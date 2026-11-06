use tauri::Manager;
use tauri_plugin_fs::FsExt;
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Context {
    home: String,
    data_dir: String,
    env: std::collections::HashMap<String, String>,
}
pub fn context(app: &tauri::AppHandle) -> Result<Context, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let data = std::env::var("SOMM_DATA_DIR")
        .ok()
        .filter(|s| !s.is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| home.join("Library/Application Support/io.github.seongjooon.somm"));
    std::fs::create_dir_all(&data).map_err(|e| e.to_string())?;
    app.fs_scope()
        .allow_directory(&data, true)
        .map_err(|e| e.to_string())?;
    let mut env = app
        .state::<crate::environment::Environment>()
        .vars()
        .clone();
    env.insert("SOMM_DATA_DIR".into(), data.to_string_lossy().into_owned());
    Ok(Context {
        env,
        home: home.to_string_lossy().into_owned(),
        data_dir: data.to_string_lossy().into_owned(),
    })
}
#[tauri::command]
pub fn platform_context(app: tauri::AppHandle) -> Result<Context, String> {
    context(&app)
}
#[tauri::command]
pub fn symlink(app: tauri::AppHandle, target: String, link: String) -> Result<(), String> {
    scoped_symlink(
        std::path::Path::new(&target),
        std::path::Path::new(&link),
        |p| app.fs_scope().is_allowed(p),
    )
}

fn scoped_symlink(
    target: &std::path::Path,
    link: &std::path::Path,
    allowed: impl Fn(&std::path::Path) -> bool,
) -> Result<(), String> {
    if !allowed(link) {
        return Err("Path outside filesystem scope".into());
    }
    let absolute = if target.is_absolute() {
        target.to_path_buf()
    } else {
        link.parent().ok_or("Missing link parent")?.join(target)
    };
    if !allowed(&absolute) {
        return Err("Link target outside filesystem scope".into());
    }
    let resolved = std::fs::canonicalize(&absolute).map_err(|e| e.to_string())?;
    if !allowed(&resolved) {
        return Err("Resolved path outside filesystem scope".into());
    }
    std::os::unix::fs::symlink(target, link).map_err(|e| e.to_string())
}

fn scoped_readlink(
    path: &std::path::Path,
    allowed: impl Fn(&std::path::Path) -> bool,
) -> Result<String, String> {
    if !allowed(path) {
        return Err("Path outside filesystem scope".into());
    }
    let target = std::fs::read_link(path).map_err(|e| e.to_string())?;
    let absolute = if target.is_absolute() {
        target.clone()
    } else {
        path.parent().ok_or("Missing link parent")?.join(&target)
    };
    if !allowed(&absolute) {
        return Err("Link target outside filesystem scope".into());
    }
    let resolved = std::fs::canonicalize(&absolute).map_err(|e| e.to_string())?;
    if !allowed(&resolved) {
        return Err("Resolved path outside filesystem scope".into());
    }
    target
        .into_os_string()
        .into_string()
        .map_err(|_| "Non-UTF-8 path".into())
}

#[tauri::command]
pub fn readlink(app: tauri::AppHandle, path: String) -> Result<String, String> {
    scoped_readlink(std::path::Path::new(&path), |p| {
        app.fs_scope().is_allowed(p)
    })
}

#[cfg(test)]
mod tests {
    use super::{scoped_readlink, scoped_symlink};
    #[test]
    fn preserves_direct_targets_and_checks_link_immediate_and_final_scopes() {
        let root = std::env::temp_dir().join(format!(
            "somm-readlink-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("target"), "ok").unwrap();
        std::os::unix::fs::symlink("target", root.join("link")).unwrap();
        let link = root.join("link");

        assert_eq!(scoped_readlink(&link, |_| true).unwrap(), "target");
        assert!(scoped_readlink(&link, |_| false)
            .unwrap_err()
            .contains("outside filesystem scope"));
        assert!(scoped_readlink(&link, |p| p == link)
            .unwrap_err()
            .contains("outside filesystem scope"));
        assert!(scoped_readlink(&root.join("missing"), |_| true).is_err());
        std::os::unix::fs::symlink("target", root.join("current")).unwrap();
        let chain = root.join("chain");
        scoped_symlink(std::path::Path::new("current"), &chain, |_| true).unwrap();
        assert_eq!(scoped_readlink(&chain, |_| true).unwrap(), "current");
        let final_target = std::fs::canonicalize(root.join("target")).unwrap();
        assert!(scoped_readlink(&chain, |p| p != final_target)
            .unwrap_err()
            .contains("Resolved path outside"));
        let denied_link = root.join("denied");
        assert!(
            scoped_symlink(std::path::Path::new("current"), &denied_link, |p| p
                != final_target)
            .is_err()
        );
        assert!(!denied_link.exists());
        assert!(
            scoped_symlink(std::path::Path::new("current"), &denied_link, |p| p
                != root.join("current"))
            .is_err()
        );
        assert!(
            scoped_symlink(std::path::Path::new("current"), &denied_link, |p| p
                != denied_link)
            .is_err()
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
