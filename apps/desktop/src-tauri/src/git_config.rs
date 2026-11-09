use std::{collections::HashMap, ffi::CString, fs::File, io::{Read, Write}, os::{fd::{AsRawFd, FromRawFd}, unix::{ffi::OsStrExt, fs::MetadataExt}}, path::Path, sync::{atomic::{AtomicU64, Ordering}, Mutex}};

#[derive(Default)]
pub struct Snapshots(Mutex<HashMap<String, Snapshot>>);
struct Snapshot { dirs: Vec<File>, contents: Vec<u8> }
static NEXT: AtomicU64 = AtomicU64::new(0);

fn valid_run(id: &str) -> bool {
    !id.is_empty() && id.as_bytes()[0].is_ascii_alphanumeric() && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
fn open_at(dir: i32, name: &std::ffi::OsStr, flags: i32, mode: u32) -> Result<File, String> {
    let name = CString::new(name.as_bytes()).map_err(|e| e.to_string())?;
    let fd = unsafe { libc::openat(dir, name.as_ptr(), flags | libc::O_CLOEXEC | libc::O_NOFOLLOW, mode) };
    if fd < 0 { return Err(std::io::Error::last_os_error().to_string()); }
    Ok(unsafe { File::from_raw_fd(fd) })
}
fn directories(data: &Path, id: &str) -> Result<Vec<File>, String> {
    if !valid_run(id) { return Err("Invalid sandbox run".into()); }
    let mut dirs = vec![open_at(libc::AT_FDCWD, data.as_os_str(), libc::O_RDONLY | libc::O_DIRECTORY, 0)?];
    for name in ["runs", id, "base", ".git"] {
        dirs.push(open_at(dirs.last().unwrap().as_raw_fd(), name.as_ref(), libc::O_RDONLY | libc::O_DIRECTORY, 0)?);
    }
    Ok(dirs)
}
fn same_dirs(data: &Path, id: &str, original: &[File]) -> Result<(), String> {
    for (a, b) in directories(data, id)?.iter().zip(original) {
        let (a, b) = (a.metadata().map_err(|e| e.to_string())?, b.metadata().map_err(|e| e.to_string())?);
        if a.dev() != b.dev() || a.ino() != b.ino() { return Err("Sandbox directory changed".into()); }
    }
    Ok(())
}
impl Snapshots {
    fn snapshot(&self, data: &Path, id: &str) -> Result<(), String> {
        let mut snapshots = self.0.lock().map_err(|e| e.to_string())?;
        if snapshots.contains_key(id) { return Err("Snapshot already exists".into()); }
        let dirs = directories(data, id)?;
        let mut config = open_at(dirs.last().unwrap().as_raw_fd(), "config".as_ref(), libc::O_RDONLY | libc::O_NONBLOCK, 0)?;
        if !config.metadata().map_err(|e| e.to_string())?.is_file() { return Err("Config is not a regular file".into()); }
        let mut contents = Vec::new();
        config.read_to_end(&mut contents).map_err(|e| e.to_string())?;
        same_dirs(data, id, &dirs)?;
        snapshots.insert(id.into(), Snapshot { dirs, contents });
        Ok(())
    }
    fn restore(&self, data: &Path, id: &str) -> Result<(), String> {
        let snapshots = self.0.lock().map_err(|e| e.to_string())?;
        let snapshot = snapshots.get(id).ok_or("Unknown sandbox run")?;
        same_dirs(data, id, &snapshot.dirs)?;
        let dir = snapshot.dirs.last().unwrap().as_raw_fd();
        let config = open_at(dir, "config".as_ref(), libc::O_RDONLY | libc::O_NONBLOCK, 0)?;
        if !config.metadata().map_err(|e| e.to_string())?.is_file() { return Err("Config is not a regular file".into()); }
        let name = format!(".somm-config-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed));
        let mut temp = open_at(dir, name.as_ref(), libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL, 0o600)?;
        let name = CString::new(name).unwrap();
        let result = (|| {
            temp.write_all(&snapshot.contents).map_err(|e| e.to_string())?;
            same_dirs(data, id, &snapshot.dirs)?;
            // Same-UID processes can still race directory and config checks.
            let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
            if unsafe { libc::fstatat(dir, c"config".as_ptr(), stat.as_mut_ptr(), libc::AT_SYMLINK_NOFOLLOW) } != 0 { return Err(std::io::Error::last_os_error().to_string()); }
            if unsafe { stat.assume_init() }.st_mode & libc::S_IFMT != libc::S_IFREG { return Err("Config is not a regular file".into()); }
            if unsafe { libc::renameat(dir, name.as_ptr(), dir, c"config".as_ptr()) } != 0 { return Err(std::io::Error::last_os_error().to_string()); }
            Ok(())
        })();
        unsafe { libc::unlinkat(dir, name.as_ptr(), 0); }
        result
    }
    fn forget(&self, id: &str) -> Result<(), String> {
        self.0.lock().map_err(|e| e.to_string())?.remove(id).map(|_| ()).ok_or_else(|| "Unknown sandbox run".into())
    }
}
pub(crate) fn authorize(window: &tauri::WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|e| e.to_string())?;
    let local = url.username().is_empty() && url.password().is_none() && match (url.scheme(), url.host_str(), url.port()) {
        ("tauri", Some("localhost"), None) | ("http", Some("tauri.localhost"), None) => true,
        ("http", Some("localhost"), Some(1420)) if cfg!(debug_assertions) => true,
        _ => false,
    };
    if window.label() == "main" && local { Ok(()) } else { Err("Untrusted webview origin".into()) }
}
#[tauri::command]
pub fn sandbox_git_snapshot(app: tauri::AppHandle, window: tauri::WebviewWindow, state: tauri::State<'_, Snapshots>, run_id: String) -> Result<(), String> {
    authorize(&window)?; state.snapshot(&crate::platform::data_dir(&app)?, &run_id)
}
#[tauri::command]
pub fn sandbox_git_restore(app: tauri::AppHandle, window: tauri::WebviewWindow, state: tauri::State<'_, Snapshots>, run_id: String) -> Result<(), String> {
    authorize(&window)?; state.restore(&crate::platform::data_dir(&app)?, &run_id)
}
#[tauri::command]
pub fn sandbox_git_forget(window: tauri::WebviewWindow, state: tauri::State<'_, Snapshots>, run_id: String) -> Result<(), String> {
    authorize(&window)?; state.forget(&run_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn isolated_lifecycle_and_symlink_defenses() {
        let root = std::env::temp_dir().join(format!("somm-git-config-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
        let git = |id: &str| root.join("runs").join(id).join("base/.git");
        for id in ["a", "b"] { std::fs::create_dir_all(git(id)).unwrap(); std::fs::write(git(id).join("config"), id).unwrap(); }
        let state = Snapshots::default();
        assert!(state.snapshot(&root, "../a").is_err());
        state.snapshot(&root, "a").unwrap(); state.snapshot(&root, "b").unwrap();
        assert!(state.snapshot(&root, "a").is_err());
        let sentinel = root.join("sentinel"); std::fs::write(&sentinel, "safe").unwrap();
        std::fs::remove_file(git("a").join("config")).unwrap();
        std::os::unix::fs::symlink(&sentinel, git("a").join("config")).unwrap();
        assert!(state.restore(&root, "a").is_err());
        assert_eq!(std::fs::read_to_string(&sentinel).unwrap(), "safe");
        std::fs::write(git("b").join("config"), "bad").unwrap();
        state.restore(&root, "b").unwrap();
        assert_eq!(std::fs::read_to_string(git("b").join("config")).unwrap(), "b");
        std::fs::rename(git("b"), root.join("old-git")).unwrap();
        std::fs::create_dir(git("b")).unwrap();
        assert!(state.restore(&root, "b").is_err());
        state.forget("a").unwrap(); assert!(state.restore(&root, "a").is_err()); assert!(state.forget("a").is_err());
        state.forget("b").unwrap(); assert!(state.restore(&root, "missing").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
