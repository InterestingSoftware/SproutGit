mod editor;
mod git;
mod github;
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
            editor::open_in_editor,
            editor::detect_editors,
            editor::get_git_config,
            editor::set_git_config,
            workspace::create_sproutgit_workspace,
            workspace::inspect_sproutgit_workspace,
            github::github_device_flow_start,
            github::github_device_flow_poll,
            github::get_github_auth_status,
            github::github_logout,
            github::list_github_repos,
            get_home_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
