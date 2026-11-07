#[cfg(test)]
mod tests {
    #[test]
    fn redacts_plain_and_json_escaped_keys() {
        let keys = super::secret_forms(&["a\"b".to_string()]);
        assert_eq!(super::redact("a\"b and a\\\"b", &keys), "[REDACTED] and [REDACTED]");
    }
    #[test]
    fn masks_encoded_and_split_secrets() {
        let forms = super::secret_forms(&["secret+/".to_string()]);
        for value in ["secret%2B%2F", "7365637265742b2f", "c2VjcmV0Ky8=", "c2VjcmV0Ky8"] {
            assert!(!super::redact(value, &forms).contains(value));
        }
        assert!(!super::redact("sec\nret+/", &forms).contains("sec\nret+/"));
    }
    #[test]
    fn validates_binary_name_and_path() {
        assert!(super::is_allowed("claude", "/x/bin/claude"));
        assert!(!super::is_allowed("claude", "/x/bin/sh"));
        assert!(!super::is_allowed("rm", "/bin/rm"));
        assert!(!super::is_allowed("node", "node"));
        assert!(super::is_allowed("pwd", "/bin/pwd"));
        assert!(!super::is_allowed("pwd", "/tmp/pwd"));
        assert!(super::allowed_args("pwd", &["-P".into()]));
        assert!(!super::allowed_args("pwd", &["-L".into()]));
        assert!(!super::allowed_args("pwd", &[]));
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
    "python3", "uv", "cargo", "go", "pwd",
];
pub(crate) fn is_allowed(name: &str, path: &str) -> bool {
    ALLOWED.contains(&name)
        && (name != "pwd" || path == "/bin/pwd")
        && Path::new(path).is_absolute()
        && Path::new(path).file_name().and_then(|n| n.to_str()) == Some(name)
}
fn allowed_args(name: &str, args: &[String]) -> bool {
    name != "pwd" || args == ["-P"]
}
fn secret_forms(keys: &[String]) -> Vec<String> {
    const B64: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut forms = Vec::new();
    for key in keys.iter().filter(|k| !k.is_empty()) {
        let bytes = key.as_bytes();
        forms.push(key.clone());
        forms.push(key.chars().flat_map(|c| match c {
            '"' => "\\\"".to_string(), '\\' => "\\\\".to_string(), '\n' => "\\n".to_string(), '\r' => "\\r".to_string(), '\t' => "\\t".to_string(),
            c if c.is_control() => format!("\\u{:04x}", c as u32), c => c.to_string(),
        }.chars().collect::<Vec<_>>()).collect());
        forms.push(bytes.iter().map(|b| format!("%{b:02X}")).collect());
        forms.push(bytes.iter().map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(b) { (*b as char).to_string() } else { format!("%{b:02X}") }).collect());
        forms.push(bytes.iter().map(|b| format!("{b:02x}")).collect());
        forms.push(bytes.iter().map(|b| format!("{b:02X}")).collect());
        for prefix in 0..3 {
            let data = [vec![0; prefix], bytes.to_vec()].concat();
            let mut encoded = String::new();
            for chunk in data.chunks(3) {
                let n = ((chunk[0] as u32) << 16) | ((chunk.get(1).copied().unwrap_or(0) as u32) << 8) | chunk.get(2).copied().unwrap_or(0) as u32;
                encoded.push(B64[((n >> 18) & 63) as usize] as char); encoded.push(B64[((n >> 12) & 63) as usize] as char);
                encoded.push(if chunk.len() > 1 { B64[((n >> 6) & 63) as usize] as char } else { '=' });
                encoded.push(if chunk.len() > 2 { B64[(n & 63) as usize] as char } else { '=' });
            }
            let start = match prefix { 0 => 0, 1 => 2, _ => 3 };
            let encoded = &encoded[start..];
            for form in [encoded.to_string(), encoded.trim_end_matches('=').to_string()] {
                forms.push(form.clone()); forms.push(form.replace('+', "-").replace('/', "_"));
            }
        }
    }
    forms.retain(|f| !f.is_empty()); forms.sort_by_key(|f| std::cmp::Reverse(f.len())); forms.dedup(); forms
}
fn redact(text: &str, forms: &[String]) -> String {
    let mut result = text.to_string();
    for form in forms {
        result = result.replace(form, "[REDACTED]");
        for (i, _) in form.char_indices().skip(1) {
            let split = format!("{}\n{}", &form[..i], &form[i..]);
            result = result.replace(&split, "[REDACTED]\n");
        }
    }
    result
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
    if !environment.permits(&bin_name, &bin_path) || !allowed_args(&bin_name, &args) {
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
    let keys: Vec<String> = ["ANTHROPIC_API_KEY", "CODEX_API_KEY"].iter()
        .filter_map(|name| env.get(*name).and_then(|value| value.clone())).filter(|value| !value.is_empty()).collect();
    let secrets = secret_forms(&keys);
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
        let secrets = secrets.clone();
        thread::spawn(move || {
            let mut reader = BufReader::new(input);
            let mut pending: Option<(String, bool)> = None;
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
                        let current = String::from_utf8_lossy(&bytes).into_owned();
                        if let Some((previous, previous_terminated)) = pending.take() {
                            let joined = redact(&format!("{previous}\n{current}"), &secrets);
                            let (first, rest) = joined.split_once('\n').unwrap_or((&joined, ""));
                            let _ = app.emit("proc://line", Line { id: id.clone(), stream: stream.clone(), line: first.into(), terminated: previous_terminated });
                            pending = Some((rest.into(), terminated));
                        } else { pending = Some((current, terminated)); }
                    }
                }
            }
            if let Some((line, terminated)) = pending {
                let _ = app.emit("proc://line", Line { id, stream, line: redact(&line, &secrets), terminated });
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
