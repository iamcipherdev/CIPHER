//! Browser automation via the local Python + Playwright sidecar, plus the
//! zero-dependency `open_url` fallback through the OS default browser.

use super::ToolResult;
use serde_json::Value;

pub const BROWSER_SIDECAR: &str = "http://127.0.0.1:11436";
pub const VOICE_SIDECAR: &str = "http://127.0.0.1:11437";

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(40))
        .build()
}

fn sidecar_available() -> bool {
    let a = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_millis(900))
        .build();
    matches!(a.get(&format!("{BROWSER_SIDECAR}/health")).call(), Ok(_))
}

fn sidecar_error(tool: &str) -> ToolResult {
    ToolResult::failure(
        tool,
        "safe",
        "The browser automation sidecar isn't running. Start it with:\n  pip install -r agent/requirements.txt\n  python agent/browser_server.py\n(See docs/BUILD-WINDOWS.md).".to_string(),
        0,
    )
}

async fn call_sidecar(tool: &str, action: &str, params: Value) -> ToolResult {
    if !sidecar_available() {
        return sidecar_error(tool);
    }
    let body = serde_json::json!({ "action": action, "params": params });
    let result = tokio::task::spawn_blocking(move || {
        agent()
            .post(&format!("{BROWSER_SIDECAR}/command"))
            .send_json(body)
    })
    .await;

    match result {
        Ok(Ok(resp)) => match resp.into_json::<serde_json::Value>() {
            Ok(v) => {
                if v.get("ok").and_then(|b| b.as_bool()).unwrap_or(false) {
                    let mut r = ToolResult::success(tool, "safe", v["data"].clone(), 0);
                    r.evidence = v["evidence"].as_str().map(|s| s.to_string());
                    r
                } else {
                    ToolResult::failure(
                        tool,
                        "safe",
                        v["error"]
                            .as_str()
                            .unwrap_or("sidecar returned an unknown error")
                            .to_string(),
                        0,
                    )
                }
            }
            Err(e) => ToolResult::failure(tool, "safe", format!("Bad sidecar response: {e}"), 0),
        },
        Ok(Err(e)) => ToolResult::failure(
            tool,
            "safe",
            format!("Sidecar request failed: {e}"),
            0,
        ),
        Err(e) => ToolResult::failure(tool, "safe", format!("Sidecar task failed: {e}"), 0),
    }
}

/// Dispatch a browser tool through the sidecar with normalization.
pub async fn sidecar_tool(action: &str, args: &Value) -> ToolResult {
    let params = match action {
        "navigate" => serde_json::json!({ "url": args.get("url").and_then(|v| v.as_str()).unwrap_or("") }),
        "click" => serde_json::json!({
            "selector": args.get("selector").and_then(|v| v.as_str()).unwrap_or(""),
            "text": args.get("text").and_then(|v| v.as_str()).unwrap_or("")
        }),
        "type" => serde_json::json!({
            "selector": args.get("selector").and_then(|v| v.as_str()).unwrap_or(""),
            "text": args.get("text").and_then(|v| v.as_str()).unwrap_or(""),
            "submit": args.get("submit").and_then(|v| v.as_bool()).unwrap_or(false)
        }),
        "scroll" => serde_json::json!({ "amount": args.get("amount").and_then(|v| v.as_i64()).unwrap_or(600) }),
        "find" => serde_json::json!({ "query": args.get("query").and_then(|v| v.as_str()).unwrap_or("") }),
        _ => serde_json::json!({}),
    };
    let mut r = call_sidecar(action, action, params).await;
    r.risk = super::super::permissions::Risk::from_tool(&tool_name_for(action))
        .as_str()
        .to_string();
    // navigation verification
    if action == "navigate" {
        if let Some(url) = args.get("url").and_then(|v| v.as_str()) {
            if let Some(current) = r.data.get("url").and_then(|u| u.as_str()) {
                let wanted_host = host_of(url);
                let got_host = host_of(current);
                r.verified = Some(
                    got_host.contains(&wanted_host) || !wanted_host.is_empty() && got_host == wanted_host,
                );
                r.evidence = Some(format!("browser is now at {current}"));
            }
        }
    }
    r
}

fn tool_name_for(action: &str) -> String {
    match action {
        "navigate" => "browser_navigate",
        "click" => "browser_click",
        "type" => "browser_type",
        "scroll" => "browser_scroll",
        "find" => "browser_find",
        "read_page" => "browser_read_page",
        "screenshot" => "browser_screenshot",
        "current_url" => "get_current_url",
        "page_title" => "get_page_title",
        other => other,
    }
    .to_string()
}

fn host_of(url: &str) -> String {
    url.trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_start_matches("www.")
        .split('/')
        .next()
        .unwrap_or("")
        .to_lowercase()
}

pub async fn open_url(args: &Value) -> ToolResult {
    let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
    if url.is_empty() {
        return ToolResult::failure("open_url", "safe", "No URL given.".into(), 0);
    }
    let normalized = if url.starts_with("http://") || url.starts_with("https://") {
        url.to_string()
    } else if url.contains('.') && !url.contains(' ') {
        format!("https://{url}")
    } else {
        // treat as a search query
        format!("https://duckduckgo.com/?q={}", url.replace(' ', "+"))
    };
    match open::that(&normalized) {
        Ok(()) => ToolResult::success(
            "open_url",
            "safe",
            serde_json::json!({ "url": normalized, "opened": true, "browser": "system default" }),
            0,
        )
        .with_verified(
            false,
            "handed to the system default browser (install the browser sidecar for in-browser verification)".into(),
        ),
        Err(e) => ToolResult::failure("open_url", "safe", format!("Couldn't open URL: {e}"), 0),
    }
}

pub async fn sidecar_status(args: &Value) -> Result<serde_json::Value, String> {
    let _ = args;
    let a = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_millis(900))
        .build();
    let browser = matches!(a.get(&format!("{BROWSER_SIDECAR}/health")).call(), Ok(_));
    let voice = matches!(a.get(&format!("{VOICE_SIDECAR}/health")).call(), Ok(_));
    Ok(serde_json::json!({ "browser": browser, "voice": voice }))
}

pub async fn start_browser_sidecar(app: &tauri::AppHandle, _args: &Value) -> Result<serde_json::Value, String> {
    let _ = app;
    // locate the repo layout: ../agent/browser_server.py relative to the exe,
    // or an absolute CIPHER_AGENT_DIR override.
    let script = std::env::var("CIPHER_AGENT_DIR")
        .map(|d| std::path::PathBuf::from(d).join("browser_server.py"))
        .or_else(|_| {
            std::env::current_dir()
                .map(|c| c.join("agent").join("browser_server.py"))
        });
    let script = match script {
        Ok(p) if p.exists() => p,
        _ => {
            return Ok(serde_json::json!({
                "started": false,
                "reason": "browser_server.py not found next to the app. Run it manually: python agent/browser_server.py"
            }));
        }
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "/MIN", "python", &script.to_string_lossy()])
            .creation_flags(0x0800_0000)
            .spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("python3")
            .arg(&script)
            .spawn();
    }
    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
    sidecar_status(&_args_none()).await
}

fn _args_none() -> Value {
    serde_json::json!({})
}
