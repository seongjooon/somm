use tauri::Manager;
use tauri_plugin_fs::FsExt;
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Context {
    home: String,
    data_dir: String,
    env: std::collections::HashMap<String, String>,
}
pub(crate) fn data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    Ok(std::env::var("SOMM_DATA_DIR").ok().filter(|s| !s.is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| home.join("Library/Application Support/io.github.seongjooon.somm")))
}
pub fn context(app: &tauri::AppHandle) -> Result<Context, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let data = data_dir(app)?;
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
        |p| !sensitive_path(p) && !resolved_sensitive_path(p) && app.fs_scope().is_allowed(p),
    )
}

// Path checks and filesystem operations are subject to TOCTOU races.
// Resolution requires the path or its immediate parent to exist and otherwise fails closed.
fn resolved_sensitive_path(path: &std::path::Path) -> bool {
    std::fs::canonicalize(path)
        .or_else(|_| -> std::io::Result<std::path::PathBuf> {
            let parent = path.parent().ok_or_else(|| std::io::Error::from(std::io::ErrorKind::NotFound))?;
            Ok(std::fs::canonicalize(parent)?.join(path.file_name().unwrap_or_default()))
        })
        .map(|resolved| sensitive_path(&resolved))
        .unwrap_or(true)
}

// Keep this in sync with the global fs:scope deny entries.
fn sensitive_path(path: &std::path::Path) -> bool {
    let parts: Vec<_> = path.components().map(|part| part.as_os_str().to_string_lossy().to_lowercase()).collect();
    parts.iter().enumerate().any(|(i, name)| {
        let rest = &parts[i..];
        [".env", ".netrc", ".credentials"].iter().any(|prefix| name == prefix || name.starts_with(&format!("{prefix}.")))
            || [".ssh", ".aws", ".gnupg", ".npmrc", ".pypirc", ".claude.json", ".git-credentials", ".gitconfig", ".docker", ".kube", "id_rsa", "id_ed25519"].contains(&name.as_str())
            || (name == ".git" && rest.get(1).is_some_and(|p| p == "config" || p == "hooks"))
            || (name == ".config" && rest.get(1).is_some_and(|p| p == "gh"))
            || (name == "library" && (rest.get(1).is_some_and(|p| p == "keychains" || p == "safari")
                || (rest.get(1).is_some_and(|p| p == "application support") && (rest.get(2).is_some_and(|p| p == "firefox") || (rest.get(2).is_some_and(|p| p == "google") && rest.get(3).is_some_and(|p| p == "chrome"))))))
    })
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
        !sensitive_path(p) && !resolved_sensitive_path(p) && app.fs_scope().is_allowed(p)
    })
}

#[cfg(test)]
mod tests {
    use super::{scoped_readlink, scoped_symlink};
    #[test]
    fn deny_entries_match_custom_command_checks() {
        let capability: serde_json::Value = serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let entries = capability["permissions"].as_array().unwrap().iter()
            .find(|entry| entry["identifier"] == "fs:scope").unwrap()["deny"].as_array().unwrap();
        for entry in entries {
            let pattern = entry["path"].as_str().unwrap();
            let sample = pattern.replace("/**/", "/tmp/project/").replace("/**", "/sample").replace('*', "example");
            assert!(super::sensitive_path(std::path::Path::new(&sample)), "{pattern}: {sample}");
            assert!(super::sensitive_path(std::path::Path::new(&sample.to_uppercase())), "uppercase: {sample}");
        }
        for sample in [".claude.json", ".credentials.json", ".credentials.token", ".netrc.backup", ".git-credentials", ".gitconfig", ".docker/config.json", ".kube/config", "id_rsa", "id_ed25519", "Library/Keychains/login.keychain-db", "Library/Application Support/Google/Chrome/Default", "Library/Application Support/Firefox/Profiles", "Library/Safari/History.db"] {
            assert!(super::sensitive_path(std::path::Path::new(&format!("/tmp/{sample}"))), "{sample}");
        }
    }
    #[test]
    fn configured_scope_allows_cache_and_denies_sensitive_paths() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let capability: serde_json::Value = serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let deny = capability["permissions"].as_array().unwrap().iter()
            .find(|entry| entry["identifier"] == "fs:scope").unwrap()["deny"].as_array().unwrap()
            .iter().map(|entry| std::path::PathBuf::from(entry["path"].as_str().unwrap())).collect();
        let scope = tauri::fs::Scope::new(&tauri::test::mock_app(), &tauri::utils::config::FsScope::Scope {
            allow: vec!["/tmp/somm-scope/**".into()], deny,
            require_literal_leading_dot: config["plugins"]["fs"]["requireLiteralLeadingDot"].as_bool(),
        }).unwrap();
        for path in ["cache/.git/.somm-ready", "cache/.somm-ready", "project/README.md"] {
            assert!(scope.is_allowed(format!("/tmp/somm-scope/{path}")), "{path}");
        }
        for path in [".env", ".env.example", ".ssh/id", ".aws/config", ".gnupg/key", ".netrc", ".npmrc", ".pypirc", ".git/config", ".git/hooks/pre-commit", ".config/gh/hosts.yml"] {
            assert!(!scope.is_allowed(format!("/tmp/somm-scope/project/{path}")), "{path}");
        }
        assert!(!scope.is_allowed("/tmp/outside/README.md"));
    }
    #[test]
    fn sensitive_paths_are_denied_without_blocking_cache_markers() {
        for path in [".env", ".env.example", ".ssh/id", ".aws/config", ".gnupg/key", ".netrc", ".npmrc", ".pypirc", ".git/config", ".git/hooks/pre-commit", ".config/gh/hosts.yml"] {
            assert!(super::sensitive_path(std::path::Path::new(&format!("/tmp/project/{path}"))), "{path}");
        }
        for path in ["cache/repo/.git/.somm-ready", "cache/repo/.somm-ready", "project/README.md"] {
            assert!(!super::sensitive_path(std::path::Path::new(&format!("/tmp/{path}"))), "{path}");
        }
    }

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

#[derive(Default)]
pub struct DemoDirs(pub std::sync::Mutex<Vec<std::path::PathBuf>>);

#[tauri::command]
pub fn copy_demo(app: tauri::AppHandle) -> Result<String, String> {
    let source = app.path().resolve("demos/ts-mini", tauri::path::BaseDirectory::Resource).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
    let dest = std::env::temp_dir().join(format!("somm-demo-{}-{stamp}", std::process::id()));
    fn copy(source: &std::path::Path, dest: &std::path::Path) -> std::io::Result<()> {
        std::fs::create_dir(dest)?;
        for entry in std::fs::read_dir(source)? {
            let entry = entry?;
            let kind = entry.file_type()?;
            if kind.is_dir() { copy(&entry.path(), &dest.join(entry.file_name()))?; }
            else if kind.is_file() { std::fs::copy(entry.path(), dest.join(entry.file_name()))?; }
            else { return Err(std::io::Error::other("Unsupported demo file")); }
        }
        Ok(())
    }
    if let Err(error) = copy(&source, &dest) { let _ = std::fs::remove_dir_all(&dest); return Err(error.to_string()); }
    if let Err(error) = app.fs_scope().allow_directory(&dest, true) { let _ = std::fs::remove_dir_all(&dest); return Err(error.to_string()); }
    app.state::<DemoDirs>().0.lock().map_err(|e| e.to_string())?.push(dest.clone());
    Ok(dest.to_string_lossy().into_owned())
}
