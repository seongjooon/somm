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
    if !app.fs_scope().is_allowed(&target) || !app.fs_scope().is_allowed(&link) {
        return Err("Path outside filesystem scope".into());
    }
    std::os::unix::fs::symlink(target, link).map_err(|e| e.to_string())
}
