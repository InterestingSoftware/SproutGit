mod diff;
mod editor;
mod git;
mod github;
mod helpers;
mod workspace;


#[tauri::command]
fn get_home_dir() -> Result<String, String> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Cannot determine home directory".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|_app| {
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            git::git_info,
            git::list_worktrees,
            git::list_refs,
            git::get_commit_graph,
            git::create_managed_worktree,
            git::delete_managed_worktree,
            git::checkout_worktree,
            git::reset_worktree_branch,
            diff::get_diff_files,
            diff::get_diff_content,
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
