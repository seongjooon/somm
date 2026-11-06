mod environment;
mod platform;
mod process;
use tauri::Manager;
pub fn run() {
    tauri::Builder::default()
        .manage(process::Processes::default())
        .manage(environment::Environment::default())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            process::resolve_bins,
            process::spawn_agent,
            process::kill_agent,
            platform::platform_context,
            platform::readlink,
            platform::symlink
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
            }
        });
}
