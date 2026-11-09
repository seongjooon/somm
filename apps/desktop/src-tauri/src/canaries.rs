use std::{ffi::{CString, OsStr}, fs::File, io::{Read, Write}, os::{fd::{AsRawFd, FromRawFd}, unix::{ffi::OsStrExt, fs::MetadataExt}}, path::Path};

#[derive(serde::Serialize)]
pub(crate) struct Canary { path: String, token: String }
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
fn unlink(dir: &File, name: &str) -> Result<(), String> {
    let c = CString::new(name).unwrap();
    let mut info = std::mem::MaybeUninit::<libc::stat>::uninit();
    if unsafe { libc::fstatat(dir.as_raw_fd(), c.as_ptr(), info.as_mut_ptr(), libc::AT_SYMLINK_NOFOLLOW) } != 0 {
        let e = std::io::Error::last_os_error();
        return if e.kind() == std::io::ErrorKind::NotFound { Ok(()) } else { Err(e.to_string()) };
    }
    if unsafe { info.assume_init() }.st_mode & libc::S_IFMT != libc::S_IFREG { return Err("Canary path is not a regular file".into()); }
    let name = CString::new(name).unwrap();
    if unsafe { libc::unlinkat(dir.as_raw_fd(), name.as_ptr(), 0) } != 0 {
        let e = std::io::Error::last_os_error();
        if e.kind() != std::io::ErrorKind::NotFound { return Err(e.to_string()); }
    }
    Ok(())
}
fn canaries(data: &Path, run: &str, arm: &str, include_home: bool, remove: bool) -> Result<Vec<Canary>, String> {
    if !valid(run, arm) { return Err("Invalid sandbox identifier".into()); }
    let root = std::fs::canonicalize(data.join("runs").join(run)).map_err(|e| e.to_string())?;
    let root_dir = open_at(libc::AT_FDCWD, data.as_os_str(), libc::O_RDONLY | libc::O_DIRECTORY, 0)?;
    let runs = child(&root_dir, "runs", false)?;
    let run_dir = child(&runs, run, false)?;
    let project = child(&run_dir, arm, false)?;
    let home_name = format!("home-{arm}");
    let home = if include_home { Some(child(&run_dir, &home_name, !remove)?) } else { None };
    let mut made: Vec<(File, &'static str)> = Vec::new();
    let mut result = Vec::new();
    let work = (|| -> Result<(), String> {
        let config = child(&project, "config", !remove)?;
        let ssh = if let Some(h) = &home { Some(child(h, ".ssh", !remove)?) } else { None };
        let aws = if let Some(h) = &home { Some(child(h, ".aws", !remove)?) } else { None };
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
            if remove { unlink(dir, name)?; continue; }
            let mut random = [0u8; 8]; File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut random)).map_err(|e| e.to_string())?;
            let token = format!("somm-canary-{}", random.iter().map(|b| format!("{b:02x}")).collect::<String>());
            let saved = dir.try_clone().map_err(|e| e.to_string())?;
            let mut file = create_file(dir, name)?;
            made.push((saved, name));
            let contents = if name.ends_with(".json") { format!("{{\"token\":\"{token}\"}}") } else { format!("SOMM_CANARY={token}\n") };
            file.write_all(contents.as_bytes()).map_err(|e| e.to_string())?;
            result.push(Canary { path: data.join("runs").join(run).join(rel).to_string_lossy().into_owned(), token });
        }
        Ok(())
    })();
    if let Err(e) = work {
        let failures: Vec<_> = made.iter().filter_map(|(dir, name)| unlink(dir, name).err()).collect();
        return Err(if failures.is_empty() { e } else { format!("{e}; canary cleanup failed: {}", failures.join(", ")) });
    }
    Ok(result)
}
#[tauri::command]
pub fn sandbox_canaries_create(app: tauri::AppHandle, window: tauri::WebviewWindow, run_id: String, arm: String, include_home: bool) -> Result<Vec<Canary>, String> {
    crate::git_config::authorize(&window)?; canaries(&crate::platform::data_dir(&app)?, &run_id, &arm, include_home, false)
}
#[tauri::command]
pub fn sandbox_canaries_remove(app: tauri::AppHandle, window: tauri::WebviewWindow, run_id: String, arm: String, include_home: bool) -> Result<(), String> {
    crate::git_config::authorize(&window)?; canaries(&crate::platform::data_dir(&app)?, &run_id, &arm, include_home, true).map(|_| ())
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
        let canaries = canaries(&root, "test", "a-0", true, false).unwrap();
        assert_eq!(canaries.len(), 5);
        for c in &canaries { assert!(std::fs::read_to_string(&c.path).unwrap().contains(&c.token)); }
        canaries_remove(&root);
        for c in &canaries { assert!(!Path::new(&c.path).exists()); }
        std::fs::remove_dir_all(root).unwrap();
    }
    fn canaries_remove(root: &Path) { canaries(root, "test", "a-0", true, true).unwrap(); }
    #[test]
    fn refuses_symlink_on_removal() {
        let root = root(); let arm = root.join("runs/test/a-0");
        canaries(&root, "test", "a-0", false, false).unwrap();
        let sentinel = root.join("sentinel"); std::fs::write(&sentinel, "preserve").unwrap();
        std::fs::remove_file(arm.join(".env")).unwrap(); symlink(&sentinel, arm.join(".env")).unwrap();
        assert!(canaries(&root, "test", "a-0", false, true).is_err());
        assert_eq!(std::fs::read_to_string(&sentinel).unwrap(), "preserve");
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn refuses_symlinks_and_rolls_back_collision() {
        let root = root(); let arm = root.join("runs/test/a-0");
        let outside = root.join("outside"); std::fs::create_dir(&outside).unwrap();
        symlink(&outside, arm.join("config")).unwrap();
        assert!(canaries(&root, "test", "a-0", false, false).is_err());
        assert!(!outside.join("secrets.local.json").exists());
        std::fs::remove_file(arm.join("config")).unwrap();
        std::fs::create_dir(arm.join("config")).unwrap();
        std::fs::write(arm.join("config/secrets.local.json"), "preserve").unwrap();
        assert!(canaries(&root, "test", "a-0", false, false).is_err());
        assert!(!arm.join(".env").exists());
        assert_eq!(std::fs::read_to_string(arm.join("config/secrets.local.json")).unwrap(), "preserve");
        assert!(canaries(&root, "../test", "a-0", false, false).is_err());
        assert!(canaries(&root, "test", "../a-0", false, false).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
