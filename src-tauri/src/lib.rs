mod config;
mod db;
mod editor;
mod git;
mod github;
mod hooks;
mod terminal;
mod watcher;
mod workspace;

#[tauri::command]
fn get_home_dir() -> Result<String, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Cannot determine home directory".to_string())?;
    // Normalize to forward slashes so the frontend can safely join paths
    // with '/' on all platforms (Windows accepts forward slashes too).
    Ok(home.replace('\\', "/"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[allow(clippy::expect_used)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(terminal::TerminalManager::new())
        .manage(watcher::WatcherState(std::sync::Mutex::new(None)))
        .setup(|_app| {
            #[cfg(target_os = "windows")]
            {
                use tauri::Manager;
                if let Some(window) = _app.get_webview_window("main") {
                    let _ = window.set_decorations(false);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            git::operations::git_info,
            git::operations::list_worktrees,
            git::operations::list_refs,
            git::operations::get_commit_graph,
            git::operations::create_managed_worktree,
            git::operations::delete_managed_worktree,
            git::operations::checkout_worktree,
            git::operations::reset_worktree_branch,
            git::diff::get_diff_files,
            git::diff::get_diff_content,
            git::staging::get_worktree_status,
            git::staging::stage_files,
            git::staging::unstage_files,
            git::staging::create_commit,
            git::staging::get_working_diff,
            editor::open_in_editor,
            editor::detect_editors,
            editor::detect_git_tools,
            editor::get_git_config,
            editor::set_git_config,
            workspace::create_sproutgit_workspace,
            workspace::import_git_repo_workspace,
            workspace::inspect_sproutgit_workspace,
            config::list_recent_workspaces,
            config::touch_recent_workspace,
            config::remove_recent_workspace,
            config::get_app_setting,
            config::set_app_setting,
            hooks::list_workspace_hooks,
            hooks::create_workspace_hook,
            hooks::update_workspace_hook,
            hooks::delete_workspace_hook,
            hooks::toggle_workspace_hook,
            hooks::get_available_hook_shells,
            hooks::run_workspace_hook,
            github::migrate_github_auth_storage,
            github::github_device_flow_start,
            github::github_device_flow_poll,
            github::get_github_auth_status,
            github::github_logout,
            github::list_github_repos,
            github::list_github_email_suggestions,
            get_home_dir,
            terminal::list_available_shells,
            terminal::spawn_terminal,
            terminal::terminal_input,
            terminal::terminal_resize,
            terminal::close_terminal,
            watcher::start_watching_worktrees,
            watcher::stop_watching_worktrees,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
