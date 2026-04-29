use serde::Serialize;

use crate::git::helpers::{
    ensure_git_success, normalize_existing_path, run_git, validate_no_control_chars,
    validate_non_option_value, GitAction,
};

// ── Structs ──

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatusFileEntry {
    pub path: String,
    pub orig_path: Option<String>,
    pub index_status: String,
    pub work_tree_status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeStatusResult {
    pub worktree_path: String,
    pub files: Vec<StatusFileEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkingDiffResult {
    pub worktree_path: String,
    pub file_path: Option<String>,
    pub staged: bool,
    pub diff: String,
}

// ── Validation ──

pub fn validate_commit_message(message: &str) -> Result<String, String> {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err("Commit message is required".to_string());
    }
    // Allow newline, carriage return, and tab (common in commit bodies),
    // but reject all other control characters.  This mirrors the frontend
    // validateCommitMessage regex which permits \t (\x09) explicitly.
    if trimmed
        .chars()
        .any(|c| c.is_control() && c != '\n' && c != '\r' && c != '\t')
    {
        return Err("Commit message contains unsupported control characters".to_string());
    }
    if trimmed.len() > 10_000 {
        return Err("Commit message is too long (max 10,000 characters)".to_string());
    }
    Ok(trimmed.to_string())
}

fn validate_file_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("File path is required".to_string());
    }
    validate_no_control_chars(trimmed, "File path")?;
    if trimmed.starts_with('-') {
        return Err("File path cannot start with '-'".to_string());
    }
    Ok(trimmed.to_string())
}

fn validate_file_paths(paths: &[String]) -> Result<Vec<String>, String> {
    paths.iter().map(|p| validate_file_path(p)).collect()
}

// ── Parsing ──

pub fn parse_porcelain_status(stdout: &str) -> Vec<StatusFileEntry> {
    let mut files = Vec::new();

    for line in stdout.lines() {
        if line.len() < 4 {
            // Minimum valid: "XY f" (2-char status + space + at least 1 char path)
            continue;
        }

        let index_status = line[0..1].to_string();
        let work_tree_status = line[1..2].to_string();
        let rest = &line[3..]; // Skip "XY "

        // Handle renames: "R  old -> new" or "RM old -> new"
        let (path, orig_path) =
            if (index_status == "R" || index_status == "C") && rest.contains(" -> ") {
                // Destination is the new path; source is the original.
                let mut parts = rest.splitn(2, " -> ");
                let src = parts.next().unwrap_or("").to_string();
                let dst = parts.next().unwrap_or(rest).to_string();
                (dst, Some(src))
            } else {
                (rest.to_string(), None)
            };

        files.push(StatusFileEntry {
            path,
            orig_path,
            index_status,
            work_tree_status,
        });
    }

    files
}

// ── Internal helpers ──

fn get_status_internal(wt_str: &str) -> Result<Vec<StatusFileEntry>, String> {
    let output = run_git(
        GitAction::StatusPorcelain,
        &["-C", wt_str, "status", "--porcelain"],
    )?;
    let output = ensure_git_success(output, "Failed to read worktree status")?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_porcelain_status(&stdout))
}

// ── Commands ──

#[tauri::command]
pub async fn get_worktree_status(worktree_path: String) -> Result<WorktreeStatusResult, String> {
    let wt = normalize_existing_path(&worktree_path)?;
    let wt_str = wt.to_string_lossy();

    let files = get_status_internal(&wt_str)?;

    Ok(WorktreeStatusResult {
        worktree_path: wt_str.to_string(),
        files,
    })
}

#[tauri::command]
pub async fn stage_files(
    worktree_path: String,
    paths: Vec<String>,
) -> Result<WorktreeStatusResult, String> {
    let wt = normalize_existing_path(&worktree_path)?;
    let wt_str = wt.to_string_lossy();

    if paths.is_empty() {
        // Stage all changes
        let output = run_git(GitAction::StageFiles, &["-C", &wt_str, "add", "-A"])?;
        ensure_git_success(output, "Failed to stage all files")?;
    } else {
        let validated = validate_file_paths(&paths)?;
        let mut args: Vec<String> = vec![
            "-C".to_string(),
            wt_str.to_string(),
            "add".to_string(),
            "--".to_string(),
        ];
        args.extend(validated);
        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output = run_git(GitAction::StageFiles, &arg_refs)?;
        ensure_git_success(output, "Failed to stage files")?;
    }

    // Return refreshed status
    let files = get_status_internal(&wt_str)?;
    Ok(WorktreeStatusResult {
        worktree_path: wt_str.to_string(),
        files,
    })
}

#[tauri::command]
pub async fn unstage_files(
    worktree_path: String,
    paths: Vec<String>,
) -> Result<WorktreeStatusResult, String> {
    let wt = normalize_existing_path(&worktree_path)?;
    let wt_str = wt.to_string_lossy();

    let unstage_result = if paths.is_empty() {
        // Unstage all
        run_git(GitAction::UnstageFiles, &["-C", &wt_str, "reset", "HEAD"])
    } else {
        let validated = validate_file_paths(&paths)?;
        let mut args: Vec<String> = vec![
            "-C".to_string(),
            wt_str.to_string(),
            "reset".to_string(),
            "HEAD".to_string(),
            "--".to_string(),
        ];
        args.extend(validated);
        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        run_git(GitAction::UnstageFiles, &arg_refs)
    };

    match unstage_result {
        Ok(output) if output.status.success() => {},
        Ok(output) => {
            // `reset HEAD` fails when there is no initial commit yet.
            // Detect this by checking whether HEAD resolves; if not, fall back
            // to `git rm --cached` which works on an empty index.
            let head_exists = run_git(
                GitAction::RevParse,
                &["-C", &wt_str, "rev-parse", "--verify", "HEAD"],
            )
            .map(|o| o.status.success())
            .unwrap_or(false);

            if head_exists {
                // HEAD exists but reset still failed — surface the real error.
                ensure_git_success(output, "Failed to unstage files")?;
            }

            // Initial commit: unstage with git rm --cached instead.
            if paths.is_empty() {
                let output = run_git(
                    GitAction::UnstageFiles,
                    &["-C", &wt_str, "rm", "--cached", "-r", "."],
                )?;
                ensure_git_success(output, "Failed to unstage files")?;
            } else {
                let validated = validate_file_paths(&paths)?;
                let mut args: Vec<String> = vec![
                    "-C".to_string(),
                    wt_str.to_string(),
                    "rm".to_string(),
                    "--cached".to_string(),
                    "--".to_string(),
                ];
                args.extend(validated);
                let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
                let output = run_git(GitAction::UnstageFiles, &arg_refs)?;
                ensure_git_success(output, "Failed to unstage files")?;
            }
        },
        Err(e) => return Err(e),
    }

    // Return refreshed status
    let files = get_status_internal(&wt_str)?;
    Ok(WorktreeStatusResult {
        worktree_path: wt_str.to_string(),
        files,
    })
}

#[tauri::command]
pub async fn create_commit(worktree_path: String, message: String) -> Result<CommitResult, String> {
    let wt = normalize_existing_path(&worktree_path)?;
    let wt_str = wt.to_string_lossy();
    let msg = validate_commit_message(&message)?;

    // Verify there are staged changes
    let files = get_status_internal(&wt_str)?;
    let has_staged = files
        .iter()
        .any(|f| f.index_status != " " && f.index_status != "?");
    if !has_staged {
        return Err("No staged changes to commit".to_string());
    }

    // Create the commit
    let output = run_git(
        GitAction::CreateCommit,
        &["-C", &wt_str, "commit", "-m", &msg],
    )?;
    ensure_git_success(output, "Failed to create commit")?;

    // Get the commit info for the new HEAD
    let log_output = run_git(
        GitAction::CommitGraph,
        &["-C", &wt_str, "log", "-1", "--format=%H\x1e%h\x1e%s"],
    )?;
    let log_output = ensure_git_success(log_output, "Failed to read new commit")?;
    let stdout = String::from_utf8_lossy(&log_output.stdout);
    let parts: Vec<&str> = stdout.trim().split('\x1e').collect();

    if parts.len() < 3 {
        return Err("Failed to parse new commit info".to_string());
    }

    Ok(CommitResult {
        hash: parts[0].to_string(),
        short_hash: parts[1].to_string(),
        subject: parts[2].to_string(),
    })
}

#[tauri::command]
pub async fn get_working_diff(
    worktree_path: String,
    file_path: Option<String>,
    staged: bool,
) -> Result<WorkingDiffResult, String> {
    let wt = normalize_existing_path(&worktree_path)?;
    let wt_str = wt.to_string_lossy();

    let validated_file = file_path
        .as_deref()
        .map(|fp| validate_non_option_value(fp, "File path"))
        .transpose()?;

    let mut args: Vec<String> = vec!["-C".to_string(), wt_str.to_string(), "diff".to_string()];

    if staged {
        args.push("--cached".to_string());
    }

    if let Some(ref fp) = validated_file {
        args.push("--".to_string());
        args.push(fp.clone());
    }

    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = run_git(GitAction::DiffContent, &arg_refs)?;
    let output = ensure_git_success(output, "Failed to load diff")?;

    let diff = String::from_utf8_lossy(&output.stdout).to_string();

    // Untracked files (status "??") return an empty diff because git doesn't
    // track them yet.  Synthesise a full-addition diff from the file contents
    // so the viewer can show the whole file highlighted green.
    if diff.trim().is_empty() && !staged {
        if let Some(ref rel_path) = validated_file {
            let candidate = wt.join(rel_path);
            if candidate.exists() && candidate.is_file() {
                let fake = generate_fake_add_diff(rel_path, &candidate)?;
                return Ok(WorkingDiffResult {
                    worktree_path: wt_str.to_string(),
                    file_path: validated_file,
                    staged: false,
                    diff: fake,
                });
            }
        }
    }

    Ok(WorkingDiffResult {
        worktree_path: wt_str.to_string(),
        file_path: validated_file,
        staged,
        diff,
    })
}

// ── Helpers ──

const MAX_PREVIEW_BYTES: u64 = 4 * 1024 * 1024; // 4 MB

fn generate_fake_add_diff(rel_path: &str, full_path: &std::path::Path) -> Result<String, String> {
    let meta =
        std::fs::metadata(full_path).map_err(|e| format!("Cannot stat '{rel_path}': {e}"))?;

    if meta.len() > MAX_PREVIEW_BYTES {
        return Ok(format!(
            "diff --git a/{rel_path} b/{rel_path}\nnew file mode 100644\n\
             --- /dev/null\n+++ b/{rel_path}\n\
             @@ File too large to preview ({} bytes) @@\n",
            meta.len()
        ));
    }

    let bytes = std::fs::read(full_path).map_err(|e| format!("Cannot read '{rel_path}': {e}"))?;

    if bytes.contains(&0u8) {
        return Ok(format!(
            "diff --git a/{rel_path} b/{rel_path}\nnew file mode 100644\n\
             --- /dev/null\n+++ b/{rel_path}\n\
             Binary file (new, not shown)\n"
        ));
    }

    let text = String::from_utf8_lossy(&bytes);
    let lines: Vec<&str> = text.lines().collect();
    let line_count = lines.len();

    let mut out = format!(
        "diff --git a/{rel_path} b/{rel_path}\nnew file mode 100644\n\
         --- /dev/null\n+++ b/{rel_path}\n\
         @@ -0,0 +1,{line_count} @@\n"
    );
    for line in &lines {
        out.push('+');
        out.push_str(line);
        out.push('\n');
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::{parse_porcelain_status, validate_commit_message};

    #[test]
    fn parse_porcelain_status_parses_untracked_file() {
        let parsed = parse_porcelain_status("?? notes.txt\n");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].index_status, "?");
        assert_eq!(parsed[0].work_tree_status, "?");
        assert_eq!(parsed[0].path, "notes.txt");
        assert_eq!(parsed[0].orig_path, None);
    }

    #[test]
    fn parse_porcelain_status_parses_rename_and_copy_entries() {
        let parsed = parse_porcelain_status(
            "R  src/old name.txt -> src/new name.txt\nC  src/base.rs -> src/base-copy.rs\n",
        );

        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].index_status, "R");
        assert_eq!(parsed[0].path, "src/new name.txt");
        assert_eq!(parsed[0].orig_path.as_deref(), Some("src/old name.txt"));

        assert_eq!(parsed[1].index_status, "C");
        assert_eq!(parsed[1].path, "src/base-copy.rs");
        assert_eq!(parsed[1].orig_path.as_deref(), Some("src/base.rs"));
    }

    #[test]
    fn parse_porcelain_status_keeps_paths_with_quotes_and_spaces() {
        let parsed = parse_porcelain_status(" M \"a folder/quoted name.txt\"\n");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].index_status, " ");
        assert_eq!(parsed[0].work_tree_status, "M");
        assert_eq!(parsed[0].path, "\"a folder/quoted name.txt\"");
    }

    #[test]
    fn validate_commit_message_rejects_empty() {
        let result = validate_commit_message("   ");
        assert!(matches!(result, Err(ref e) if e == "Commit message is required"));
    }

    #[test]
    fn validate_commit_message_rejects_overly_long_messages() {
        let message = "a".repeat(10_001);
        let result = validate_commit_message(&message);
        assert!(matches!(
            result,
            Err(ref e) if e == "Commit message is too long (max 10,000 characters)"
        ));
    }

    #[test]
    fn validate_commit_message_allows_tabs_in_body() {
        // Tabs are valid in commit message bodies (e.g. indented code snippets).
        assert!(validate_commit_message("Subject\n\n\tcode block").is_ok());
    }

    #[test]
    fn validate_commit_message_rejects_other_control_characters() {
        // Non-printable control characters (except \n, \r, \t) must be rejected.
        assert!(validate_commit_message("hello\x07world").is_err()); // BEL
        assert!(validate_commit_message("hello\x00world").is_err()); // NUL
    }

    #[test]
    fn validate_commit_message_accepts_multiline_message() {
        let result = validate_commit_message("Subject line\n\nBody paragraph");
        assert!(matches!(
            result,
            Ok(ref value) if value == "Subject line\n\nBody paragraph"
        ));
    }
}
