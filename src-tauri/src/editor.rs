use serde::Serialize;
use std::path::Path;

use crate::helpers::{
    command_exists, normalize_existing_path, run_git, system_command, validate_git_config_key,
    validate_no_control_chars, validate_non_option_value, GitAction, SystemAction,
};

// ── Structs ──

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EditorInfo {
    pub id: String,
    pub name: String,
    pub command: String,
    pub installed: bool,
}

// ── Known Editors ──
// Each entry: (id, display_name, cli_command, optional macOS app bundle path).

struct EditorCandidate {
    id: &'static str,
    name: &'static str,
    command: &'static str,
    mac_bundle_bin: Option<&'static str>,
}

fn known_editors() -> Vec<EditorCandidate> {
    vec![
        EditorCandidate { id: "vscode",  name: "VS Code",      command: "code",    mac_bundle_bin: Some("/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code") },
        EditorCandidate { id: "cursor",  name: "Cursor",       command: "cursor",  mac_bundle_bin: Some("/Applications/Cursor.app/Contents/Resources/app/bin/cursor") },
        EditorCandidate { id: "windsurf", name: "Windsurf",    command: "windsurf", mac_bundle_bin: Some("/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf") },
        EditorCandidate { id: "kiro",    name: "Kiro",         command: "kiro",    mac_bundle_bin: None },
        EditorCandidate { id: "zed",     name: "Zed",          command: "zed",     mac_bundle_bin: Some("/Applications/Zed.app/Contents/MacOS/cli") },
        EditorCandidate { id: "sublime", name: "Sublime Text", command: "subl",    mac_bundle_bin: Some("/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl") },
        EditorCandidate { id: "vim",     name: "Vim",          command: "vim",     mac_bundle_bin: None },
        EditorCandidate { id: "neovim",  name: "Neovim",       command: "nvim",    mac_bundle_bin: None },
        EditorCandidate { id: "emacs",   name: "Emacs",        command: "emacs",   mac_bundle_bin: None },
        EditorCandidate { id: "nano",    name: "nano",         command: "nano",    mac_bundle_bin: None },
    ]
}

fn is_command_available(cmd: &str) -> bool {
    command_exists(cmd)
}

/// Resolve the actual executable path for an editor, checking the CLI
/// command on PATH first, then falling back to the macOS app bundle path.
fn resolve_editor(editor: &EditorCandidate) -> Option<String> {
    if is_command_available(editor.command) {
        return Some(editor.command.to_string());
    }
    if let Some(bundle_path) = editor.mac_bundle_bin {
        if Path::new(bundle_path).exists() {
            return Some(bundle_path.to_string());
        }
    }
    None
}

/// Parse a shell-like command string, respecting double and single quotes.
/// e.g. `"/path/with spaces/code" --wait` → ["/path/with spaces/code", "--wait"]
/// Also handles unquoted paths by probing the filesystem for known editors.
fn parse_editor_command(editor: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut in_single = false;
    let mut in_double = false;

    for ch in editor.chars() {
        match ch {
            '\'' if !in_double => {
                in_single = !in_single;
            }
            '"' if !in_single => {
                in_double = !in_double;
            }
            ' ' | '\t' if !in_single && !in_double => {
                if !current.is_empty() {
                    parts.push(std::mem::take(&mut current));
                }
            }
            _ => {
                current.push(ch);
            }
        }
    }
    if !current.is_empty() {
        parts.push(current);
    }

    // If the first part isn't a valid file, try combining tokens until we find one.
    // This handles unquoted paths like: /Applications/Visual Studio Code.app/.../code --wait
    if parts.len() > 1 && !Path::new(&parts[0]).exists() {
        for i in 1..parts.len() {
            let candidate = parts[..=i].join(" ");
            if Path::new(&candidate).exists() {
                let mut merged = vec![candidate];
                merged.extend(parts[i + 1..].iter().cloned());
                return merged;
            }
        }
    }

    parts
}

// ── Commands ──

#[tauri::command]
pub async fn open_in_editor(worktree_path: String) -> Result<String, String> {
    let wt_path = normalize_existing_path(&worktree_path)?;
    let wt_str = wt_path.to_string_lossy().to_string();

    let editor = std::env::var("GIT_EDITOR")
        .ok()
        .or_else(|| {
            run_git(GitAction::ReadGitConfig, &["config", "--global", "--", "core.editor"])
                .ok()
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .filter(|s| !s.is_empty())
        })
        .or_else(|| std::env::var("VISUAL").ok())
        .or_else(|| std::env::var("EDITOR").ok())
        .unwrap_or_else(|| {
            if cfg!(target_os = "macos") {
                "open -a TextEdit".to_string()
            } else if cfg!(target_os = "windows") {
                "notepad".to_string()
            } else {
                "xdg-open".to_string()
            }
        });

    let parts = parse_editor_command(&editor);
    if parts.is_empty() {
        return Err("No editor configured".to_string());
    }

    validate_non_option_value(&parts[0], "Editor command")?;
    validate_no_control_chars(&wt_str, "Worktree path")?;

    let mut args: Vec<&str> = parts[1..]
        .iter()
        .map(|s| s.as_str())
        .filter(|arg| *arg != "--wait" && *arg != "-w")
        .collect();
    args.push(&wt_str);

    let mut cmd = system_command(SystemAction::OpenEditor, &parts[0], &args);

    cmd.spawn()
        .map_err(|e| format!("Failed to open editor '{}': {e}", parts[0]))?;

    Ok(editor)
}

#[tauri::command]
pub fn detect_editors() -> Vec<EditorInfo> {
    known_editors()
        .into_iter()
        .map(|editor| {
            let resolved = resolve_editor(&editor);
            EditorInfo {
                id: editor.id.to_string(),
                name: editor.name.to_string(),
                command: resolved.clone().unwrap_or_else(|| editor.command.to_string()),
                installed: resolved.is_some(),
            }
        })
        .collect()
}

#[tauri::command]
pub fn get_git_config(key: String) -> Result<String, String> {
    let key = validate_git_config_key(&key)?;
    let output = run_git(GitAction::ReadGitConfig, &["config", "--global", "--", &key])
        .map_err(|e| format!("Failed to read git config: {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Ok(String::new())
    }
}

#[tauri::command]
pub fn set_git_config(key: String, value: String) -> Result<(), String> {
    let key = validate_git_config_key(&key)?;
    validate_no_control_chars(value.trim(), "Git config value")?;

    if value.is_empty() {
        let _ = run_git(
            GitAction::UnsetGitConfig,
            &["config", "--global", "--unset", "--", &key],
        );
        Ok(())
    } else {
        let output = run_git(
            GitAction::SetGitConfig,
            &["config", "--global", "--", &key, value.trim()],
        )
            .map_err(|e| format!("Failed to set git config: {e}"))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(format!(
                "git config failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ))
        }
    }
}
