use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter};

use crate::git::helpers::{
    command_exists, shell_candidates_for_current_os, validate_no_control_chars,
};

// ── Shell detection ──────────────────────────────────────────────────────────

pub fn detect_available_shells() -> Vec<String> {
    let detected: Vec<String> = shell_candidates_for_current_os()
        .iter()
        .filter(|c| command_exists(c))
        .map(|c| c.to_string())
        .collect();

    if detected.is_empty() {
        shell_candidates_for_current_os()
            .first()
            .map(|c| vec![c.to_string()])
            .unwrap_or_else(|| vec!["bash".to_string()])
    } else {
        detected
    }
}

// ── PTY session state ────────────────────────────────────────────────────────

struct PtySession {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
}

pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, Arc<PtySession>>>>,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn generate_pty_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("pty-{millis}")
}

fn validate_pty_id(pty_id: &str) -> Result<String, String> {
    let id = pty_id.trim().to_string();
    if id.is_empty() {
        return Err("PTY ID is required".to_string());
    }
    validate_no_control_chars(&id, "PTY ID")?;
    Ok(id)
}

fn validate_shell_for_terminal(shell: &str) -> Result<String, String> {
    let s = shell.trim().to_string();
    if s.is_empty() {
        return Err("Shell is required".to_string());
    }
    // Prevent option-injection: reject values that start with '-'
    if s.starts_with('-') {
        return Err("Invalid shell name".to_string());
    }
    validate_no_control_chars(&s, "Shell")?;
    let available = detect_available_shells();
    if !available.contains(&s) {
        return Err(format!(
            "Shell '{}' is not available on this system. Available: {}",
            s,
            available.join(", ")
        ));
    }
    Ok(s)
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_available_shells() -> Vec<String> {
    tokio::task::spawn_blocking(detect_available_shells)
        .await
        .unwrap_or_default()
}

/// Spawn a new PTY session running the given shell in the given directory.
/// Returns the PTY ID which must be used for subsequent input/resize/close calls.
/// Emits `terminal-output-{pty_id}` events with `String` payloads (UTF-8).
/// Emits `terminal-closed-{pty_id}` when the shell process exits.
#[tauri::command]
pub async fn spawn_terminal(
    app_handle: AppHandle,
    state: tauri::State<'_, TerminalManager>,
    shell: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    let shell = validate_shell_for_terminal(&shell)?;

    let cwd_path = PathBuf::from(cwd.trim());
    if !cwd_path.is_dir() {
        return Err(format!(
            "Working directory does not exist: {}",
            cwd_path.display()
        ));
    }

    let pty_id = generate_pty_id();

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {e}"))?;

    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(&cwd_path);

    // Set GIT_TERMINAL_PROMPT=0 so git doesn't hang waiting for interactive input
    cmd.env("GIT_TERMINAL_PROMPT", "0");

    pair.slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell '{shell}': {e}"))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to get PTY writer: {e}"))?;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to get PTY reader: {e}"))?;

    let session = Arc::new(PtySession {
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
    });

    {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "Failed to lock terminal sessions".to_string())?;
        sessions.insert(pty_id.clone(), Arc::clone(&session));
    }

    // Clone the Arc so the background task can clean up when done
    let sessions_arc = Arc::clone(&state.sessions);
    let pty_id_clone = pty_id.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    // Convert bytes to a UTF-8 string (lossy) for the frontend
                    let text = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = app_handle.emit(&format!("terminal-output-{}", pty_id_clone), &text);
                },
            }
        }

        // Remove session from the map when the shell exits
        if let Ok(mut sessions) = sessions_arc.lock() {
            sessions.remove(&pty_id_clone);
        }

        // Notify frontend that the session is gone
        let _ = app_handle.emit(&format!("terminal-closed-{}", pty_id_clone), ());
    });

    Ok(pty_id)
}

/// Send keyboard input to a running PTY session.
#[tauri::command]
pub async fn terminal_input(
    state: tauri::State<'_, TerminalManager>,
    pty_id: String,
    data: String,
) -> Result<(), String> {
    let pty_id = validate_pty_id(&pty_id)?;

    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "Failed to lock terminal sessions".to_string())?;

    let session = sessions
        .get(&pty_id)
        .ok_or_else(|| format!("No terminal session: {pty_id}"))?;

    let mut writer = session
        .writer
        .lock()
        .map_err(|_| "Failed to lock PTY writer".to_string())?;

    writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Failed to write to PTY: {e}"))?;

    Ok(())
}

/// Notify the PTY of a terminal resize.
#[tauri::command]
pub async fn terminal_resize(
    state: tauri::State<'_, TerminalManager>,
    pty_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let pty_id = validate_pty_id(&pty_id)?;

    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "Failed to lock terminal sessions".to_string())?;

    let session = sessions
        .get(&pty_id)
        .ok_or_else(|| format!("No terminal session: {pty_id}"))?;

    session
        .master
        .lock()
        .map_err(|_| "Failed to lock PTY master".to_string())?
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to resize PTY: {e}"))?;

    Ok(())
}

/// Close and clean up a PTY session, killing the shell process.
#[tauri::command]
pub async fn close_terminal(
    state: tauri::State<'_, TerminalManager>,
    pty_id: String,
) -> Result<(), String> {
    let pty_id = validate_pty_id(&pty_id)?;

    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Failed to lock terminal sessions".to_string())?;

    // Dropping the Arc (when refcount → 0) closes the master PTY and kills the child
    sessions.remove(&pty_id);

    Ok(())
}
