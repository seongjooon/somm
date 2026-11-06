#[cfg(test)]
mod tests {
    #[test]
    fn validates_binary_name_and_path() {
        assert!(super::is_allowed("claude", "/x/bin/claude"));
        assert!(!super::is_allowed("claude", "/x/bin/sh"));
        assert!(!super::is_allowed("rm", "/bin/rm"));
        assert!(!super::is_allowed("node", "node"));
    }
}

use std::{
    collections::HashMap,
    io::{BufRead, BufReader},
    os::unix::process::CommandExt,
    path::Path,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{Emitter, Manager, State};
const ALLOWED: &[&str] = &[
    "claude", "codex", "git", "tar", "cp", "docker", "node", "npm", "npx", "pnpm", "yarn",
    "python3", "uv", "cargo", "go",
];
pub(crate) fn is_allowed(name: &str, path: &str) -> bool {
    ALLOWED.contains(&name)
        && Path::new(path).is_absolute()
        && Path::new(path).file_name().and_then(|n| n.to_str()) == Some(name)
}
#[derive(Default)]
pub struct Processes(pub Mutex<HashMap<String, Arc<Mutex<Child>>>>);
#[derive(Clone, serde::Serialize)]
struct Line {
    id: String,
    stream: String,
    line: String,
    terminated: bool,
}
#[derive(Clone, serde::Serialize)]
struct Exit {
    id: String,
    code: i32,
}
fn signal(pid: u32, sig: &str) {
    let _ = Command::new("/bin/kill")
        .args([sig, "--", &format!("-{pid}")])
        .status();
}
#[tauri::command]
pub async fn resolve_bins(
    state: State<'_, crate::environment::Environment>,
    names: Vec<String>,
) -> Result<HashMap<String, Option<String>>, String> {
    Ok(state.resolve(names))
}
#[tauri::command]
pub fn spawn_agent(
    app: tauri::AppHandle,
    state: State<Processes>,
    environment: State<crate::environment::Environment>,
    id: String,
    bin_name: String,
    bin_path: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: HashMap<String, Option<String>>,
) -> Result<(), String> {
    if !environment.permits(&bin_name, &bin_path) {
        return Err("Binary is not allowed".into());
    }
    let mut processes = state.0.lock().map_err(|e| e.to_string())?;
    if processes.contains_key(&id) {
        return Err("Process id already exists".into());
    }
    let mut cmd = Command::new(bin_path);
    environment.apply(&mut cmd);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    for (key, value) in env {
        match value {
            Some(v) => {
                cmd.env(key, v);
            }
            None => {
                cmd.env_remove(key);
            }
        }
    }
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let child = Arc::new(Mutex::new(child));
    processes.insert(id.clone(), child.clone());
    let reader = |input: Box<dyn std::io::Read + Send>, stream: &str| {
        let app = app.clone();
        let id = id.clone();
        let stream = stream.to_string();
        thread::spawn(move || {
            let mut reader = BufReader::new(input);
            loop {
                let mut bytes = Vec::new();
                match reader.read_until(b'\n', &mut bytes) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        let terminated = bytes.last() == Some(&b'\n');
                        if terminated {
                            bytes.pop();
                            if bytes.last() == Some(&b'\r') {
                                bytes.pop();
                            }
                        }
                        let _ = app.emit(
                            "proc://line",
                            Line {
                                id: id.clone(),
                                stream: stream.clone(),
                                line: String::from_utf8_lossy(&bytes).into_owned(),
                                terminated,
                            },
                        );
                    }
                }
            }
        })
    };
    let out = reader(Box::new(stdout), "stdout");
    let err = reader(Box::new(stderr), "stderr");
    thread::spawn(move || {
        let code = loop {
            match child.lock().unwrap().try_wait() {
                Ok(Some(status)) => break status.code().unwrap_or(1),
                Err(_) => break 1,
                _ => thread::sleep(Duration::from_millis(15)),
            }
        };
        let _ = out.join();
        let _ = err.join();
        app.state::<Processes>().0.lock().unwrap().remove(&id);
        let _ = app.emit("proc://exit", Exit { id, code });
    });
    Ok(())
}
#[tauri::command]
pub async fn kill_agent(state: State<'_, Processes>, id: String) -> Result<(), String> {
    let child = state.0.lock().map_err(|e| e.to_string())?.get(&id).cloned();
    if let Some(child) = child {
        let pid = child.lock().map_err(|e| e.to_string())?.id();
        tauri::async_runtime::spawn_blocking(move || {
            signal(pid, "-TERM");
            thread::sleep(Duration::from_millis(300));
            signal(pid, "-KILL");
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
pub fn kill_all(state: &Processes) {
    for child in state.0.lock().unwrap().values() {
        signal(child.lock().unwrap().id(), "-KILL");
    }
}
