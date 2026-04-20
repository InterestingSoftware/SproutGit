use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const GITHUB_CLIENT_ID: &str = "Ov23lifguAkeqGXQaZFS";

// ── Auth Storage ──
// Token and username are stored in ~/.sproutgit/auth.json with 0600 permissions.

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

pub fn get_stored_token() -> Option<String> {
    read_auth_data().token
}

fn store_token(token: &str) -> Result<(), String> {
    let mut data = read_auth_data();
    data.token = Some(token.to_string());
    write_auth_data(&data)
}

fn delete_token() -> Result<(), String> {
    let path = auth_file_path()?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to remove auth file: {e}"))?;
    }
    Ok(())
}

fn get_stored_username() -> Option<String> {
    read_auth_data().username
}

fn store_username(username: &str) -> Result<(), String> {
    let mut data = read_auth_data();
    data.username = Some(username.to_string());
    write_auth_data(&data)
}

// ── Git Credential Injection ──
// Used by workspace clone to authenticate via stored GitHub token.

pub fn git_auth_env() -> Vec<(String, String)> {
    let mut envs = Vec::new();
    if let Some(token) = get_stored_token() {
        envs.push(("GIT_CONFIG_COUNT".to_string(), "1".to_string()));
        envs.push((
            "GIT_CONFIG_KEY_0".to_string(),
            "credential.helper".to_string(),
        ));
        #[cfg(unix)]
        envs.push((
            "GIT_CONFIG_VALUE_0".to_string(),
            format!(
                "!f() {{ echo \"username=x-access-token\"; echo \"password={}\"; }}; f",
                token.replace('"', "\\\"")
            ),
        ));
        #[cfg(not(unix))]
        envs.push((
            "GIT_CONFIG_VALUE_0".to_string(),
            format!("!echo username=x-access-token& echo password={}", token),
        ));
    }
    envs
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
pub struct GitHubRepo {
    pub full_name: String,
    pub clone_url: String,
    pub private: bool,
    pub description: Option<String>,
}

// ── Commands ──

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
