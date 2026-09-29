//! All #[tauri::command] IPC handlers.

use crate::permissions::Risk;
use crate::settings;
use crate::state::{AppState, PendingPermission, ToolResult};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager};

// ---------------------------------------------------------------------------
// Outcome envelope
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ToolOutcome {
    Executed { result: ToolResult },
    PermissionRequired {
        request_id: String,
        tool: String,
        risk: String,
        summary: String,
        params: Value,
        allow_always: bool,
    },
}

#[derive(Serialize, Deserialize)]
pub struct Rule {
    pub tool: String,
    pub risk: String,
    pub created_at: String,
}

// ---------------------------------------------------------------------------
// Settings & secrets
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_settings(state: tauri::State<'_, AppState>) -> Value {
    let mut out = serde_json::Map::new();
    for key in ["general", "ai", "voice", "desktop", "security", "privacy"] {
        out.insert(key.to_string(), settings::get_section(&state, key));
    }
    let onboarded = settings::get_section(&state, "onboarded");
    out.insert(
        "onboarded".into(),
        Value::Bool(onboarded.as_bool().unwrap_or(false)),
    );
    Value::Object(out)
}

#[tauri::command]
pub fn set_setting(state: tauri::State<'_, AppState>, key: String, value: Value) -> Result<(), String> {
    if key == "onboarded" {
        settings::set_section(&state, "onboarded", value);
        return Ok(());
    }
    settings::set_section(&state, &key, value);
    Ok(())
}

#[tauri::command]
pub fn get_secret(_app: AppHandle, provider: String) -> Result<Option<String>, String> {
    crate::secure::get_secret(&provider)
}

#[tauri::command]
pub fn set_secret(_app: AppHandle, provider: String, key: String) -> Result<(), String> {
    crate::secure::set_secret(&provider, &key)
}

#[tauri::command]
pub fn delete_secret(_app: AppHandle, provider: String) -> Result<(), String> {
    crate::secure::delete_secret(&provider)
}

// ---------------------------------------------------------------------------
// Tool execution + permissions
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn request_tool_execution(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    tool: String,
    args: Value,
    task_id: Option<String>,
) -> Result<ToolOutcome, String> {
    if state.paused.load(Ordering::SeqCst) {
        return Ok(ToolOutcome::Executed {
            result: ToolResult::blocked(&tool, "CIPHER is paused (system tray → Pause Agent)"),
        });
    }

    let desktop = settings::get_section(&state, "desktop");
    let security = settings::get_section(&state, "security");
    let privacy = settings::get_section(&state, "privacy");
    let class = crate::permissions::classify(&desktop, &security, &privacy, &tool, &args);

    if let Some(reason) = &class.disabled {
        return Ok(ToolOutcome::Executed {
            result: ToolResult::blocked(&tool, reason),
        });
    }

    // Always-allow rules can never bypass HIGH risk.
    let rule_exists = crate::db::with_db(&state, |c| {
        c.query_row(
            "SELECT 1 FROM permission_rules WHERE tool = ?1",
            [&tool],
            |_| Ok(()),
        )
        .optional()
        .map(|o| o.is_some())
    })
    .unwrap_or(false);

    let auto_run_safe = security
        .get("auto_run_safe")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let confirm_medium = security
        .get("confirm_medium")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    let needs_permission = match class.risk {
        Risk::High => true,
        Risk::Medium => !rule_exists && confirm_medium,
        Risk::Safe => !rule_exists && !auto_run_safe,
    };

    if !needs_permission {
        let result = crate::tools::execute_and_log(&app, &tool, &args, task_id).await;
        return Ok(ToolOutcome::Executed { result });
    }

    let request_id = uuid::Uuid::new_v4().to_string();
    state.pending.lock().unwrap().insert(
        request_id.clone(),
        PendingPermission {
            tool: tool.clone(),
            args: args.clone(),
            risk: class.risk.as_str().to_string(),
            task_id: task_id.clone(),
        },
    );
    app.emit(
        "cipher-permission",
        serde_json::json!({
            "request_id": request_id,
            "tool": tool,
            "risk": class.risk.as_str(),
            "summary": class.summary,
            "params": args,
            "allow_always": class.risk != Risk::High,
        }),
    )
    .map_err(|e| e.to_string())?;

    Ok(ToolOutcome::PermissionRequired {
        request_id,
        tool,
        risk: class.risk.as_str().to_string(),
        summary: class.summary,
        params: args,
        allow_always: class.risk != Risk::High,
    })
}

#[tauri::command]
pub async fn resolve_permission(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    request_id: String,
    granted: bool,
    always_allow: bool,
) -> Result<ToolOutcome, String> {
    let pending = state.pending.lock().unwrap().remove(&request_id);
    let Some(p) = pending else {
        return Err("Unknown or expired permission request.".into());
    };

    if !granted {
        let result = ToolResult::failure(
            &p.tool,
            &p.risk,
            "Permission denied by the user. CIPHER will not perform this action.".into(),
            0,
        );
        let entry = crate::state::ActionEntry {
            id: None,
            ts: crate::db::now_time(),
            task_id: p.task_id.clone(),
            tool: p.tool.clone(),
            risk: p.risk.clone(),
            ok: false,
            summary: format!("DENIED — {}", p.tool),
            detail: "The user denied permission for this action.".into(),
        };
        let _ = crate::db::with_db(&state, |c| {
            c.execute(
                "INSERT INTO actions (task_id, tool, risk, ok, summary, detail, created_at)
                 VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6)",
                rusqlite::params![entry.task_id, entry.tool, entry.risk, entry.summary, entry.detail, crate::db::now_ts()],
            )
        });
        let _ = app.emit("cipher-action", &entry);
        return Ok(ToolOutcome::Executed { result });
    }

    if always_allow && p.risk != "high" {
        let _ = crate::db::with_db(&state, |c| {
            c.execute(
                "INSERT INTO permission_rules (tool, risk, created_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(tool) DO NOTHING",
                rusqlite::params![p.tool, p.risk, crate::db::now_ts()],
            )
        });
    }

    let result = crate::tools::execute_and_log(&app, &p.tool, &p.args, p.task_id).await;
    Ok(ToolOutcome::Executed { result })
}

#[tauri::command]
pub fn cancel_task(state: tauri::State<'_, AppState>, task_id: String) -> i64 {
    let mut pending = state.pending.lock().unwrap();
    let before = pending.len();
    pending.retain(|_, p| p.task_id.as_deref() != Some(task_id.as_str()));
    (before - pending.len()) as i64
}

#[tauri::command]
pub fn permission_rules(state: tauri::State<'_, AppState>) -> Vec<Rule> {
    crate::db::with_db(&state, |c| {
        let mut stmt = c.prepare("SELECT tool, risk, created_at FROM permission_rules ORDER BY created_at")?;
        let rows = stmt
            .query_map([], |row| {
                Ok(Rule {
                    tool: row.get(0)?,
                    risk: row.get(1)?,
                    created_at: row.get(2)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    })
    .unwrap_or_default()
}

#[tauri::command]
pub fn clear_permission_rules(state: tauri::State<'_, AppState>) -> Result<(), String> {
    crate::db::with_db(&state, |c| c.execute("DELETE FROM permission_rules", []))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// History (tasks / steps / actions / conversations)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn create_task(state: tauri::State<'_, AppState>, request: String) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    crate::db::with_db(&state, |c| {
        c.execute(
            "INSERT INTO tasks (id, request, status, created_at) VALUES (?1, ?2, 'running', ?3)",
            rusqlite::params![id, request, crate::db::now_ts()],
        )
    })?;
    Ok(id)
}

#[tauri::command]
pub fn set_task_plan(
    state: tauri::State<'_, AppState>,
    task_id: String,
    steps: Vec<Value>,
) -> Result<(), String> {
    crate::db::with_db(&state, |c| {
        c.execute("DELETE FROM task_steps WHERE task_id = ?1", [&task_id])?;
        for (i, step) in steps.iter().enumerate() {
            let description = step
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("Step");
            let tool = step.get("tool").and_then(|v| v.as_str()).unwrap_or("");
            c.execute(
                "INSERT INTO task_steps (task_id, idx, description, tool, status) VALUES (?1, ?2, ?3, ?4, 'pending')",
                rusqlite::params![task_id, i as i64, description, tool],
            )?;
        }
        let plan = serde_json::to_string(&steps).unwrap_or_default();
        c.execute(
            "UPDATE tasks SET plan_json = ?2 WHERE id = ?1",
            rusqlite::params![task_id, plan],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn complete_task(
    state: tauri::State<'_, AppState>,
    task_id: String,
    status: String,
    report: String,
) -> Result<(), String> {
    crate::db::with_db(&state, |c| {
        c.execute(
            "UPDATE tasks SET status = ?2, report = ?3, finished_at = ?4 WHERE id = ?1",
            rusqlite::params![task_id, status, report, crate::db::now_ts()],
        )
    })?;
    Ok(())
}

#[tauri::command]
pub fn list_tasks(state: tauri::State<'_, AppState>, limit: i64) -> Vec<Value> {
    crate::db::with_db(&state, |c| {
        let mut stmt = c.prepare(
            "SELECT id, request, status, report, created_at FROM tasks ORDER BY created_at DESC LIMIT ?1",
        )?;
        let rows = stmt
            .query_map([limit], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, String>(0)?,
                    "request": row.get::<_, String>(1)?,
                    "status": row.get::<_, String>(2)?,
                    "report": row.get::<_, Option<String>>(3)?,
                    "created_at": row.get::<_, String>(4)?,
                }))
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    })
    .unwrap_or_default()
}

#[tauri::command]
pub fn list_actions(state: tauri::State<'_, AppState>, limit: i64) -> Vec<Value> {
    crate::db::with_db(&state, |c| {
        let mut stmt = c.prepare(
            "SELECT id, created_at, tool, risk, ok, summary FROM actions ORDER BY id DESC LIMIT ?1",
        )?;
        let rows = stmt
            .query_map([limit], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, i64>(0)?,
                    "ts": row.get::<_, String>(1)?,
                    "tool": row.get::<_, String>(2)?,
                    "risk": row.get::<_, String>(3)?,
                    "ok": row.get::<_, i64>(4)? != 0,
                    "summary": row.get::<_, String>(5)?,
                }))
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    })
    .unwrap_or_default()
}

#[tauri::command]
pub fn clear_history(state: tauri::State<'_, AppState>) -> Result<(), String> {
    crate::db::with_db(&state, |c| {
        c.execute("DELETE FROM actions", [])?;
        c.execute("DELETE FROM task_steps", [])?;
        c.execute("DELETE FROM tasks", [])?;
        Ok(())
    })
}

#[tauri::command]
pub fn save_conversation(
    state: tauri::State<'_, AppState>,
    request: String,
    response: String,
) -> Result<(), String> {
    let id = uuid::Uuid::new_v4().to_string();
    crate::db::with_db(&state, |c| {
        c.execute(
            "INSERT INTO conversations (id, request, response, created_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![id, request, response, crate::db::now_ts()],
        )
    })?;
    Ok(())
}

#[tauri::command]
pub fn list_conversations(state: tauri::State<'_, AppState>, limit: i64) -> Vec<Value> {
    crate::db::with_db(&state, |c| {
        let mut stmt = c.prepare(
            "SELECT id, request, response, created_at FROM conversations ORDER BY created_at DESC LIMIT ?1",
        )?;
        let rows = stmt
            .query_map([limit], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, String>(0)?,
                    "request": row.get::<_, String>(1)?,
                    "response": row.get::<_, Option<String>>(2)?,
                    "created_at": row.get::<_, String>(3)?,
                }))
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    })
    .unwrap_or_default()
}

#[tauri::command]
pub fn clear_conversations(state: tauri::State<'_, AppState>) -> Result<(), String> {
    crate::db::with_db(&state, |c| c.execute("DELETE FROM conversations", []))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Speech / providers / system
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn speak(text: String) -> Result<(), String> {
    crate::tools::media::speak(&text).await
}

#[tauri::command]
pub fn ollama_detect(state: tauri::State<'_, AppState>) -> Value {
    let ai = settings::get_section(&state, "ai");
    let base = ai
        .get("ollama_endpoint")
        .and_then(|v| v.as_str())
        .unwrap_or("http://localhost:11434");
    let agent = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_millis(1200))
        .build();
    match agent.get(&format!("{base}/api/tags")).call() {
        Ok(resp) => match resp.into_json::<Value>() {
            Ok(tags) => {
                let models: Vec<Value> = tags
                    .get("models")
                    .and_then(|m| m.as_array())
                    .cloned()
                    .unwrap_or_default()
                    .iter()
                    .map(|m| {
                        serde_json::json!({
                            "name": m.get("name").cloned().unwrap_or(Value::Null),
                            "parameter_size": m.get("details").and_then(|d| d.get("parameter_size")).cloned().unwrap_or(Value::Null),
                            "family": m.get("details").and_then(|d| d.get("family")).cloned().unwrap_or(Value::Null),
                        })
                    })
                    .collect();
                serde_json::json!({ "available": true, "models": models })
            }
            Err(e) => serde_json::json!({ "available": false, "error": e.to_string() }),
        },
        Err(e) => serde_json::json!({
            "available": false,
            "error": format!("Ollama isn't reachable at {base} ({e}). Start it with `ollama serve`.")
        }),
    }
}

#[tauri::command]
pub async fn get_sidecar_status() -> Result<Value, String> {
    crate::tools::browser::sidecar_status(&Value::Null).await
}

#[tauri::command]
pub async fn start_browser_sidecar(app: AppHandle) -> Result<Value, String> {
    crate::tools::browser::start_browser_sidecar(&app, &Value::Null).await
}

#[tauri::command]
pub fn system_info() -> Value {
    serde_json::json!({
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "home": dirs::home_dir().map(|h| h.to_string_lossy().into_owned()).unwrap_or_default(),
        "hostname": std::env::var("COMPUTERNAME").unwrap_or_default(),
    })
}

#[tauri::command]
pub fn set_launch_on_startup(app: AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let autolaunch = app.autolaunch();
    if enabled {
        autolaunch.enable().map_err(|e| e.to_string())
    } else {
        autolaunch.disable().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn set_global_shortcut_cmd(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    shortcut: String,
) -> Result<(), String> {
    crate::system::shortcuts::register(&app, &shortcut)?;
    let mut general = settings::get_section(&state, "general");
    general["global_shortcut"] = Value::String(shortcut);
    settings::set_section(&state, "general", general);
    Ok(())
}

#[tauri::command]
pub fn submit_palette(app: AppHandle, text: String) -> Result<(), String> {
    crate::system::palette::submit(&app, text)
}

#[tauri::command]
pub fn set_paused(app: AppHandle, paused: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    state.paused.store(paused, Ordering::SeqCst);
    app.emit("cipher-paused", serde_json::json!({ "paused": paused }))
        .map_err(|e| e.to_string())
}
