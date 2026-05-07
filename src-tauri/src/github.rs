use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

const GITHUB_CLIENT_ID: &str = "Ov23li7ulFUcqulDi8u8";
const GITHUB_KEYCHAIN_SERVICE: &str = "dev.sproutgit.github";
const GITHUB_KEYCHAIN_ACCOUNT: &str = "oauth-token";

// ── Auth Storage ──
// Token is stored in ~/.sproutgit/auth.json (file-primary) with the OS keychain
// used as a best-effort secondary copy. File is never cleared; reads prefer file.
// Username is stored in ~/.sproutgit/auth.json with 0600 permissions.

#[derive(Serialize, Deserialize, Default)]
struct AuthData {
    #[serde(default)]
    token: Option<String>,
    #[serde(default)]
    username: Option<String>,
}

fn auth_file_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Cannot determine home directory".to_string())?;
    Ok(PathBuf::from(home).join(".sproutgit").join("auth.json"))
}

fn read_auth_data() -> AuthData {
    let path = match auth_file_path() {
        Ok(p) => p,
        Err(_) => return AuthData::default(),
    };
    match fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => AuthData::default(),
    }
}

fn write_auth_data(data: &AuthData) -> Result<(), String> {
    let path = auth_file_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create auth directory: {e}"))?;
    }
    let json = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize auth data: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("Failed to write auth file: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn keychain_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(GITHUB_KEYCHAIN_SERVICE, GITHUB_KEYCHAIN_ACCOUNT)
        .map_err(|e| format!("Failed to initialize secure credential storage: {e}"))
}

fn read_token_from_keychain() -> Option<String> {
    let entry = keychain_entry().ok()?;
    entry.get_password().ok().filter(|token| !token.is_empty())
}

fn write_token_to_keychain(token: &str) -> Result<(), String> {
    let entry = keychain_entry()?;
    entry
        .set_password(token)
        .map_err(|e| format!("Failed to store token in secure credential storage: {e}"))
}

fn delete_token_from_keychain() {
    if let Ok(entry) = keychain_entry() {
        let _ = entry.delete_credential();
    }
}

fn write_token_to_file(token: &str) -> Result<(), String> {
    let mut data = read_auth_data();
    data.token = Some(token.to_string());
    write_auth_data(&data)
}

fn clear_token_from_file() -> Result<(), String> {
    let mut data = read_auth_data();
    data.token = None;
    write_auth_data(&data)
}

fn validate_github_token_for_transport(token: &str) -> Result<(), String> {
    if token.trim().is_empty() {
        return Err("Stored token is empty".to_string());
    }

    let valid = token
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-');

    if !valid {
        return Err("Stored token contains unsupported characters".to_string());
    }

    Ok(())
}

fn auth_dir() -> Result<PathBuf, String> {
    auth_file_path()?
        .parent()
        .map(|parent| parent.to_path_buf())
        .ok_or("Failed to resolve auth directory".to_string())
}

fn unique_suffix() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

fn create_clone_credential_file(token: &str) -> Result<PathBuf, String> {
    let dir = auth_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create auth directory: {e}"))?;

    let file_path = dir.join(format!(
        "github-credentials-{}-{}.tmp",
        std::process::id(),
        unique_suffix()
    ));

    let content = format!("https://x-access-token:{token}@github.com\n");
    fs::write(&file_path, content)
        .map_err(|e| format!("Failed to prepare clone credentials: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&file_path, fs::Permissions::from_mode(0o600));
    }

    Ok(file_path)
}

pub struct GitCloneAuthContext {
    pub envs: Vec<(String, String)>,
    credential_file_path: Option<PathBuf>,
}

impl Drop for GitCloneAuthContext {
    fn drop(&mut self) {
        if let Some(path) = self.credential_file_path.take() {
            let _ = fs::remove_file(path);
        }
    }
}

fn git_helper_value_for_file(path: &std::path::Path) -> String {
    let normalized = path
        .to_string_lossy()
        .replace('\\', "/")
        .replace('"', "\\\"");
    format!("store --file=\"{normalized}\"")
}

pub fn get_stored_token() -> Option<String> {
    // File is the authoritative store (always written first in store_token).
    // Fall back to keychain for users who authenticated before the storage model
    // changed and whose file copy may not exist yet.
    if let Some(token) = read_auth_data().token {
        return Some(token);
    }
    read_token_from_keychain()
}

fn store_token(token: &str) -> Result<(), String> {
    validate_github_token_for_transport(token)?;

    // Always write to file first — this is the reliable fallback.
    // Keychain reads can silently fail in sandboxed environments (e.g. Tauri on
    // macOS without keychain entitlements), so we never clear the file copy.
    write_token_to_file(token)?;

    // Also try keychain as a best-effort upgrade; failure is non-fatal.
    let _ = write_token_to_keychain(token);

    Ok(())
}

fn delete_token() -> Result<(), String> {
    delete_token_from_keychain();
    clear_token_from_file()
}

fn get_stored_username() -> Option<String> {
    read_auth_data().username
}

fn store_username(username: &str) -> Result<(), String> {
    let mut data = read_auth_data();
    data.username = Some(username.to_string());
    write_auth_data(&data)
}

// ── Git Clone Auth Context ──
// Used by workspace clone to authenticate via stored GitHub token.

pub fn git_clone_auth_context() -> Result<Option<GitCloneAuthContext>, String> {
    let _ = migrate_legacy_token_to_keychain();

    let Some(token) = get_stored_token() else {
        return Ok(None);
    };

    validate_github_token_for_transport(&token)?;

    let credential_file = create_clone_credential_file(&token)?;
    let helper_value = git_helper_value_for_file(&credential_file);

    Ok(Some(GitCloneAuthContext {
        envs: vec![
            ("GIT_CONFIG_COUNT".to_string(), "1".to_string()),
            (
                "GIT_CONFIG_KEY_0".to_string(),
                "credential.helper".to_string(),
            ),
            ("GIT_CONFIG_VALUE_0".to_string(), helper_value),
        ],
        credential_file_path: Some(credential_file),
    }))
}

// ── API Structs ──

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Deserialize)]
struct GitHubDeviceCodeRaw {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct GitHubTokenRaw {
    access_token: Option<String>,
    token_type: Option<String>,
    scope: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
    interval: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPollResult {
    pub status: String,
    pub username: Option<String>,
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubAuthStatus {
    pub authenticated: bool,
    pub username: Option<String>,
    pub provider: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubAuthStorageMigration {
    pub migrated: bool,
    pub storage_backend: String,
    pub had_legacy_file_token: bool,
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepo {
    pub full_name: String,
    pub clone_url: String,
    pub private: bool,
    pub description: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubEmailSuggestion {
    pub label: String,
    pub email: String,
    pub kind: String,
    pub primary: bool,
    pub verified: bool,
}

fn migrate_legacy_token_to_keychain() -> GitHubAuthStorageMigration {
    // File is now always the primary token store (keychain is best-effort).
    // This migration is kept for backwards compatibility but does not clear
    // the file copy even when a keychain entry is successfully written.
    let auth_data = read_auth_data();
    let had_legacy_file_token = auth_data.token.is_some();

    if read_token_from_keychain().is_some() {
        return GitHubAuthStorageMigration {
            migrated: false,
            storage_backend: "keychain".to_string(),
            had_legacy_file_token,
            error: None,
        };
    }

    let Some(token) = auth_data.token else {
        return GitHubAuthStorageMigration {
            migrated: false,
            storage_backend: if had_legacy_file_token { "file" } else { "none" }.to_string(),
            had_legacy_file_token,
            error: None,
        };
    };

    if let Err(err) = validate_github_token_for_transport(&token) {
        return GitHubAuthStorageMigration {
            migrated: false,
            storage_backend: "file".to_string(),
            had_legacy_file_token: true,
            error: Some(err),
        };
    }

    // Try to also write to keychain; leave file intact regardless of outcome.
    match write_token_to_keychain(&token) {
        Ok(()) => GitHubAuthStorageMigration {
            migrated: true,
            storage_backend: "keychain".to_string(),
            had_legacy_file_token: true,
            error: None,
        },
        Err(err) => GitHubAuthStorageMigration {
            migrated: false,
            storage_backend: "file".to_string(),
            had_legacy_file_token: true,
            error: Some(err),
        },
    }
}

// ── Commands ──

#[tauri::command]
pub async fn migrate_github_auth_storage() -> GitHubAuthStorageMigration {
    tokio::task::spawn_blocking(migrate_legacy_token_to_keychain)
        .await
        .unwrap_or_else(|_| GitHubAuthStorageMigration {
            migrated: false,
            storage_backend: "error".to_string(),
            had_legacy_file_token: false,
            error: Some("Migration task failed".to_string()),
        })
}

#[tauri::command]
pub async fn github_device_flow_start() -> Result<DeviceCodeResponse, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .form(&[("client_id", GITHUB_CLIENT_ID), ("scope", "repo")])
        .send()
        .await
        .map_err(|e| format!("Failed to start device flow: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub returned status {}", resp.status()));
    }

    let raw: GitHubDeviceCodeRaw = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse device code response: {e}"))?;

    Ok(DeviceCodeResponse {
        device_code: raw.device_code,
        user_code: raw.user_code,
        verification_uri: raw.verification_uri,
        expires_in: raw.expires_in,
        interval: raw.interval,
    })
}

#[tauri::command]
pub async fn github_device_flow_poll(device_code: String) -> Result<GitHubPollResult, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .form(&[
            ("client_id", GITHUB_CLIENT_ID),
            ("device_code", device_code.as_str()),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ])
        .send()
        .await
        .map_err(|e| format!("Failed to poll for token: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub returned status {}", resp.status()));
    }

    let raw: GitHubTokenRaw = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse token response: {e}"))?;

    if let Some(token) = raw.access_token {
        store_token(&token)?;

        let username = fetch_github_username(&token).await.ok();
        if let Some(ref u) = username {
            let _ = store_username(u);
        }

        Ok(GitHubPollResult {
            status: "complete".to_string(),
            username,
            error: None,
        })
    } else if let Some(err) = raw.error {
        match err.as_str() {
            "authorization_pending" | "slow_down" => Ok(GitHubPollResult {
                status: "pending".to_string(),
                username: None,
                error: None,
            }),
            "expired_token" => Ok(GitHubPollResult {
                status: "expired".to_string(),
                username: None,
                error: Some("Device code expired. Please try again.".to_string()),
            }),
            _ => Ok(GitHubPollResult {
                status: "error".to_string(),
                username: None,
                error: raw.error_description.or(Some(err)),
            }),
        }
    } else {
        Err("Unexpected response from GitHub".to_string())
    }
}

async fn fetch_github_username(token: &str) -> Result<String, String> {
    #[derive(Deserialize)]
    struct GitHubUser {
        login: String,
    }

    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {token}"))
        .header("User-Agent", "SproutGit")
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch user info: {e}"))?;

    let user: GitHubUser = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse user info: {e}"))?;

    Ok(user.login)
}

#[tauri::command]
pub async fn get_github_auth_status() -> GitHubAuthStatus {
    let _ = migrate_legacy_token_to_keychain();

    let token = get_stored_token();
    let username = get_stored_username();

    if let Some(ref t) = token {
        // Validate the token with a lightweight API call.
        // If the token was revoked or expired, clear it immediately.
        let client = reqwest::Client::new();
        match client
            .get("https://api.github.com/user")
            .header("Authorization", format!("Bearer {t}"))
            .header("User-Agent", "SproutGit")
            .header("Accept", "application/json")
            .send()
            .await
        {
            Ok(resp) if resp.status().as_u16() == 401 => {
                let _ = delete_token();
                return GitHubAuthStatus {
                    authenticated: false,
                    username: None,
                    provider: "github".to_string(),
                };
            },
            Ok(resp) if resp.status().is_success() => {
                // Token valid — refresh username if it changed
                if let Ok(body) = resp.json::<serde_json::Value>().await {
                    if let Some(login) = body.get("login").and_then(|v| v.as_str()) {
                        if username.as_deref() != Some(login) {
                            let _ = store_username(login);
                            return GitHubAuthStatus {
                                authenticated: true,
                                username: Some(login.to_string()),
                                provider: "github".to_string(),
                            };
                        }
                    }
                }
            },
            _ => {
                // Network error — trust stored data
            },
        }
    }

    GitHubAuthStatus {
        authenticated: token.is_some(),
        username,
        provider: "github".to_string(),
    }
}

#[tauri::command]
pub fn github_logout() -> Result<(), String> {
    delete_token()
}

#[tauri::command]
pub async fn list_github_repos() -> Result<Vec<GitHubRepo>, String> {
    let token = get_stored_token().ok_or("Not authenticated with GitHub")?;

    #[derive(Deserialize)]
    struct RawRepo {
        full_name: String,
        clone_url: String,
        private: bool,
        description: Option<String>,
    }

    let client = reqwest::Client::new();
    let mut all_repos = Vec::new();
    let mut page = 1u32;

    loop {
        let resp = client
            .get("https://api.github.com/user/repos")
            .header("Authorization", format!("Bearer {token}"))
            .header("User-Agent", "SproutGit")
            .header("Accept", "application/json")
            .query(&[
                ("per_page", "100"),
                ("page", &page.to_string()),
                ("sort", "pushed"),
                ("direction", "desc"),
            ])
            .send()
            .await
            .map_err(|e| format!("Failed to fetch repos: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("GitHub returned status {}", resp.status()));
        }

        let repos: Vec<RawRepo> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse repos: {e}"))?;

        let count = repos.len();
        for r in repos {
            all_repos.push(GitHubRepo {
                full_name: r.full_name,
                clone_url: r.clone_url,
                private: r.private,
                description: r.description,
            });
        }

        if count < 100 {
            break;
        }
        page += 1;
        if page > 10 {
            break;
        }
    }

    Ok(all_repos)
}

#[tauri::command]
pub async fn list_github_email_suggestions() -> Result<Vec<GitHubEmailSuggestion>, String> {
    let token = get_stored_token().ok_or("Not authenticated with GitHub")?;

    #[derive(Deserialize)]
    struct RawUser {
        login: String,
        id: u64,
        email: Option<String>,
    }

    #[derive(Deserialize)]
    struct RawEmail {
        email: String,
        primary: bool,
        verified: bool,
    }

    fn push_unique(
        suggestions: &mut Vec<GitHubEmailSuggestion>,
        suggestion: GitHubEmailSuggestion,
    ) {
        if !suggestions
            .iter()
            .any(|existing| existing.email.eq_ignore_ascii_case(&suggestion.email))
        {
            suggestions.push(suggestion);
        }
    }

    let client = reqwest::Client::new();

    let user_resp = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {token}"))
        .header("User-Agent", "SproutGit")
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch GitHub user profile: {e}"))?;

    if !user_resp.status().is_success() {
        return Err(format!("GitHub returned status {}", user_resp.status()));
    }

    let user: RawUser = user_resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse GitHub user profile: {e}"))?;

    let mut suggestions = Vec::new();

    if let Some(public_email) = user.email.filter(|value| !value.trim().is_empty()) {
        push_unique(
            &mut suggestions,
            GitHubEmailSuggestion {
                label: "GitHub public email".to_string(),
                email: public_email,
                kind: "public".to_string(),
                primary: true,
                verified: true,
            },
        );
    }

    push_unique(
        &mut suggestions,
        GitHubEmailSuggestion {
            label: "GitHub private email".to_string(),
            email: format!("{}+{}@users.noreply.github.com", user.id, user.login),
            kind: "private".to_string(),
            primary: true,
            verified: true,
        },
    );

    push_unique(
        &mut suggestions,
        GitHubEmailSuggestion {
            label: "GitHub private email (legacy)".to_string(),
            email: format!("{}@users.noreply.github.com", user.login),
            kind: "private-legacy".to_string(),
            primary: false,
            verified: true,
        },
    );

    let emails_resp = client
        .get("https://api.github.com/user/emails")
        .header("Authorization", format!("Bearer {token}"))
        .header("User-Agent", "SproutGit")
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch GitHub emails: {e}"))?;

    if emails_resp.status().is_success() {
        let emails: Vec<RawEmail> = emails_resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse GitHub emails: {e}"))?;

        for entry in emails {
            push_unique(
                &mut suggestions,
                GitHubEmailSuggestion {
                    label: if entry.primary {
                        "GitHub email (primary)".to_string()
                    } else {
                        "GitHub email".to_string()
                    },
                    email: entry.email,
                    kind: "account".to_string(),
                    primary: entry.primary,
                    verified: entry.verified,
                },
            );
        }
    }

    Ok(suggestions)
}
