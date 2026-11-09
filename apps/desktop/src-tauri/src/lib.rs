mod canaries;
mod environment;
mod git_config;
mod platform;
mod process;
use tauri::Manager;
pub fn run() {
    tauri::Builder::default()
        .manage(process::Processes::default())
        .manage(environment::Environment::default())
        .manage(platform::DemoDirs::default())
        .manage(git_config::Snapshots::default())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            canaries::sandbox_canaries_create,
            canaries::sandbox_canaries_remove,
            process::resolve_bins,
            process::spawn_agent,
            process::kill_agent,
            platform::platform_context,
            platform::copy_demo,
            platform::readlink,
            platform::symlink
            ,git_config::sandbox_git_snapshot
            ,git_config::sandbox_git_restore
            ,git_config::sandbox_git_forget
        ])
        .setup(|app| {
            platform::context(app.handle())?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building somm")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                process::kill_all(&app.state::<process::Processes>());
                if let Ok(dirs) = app.state::<platform::DemoDirs>().0.lock() { for dir in dirs.iter() { let _ = std::fs::remove_dir_all(dir); } }
            }
        });
}
