pub mod apps;
pub mod browser;
pub mod fsops;
pub mod media;
pub mod shell;
pub mod system;

use crate::state::{AppState, ToolResult};
use serde_json::Value;
use tauri::{AppHandle, Manager};

/// Execute a tool by name. Every tool returns a ToolResult carrying its own
/// verification evidence; the wall duration is patched in here.
pub async fn dispatch(app: &AppHandle, tool: &str, args: &Value) -> ToolResult {
    let started = std::time::Instant::now();
    let mut result = match tool {
        // --- desktop ---
        "open_app" => apps::open_app(args).await,
        "close_app" => apps::close_app(args).await,
        "focus_app" => apps::focus_app(args).await,
        "list_running_apps" => apps::list_running_apps(args).await,
        "find_installed_app" => apps::find_installed_app(args).await,
        // --- filesystem ---
        "list_directory" => fsops::list_directory(args).await,
        "search_files" => fsops::search_files(args).await,
        "open_file" => fsops::open_file(args).await,
        "create_folder" => fsops::create_folder(args).await,
        "copy_file" => fsops::copy_file(args).await,
        "move_file" => fsops::move_file(args).await,
        "rename_file" => fsops::rename_file(args).await,
        "get_file_info" => fsops::get_file_info(args).await,
        "delete_file" => fsops::delete_file(args).await,
        "delete_folder" => fsops::delete_folder(args).await,
        // --- clipboard ---
        "clipboard_read" => media::clipboard_read(args).await,
        "clipboard_write" => media::clipboard_write(args).await,
        // --- terminal ---
        "run_powershell" => shell::run_powershell(app, args).await,
        "start_background_process" => shell::start_background_process(app, args).await,
        "read_process_log" => shell::read_process_log(app, args).await,
        "stop_process" => shell::stop_process(app, args).await,
        "check_http" => shell::check_http(args).await,
        // --- browser ---
        "open_url" => browser::open_url(args).await,
        "browser_navigate" => browser::sidecar_tool("navigate", args).await,
        "browser_click" => browser::sidecar_tool("click", args).await,
        "browser_type" => browser::sidecar_tool("type", args).await,
        "browser_scroll" => browser::sidecar_tool("scroll", args).await,
        "browser_find" => browser::sidecar_tool("find", args).await,
        "browser_read_page" => browser::sidecar_tool("read_page", args).await,
        "browser_screenshot" => browser::sidecar_tool("screenshot", args).await,
        "get_current_url" => browser::sidecar_tool("current_url", args).await,
        "get_page_title" => browser::sidecar_tool("page_title", args).await,
        // --- system information ---
        "get_system_info" => system::get_system_info(args).await,
        "get_memory_info" => system::get_memory_info(args).await,
        "get_disk_info" => system::get_disk_info(args).await,
        "get_battery_info" => system::get_battery_info(args).await,
        "open_windows_settings" => system::open_windows_settings(args).await,
        // --- screen ---
        "take_screenshot" => media::take_screenshot(args).await,
        "inspect_screen" => media::take_screenshot(args).await,
        // --- local agent helper ---
        "create_plan" => ToolResult::success(
            "create_plan",
            "safe",
            serde_json::json!({ "plan_recorded": true }),
            0,
        ),
        other => ToolResult::failure(
            other,
            "safe",
            format!("Unknown tool: {other}"),
            started.elapsed().as_millis(),
        ),
    };
    result.duration_ms = started.elapsed().as_millis();
    result
}

/// Execute a tool and persist + broadcast an action entry.
pub async fn execute_and_log(
    app: &AppHandle,
    tool: &str,
    args: &Value,
    task_id: Option<String>,
) -> ToolResult {
    let state: tauri::State<'_, AppState> = app.state();
    let result = dispatch(app, tool, args).await;

    // Build a human summary (reuse classifier summary; fall back to error).
    let desktop = crate::settings::get_section(&state, "desktop");
    let security = crate::settings::get_section(&state, "security");
    let privacy = crate::settings::get_section(&state, "privacy");
    let class = crate::permissions::classify(&desktop, &security, &privacy, tool, args);
    let summary = if result.ok {
        class.summary.clone()
    } else {
        result
            .error
            .clone()
            .unwrap_or_else(|| class.summary.clone())
    };
    let detail = format!(
        "args: {}\nresult: {}",
        serde_json::to_string(args).unwrap_or_default(),
        serde_json::to_string(&result.data).unwrap_or_default()
    );

    let entry = crate::state::ActionEntry {
        id: None,
        ts: crate::db::now_time(),
        task_id: task_id.clone(),
        tool: tool.to_string(),
        risk: result.risk.clone(),
        ok: result.ok,
        summary: summary.clone(),
        detail: detail.chars().take(1500).collect(),
    };

    // persist
    let _ = crate::db::with_db(&state, |c| {
        c.execute(
            "INSERT INTO actions (task_id, tool, risk, ok, summary, detail, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                entry.task_id,
                entry.tool,
                entry.risk,
                entry.ok as i64,
                entry.summary,
                entry.detail,
                crate::db::now_ts()
            ],
        )
    });

    // broadcast
    use tauri::Emitter;
    let _ = app.emit("cipher-action", &entry);
    result
}
