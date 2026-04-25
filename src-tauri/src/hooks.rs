use sea_orm::{ConnectionTrait, DbBackend, FromQueryResult, Statement};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Output, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command as TokioCommand;
use tokio::task::JoinSet;
use tokio::time::timeout;

use crate::db::connect_workspace_db;
use crate::git::helpers::{
    command_exists, now_epoch_seconds, run_git, strip_win_prefix, system_command,
    validate_no_control_chars, shell_candidates_for_current_os, GitAction, SystemAction,
};

#[derive(Serialize, FromQueryResult)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceHook {
    pub id: String,
    pub name: String,
    pub scope: String,
    pub trigger: String,
    pub shell: String,
    pub script: String,
    pub enabled: bool,
    pub critical: bool,
    pub timeout_seconds: u32,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceHookWithDependencies {
    pub id: String,
    pub name: String,
    pub scope: String,
    pub trigger: String,
    pub shell: String,
    pub script: String,
    pub enabled: bool,
    pub critical: bool,
    pub timeout_seconds: u32,
    pub created_at: i64,
    pub updated_at: i64,
    pub dependency_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookUpsertInput {
    pub name: String,
    pub scope: String,
    pub trigger: String,
    pub shell: String,
    pub script: String,
    pub enabled: bool,
    pub critical: bool,
    pub timeout_seconds: u32,
    pub dependency_ids: Vec<String>,
}

#[derive(Clone)]
struct RuntimeHook {
    id: String,
    name: String,
    scope: String,
    trigger: String,
    shell: String,
    script: String,
    critical: bool,
    timeout_seconds: u32,
}

#[derive(Clone)]
struct RuntimeHookResult {
    hook_id: String,
    hook_name: String,
    critical: bool,
    status: String,
    success: bool,
    error_message: Option<String>,
}

#[derive(Default)]
pub struct HookExecutionSummary {
    pub had_critical_failure: bool,
    pub failed_critical_hooks: Vec<String>,
    pub failed_non_critical_hooks: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct HookProgressEvent {
    trigger: String,
    hook_id: String,
    hook_name: String,
    phase: String,
    status: String,
    stdout_snippet: Option<String>,
    stderr_snippet: Option<String>,
    error_message: Option<String>,
}

fn emit_hook_progress(app_handle: Option<&tauri::AppHandle>, event: HookProgressEvent) {
    if let Some(app) = app_handle {
        use tauri::Emitter;
        let _ = app.emit("hook-progress", event);
    }
}

const ALLOWED_TRIGGERS: &[&str] = &[
    "before_worktree_create",
    "after_worktree_create",
    "before_worktree_remove",
    "after_worktree_remove",
    "before_worktree_switch",
    "after_worktree_switch",
    "manual",
];
const MAX_HOOK_OUTPUT_BYTES: usize = 64 * 1024;

const ALLOWED_SCOPES: &[&str] = &["worktree", "workspace"];

fn detect_available_hook_shells() -> Vec<String> {
    let detected: Vec<String> = shell_candidates_for_current_os()
        .iter()
        .filter(|candidate| command_exists(candidate))
        .map(|candidate| candidate.to_string())
        .collect();

    if detected.is_empty() {
        shell_candidates_for_current_os()
            .first()
            .map(|candidate| vec![candidate.to_string()])
            .unwrap_or_else(|| vec!["bash".to_string()])
    } else {
        detected
    }
}

fn current_os_label() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

fn normalize_non_empty(value: &str, field: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{field} is required"));
    }
    validate_no_control_chars(trimmed, field)?;
    Ok(trimmed.to_string())
}

fn normalize_hook_script(script: &str) -> Result<String, String> {
    let trimmed = script.trim();
    if trimmed.is_empty() {
        return Err("Hook script is required".to_string());
    }

    if trimmed
        .chars()
        .any(|c| c.is_control() && c != '\n' && c != '\r' && c != '\t')
    {
        return Err("Hook script contains invalid control characters".to_string());
    }

    Ok(trimmed.to_string())
}

fn validate_trigger(trigger: &str) -> Result<String, String> {
    let trigger = normalize_non_empty(trigger, "Trigger")?;
    if !ALLOWED_TRIGGERS.contains(&trigger.as_str()) {
        return Err(format!("Unsupported trigger: {trigger}"));
    }
    Ok(trigger)
}

fn validate_shell(shell: &str) -> Result<String, String> {
    let shell = normalize_non_empty(shell, "Shell")?;
    let available_shells = detect_available_hook_shells();
    if !available_shells.iter().any(|candidate| candidate == &shell) {
        return Err(format!(
            "Unsupported shell '{}' for this machine. Available: {}",
            shell,
            available_shells.join(", ")
        ));
    }
    Ok(shell)
}

fn validate_scope(scope: &str) -> Result<String, String> {
    let scope = normalize_non_empty(scope, "Scope")?;
    if !ALLOWED_SCOPES.contains(&scope.as_str()) {
        return Err(format!("Unsupported scope: {scope}"));
    }
    Ok(scope)
}

fn validate_timeout(timeout_seconds: u32) -> Result<u32, String> {
    if timeout_seconds == 0 {
        return Err("timeoutSeconds must be at least 1".to_string());
    }
    if timeout_seconds > 24 * 60 * 60 {
        return Err("timeoutSeconds must be <= 86400".to_string());
    }
    Ok(timeout_seconds)
}

fn unique_suffix() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn generate_hook_id() -> String {
    format!("hook-{}-{}", now_epoch_seconds(), unique_suffix())
}

fn generate_run_id(hook_id: &str) -> String {
    format!("run-{hook_id}-{}", unique_suffix())
}

fn normalize_workspace_path(workspace_path: &str) -> Result<PathBuf, String> {
    let trimmed = workspace_path.trim();
    if trimmed.is_empty() {
        return Err("Workspace path is required".to_string());
    }

    let path = Path::new(trimmed);
    if !path.exists() {
        return Err("Workspace path does not exist".to_string());
    }
    if !path.is_dir() {
        return Err("Workspace path must be a directory".to_string());
    }

    path.canonicalize()
        .map(strip_win_prefix)
        .map_err(|_| "Failed to resolve workspace path".to_string())
}

fn normalize_existing_dir(path_value: &str, field_name: &str) -> Result<PathBuf, String> {
    let normalized = normalize_workspace_path(path_value)?;
    if !normalized.is_dir() {
        return Err(format!("{field_name} must be a directory"));
    }
    Ok(normalized)
}

fn truncate_utf8(input: &[u8], max_bytes: usize) -> String {
    let text = String::from_utf8_lossy(input).to_string();
    if text.len() <= max_bytes {
        return text;
    }
    text.chars().take(max_bytes).collect()
}

fn git_output_trimmed(output: Output) -> Option<String> {
    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn git_capture_trimmed(action: GitAction, args: &[&str]) -> Option<String> {
    run_git(action, args).ok().and_then(git_output_trimmed)
}

fn trigger_parts(trigger: &str) -> (String, String) {
    let phase = if trigger.starts_with("before_") {
        "before"
    } else if trigger.starts_with("after_") {
        "after"
    } else {
        "unknown"
    };

    let action = if trigger.ends_with("_create") {
        "create"
    } else if trigger.ends_with("_remove") {
        "remove"
    } else if trigger.ends_with("_switch") {
        "switch"
    } else {
        "unknown"
    };

    (phase.to_string(), action.to_string())
}

fn path_tail(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "unknown".to_string())
}

struct WorktreeGitContext {
    branch_name: Option<String>,
    head_full: Option<String>,
    head_short: Option<String>,
    detached: bool,
}

fn load_worktree_git_context(worktree_path: &Path) -> WorktreeGitContext {
    let wt_str = worktree_path.to_string_lossy().to_string();

    let branch_name = git_capture_trimmed(
        GitAction::CurrentBranch,
        &["-C", &wt_str, "branch", "--show-current"],
    );
    let head_full = git_capture_trimmed(GitAction::RevParse, &["-C", &wt_str, "rev-parse", "HEAD"]);
    let head_short = git_capture_trimmed(
        GitAction::RevParse,
        &["-C", &wt_str, "rev-parse", "--short", "HEAD"],
    );

    WorktreeGitContext {
        detached: branch_name.is_none(),
        branch_name,
        head_full,
        head_short,
    }
}

fn write_hook_script_file(script_path: &Path, script: &str) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;

        let mut file = fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .mode(0o600)
            .open(script_path)
            .map_err(|e| format!("Failed to prepare hook script: {e}"))?;

        file.write_all(script.as_bytes())
            .map_err(|e| format!("Failed to prepare hook script: {e}"))?;
        Ok(())
    }

    #[cfg(not(unix))]
    {
        fs::write(script_path, script.as_bytes())
            .map_err(|e| format!("Failed to prepare hook script: {e}"))
    }
}

async fn read_limited_output<R>(reader: &mut R, max_bytes: usize) -> Vec<u8>
where
    R: AsyncRead + Unpin,
{
    let mut bytes = Vec::with_capacity(max_bytes.min(8192));
    let mut buffer = [0_u8; 8192];

    loop {
        if bytes.len() >= max_bytes {
            break;
        }

        match reader.read(&mut buffer).await {
            Ok(0) => break,
            Ok(read_count) => {
                let remaining = max_bytes.saturating_sub(bytes.len());
                if remaining > 0 {
                    let to_copy = remaining.min(read_count);
                    bytes.extend_from_slice(&buffer[..to_copy]);
                }
            },
            Err(_) => break,
        }
    }

    bytes
}

async fn load_dependencies(
    conn: &sea_orm::DatabaseConnection,
    hook_id: &str,
) -> Result<Vec<String>, String> {
    let statement = Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "
        SELECT depends_on_hook_id
        FROM hook_dependencies
        WHERE hook_id = ?
        ORDER BY depends_on_hook_id ASC
        ",
        vec![hook_id.into()],
    );

    let rows = conn
        .query_all(statement)
        .await
        .map_err(|e| format!("Failed to load hook dependencies: {e}"))?;

    let mut deps = Vec::with_capacity(rows.len());
    for row in rows {
        let dep = row
            .try_get::<String>("", "depends_on_hook_id")
            .map_err(|e| format!("Failed to parse hook dependency: {e}"))?;
        deps.push(dep);
    }

    Ok(deps)
}

async fn ensure_dependencies_exist(
    conn: &sea_orm::DatabaseConnection,
    hook_id: &str,
    dependency_ids: &[String],
) -> Result<(), String> {
    for dep in dependency_ids {
        if dep == hook_id {
            return Err("Hooks cannot depend on themselves".to_string());
        }

        let statement = Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT 1 FROM hook_definitions WHERE id = ? LIMIT 1",
            vec![dep.clone().into()],
        );

        let exists = conn
            .query_one(statement)
            .await
            .map_err(|e| format!("Failed to validate hook dependency: {e}"))?
            .is_some();

        if !exists {
            return Err(format!("Dependency hook does not exist: {dep}"));
        }
    }

    Ok(())
}

#[derive(FromQueryResult)]
struct HookDependencyTriggerRow {
    id: String,
    trigger: String,
}

async fn ensure_dependency_triggers_match(
    conn: &sea_orm::DatabaseConnection,
    trigger: &str,
    dependency_ids: &[String],
) -> Result<(), String> {
    if dependency_ids.is_empty() {
        return Ok(());
    }

    let placeholders = vec!["?"; dependency_ids.len()].join(", ");
    let statement = Statement::from_sql_and_values(
        DbBackend::Sqlite,
        format!(
            "
            SELECT id, trigger
            FROM hook_definitions
            WHERE id IN ({placeholders})
            "
        ),
        dependency_ids
            .iter()
            .cloned()
            .map(Into::into)
            .collect::<Vec<_>>(),
    );

    let rows = HookDependencyTriggerRow::find_by_statement(statement)
        .all(conn)
        .await
        .map_err(|e| format!("Failed to validate workspace hook dependencies: {e}"))?;

    let dependency_triggers: HashMap<String, String> =
        rows.into_iter().map(|row| (row.id, row.trigger)).collect();

    ensure_dependency_triggers_compatible(trigger, dependency_ids, &dependency_triggers)
}

fn ensure_dependency_triggers_compatible(
    trigger: &str,
    dependency_ids: &[String],
    dependency_triggers: &HashMap<String, String>,
) -> Result<(), String> {
    for dependency_id in dependency_ids {
        let dependency_trigger = dependency_triggers.get(dependency_id).ok_or_else(|| {
            format!("Dependency '{dependency_id}' could not be validated for trigger compatibility")
        })?;

        if !dependency_trigger_compatible(trigger, dependency_trigger) {
            return Err(format!(
                "Dependency '{dependency_id}' uses trigger '{dependency_trigger}', which is not compatible with hook trigger '{trigger}' (only same-trigger or manual dependencies are allowed)"
            ));
        }
    }

    Ok(())
}

fn dependency_trigger_compatible(trigger: &str, dependency_trigger: &str) -> bool {
    dependency_trigger == trigger || dependency_trigger == "manual"
}

async fn ensure_no_dependency_cycle(
    conn: &sea_orm::DatabaseConnection,
    hook_id: &str,
) -> Result<(), String> {
    let statement = Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "
        WITH RECURSIVE graph(hook_id, depends_on_hook_id) AS (
            SELECT hook_id, depends_on_hook_id
            FROM hook_dependencies
            UNION ALL
            SELECT g.hook_id, d.depends_on_hook_id
            FROM graph g
            JOIN hook_dependencies d ON d.hook_id = g.depends_on_hook_id
        )
        SELECT 1
        FROM graph
        WHERE hook_id = depends_on_hook_id
          AND hook_id = ?
        LIMIT 1
        ",
        vec![hook_id.to_string().into()],
    );

    let cycle = conn
        .query_one(statement)
        .await
        .map_err(|e| format!("Failed to validate dependency graph: {e}"))?
        .is_some();

    if cycle {
        return Err("Dependency graph contains a cycle".to_string());
    }

    Ok(())
}

async fn load_hook_by_id(
    conn: &sea_orm::DatabaseConnection,
    hook_id: &str,
) -> Result<WorkspaceHook, String> {
    let statement = Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "
        SELECT id, name, scope, trigger, shell, script, enabled, critical, timeout_seconds, created_at, updated_at
        FROM hook_definitions
        WHERE id = ?
        LIMIT 1
        ",
        vec![hook_id.to_string().into()],
    );

    let row = conn
        .query_one(statement)
        .await
        .map_err(|e| format!("Failed to read workspace hook: {e}"))?
        .ok_or_else(|| "Hook not found".to_string())?;

    WorkspaceHook::from_query_result(&row, "")
        .map_err(|e| format!("Failed to parse workspace hook: {e}"))
}

async fn upsert_dependencies(
    conn: &sea_orm::DatabaseConnection,
    hook_id: &str,
    dependency_ids: &[String],
) -> Result<(), String> {
    let delete_statement = Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "DELETE FROM hook_dependencies WHERE hook_id = ?",
        vec![hook_id.to_string().into()],
    );
    conn.execute(delete_statement)
        .await
        .map_err(|e| format!("Failed to clear hook dependencies: {e}"))?;

    for dep in dependency_ids {
        let insert_statement = Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "
            INSERT INTO hook_dependencies(hook_id, depends_on_hook_id)
            VALUES(?, ?)
            ",
            vec![hook_id.to_string().into(), dep.clone().into()],
        );
        conn.execute(insert_statement)
            .await
            .map_err(|e| format!("Failed to save hook dependency: {e}"))?;
    }

    Ok(())
}

struct HookRunRecord {
    hook_id: String,
    trigger: String,
    worktree_path: String,
    status: String,
    started_at: i64,
    finished_at: Option<i64>,
    exit_code: Option<i64>,
    stdout: Option<String>,
    stderr: Option<String>,
    error_message: Option<String>,
}

async fn insert_hook_run(
    conn: &sea_orm::DatabaseConnection,
    record: HookRunRecord,
) -> Result<(), String> {
    let statement = Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "
        INSERT INTO hook_runs(
            id,
            hook_id,
            trigger,
            worktree_path,
            status,
            started_at,
            finished_at,
            exit_code,
            stdout_snippet,
            stderr_snippet,
            error_message
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ",
        vec![
            generate_run_id(&record.hook_id).into(),
            record.hook_id.into(),
            record.trigger.into(),
            record.worktree_path.into(),
            record.status.into(),
            record.started_at.into(),
            record.finished_at.into(),
            record.exit_code.into(),
            record.stdout.into(),
            record.stderr.into(),
            record.error_message.into(),
        ],
    );

    conn.execute(statement)
        .await
        .map_err(|e| format!("Failed to record hook run: {e}"))?;

    Ok(())
}

fn resolve_script_execution(
    hook: &RuntimeHook,
    script_path: &Path,
) -> Result<(String, Vec<String>), String> {
    let script = script_path.to_string_lossy().to_string();

    match hook.shell.as_str() {
        "bash" => Ok(("bash".to_string(), vec![script])),
        "zsh" => Ok(("zsh".to_string(), vec![script])),
        "powershell" => Ok((
            "powershell".to_string(),
            vec![
                "-NoLogo".to_string(),
                "-NoProfile".to_string(),
                "-NonInteractive".to_string(),
                "-File".to_string(),
                script,
            ],
        )),
        "pwsh" => Ok((
            "pwsh".to_string(),
            vec![
                "-NoLogo".to_string(),
                "-NoProfile".to_string(),
                "-NonInteractive".to_string(),
                "-File".to_string(),
                script,
            ],
        )),
        _ => Err(format!("Unsupported shell: {}", hook.shell)),
    }
}

async fn execute_hook(
    hook: RuntimeHook,
    workspace_path: PathBuf,
    worktree_path: PathBuf,
) -> (RuntimeHookResult, Option<String>, Option<String>) {
    let root_path = workspace_path.join("root");
    let worktrees_path = workspace_path.join("worktrees");

    let script_extension = hook_script_extension(&hook.shell);
    let script_path = std::env::temp_dir().join(format!(
        "sproutgit-hook-{}-{}.{}",
        hook.id,
        unique_suffix(),
        script_extension
    ));

    if let Err(e) = write_hook_script_file(&script_path, &hook.script) {
        return (
            RuntimeHookResult {
                hook_id: hook.id,
                hook_name: hook.name,
                critical: hook.critical,
                status: "failed".to_string(),
                success: false,
                error_message: Some(e),
            },
            None,
            None,
        );
    }

    let execution = resolve_script_execution(&hook, &script_path);
    let (program, args) = match execution {
        Ok(value) => value,
        Err(err) => {
            let _ = fs::remove_file(&script_path);
            return (
                RuntimeHookResult {
                    hook_id: hook.id,
                    hook_name: hook.name,
                    critical: hook.critical,
                    status: "failed".to_string(),
                    success: false,
                    error_message: Some(err),
                },
                None,
                None,
            );
        },
    };

    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let mut base = system_command(SystemAction::HookExecute, &program, &arg_refs);
    let (trigger_phase, trigger_action) = trigger_parts(&hook.trigger);
    let workspace_name = path_tail(&workspace_path);
    let worktree_name = path_tail(&worktree_path);
    let worktree_context = load_worktree_git_context(&worktree_path);

    base.env(
        "SPROUTGIT_WORKSPACE_PATH",
        workspace_path.to_string_lossy().to_string(),
    );
    base.env("SPROUTGIT_WORKSPACE_NAME", workspace_name);
    base.env(
        "SPROUTGIT_ROOT_PATH",
        root_path.to_string_lossy().to_string(),
    );
    base.env(
        "SPROUTGIT_WORKTREES_PATH",
        worktrees_path.to_string_lossy().to_string(),
    );
    base.env(
        "SPROUTGIT_WORKTREE_PATH",
        worktree_path.to_string_lossy().to_string(),
    );
    base.env("SPROUTGIT_WORKTREE_NAME", worktree_name);
    base.env(
        "SPROUTGIT_WORKTREE_BRANCH",
        worktree_context.branch_name.unwrap_or_default(),
    );
    base.env(
        "SPROUTGIT_WORKTREE_HEAD",
        worktree_context.head_full.unwrap_or_default(),
    );
    base.env(
        "SPROUTGIT_WORKTREE_HEAD_SHORT",
        worktree_context.head_short.unwrap_or_default(),
    );
    base.env(
        "SPROUTGIT_WORKTREE_DETACHED",
        if worktree_context.detached {
            "true"
        } else {
            "false"
        },
    );

    base.env("SPROUTGIT_HOOK_ID", hook.id.clone());
    base.env("SPROUTGIT_HOOK_NAME", hook.name.clone());
    base.env("SPROUTGIT_HOOK_SCOPE", hook.scope.clone());
    base.env("SPROUTGIT_HOOK_SHELL", hook.shell.clone());
    base.env(
        "SPROUTGIT_HOOK_CRITICAL",
        if hook.critical { "true" } else { "false" },
    );
    base.env(
        "SPROUTGIT_HOOK_TIMEOUT_SECONDS",
        hook.timeout_seconds.to_string(),
    );

    base.env("SPROUTGIT_TRIGGER", hook.trigger.clone());
    base.env("SPROUTGIT_TRIGGER_PHASE", trigger_phase);
    base.env("SPROUTGIT_TRIGGER_ACTION", trigger_action);
    base.env("SPROUTGIT_OS", current_os_label());

    let mut command = TokioCommand::from(base);
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(e) => {
            let _ = fs::remove_file(&script_path);
            return (
                RuntimeHookResult {
                    hook_id: hook.id,
                    hook_name: hook.name,
                    critical: hook.critical,
                    status: "failed".to_string(),
                    success: false,
                    error_message: Some(format!("Failed to spawn hook process: {e}")),
                },
                None,
                None,
            );
        },
    };

    let stdout_task = child.stdout.take().map(|mut out| {
        tokio::spawn(async move { read_limited_output(&mut out, MAX_HOOK_OUTPUT_BYTES).await })
    });

    let stderr_task = child.stderr.take().map(|mut err| {
        tokio::spawn(async move { read_limited_output(&mut err, MAX_HOOK_OUTPUT_BYTES).await })
    });

    let wait_outcome = timeout(
        Duration::from_secs(hook.timeout_seconds as u64),
        child.wait(),
    )
    .await;

    if wait_outcome.is_err() {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }

    let stdout_bytes = match stdout_task {
        Some(task) => task.await.unwrap_or_default(),
        None => Vec::new(),
    };
    let stderr_bytes = match stderr_task {
        Some(task) => task.await.unwrap_or_default(),
        None => Vec::new(),
    };

    let stdout_snippet = if stdout_bytes.is_empty() {
        None
    } else {
        Some(truncate_utf8(&stdout_bytes, MAX_HOOK_OUTPUT_BYTES))
    };
    let stderr_snippet = if stderr_bytes.is_empty() {
        None
    } else {
        Some(truncate_utf8(&stderr_bytes, MAX_HOOK_OUTPUT_BYTES))
    };

    let _ = fs::remove_file(&script_path);

    match wait_outcome {
        Ok(Ok(status)) => {
            if status.success() {
                (
                    RuntimeHookResult {
                        hook_id: hook.id,
                        hook_name: hook.name,
                        critical: hook.critical,
                        status: "success".to_string(),
                        success: true,
                        error_message: None,
                    },
                    stdout_snippet,
                    stderr_snippet,
                )
            } else {
                let error_message = stderr_snippet
                    .clone()
                    .filter(|s| !s.trim().is_empty())
                    .or_else(|| Some("Hook command failed".to_string()));

                (
                    RuntimeHookResult {
                        hook_id: hook.id,
                        hook_name: hook.name,
                        critical: hook.critical,
                        status: "failed".to_string(),
                        success: false,
                        error_message,
                    },
                    stdout_snippet,
                    stderr_snippet,
                )
            }
        },
        Ok(Err(e)) => (
            RuntimeHookResult {
                hook_id: hook.id,
                hook_name: hook.name,
                critical: hook.critical,
                status: "failed".to_string(),
                success: false,
                error_message: Some(format!("Failed while waiting for hook process: {e}")),
            },
            stdout_snippet,
            stderr_snippet,
        ),
        Err(_) => (
            RuntimeHookResult {
                hook_id: hook.id,
                hook_name: hook.name,
                critical: hook.critical,
                status: "timed_out".to_string(),
                success: false,
                error_message: Some(format!(
                    "Hook timed out after {} seconds",
                    hook.timeout_seconds
                )),
            },
            stdout_snippet,
            stderr_snippet,
        ),
    }
}

fn hook_script_extension(shell: &str) -> &'static str {
    if matches!(shell, "pwsh" | "powershell") {
        "ps1"
    } else {
        "sh"
    }
}

fn dependency_satisfied(
    dep_id: &str,
    pending: &HashMap<String, RuntimeHook>,
    completed: &HashMap<String, RuntimeHookResult>,
) -> bool {
    if pending.contains_key(dep_id) {
        return false;
    }

    let Some(dep_result) = completed.get(dep_id) else {
        // Missing dependency can happen if dependency hook was disabled or removed.
        // Treat as satisfied to avoid deadlocking the graph.
        return true;
    };

    if dep_result.success {
        return true;
    }

    // User decision: non-critical failure still allows downstream runs.
    !dep_result.critical
}

fn to_runtime_hook(hook: WorkspaceHook) -> RuntimeHook {
    RuntimeHook {
        id: hook.id,
        name: hook.name,
        scope: hook.scope,
        trigger: hook.trigger,
        shell: hook.shell,
        script: hook.script,
        critical: hook.critical,
        timeout_seconds: hook.timeout_seconds,
    }
}

async fn execute_loaded_hooks(
    conn: &sea_orm::DatabaseConnection,
    trigger: &str,
    worktree: &Path,
    hooks: HashMap<String, RuntimeHook>,
    dependency_map: HashMap<String, Vec<String>>,
    workspace: &Path,
    app_handle: Option<&tauri::AppHandle>,
) -> Result<HookExecutionSummary, String> {
    let mut pending = hooks;
    let mut completed: HashMap<String, RuntimeHookResult> = HashMap::new();
    let mut summary = HookExecutionSummary::default();

    while !pending.is_empty() {
        let mut ready_ids: Vec<String> = pending
            .keys()
            .filter_map(|hook_id| {
                let deps = dependency_map.get(hook_id).cloned().unwrap_or_default();
                let all_satisfied = deps
                    .iter()
                    .all(|dep_id| dependency_satisfied(dep_id, &pending, &completed));
                if all_satisfied {
                    Some(hook_id.clone())
                } else {
                    None
                }
            })
            .collect();

        if ready_ids.is_empty() {
            let blocked_ids: Vec<String> = pending.keys().cloned().collect();
            for blocked_id in blocked_ids {
                if let Some(blocked) = pending.remove(&blocked_id) {
                    let err = Some(
                        "Skipped because required dependencies did not complete successfully"
                            .to_string(),
                    );
                    let result = RuntimeHookResult {
                        hook_id: blocked.id.clone(),
                        hook_name: blocked.name.clone(),
                        critical: blocked.critical,
                        status: "skipped".to_string(),
                        success: false,
                        error_message: err.clone(),
                    };

                    if blocked.critical {
                        summary.had_critical_failure = true;
                        summary.failed_critical_hooks.push(blocked.name.clone());
                    } else {
                        summary.failed_non_critical_hooks.push(blocked.name.clone());
                    }

                    insert_hook_run(
                        conn,
                        HookRunRecord {
                            hook_id: blocked.id.clone(),
                            trigger: trigger.to_string(),
                            worktree_path: worktree.to_string_lossy().to_string(),
                            status: "skipped".to_string(),
                            started_at: now_epoch_seconds() as i64,
                            finished_at: Some(now_epoch_seconds() as i64),
                            exit_code: None,
                            stdout: None,
                            stderr: None,
                            error_message: err,
                        },
                    )
                    .await?;

                    emit_hook_progress(
                        app_handle,
                        HookProgressEvent {
                            trigger: trigger.to_string(),
                            hook_id: blocked.id.clone(),
                            hook_name: blocked.name.clone(),
                            phase: "skipped".to_string(),
                            status: "skipped".to_string(),
                            stdout_snippet: None,
                            stderr_snippet: None,
                            error_message: result.error_message.clone(),
                        },
                    );

                    completed.insert(blocked.id, result);
                }
            }
            break;
        }

        ready_ids.sort_by(|a, b| {
            let a_name = pending.get(a).map(|h| h.name.as_str()).unwrap_or_default();
            let b_name = pending.get(b).map(|h| h.name.as_str()).unwrap_or_default();
            a_name.cmp(b_name)
        });

        let mut joins = JoinSet::new();
        for hook_id in ready_ids {
            let Some(hook) = pending.remove(&hook_id) else {
                continue;
            };

            emit_hook_progress(
                app_handle,
                HookProgressEvent {
                    trigger: trigger.to_string(),
                    hook_id: hook.id.clone(),
                    hook_name: hook.name.clone(),
                    phase: "start".to_string(),
                    status: "running".to_string(),
                    stdout_snippet: None,
                    stderr_snippet: None,
                    error_message: None,
                },
            );

            joins.spawn(execute_hook(
                hook,
                workspace.to_path_buf(),
                worktree.to_path_buf(),
            ));
        }

        while let Some(join_result) = joins.join_next().await {
            if let Ok((hook_result, stdout, stderr)) = join_result {
                let name = hook_result.hook_name.clone();
                let stdout_for_event = stdout.clone();
                let stderr_for_event = stderr.clone();

                if !hook_result.success {
                    if hook_result.critical {
                        summary.had_critical_failure = true;
                        summary.failed_critical_hooks.push(name.clone());
                    } else {
                        summary.failed_non_critical_hooks.push(name.clone());
                    }
                }

                insert_hook_run(
                    conn,
                    HookRunRecord {
                        hook_id: hook_result.hook_id.clone(),
                        trigger: trigger.to_string(),
                        worktree_path: worktree.to_string_lossy().to_string(),
                        status: hook_result.status.clone(),
                        started_at: now_epoch_seconds() as i64,
                        finished_at: Some(now_epoch_seconds() as i64),
                        exit_code: None,
                        stdout,
                        stderr,
                        error_message: hook_result.error_message.clone(),
                    },
                )
                .await?;

                emit_hook_progress(
                    app_handle,
                    HookProgressEvent {
                        trigger: trigger.to_string(),
                        hook_id: hook_result.hook_id.clone(),
                        hook_name: hook_result.hook_name.clone(),
                        phase: "end".to_string(),
                        status: hook_result.status.clone(),
                        stdout_snippet: stdout_for_event,
                        stderr_snippet: stderr_for_event,
                        error_message: hook_result.error_message.clone(),
                    },
                );

                completed.insert(hook_result.hook_id.clone(), hook_result);
            }
        }
    }

    Ok(summary)
}

async fn load_hooks_for_trigger(
    conn: &sea_orm::DatabaseConnection,
    trigger: &str,
) -> Result<(HashMap<String, RuntimeHook>, HashMap<String, Vec<String>>), String> {
    let hook_statement = Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "
        SELECT id, name, scope, trigger, shell, script, enabled, critical, timeout_seconds, created_at, updated_at
        FROM hook_definitions
        WHERE trigger = ? AND enabled = 1
        ORDER BY name ASC
        ",
        vec![trigger.into()],
    );

    let rows = conn
        .query_all(hook_statement)
        .await
        .map_err(|e| format!("Failed to load hooks for trigger '{trigger}': {e}"))?;

    let mut hooks: HashMap<String, RuntimeHook> = HashMap::new();
    for row in rows {
        let hook = WorkspaceHook::from_query_result(&row, "")
            .map_err(|e| format!("Failed to parse hook definition: {e}"))?;
        hooks.insert(hook.id.clone(), to_runtime_hook(hook));
    }

    let mut dependency_map: HashMap<String, Vec<String>> = HashMap::new();
    let mut stack: Vec<String> = hooks.keys().cloned().collect();

    while let Some(hook_id) = stack.pop() {
        if dependency_map.contains_key(&hook_id) {
            continue;
        }

        let deps = load_dependencies(conn, &hook_id).await?;
        for dep_id in &deps {
            if hooks.contains_key(dep_id) {
                continue;
            }

            let dep_hook = load_hook_by_id(conn, dep_id).await?;
            if !dependency_trigger_compatible(trigger, &dep_hook.trigger) {
                return Err(format!(
                    "Dependency '{}' uses trigger '{}', which is not compatible with trigger '{}' (only same-trigger or manual dependencies are allowed)",
                    dep_hook.name, dep_hook.trigger, trigger
                ));
            }

            if dep_hook.enabled {
                hooks.insert(dep_hook.id.clone(), to_runtime_hook(dep_hook));
                stack.push(dep_id.clone());
            }
        }

        dependency_map.insert(hook_id, deps);
    }

    Ok((hooks, dependency_map))
}

async fn load_hook_closure(
    conn: &sea_orm::DatabaseConnection,
    hook_id: &str,
) -> Result<
    (
        String,
        HashMap<String, RuntimeHook>,
        HashMap<String, Vec<String>>,
    ),
    String,
> {
    let mut stack = vec![hook_id.to_string()];
    let mut hooks: HashMap<String, RuntimeHook> = HashMap::new();
    let mut dependency_map: HashMap<String, Vec<String>> = HashMap::new();
    let mut root_trigger: Option<String> = None;

    while let Some(next_hook_id) = stack.pop() {
        if hooks.contains_key(&next_hook_id) {
            continue;
        }

        let hook = load_hook_by_id(conn, &next_hook_id).await?;
        if !hook.enabled {
            return Err(format!(
                "Hook '{}' is disabled and cannot be run",
                hook.name
            ));
        }

        if let Some(existing_trigger) = &root_trigger {
            if !dependency_trigger_compatible(existing_trigger, &hook.trigger) {
                return Err(format!(
                    "Hook '{}' uses trigger '{}', which is not compatible with the selected hook trigger '{}' (only same-trigger or manual dependencies are allowed)",
                    hook.name, hook.trigger, existing_trigger
                ));
            }
        } else {
            root_trigger = Some(hook.trigger.clone());
        }

        let deps = load_dependencies(conn, &next_hook_id).await?;
        for dep in deps.iter().rev() {
            stack.push(dep.clone());
        }

        dependency_map.insert(next_hook_id.clone(), deps);
        hooks.insert(next_hook_id, to_runtime_hook(hook));
    }

    let trigger = root_trigger.ok_or_else(|| "Hook not found".to_string())?;
    Ok((trigger, hooks, dependency_map))
}

pub async fn execute_workspace_hooks_for_trigger(
    workspace_path: &Path,
    trigger: &str,
    worktree_path: &Path,
    app_handle: Option<&tauri::AppHandle>,
) -> Result<HookExecutionSummary, String> {
    let trigger = validate_trigger(trigger)?;
    let workspace = normalize_workspace_path(&workspace_path.to_string_lossy())?;
    let worktree = worktree_path.to_path_buf();

    let conn = connect_workspace_db(&workspace.to_string_lossy()).await?;
    let (hooks, dependency_map) = load_hooks_for_trigger(&conn, &trigger).await?;
    if hooks.is_empty() {
        return Ok(HookExecutionSummary::default());
    }

    execute_loaded_hooks(
        &conn,
        &trigger,
        &worktree,
        hooks,
        dependency_map,
        &workspace,
        app_handle,
    )
    .await
}

#[tauri::command]
pub async fn list_workspace_hooks(
    workspace_path: String,
    trigger: Option<String>,
) -> Result<Vec<WorkspaceHookWithDependencies>, String> {
    let conn = connect_workspace_db(&workspace_path).await?;

    let statement = if let Some(raw_trigger) = trigger {
        let trigger = validate_trigger(&raw_trigger)?;
        Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "
            SELECT id, name, scope, trigger, shell, script, enabled, critical, timeout_seconds, created_at, updated_at
            FROM hook_definitions
            WHERE trigger = ?
            ORDER BY name ASC
            ",
            vec![trigger.into()],
        )
    } else {
        Statement::from_string(
            DbBackend::Sqlite,
            "
            SELECT id, name, scope, trigger, shell, script, enabled, critical, timeout_seconds, created_at, updated_at
            FROM hook_definitions
            ORDER BY trigger ASC, name ASC
            "
            .to_string(),
        )
    };

    let rows = conn
        .query_all(statement)
        .await
        .map_err(|e| format!("Failed to list workspace hooks: {e}"))?;

    let mut output = Vec::with_capacity(rows.len());
    for row in rows {
        let hook = WorkspaceHook::from_query_result(&row, "")
            .map_err(|e| format!("Failed to parse workspace hook: {e}"))?;
        let dependency_ids = load_dependencies(&conn, &hook.id).await?;

        output.push(WorkspaceHookWithDependencies {
            id: hook.id,
            name: hook.name,
            scope: hook.scope,
            trigger: hook.trigger,
            shell: hook.shell,
            script: hook.script,
            enabled: hook.enabled,
            critical: hook.critical,
            timeout_seconds: hook.timeout_seconds,
            created_at: hook.created_at,
            updated_at: hook.updated_at,
            dependency_ids,
        });
    }

    Ok(output)
}

#[tauri::command]
pub async fn create_workspace_hook(
    workspace_path: String,
    input: HookUpsertInput,
) -> Result<WorkspaceHookWithDependencies, String> {
    let conn = connect_workspace_db(&workspace_path).await?;

    let id = generate_hook_id();
    let name = normalize_non_empty(&input.name, "Hook name")?;
    let scope = validate_scope(&input.scope)?;
    let trigger = validate_trigger(&input.trigger)?;
    let shell = validate_shell(&input.shell)?;
    let script = normalize_hook_script(&input.script)?;
    let timeout_seconds = validate_timeout(input.timeout_seconds)? as i64;
    let now = now_epoch_seconds() as i64;

    let insert_statement = Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "
        INSERT INTO hook_definitions(
            id,
            name,
            scope,
            trigger,
            shell,
            script,
            enabled,
            critical,
            timeout_seconds,
            created_at,
            updated_at
        )
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ",
        vec![
            id.clone().into(),
            name.clone().into(),
            scope.clone().into(),
            trigger.clone().into(),
            shell.clone().into(),
            script.clone().into(),
            (input.enabled as i64).into(),
            (input.critical as i64).into(),
            timeout_seconds.into(),
            now.into(),
            now.into(),
        ],
    );

    conn.execute(insert_statement)
        .await
        .map_err(|e| format!("Failed to create workspace hook: {e}"))?;

    let dependency_ids: Vec<String> = input
        .dependency_ids
        .into_iter()
        .map(|v| normalize_non_empty(&v, "Dependency id"))
        .collect::<Result<Vec<_>, _>>()?;

    ensure_dependencies_exist(&conn, &id, &dependency_ids).await?;
    ensure_dependency_triggers_match(&conn, &trigger, &dependency_ids).await?;
    upsert_dependencies(&conn, &id, &dependency_ids).await?;
    ensure_no_dependency_cycle(&conn, &id).await?;

    let hook = load_hook_by_id(&conn, &id).await?;

    Ok(WorkspaceHookWithDependencies {
        id: hook.id,
        name: hook.name,
        scope: hook.scope,
        trigger: hook.trigger,
        shell: hook.shell,
        script: hook.script,
        enabled: hook.enabled,
        critical: hook.critical,
        timeout_seconds: hook.timeout_seconds,
        created_at: hook.created_at,
        updated_at: hook.updated_at,
        dependency_ids,
    })
}

#[tauri::command]
pub async fn update_workspace_hook(
    workspace_path: String,
    hook_id: String,
    input: HookUpsertInput,
) -> Result<WorkspaceHookWithDependencies, String> {
    let conn = connect_workspace_db(&workspace_path).await?;

    let hook_id = normalize_non_empty(&hook_id, "Hook id")?;
    let name = normalize_non_empty(&input.name, "Hook name")?;
    let scope = validate_scope(&input.scope)?;
    let trigger = validate_trigger(&input.trigger)?;
    let shell = validate_shell(&input.shell)?;
    let script = normalize_hook_script(&input.script)?;
    let timeout_seconds = validate_timeout(input.timeout_seconds)? as i64;
    let now = now_epoch_seconds() as i64;

    let update_statement = Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "
        UPDATE hook_definitions
        SET name = ?,
            scope = ?,
            trigger = ?,
            shell = ?,
            script = ?,
            enabled = ?,
            critical = ?,
            timeout_seconds = ?,
            updated_at = ?
        WHERE id = ?
        ",
        vec![
            name.clone().into(),
            scope.clone().into(),
            trigger.clone().into(),
            shell.clone().into(),
            script.clone().into(),
            (input.enabled as i64).into(),
            (input.critical as i64).into(),
            timeout_seconds.into(),
            now.into(),
            hook_id.clone().into(),
        ],
    );

    let result = conn
        .execute(update_statement)
        .await
        .map_err(|e| format!("Failed to update workspace hook: {e}"))?;

    if result.rows_affected() == 0 {
        return Err("Hook not found".to_string());
    }

    let dependency_ids: Vec<String> = input
        .dependency_ids
        .into_iter()
        .map(|v| normalize_non_empty(&v, "Dependency id"))
        .collect::<Result<Vec<_>, _>>()?;

    ensure_dependencies_exist(&conn, &hook_id, &dependency_ids).await?;
    ensure_dependency_triggers_match(&conn, &trigger, &dependency_ids).await?;
    upsert_dependencies(&conn, &hook_id, &dependency_ids).await?;
    ensure_no_dependency_cycle(&conn, &hook_id).await?;

    let hook = load_hook_by_id(&conn, &hook_id).await?;

    Ok(WorkspaceHookWithDependencies {
        id: hook.id,
        name: hook.name,
        scope: hook.scope,
        trigger: hook.trigger,
        shell: hook.shell,
        script: hook.script,
        enabled: hook.enabled,
        critical: hook.critical,
        timeout_seconds: hook.timeout_seconds,
        created_at: hook.created_at,
        updated_at: hook.updated_at,
        dependency_ids,
    })
}

#[tauri::command]
pub async fn delete_workspace_hook(workspace_path: String, hook_id: String) -> Result<(), String> {
    let conn = connect_workspace_db(&workspace_path).await?;
    let hook_id = normalize_non_empty(&hook_id, "Hook id")?;

    let dep_delete = Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "DELETE FROM hook_dependencies WHERE hook_id = ? OR depends_on_hook_id = ?",
        vec![hook_id.clone().into(), hook_id.clone().into()],
    );
    conn.execute(dep_delete)
        .await
        .map_err(|e| format!("Failed to delete hook dependencies: {e}"))?;

    let hook_delete = Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "DELETE FROM hook_definitions WHERE id = ?",
        vec![hook_id.into()],
    );

    conn.execute(hook_delete)
        .await
        .map_err(|e| format!("Failed to delete workspace hook: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn toggle_workspace_hook(
    workspace_path: String,
    hook_id: String,
    enabled: bool,
) -> Result<(), String> {
    let conn = connect_workspace_db(&workspace_path).await?;
    let hook_id = normalize_non_empty(&hook_id, "Hook id")?;

    let statement = Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "
        UPDATE hook_definitions
        SET enabled = ?, updated_at = ?
        WHERE id = ?
        ",
        vec![
            (enabled as i64).into(),
            (now_epoch_seconds() as i64).into(),
            hook_id.into(),
        ],
    );

    conn.execute(statement)
        .await
        .map_err(|e| format!("Failed to toggle workspace hook: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn get_available_hook_shells() -> Vec<String> {
    detect_available_hook_shells()
}

#[tauri::command]
pub async fn run_workspace_hook(
    app_handle: tauri::AppHandle,
    workspace_path: String,
    hook_id: String,
    worktree_path: String,
) -> Result<(), String> {
    let workspace = normalize_workspace_path(&workspace_path)?;
    let worktree = normalize_existing_dir(&worktree_path, "Worktree path")?;
    let hook_id = normalize_non_empty(&hook_id, "Hook id")?;
    let conn = connect_workspace_db(&workspace.to_string_lossy()).await?;

    let (trigger, hooks, dependency_map) = load_hook_closure(&conn, &hook_id).await?;
    let summary = execute_loaded_hooks(
        &conn,
        &trigger,
        &worktree,
        hooks,
        dependency_map,
        &workspace,
        Some(&app_handle),
    )
    .await?;

    if !summary.failed_critical_hooks.is_empty() || !summary.failed_non_critical_hooks.is_empty() {
        let mut parts = Vec::new();
        if !summary.failed_critical_hooks.is_empty() {
            parts.push(format!(
                "critical: {}",
                summary.failed_critical_hooks.join(", ")
            ));
        }
        if !summary.failed_non_critical_hooks.is_empty() {
            parts.push(format!(
                "non-critical: {}",
                summary.failed_non_critical_hooks.join(", ")
            ));
        }
        return Err(format!(
            "Hook run completed with failures ({})",
            parts.join("; ")
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        ensure_dependency_triggers_compatible, hook_script_extension, normalize_hook_script,
        read_limited_output,
    };
    use std::collections::HashMap;
    use tokio::io::{duplex, AsyncWriteExt};

    #[test]
    fn normalize_hook_script_allows_multiline_scripts() {
        let script = "echo first line\n\t echo second line";
        match normalize_hook_script(script) {
            Ok(normalized) => assert_eq!(normalized, script),
            Err(err) => panic!("script should be accepted: {err}"),
        }
    }

    #[test]
    fn normalize_hook_script_rejects_invalid_control_chars() {
        let script = "echo hello\u{0000}";
        match normalize_hook_script(script) {
            Ok(_) => panic!("NUL should be rejected"),
            Err(err) => assert!(err.contains("invalid control")),
        }
    }

    #[test]
    fn read_limited_output_caps_bytes() {
        let runtime = match tokio::runtime::Runtime::new() {
            Ok(runtime) => runtime,
            Err(err) => panic!("runtime should initialize: {err}"),
        };
        runtime.block_on(async {
            let (mut writer, mut reader) = duplex(1024);
            let payload = vec![b'a'; 200];
            tokio::spawn(async move {
                if let Err(err) = writer.write_all(&payload).await {
                    panic!("write should succeed: {err}");
                }
            });

            let bytes = read_limited_output(&mut reader, 64).await;
            assert_eq!(bytes.len(), 64);
        });
    }

    #[test]
    fn powershell_family_uses_ps1_extension() {
        assert_eq!(hook_script_extension("pwsh"), "ps1");
        assert_eq!(hook_script_extension("powershell"), "ps1");
        assert_eq!(hook_script_extension("bash"), "sh");
        assert_eq!(hook_script_extension("zsh"), "sh");
    }

    #[test]
    fn dependency_trigger_validation_rejects_cross_trigger_dependency() {
        let dependency_ids = vec!["dep-1".to_string()];
        let dependency_triggers =
            HashMap::from([("dep-1".to_string(), "after_worktree_create".to_string())]);

        match ensure_dependency_triggers_compatible(
            "before_worktree_create",
            &dependency_ids,
            &dependency_triggers,
        ) {
            Ok(_) => panic!("cross-trigger dependency should be rejected"),
            Err(err) => assert!(err.contains("not compatible with hook trigger")),
        }
    }

    #[test]
    fn dependency_trigger_validation_allows_manual_dependency_for_any_trigger() {
        let dependency_ids = vec!["dep-1".to_string()];
        let dependency_triggers = HashMap::from([("dep-1".to_string(), "manual".to_string())]);

        match ensure_dependency_triggers_compatible(
            "before_worktree_create",
            &dependency_ids,
            &dependency_triggers,
        ) {
            Ok(_) => {},
            Err(err) => panic!("manual dependency should be allowed: {err}"),
        }
    }
}
