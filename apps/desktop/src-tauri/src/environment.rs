#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ignores_profile_noise_and_filters_secrets() {
        let env = parse_env(b"noise\nPATH=wrong\0MARK\0PATH=/custom/bin\0HOME=/tmp/home\0API_KEY=secret\0CODEX_HOME=/tmp/codex\0CLAUDE_CONFIG_DIR=/tmp/claude\0", b"MARK\0").unwrap();
        assert_eq!(env.len(), 4);
        assert_eq!(env["PATH"], "/custom/bin");
        assert!(parse_env(b"PATH=/wrong", b"MARK\0").is_none());
    }
    #[test]
    fn resolves_executable_files_and_requires_prior_resolution() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("somm-env-{}", std::process::id()));
        let first = root.join("first");
        let second = root.join("second");
        std::fs::create_dir_all(first.join("node")).unwrap();
        std::fs::create_dir_all(&second).unwrap();
        let node = second.join("node");
        std::fs::write(&node, "#!/bin/sh\nprintf success").unwrap();
        std::fs::set_permissions(&node, std::fs::Permissions::from_mode(0o755)).unwrap();
        let env = Environment::default();
        env.vars
            .set(HashMap::from([
                (
                    "PATH".into(),
                    format!("{}:{}:/usr/bin:/bin", first.display(), second.display()),
                ),
                ("HOME".into(), root.to_string_lossy().into_owned()),
            ]))
            .unwrap();
        let path = node.to_str().unwrap();
        assert!(!env.permits("node", path));
        let resolved = env.resolve(vec!["node".into(), "rm".into(), "missing".into()]);
        assert_eq!(resolved["node"].as_deref(), Some(path));
        assert!(resolved["rm"].is_none());
        assert!(resolved["missing"].is_none());
        assert!(env.permits("node", path));
        assert!(!env.permits("node", "/elsewhere/node"));
        let mut cmd = Command::new("/usr/bin/env");
        cmd.arg("node");
        env.apply(&mut cmd);
        assert_eq!(cmd.output().unwrap().stdout, b"success");
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn pwd_resolution_ignores_path_and_runs_physical_directory_check() {
        let root = std::env::temp_dir().join(format!("somm-pwd-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let env = Environment::default();
        env.vars.set(HashMap::from([("PATH".into(), root.to_string_lossy().into_owned())])).unwrap();
        let paths = env.resolve(vec!["pwd".into()]);
        assert_eq!(paths["pwd"].as_deref(), Some("/bin/pwd"));
        assert!(env.permits("pwd", "/bin/pwd"));
        assert!(!env.permits("pwd", root.join("pwd").to_str().unwrap()));
        let output = Command::new(&paths["pwd"].as_ref().unwrap()).arg("-P").current_dir(&root).output().unwrap();
        assert!(output.status.success());
        assert_eq!(String::from_utf8(output.stdout).unwrap().trim(), std::fs::canonicalize(&root).unwrap().to_str().unwrap());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn falls_back_in_order_and_filters_app_environment() {
        let mut flags = Vec::new();
        let env = load_env(
            |flag| {
                flags.push(flag.to_string());
                if flag == "-lc" {
                    Some(b"MARKPATH=/login\0".to_vec())
                } else {
                    None
                }
            },
            b"MARK",
            || HashMap::new(),
        );
        assert_eq!(flags, ["-ilc", "-lc"]);
        assert_eq!(env["PATH"], "/login");
        let fallback = load_env(
            |_| None,
            b"MARK",
            || {
                HashMap::from([
                    ("PATH".into(), "/app".into()),
                    ("API_KEY".into(), "secret".into()),
                ])
            },
        );
        assert_eq!(fallback, HashMap::from([("PATH".into(), "/app".into())]));
    }
    #[test]
    fn captures_output_and_bounds_hung_shells() {
        let output = capture(
            "/bin/sh",
            &["-c", "printf 'noiseMARK'; /usr/bin/env -0"],
            std::time::Duration::from_secs(1),
        )
        .unwrap();
        assert!(parse_env(&output, b"MARK").unwrap().contains_key("PATH"));
        let start = std::time::Instant::now();
        assert!(capture(
            "/bin/sh",
            &["-c", "sleep 20"],
            std::time::Duration::from_millis(50)
        )
        .is_none());
        assert!(start.elapsed() < std::time::Duration::from_secs(2));
        assert!(capture(
            "/bin/sh",
            &["-c", "exit 1"],
            std::time::Duration::from_secs(1)
        )
        .is_none());
    }
}

use std::{
    collections::HashMap,
    io::Read,
    os::unix::{fs::PermissionsExt, process::CommandExt},
    process::{Command, Stdio},
    sync::{Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};
const KEYS: &[&str] = &["PATH", "HOME", "CODEX_HOME", "CLAUDE_CONFIG_DIR"];
#[derive(Default)]
pub struct Environment {
    vars: OnceLock<HashMap<String, String>>,
    resolved: Mutex<HashMap<String, String>>,
}
impl Environment {
    pub fn vars(&self) -> &HashMap<String, String> {
        self.vars.get_or_init(login_env)
    }
    pub fn resolve(&self, names: Vec<String>) -> HashMap<String, Option<String>> {
        let mut cache = self.resolved.lock().unwrap();
        names
            .into_iter()
            .map(|name| {
                let path = find_bin(
                    &name,
                    self.vars().get("PATH").map(String::as_str).unwrap_or(""),
                );
                if let Some(ref path) = path {
                    cache.insert(name.clone(), path.clone());
                } else {
                    cache.remove(&name);
                }
                (name, path)
            })
            .collect()
    }
    pub fn permits(&self, name: &str, path: &str) -> bool {
        self.resolved
            .lock()
            .unwrap()
            .get(name)
            .is_some_and(|p| p == path)
            && crate::process::is_allowed(name, path)
    }
    pub fn apply(&self, cmd: &mut Command) {
        for key in KEYS {
            cmd.env_remove(key);
        }
        cmd.envs(self.vars());
    }
}
fn find_bin(name: &str, path: &str) -> Option<String> {
    if name == "pwd" { return Some("/bin/pwd".into()); }
    if !crate::process::is_allowed(name, &format!("/bin/{name}")) {
        return None;
    }
    std::env::split_paths(path)
        .filter(|p| p.is_absolute())
        .find_map(|dir| {
            let file = dir.join(name);
            let meta = file.metadata().ok()?;
            (meta.is_file() && meta.permissions().mode() & 0o111 != 0)
                .then(|| file.to_string_lossy().into_owned())
        })
}
fn parse_env(bytes: &[u8], marker: &[u8]) -> Option<HashMap<String, String>> {
    let start = bytes.windows(marker.len()).position(|w| w == marker)? + marker.len();
    Some(
        bytes[start..]
            .split(|b| *b == 0)
            .filter_map(|entry| {
                let entry = std::str::from_utf8(entry).ok()?;
                let (key, value) = entry.split_once('=')?;
                KEYS.contains(&key)
                    .then(|| (key.to_string(), value.to_string()))
            })
            .collect(),
    )
}
fn login_env() -> HashMap<String, String> {
    let marker = format!(
        "SOMM_ENV_{}_{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    let script = format!("printf '{marker}\\0'; /usr/bin/env -0");
    let marker = format!("{marker}\0");
    load_env(
        |flag| capture("/bin/zsh", &[flag, &script], Duration::from_secs(5)),
        marker.as_bytes(),
        || std::env::vars().collect(),
    )
}
fn load_env(
    mut run: impl FnMut(&str) -> Option<Vec<u8>>,
    marker: &[u8],
    fallback: impl FnOnce() -> HashMap<String, String>,
) -> HashMap<String, String> {
    for flag in ["-ilc", "-lc"] {
        if let Some(env) = run(flag).and_then(|bytes| parse_env(&bytes, marker)) {
            if env.contains_key("PATH") {
                return env;
            }
        }
    }
    fallback()
        .into_iter()
        .filter(|(key, _)| KEYS.contains(&key.as_str()))
        .collect()
}
fn capture(bin: &str, args: &[&str], timeout: Duration) -> Option<Vec<u8>> {
    let mut child = Command::new(bin)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .ok()?;
    let pid = child.id();
    let mut stdout = child.stdout.take()?;
    let (tx, rx) = std::sync::mpsc::channel();
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = stdout.read_to_end(&mut bytes).map(|_| bytes);
        let _ = tx.send(result);
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(10)),
            _ => break None,
        }
    };
    let output = if status.is_some_and(|s| s.success()) {
        rx.recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .ok()
            .and_then(Result::ok)
    } else {
        None
    };
    // Clean up shell descendants too, including background profile commands.
    let _ = Command::new("/bin/kill")
        .args(["-KILL", "--", &format!("-{pid}")])
        .stderr(Stdio::null())
        .status();
    let _ = child.wait();
    output
}
