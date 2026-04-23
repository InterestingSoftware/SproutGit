mod config;
mod db;
mod editor;
mod git;
mod github;
mod hooks;
mod recent_docs;
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
    let mut builder = tauri::Builder::default();

    #[cfg(feature = "e2e-testing")]
    {
        let socket_path = std::env::var("SPROUTGIT_PLAYWRIGHT_SOCKET_PATH")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| {
                std::env::temp_dir()
                    .join("sproutgit-playwright.sock")
                    .to_string_lossy()
                    .to_string()
            });

        let tcp_port = std::env::var("SPROUTGIT_PLAYWRIGHT_TCP_PORT")
            .ok()
            .and_then(|value| value.trim().parse::<u16>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(6274);

        builder = builder.plugin(
            tauri_plugin_playwright::init_with_config(
                tauri_plugin_playwright::PluginConfig::new()
                    .socket_path(&socket_path)
                    .tcp_port(tcp_port)
                    .window_label("main"),
            ),
        );
    }

    builder
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
            git::operations::count_commits,
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
            workspace::import_git_repo_workspace_with_mode,
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
