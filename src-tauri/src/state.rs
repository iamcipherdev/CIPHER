use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;

/// A tool execution waiting for the user's permission decision.
#[derive(Debug, Clone)]
pub struct PendingPermission {
    pub tool: String,
    pub args: serde_json::Value,
    pub risk: String,
    pub task_id: Option<String>,
}

/// A background process started by CIPHER (e.g. a dev server).
pub struct BgProc {
    pub log_path: std::path::PathBuf,
    pub command: String,
}

pub struct AppState {
    pub db: Mutex<Connection>,
    pub pending: Mutex<HashMap<String, PendingPermission>>,
    pub procs: Mutex<HashMap<u32, BgProc>>,
    pub paused: AtomicBool,
}

impl AppState {
    pub fn new(conn: Connection) -> Self {
        Self {
            db: Mutex::new(conn),
            pending: Mutex::new(HashMap::new()),
            procs: Mutex::new(HashMap::new()),
            paused: AtomicBool::new(false),
        }
    }
}

/// A row from the `actions` table, emitted live to the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionEntry {
    pub id: Option<i64>,
    pub ts: String,
    pub task_id: Option<String>,
    pub tool: String,
    pub risk: String,
    pub ok: bool,
    pub summary: String,
    pub detail: String,
}

/// Uniform result returned by every tool execution.
#[derive(Debug, Clone, Serialize)]
pub struct ToolResult {
    pub ok: bool,
    pub tool: String,
    pub risk: String,
    pub data: serde_json::Value,
    pub error: Option<String>,
    pub verified: Option<bool>,
    pub evidence: Option<String>,
    pub duration_ms: u128,
}

impl ToolResult {
    pub fn success(tool: &str, risk: &str, data: serde_json::Value, duration_ms: u128) -> Self {
        Self {
            ok: true,
            tool: tool.into(),
            risk: risk.into(),
            data,
            error: None,
            verified: None,
            evidence: None,
            duration_ms,
        }
    }

    pub fn failure(tool: &str, risk: &str, error: String, duration_ms: u128) -> Self {
        Self {
            ok: false,
            tool: tool.into(),
            risk: risk.into(),
            data: serde_json::json!({}),
            error: Some(error),
            verified: Some(false),
            evidence: None,
            duration_ms,
        }
    }

    pub fn blocked(tool: &str, reason: &str) -> Self {
        Self::failure(tool, "safe", format!("Blocked: {reason}"), 0)
    }
}
