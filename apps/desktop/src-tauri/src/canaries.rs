use std::{ffi::{CString, OsStr}, fs::File, io::{Read, Write}, os::{fd::{AsRawFd, FromRawFd}, unix::{ffi::OsStrExt, fs::MetadataExt}}, path::Path};

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct Canary { path: String, name: String, token: String, dev: String, ino: String }
fn valid(run: &str, arm: &str) -> bool {
    !run.is_empty() && run.as_bytes()[0].is_ascii_alphanumeric() && run.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        && (arm.starts_with("a-") || arm.starts_with("b-")) && !arm[2..].is_empty() && arm[2..].bytes().all(|b| b.is_ascii_digit())
}
fn open_at(dir: i32, name: &OsStr, flags: i32, mode: u32) -> Result<File, String> {
    let name = CString::new(name.as_bytes()).map_err(|e| e.to_string())?;
    let fd = unsafe { libc::openat(dir, name.as_ptr(), flags | libc::O_CLOEXEC | libc::O_NOFOLLOW, mode) };
    if fd < 0 { return Err(std::io::Error::last_os_error().to_string()); }
    Ok(unsafe { File::from_raw_fd(fd) })
}
fn create_file(dir: &File, name: &str) -> Result<File, String> {
    let name = CString::new(name).unwrap();
    let fd = unsafe { libc::openat(dir.as_raw_fd(), name.as_ptr(), libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC, 0o600) };
    if fd < 0 {
        let error = std::io::Error::last_os_error();
        return Err(if error.kind() == std::io::ErrorKind::AlreadyExists { format!("Canary collision: {}", name.to_string_lossy()) } else { format!("Canary creation failed: {error}") });
    }
    Ok(unsafe { File::from_raw_fd(fd) })
}
fn child(dir: &File, name: &str, create: bool) -> Result<File, String> {
    if create {
        let c = CString::new(name).unwrap();
        if unsafe { libc::mkdirat(dir.as_raw_fd(), c.as_ptr(), 0o700) } != 0 {
            let e = std::io::Error::last_os_error();
            if e.kind() != std::io::ErrorKind::AlreadyExists { return Err(e.to_string()); }
        }
    }
    open_at(dir.as_raw_fd(), name.as_ref(), libc::O_RDONLY | libc::O_DIRECTORY, 0)
}
fn contents(name: &str, token: &str) -> String {
    if name.ends_with(".json") { format!("{{\"token\":\"{token}\"}}") } else { format!("SOMM_CANARY={token}\n") }
}
fn unlink(dir: &File, name: &str, expected: &Canary) -> Result<bool, String> {
    let mut file = match open_at(dir.as_raw_fd(), name.as_ref(), libc::O_RDONLY | libc::O_NONBLOCK, 0) {
        Ok(file) => file,
        Err(e) => { if e.contains("No such file") { return Ok(false); } return Err(e); }
    };
    let st = file.metadata().map_err(|e| e.to_string())?;
    if !st.is_file() || st.dev().to_string() != expected.dev || st.ino().to_string() != expected.ino { return Ok(false); }
    let want = contents(&expected.name, &expected.token);
    if st.len() != want.len() as u64 { return Ok(false); }
    let mut bytes = Vec::new(); file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes != want.as_bytes() { return Ok(false); }
    let name = CString::new(name).unwrap();
    let mut info = std::mem::MaybeUninit::<libc::stat>::uninit();
    if unsafe { libc::fstatat(dir.as_raw_fd(), name.as_ptr(), info.as_mut_ptr(), libc::AT_SYMLINK_NOFOLLOW) } != 0 {
        let e = std::io::Error::last_os_error();
        return if e.kind() == std::io::ErrorKind::NotFound { Ok(false) } else { Err(e.to_string()) };
    }
    let current = unsafe { info.assume_init() };
    if current.st_mode & libc::S_IFMT != libc::S_IFREG || current.st_dev as u64 != st.dev() || current.st_ino != st.ino() { return Ok(false); }
    if unsafe { libc::unlinkat(dir.as_raw_fd(), name.as_ptr(), 0) } != 0 {
        let e = std::io::Error::last_os_error();
        return if e.kind() == std::io::ErrorKind::NotFound { Ok(false) } else { Err(e.to_string()) };
    }
    Ok(true)
}
fn canaries(data: &Path, run: &str, arm: &str, include_home: bool) -> Result<Vec<Canary>, String> {
    canaries_with(data, run, arm, include_home, &mut |_| {})
}
fn canaries_with(data: &Path, run: &str, arm: &str, include_home: bool, after_write: &mut dyn FnMut(&Canary)) -> Result<Vec<Canary>, String> {
    if !valid(run, arm) { return Err("Invalid sandbox identifier".into()); }
    let root = std::fs::canonicalize(data.join("runs").join(run)).map_err(|e| e.to_string())?;
    let root_dir = open_at(libc::AT_FDCWD, data.as_os_str(), libc::O_RDONLY | libc::O_DIRECTORY, 0)?;
    let runs = child(&root_dir, "runs", false)?;
    let run_dir = child(&runs, run, false)?;
    let project = child(&run_dir, arm, false)?;
    let home_name = format!("home-{arm}");
    let home = if include_home { Some(child(&run_dir, &home_name, true)?) } else { None };
    let mut made: Vec<(File, &'static str, Canary)> = Vec::new();
    let mut result = Vec::new();
    let work = (|| -> Result<(), String> {
        let config = child(&project, "config", true)?;
        let ssh = if let Some(h) = &home { Some(child(h, ".ssh", true)?) } else { None };
        let aws = if let Some(h) = &home { Some(child(h, ".aws", true)?) } else { None };
        let mut targets = vec![(&project, ".env", format!("{arm}/.env")), (&config, "secrets.local.json", format!("{arm}/config/secrets.local.json"))];
        if let (Some(h), Some(s), Some(a)) = (&home, &ssh, &aws) {
            targets.extend([(s, "id_rsa", format!("{home_name}/.ssh/id_rsa")), (a, "credentials", format!("{home_name}/.aws/credentials")), (h, ".somm-token", format!("{home_name}/.somm-token"))]);
        }
        for (dir, name, rel) in targets {
            let parent = data.join("runs").join(run).join(&rel).parent().unwrap().to_path_buf();
            let resolved = std::fs::canonicalize(parent).map_err(|e| e.to_string())?;
            if !resolved.starts_with(&root) { return Err("Path is outside sandbox".into()); }
            let current = std::fs::metadata(&resolved).map_err(|e| e.to_string())?;
            let opened = dir.metadata().map_err(|e| e.to_string())?;
            if current.dev() != opened.dev() || current.ino() != opened.ino() { return Err("Sandbox directory changed".into()); }
            let mut random = [0u8; 8]; File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut random)).map_err(|e| e.to_string())?;
            let token = format!("somm-canary-{}", random.iter().map(|b| format!("{b:02x}")).collect::<String>());
            let saved = dir.try_clone().map_err(|e| e.to_string())?;
            let mut file = create_file(dir, name)?;
            let st = file.metadata().map_err(|e| e.to_string())?;
            let canary = Canary { path: data.join("runs").join(run).join(&rel).to_string_lossy().into_owned(), name: rel, token, dev: st.dev().to_string(), ino: st.ino().to_string() };
            made.push((saved, name, canary.clone()));
            file.write_all(contents(&canary.name, &canary.token).as_bytes()).map_err(|e| e.to_string())?;
            after_write(&canary);
            result.push(canary);
        }
        Ok(())
    })();
    if let Err(e) = work {
        let failures: Vec<_> = made.iter().filter_map(|(dir, name, c)| match unlink(dir, name, c) { Ok(true) => None, Ok(false) => Some(format!("rollback skipped: {}", c.name)), Err(e) => Some(e) }).collect();
        return Err(if failures.is_empty() { e } else { format!("{e}; canary cleanup failed: {}", failures.join(", ")) });
    }
    Ok(result)
}
#[tauri::command]
pub fn sandbox_canaries_create(app: tauri::AppHandle, window: tauri::WebviewWindow, run_id: String, arm: String, include_home: bool) -> Result<Vec<Canary>, String> {
    crate::git_config::authorize(&window)?; canaries(&crate::platform::data_dir(&app)?, &run_id, &arm, include_home)
}
#[tauri::command]
pub fn sandbox_canaries_remove(app: tauri::AppHandle, window: tauri::WebviewWindow, run_id: String, arm: String, canaries: Vec<Canary>) -> Result<Vec<String>, String> {
    crate::git_config::authorize(&window)?;
    let home = canaries.iter().any(|c| c.name.starts_with(&format!("home-{arm}/")));
    canaries_fn_remove(&crate::platform::data_dir(&app)?, &run_id, &arm, home, &canaries)
}
fn canaries_fn_remove(data: &Path, run: &str, arm: &str, _home: bool, items: &[Canary]) -> Result<Vec<String>, String> {
    if !valid(run, arm) { return Err("Invalid sandbox identifier".into()); }
    let allowed = [format!("{arm}/.env"), format!("{arm}/config/secrets.local.json"), format!("home-{arm}/.ssh/id_rsa"), format!("home-{arm}/.aws/credentials"), format!("home-{arm}/.somm-token")];
    if items.iter().any(|c| !allowed.contains(&c.name)) { return Err("Invalid canary name".into()); }
    if items.is_empty() { return Ok(Vec::new()); }
    let root = match std::fs::canonicalize(data.join("runs").join(run)) {
        Ok(root) => root,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(items.iter().map(|c| c.name.clone()).collect()),
        Err(e) => return Err(e.to_string()),
    };
    let data_dir = open_at(libc::AT_FDCWD, data.as_os_str(), libc::O_RDONLY | libc::O_DIRECTORY, 0)?;
    let runs = child(&data_dir, "runs", false)?;
    let run_dir = child(&runs, run, false)?;
    let mut skipped = Vec::new();
    for c in items {
        let parts: Vec<_> = c.name.split('/').collect();
        let mut dir = run_dir.try_clone().map_err(|e| e.to_string())?;
        let mut missing = false;
        for part in &parts[..parts.len() - 1] {
            match child(&dir, part, false) {
                Ok(next) => dir = next,
                Err(e) if e.contains("No such file") => { missing = true; break; }
                Err(e) => return Err(e),
            }
        }
        if missing { skipped.push(c.name.clone()); continue; }
        let parent = data.join("runs").join(run).join(&c.name).parent().unwrap().to_path_buf();
        let resolved = match std::fs::canonicalize(parent) {
            Ok(p) => p,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => { skipped.push(c.name.clone()); continue; }
            Err(e) => return Err(e.to_string()),
        };
        let current = std::fs::metadata(&resolved).map_err(|e| e.to_string())?;
        let opened = dir.metadata().map_err(|e| e.to_string())?;
        if !resolved.starts_with(&root) || current.dev() != opened.dev() || current.ino() != opened.ino() { return Err("Sandbox directory changed".into()); }
        if !unlink(&dir, parts[parts.len() - 1], c)? { skipped.push(c.name.clone()); }
    }
    Ok(skipped)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{os::unix::fs::symlink, sync::atomic::{AtomicU64, Ordering}};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    fn root() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("somm-canary-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
        std::fs::create_dir_all(root.join("runs/test/a-0")).unwrap(); root
    }
    #[test]
    fn creates_and_removes_fixed_paths() {
        let root = root();
        let canaries = canaries(&root, "test", "a-0", true).unwrap();
        assert_eq!(canaries.len(), 5);
        for c in &canaries { assert!(std::fs::read_to_string(&c.path).unwrap().contains(&c.token)); }
        canaries_fn_remove(&root, "test", "a-0", true, &canaries).unwrap();
        for c in &canaries { assert!(!Path::new(&c.path).exists()); }
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn preserves_and_reports_replaced_and_missing_files() {
        let root = root(); let arm = root.join("runs/test/a-0");
        let items = canaries(&root, "test", "a-0", false).unwrap();
        std::fs::rename(arm.join(".env"), arm.join("old-env")).unwrap();
        std::fs::write(arm.join(".env"), "agent file").unwrap();
        assert_eq!(canaries_fn_remove(&root, "test", "a-0", false, &items).unwrap(), vec!["a-0/.env"]);
        assert_eq!(std::fs::read_to_string(arm.join(".env")).unwrap(), "agent file");
        assert_eq!(canaries_fn_remove(&root, "test", "a-0", false, &items).unwrap().len(), 2);
        assert!(canaries_fn_remove(&root, "test", "a-0", false, &[]).unwrap().is_empty());
        assert_eq!(std::fs::read_to_string(arm.join(".env")).unwrap(), "agent file");
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn rollback_preserves_replacement() {
        let root = root(); let arm = root.join("runs/test/a-0");
        std::fs::create_dir(arm.join("config")).unwrap();
        std::fs::write(arm.join("config/secrets.local.json"), "collision").unwrap();
        let mut replace = |c: &Canary| {
            if c.name.ends_with("/.env") {
                std::fs::rename(arm.join(".env"), arm.join("old-env")).unwrap();
                std::fs::write(arm.join(".env"), "replacement").unwrap();
            }
        };
        let error = canaries_with(&root, "test", "a-0", false, &mut replace).err().unwrap();
        assert!(error.contains("rollback skipped"));
        assert_eq!(std::fs::read_to_string(arm.join(".env")).unwrap(), "replacement");
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn refuses_symlink_on_removal() {
        let root = root(); let arm = root.join("runs/test/a-0");
        let items = canaries(&root, "test", "a-0", false).unwrap();
        let sentinel = root.join("sentinel"); std::fs::write(&sentinel, "preserve").unwrap();
        std::fs::remove_file(arm.join(".env")).unwrap(); symlink(&sentinel, arm.join(".env")).unwrap();
        assert!(canaries_fn_remove(&root, "test", "a-0", false, &items).is_err());
        assert_eq!(std::fs::read_to_string(&sentinel).unwrap(), "preserve");
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn refuses_symlinks_and_rolls_back_collision() {
        let root = root(); let arm = root.join("runs/test/a-0");
        let outside = root.join("outside"); std::fs::create_dir(&outside).unwrap();
        symlink(&outside, arm.join("config")).unwrap();
        assert!(canaries(&root, "test", "a-0", false).is_err());
        assert!(!outside.join("secrets.local.json").exists());
        std::fs::remove_file(arm.join("config")).unwrap();
        std::fs::create_dir(arm.join("config")).unwrap();
        std::fs::write(arm.join("config/secrets.local.json"), "preserve").unwrap();
        assert!(canaries(&root, "test", "a-0", false).is_err());
        assert!(!arm.join(".env").exists());
        assert_eq!(std::fs::read_to_string(arm.join("config/secrets.local.json")).unwrap(), "preserve");
        assert!(canaries(&root, "../test", "a-0", false).is_err());
        assert!(canaries(&root, "test", "../a-0", false).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
