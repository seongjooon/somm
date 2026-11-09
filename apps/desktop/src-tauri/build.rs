fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["sandbox_canaries_create", "sandbox_canaries_remove", "resolve_bins", "spawn_agent", "kill_agent", "platform_context", "copy_demo", "readlink", "symlink", "sandbox_git_snapshot", "sandbox_git_restore", "sandbox_git_forget"])
    )).expect("failed to build Tauri application");
}
