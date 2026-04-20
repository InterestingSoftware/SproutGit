use sea_orm::{ConnectionTrait, DbBackend, FromQueryResult, Statement};
use serde::Serialize;

use crate::db::connect_config_db;
use crate::git::helpers::{now_epoch_seconds, validate_no_control_chars};

#[derive(Serialize, FromQueryResult)]
#[serde(rename_all = "camelCase")]
pub struct RecentWorkspace {
    pub workspace_path: String,
    pub last_opened_at: i64,
}

fn validate_setting_key(key: &str) -> Result<String, String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("Setting key is required".to_string());
    }
    validate_no_control_chars(trimmed, "Setting key")?;
    Ok(trimmed.to_string())
}

fn validate_workspace_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Workspace path is required".to_string());
    }
    validate_no_control_chars(trimmed, "Workspace path")?;
    Ok(trimmed.to_string())
}

#[tauri::command]
pub async fn list_recent_workspaces() -> Result<Vec<RecentWorkspace>, String> {
    let conn = connect_config_db().await?;

    let statement = Statement::from_string(
        DbBackend::Sqlite,
        "
        SELECT workspace_path, last_opened_at
        FROM recent_workspaces
        ORDER BY last_opened_at DESC
        LIMIT 20
        "
        .to_string(),
    );

    conn.query_all(statement)
        .await
        .map_err(|e| format!("Failed to list recent workspaces: {e}"))?
        .iter()
        .map(|row| RecentWorkspace::from_query_result(row, ""))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to parse recent workspaces: {e}"))
}

#[tauri::command]
pub async fn touch_recent_workspace(workspace_path: String) -> Result<(), String> {
    let conn = connect_config_db().await?;
    let path = validate_workspace_path(&workspace_path)?;
    let now = now_epoch_seconds() as i64;

    let statement = Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "
        INSERT INTO recent_workspaces(workspace_path, last_opened_at)
        VALUES(?, ?)
        ON CONFLICT(workspace_path)
        DO UPDATE SET last_opened_at = excluded.last_opened_at
        ",
        vec![path.into(), now.into()],
    );

    conn.execute(statement)
        .await
        .map_err(|e| format!("Failed to update recent workspace: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn remove_recent_workspace(workspace_path: String) -> Result<(), String> {
    let conn = connect_config_db().await?;
    let path = validate_workspace_path(&workspace_path)?;

    let statement = Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "DELETE FROM recent_workspaces WHERE workspace_path = ?",
        vec![path.into()],
    );

    conn.execute(statement)
        .await
        .map_err(|e| format!("Failed to remove recent workspace: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn get_app_setting(key: String) -> Result<Option<String>, String> {
    let conn = connect_config_db().await?;
    let key = validate_setting_key(&key)?;

    let statement = Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "SELECT value FROM app_settings WHERE key = ? LIMIT 1",
        vec![key.into()],
    );

    let row = conn
        .query_one(statement)
        .await
        .map_err(|e| format!("Failed to read app setting: {e}"))?;

    Ok(row.and_then(|r| r.try_get::<String>("", "value").ok()))
}

#[tauri::command]
pub async fn set_app_setting(key: String, value: Option<String>) -> Result<(), String> {
    let conn = connect_config_db().await?;
    let key = validate_setting_key(&key)?;

    match value {
        Some(raw) => {
            let trimmed = raw.trim().to_string();
            validate_no_control_chars(&trimmed, "Setting value")?;
            let statement = Statement::from_sql_and_values(
                DbBackend::Sqlite,
                "
                INSERT INTO app_settings(key, value)
                VALUES(?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                ",
                vec![key.into(), trimmed.into()],
            );
            conn.execute(statement)
                .await
                .map_err(|e| format!("Failed to set app setting: {e}"))?;
        },
        None => {
            let statement = Statement::from_sql_and_values(
                DbBackend::Sqlite,
                "DELETE FROM app_settings WHERE key = ?",
                vec![key.into()],
            );
            conn.execute(statement)
                .await
                .map_err(|e| format!("Failed to clear app setting: {e}"))?;
        },
    }

    Ok(())
}
