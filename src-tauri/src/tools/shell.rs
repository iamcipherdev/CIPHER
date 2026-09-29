//! Terminal tools: PowerShell with timeout + risk classification upstream,
//! background processes with log capture, HTTP checks for dev servers.

use super::ToolResult;
use crate::state::{AppState, BgProc};
use serde_json::Value;
use std::path::PathBuf;
use sysinfo::ProcessesToUpdate;
use tauri::{AppHandle, Manager};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[allow(dead_code)]
const _CREATE_NO_WINDOW_KEEP: u32 = CREATE_NO_WINDOW;
const MAX_OUTPUT: usize = 20_000;

pub fn encode_ps(text: &str) -> String {
    let wide: Vec<u16> = text.encode_utf16().collect();
    let bytes: Vec<u8> = wide.iter().flat_map(|w| w.to_le_bytes()).collect();
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn shell_for_command(command: &str) -> (String, Vec<String>) {
    #[cfg(windows)]
    {
        ("powershell".into(), vec![
            "-NoProfile".into(),
            "-NonInteractive".into(),
            "-ExecutionPolicy".into(),
            "Bypass".into(),
            "-EncodedCommand".into(),
            encode_ps(command),
        ])
    }
    #[cfg(not(windows))]
    {
        // Prefer pwsh when available so behavior matches Windows.
        if let Ok(out) = std::process::Command::new("which").arg("pwsh").output() {
            if out.status.success() {
                return ("pwsh".into(), vec![
                    "-NoProfile".into(),
                    "-NonInteractive".into(),
                    "-EncodedCommand".into(),
                    encode_ps(command),
                ]);
            }
        }
        ("bash".into(), vec!["-c".into(), command.to_string()])
    }
}

pub async fn run_powershell(_app: &AppHandle, args: &Value) -> ToolResult {
    let command = args
        .get("command")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if command.trim().is_empty() {
        return ToolResult::failure("run_powershell", "medium", "Empty command.".into(), 0);
    }
    let timeout_secs = args
        .get("timeout_secs")
        .and_then(|v| v.as_u64())
        .unwrap_or(30)
        .clamp(3, 300);

    let (prog, pre) = shell_for_command(&command);

    let mut cmd = tokio::process::Command::new(&prog);
    cmd.args(&pre)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        // tokio::process::Command has an inherent `creation_flags` on Windows;
        // no std CommandExt import needed.
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let started = std::time::Instant::now();
    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let hint = if prog == "powershell" {
                "PowerShell could not be started."
            } else {
                "Neither pwsh nor bash could be started on this system."
            };
            return ToolResult::failure(
                "run_powershell",
                "medium",
                format!("Failed to start the shell: {e}. {hint}"),
                started.elapsed().as_millis(),
            );
        }
    };

    let output = match tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        child.wait_with_output(),
    )
    .await
    {
        Ok(Ok(out)) => out,
        Ok(Err(e)) => {
            return ToolResult::failure(
                "run_powershell",
                "medium",
                format!("Command execution failed: {e}"),
                started.elapsed().as_millis(),
            );
        }
        Err(_) => {
            return ToolResult::failure(
                "run_powershell",
                "medium",
                format!(
                    "Command timed out after {timeout_secs}s and was terminated: {command}"
                ),
                started.elapsed().as_millis(),
            );
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let exit_code = output.status.code().unwrap_or(-1);
    let duration_ms = started.elapsed().as_millis();

    let data = serde_json::json!({
        "command": command,
        "exit_code": exit_code,
        "stdout": truncate_str(&stdout, MAX_OUTPUT),
        "stderr": truncate_str(&stderr, MAX_OUTPUT),
        "duration_ms": duration_ms,
        "shell": prog,
    });
    let mut r = if exit_code == 0 {
        ToolResult::success("run_powershell", "medium", data, duration_ms)
    } else {
        let mut r = ToolResult::success("run_powershell", "medium", data, duration_ms);
        r.ok = false;
        r.error = Some(format!(
            "Command exited with code {exit_code}. stderr: {}",
            truncate_str(&stderr, 400)
        ));
        r
    };
    r.verified = Some(exit_code == 0);
    r.evidence = Some(format!("exit code {exit_code} after {duration_ms}ms"));
    r
}

fn truncate_str(s: &str, max: usize) -> String {
    if s.chars().count() > max {
        let cut: String = s.chars().take(max).collect();
        format!("{cut}\n…(truncated)")
    } else {
        s.to_string()
    }
}

pub async fn start_background_process(app: &AppHandle, args: &Value) -> ToolResult {
    let command = args
        .get("command")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if command.trim().is_empty() {
        return ToolResult::failure(
            "start_background_process",
            "medium",
            "Empty command.".into(),
            0,
        );
    }
    let cwd = args
        .get("cwd")
        .and_then(|v| v.as_str())
        .map(crate::tools::fsops::expand_path);

    // log file
    let log_dir = app
        .path()
        .app_data_dir()
        .map(|d| d.join("process-logs"))
        .unwrap_or_else(|_| PathBuf::from("."));
    let _ = std::fs::create_dir_all(&log_dir);
    #[cfg(windows)]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        let mut c = std::process::Command::new("cmd");
        c.args(["/C", &command]).creation_flags(CREATE_NO_WINDOW);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = std::process::Command::new("sh");
        c.args(["-c", &command]);
        c
    };
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    // spawn first without redirection to obtain the pid, then re-spawn with
    // redirection? No — spawn once with redirection; pid comes from the child.
    let stamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let log_path = log_dir.join(format!("bg_{stamp}.log"));
    let log_file = match std::fs::File::create(&log_path) {
        Ok(f) => f,
        Err(e) => {
            return ToolResult::failure(
                "start_background_process",
                "medium",
                format!("couldn't create process log: {e}"),
                0,
            );
        }
    };
    let log_err = match log_file.try_clone() {
        Ok(f) => f,
        Err(e) => {
            return ToolResult::failure(
                "start_background_process",
                "medium",
                format!("couldn't duplicate process log: {e}"),
                0,
            );
        }
    };
    cmd.stdout(std::process::Stdio::from(log_file));
    cmd.stderr(std::process::Stdio::from(log_err));

    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return ToolResult::failure(
                "start_background_process",
                "medium",
                format!("Failed to start \"{command}\": {e}"),
                0,
            );
        }
    };
    let pid = child.id();
    {
        let state: tauri::State<'_, AppState> = app.state();
        state.procs.lock().unwrap().insert(
            pid,
            BgProc {
                log_path: log_path.clone(),
                command: command.clone(),
            },
        );
    }

    // brief liveness check
    tokio::time::sleep(std::time::Duration::from_millis(700)).await;
    let running = pid_alive(pid);

    ToolResult::success(
        "start_background_process",
        "medium",
        serde_json::json!({
            "pid": pid,
            "command": command,
            "log_path": log_path.to_string_lossy(),
            "running_after_700ms": running,
            "hint": "Use read_process_log to watch output and detect URLs; use stop_process to terminate."
        }),
        0,
    )
}

fn pid_alive(pid: u32) -> bool {
    let mut sys = sysinfo::System::new();
    sys.refresh_processes(
        ProcessesToUpdate::Some(&[sysinfo::Pid::from_u32(pid)]),
        false,
    );
    sys.process(sysinfo::Pid::from_u32(pid)).is_some()
}

pub async fn read_process_log(app: &AppHandle, args: &Value) -> ToolResult {
    let pid = args.get("pid").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    let state: tauri::State<'_, AppState> = app.state();
    let log_path = state.procs.lock().unwrap().get(&pid).map(|p| p.log_path.clone());
    let log_path = match log_path {
        Some(p) => p,
        None => {
            return ToolResult::failure(
                "read_process_log",
                "safe",
                format!("No background process #{pid} known to CIPHER."),
                0,
            );
        }
    };
    let output = match std::fs::read_to_string(&log_path) {
        Ok(s) => s,
        Err(e) => format!("(no output yet: {e})"),
    };
    let running = pid_alive(pid);
    let command = state
        .procs
        .lock()
        .unwrap()
        .get(&pid)
        .map(|p| p.command.clone())
        .unwrap_or_default();
    ToolResult::success(
        "read_process_log",
        "safe",
        serde_json::json!({
            "pid": pid,
            "command": command,
            "running": running,
            "output": truncate_str(&output, 8000),
            "log_path": log_path.to_string_lossy()
        }),
        0,
    )
}

pub async fn stop_process(app: &AppHandle, args: &Value) -> ToolResult {
    let pid = args.get("pid").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    if pid == 0 {
        return ToolResult::failure("stop_process", "medium", "No pid given.".into(), 0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let out = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        match out {
            Ok(o) if o.status.success() => {
                let state: tauri::State<'_, AppState> = app.state();
                state.procs.lock().unwrap().remove(&pid);
                return ToolResult::success(
                    "stop_process",
                    "medium",
                    serde_json::json!({ "pid": pid, "stopped": true }),
                    0,
                )
                .with_verified(!pid_alive(pid), "taskkill reported success".into());
            }
            _ => {}
        }
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("kill").arg("-9").arg(pid.to_string()).output();
        let state: tauri::State<'_, AppState> = app.state();
        state.procs.lock().unwrap().remove(&pid);
        return ToolResult::success(
            "stop_process",
            "medium",
            serde_json::json!({ "pid": pid, "stopped": true }),
            0,
        )
        .with_verified(!pid_alive(pid), "kill sent".into());
    }
    #[allow(unreachable_code)]
    {
        ToolResult::failure(
            "stop_process",
            "medium",
            format!("Couldn't stop process #{pid}. It may have already exited or needs manual action."),
            0,
        )
    }
}

pub async fn check_http(args: &Value) -> ToolResult {
    let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
    if url.is_empty() {
        return ToolResult::failure("check_http", "safe", "No URL given.".into(), 0);
    }
    let timeout_ms = args
        .get("timeout_ms")
        .and_then(|v| v.as_u64())
        .unwrap_or(4000);
    let agent = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_millis(timeout_ms))
        .build();
    let started = std::time::Instant::now();
    match agent.get(url).call() {
        Ok(resp) => {
            let status = resp.status();
            let body = resp
                .into_string()
                .unwrap_or_default();
            let verified = status < 400;
            ToolResult::success(
                "check_http",
                "safe",
                serde_json::json!({
                    "url": url,
                    "status": status,
                    "body_sample": truncate_str(&body, 300),
                    "duration_ms": started.elapsed().as_millis()
                }),
                0,
            )
            .with_verified(verified, format!("HTTP {status}"))
        }
        Err(ureq::Error::Status(code, _resp)) => {
            ToolResult::success(
                "check_http",
                "safe",
                serde_json::json!({ "url": url, "status": code, "body_sample": "" }),
                0,
            )
            .with_verified(code < 400, format!("HTTP {code}"))
        }
        Err(e) => {
            let msg = e.to_string();
            ToolResult::failure(
                "check_http",
                "safe",
                format!(
                    "Nothing responded at {url} ({msg}). If this is a dev server, check read_process_log for the actual port."
                ),
                0,
            )
        }
    }
}
