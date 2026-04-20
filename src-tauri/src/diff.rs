use serde::Serialize;

use crate::helpers::{
    ensure_git_success, normalize_existing_path, run_git, validate_non_option_value, GitAction,
};

// ── Structs ──

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiffFileEntry {
    pub path: String,
    pub status: String,
    pub old_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffFilesResult {
    pub commit: String,
    pub base: Option<String>,
    pub files: Vec<DiffFileEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffContentResult {
    pub commit: String,
    pub base: Option<String>,
    pub file_path: Option<String>,
    pub diff: String,
}

// ── Commands ──

#[tauri::command]
pub async fn get_diff_files(
    repo_path: String,
    commit: String,
    base: Option<String>,
) -> Result<DiffFilesResult, String> {
    let rp = normalize_existing_path(&repo_path)?;
    let rp_str = rp.to_string_lossy();
    let commit_trimmed = validate_non_option_value(commit.trim(), "Commit hash")?;
    let base_trimmed = base
        .as_deref()
        .map(|b| validate_non_option_value(b, "Base ref"))
        .transpose()?;

    let output = match &base_trimmed {
        Some(b) => {
            let range = format!("{}..{}", b, commit_trimmed);
            run_git(
                GitAction::DiffFiles,
                &["-C", &rp_str, "diff", "--name-status", "--no-renames", &range],
            )?
        }
        None => {
            run_git(GitAction::DiffFiles, &[
                "-C",
                &rp_str,
                "diff-tree",
                "--no-commit-id",
                "-r",
                "--name-status",
                "--no-renames",
                &commit_trimmed,
            ])?
        }
    };
    let output = ensure_git_success(output, "Failed to load diff files")?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut files: Vec<DiffFileEntry> = Vec::new();

    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() >= 2 {
            let status_raw = parts[0];
            let status = status_raw.chars().next().unwrap_or('M').to_string();
            let path = parts[1].to_string();
            let old_path = if status == "R" || status == "C" {
                Some(path.clone())
            } else {
                None
            };
            let final_path = if (status == "R" || status == "C") && parts.len() >= 3 {
                parts[2].to_string()
            } else {
                path
            };
            files.push(DiffFileEntry {
                path: final_path,
                status,
                old_path,
            });
        }
    }

    Ok(DiffFilesResult {
        commit: commit_trimmed,
        base: base_trimmed,
        files,
    })
}

#[tauri::command]
pub async fn get_diff_content(
    repo_path: String,
    commit: String,
    base: Option<String>,
    file_path: Option<String>,
) -> Result<DiffContentResult, String> {
    let rp = normalize_existing_path(&repo_path)?;
    let rp_str = rp.to_string_lossy();
    let commit_trimmed = validate_non_option_value(commit.trim(), "Commit hash")?;
    let base_trimmed = base
        .as_deref()
        .map(|b| validate_non_option_value(b, "Base ref"))
        .transpose()?;

    let mut args: Vec<String> = vec![
        "-C".to_string(),
        rp_str.to_string(),
    ];

    match &base_trimmed {
        Some(b) => {
            let range = format!("{}..{}", b, commit_trimmed);
            args.extend_from_slice(&[
                "diff".to_string(),
                range,
            ]);
        }
        None => {
            args.extend_from_slice(&[
                "diff-tree".to_string(),
                "-p".to_string(),
                commit_trimmed.clone(),
            ]);
        }
    };

    if let Some(fp) = &file_path {
        args.push("--".to_string());
        args.push(fp.clone());
    }

    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = run_git(GitAction::DiffContent, &arg_refs)?;
    let output = ensure_git_success(output, "Failed to load diff content")?;

    let diff = String::from_utf8_lossy(&output.stdout).to_string();

    Ok(DiffContentResult {
        commit: commit_trimmed,
        base: base_trimmed,
        file_path,
        diff,
    })
}
