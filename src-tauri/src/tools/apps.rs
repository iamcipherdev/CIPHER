//! Windows application control: open / close / focus / enumerate.
//! App discovery searches PATH, Start Menu shortcuts and common install
//! directories instead of hardcoding paths.

use super::ToolResult;
use crate::system::platform;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};
use sysinfo::ProcessesToUpdate;

const NOISE_PROCESSES: &[&str] = &[
    "svchost.exe", "csrss.exe", "dwm.exe", "winlogon.exe", "services.exe", "lsass.exe",
    "smss.exe", "system", "system idle process", "registry", "audiodg.exe", "dllhost.exe",
    "conhost.exe", "runtimebroker.exe", "fontdrvhost.exe", "sihost.exe", "taskhostw.exe",
    "searchapp.exe", "searchhost.exe", "textinputhost.exe", "startmenuexperiencehost.exe",
    "shellexperiencehost.exe", "applicationframehost.exe", "lockapp.exe", "widgetservice.exe",
    "wudfhost.exe", "spoolsv.exe", "memory compression", "securityhealthservice.exe",
    "securityhealthsystray.exe", "msedgewebview2.exe", "phoneexperiencehost.exe",
    "systemd", "dbus-daemon", "xorg", "gnome-shell", "pipewire", "pipewire-pulse",
    "wireplumber", "pulseaudio", "rtkit-daemon", "polkitd", "udisksd", "upowerd",
    "networkmanager", "ciphersandbox",
];

pub fn normalize(name: &str) -> String {
    name.to_lowercase()
        .replace(".exe", "")
        .replace(".lnk", "")
        .replace([' ', '-', '_'], "")
        .trim()
        .to_string()
}

fn proc_name_matches(query_norm: &str, process: &str) -> bool {
    let p = normalize(process);
    !p.is_empty() && (p == query_norm || p.starts_with(query_norm) || p.contains(query_norm))
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

fn walk_dir(dir: &Path, depth: usize, pred: &mut impl FnMut(&Path)) {
    if depth == 0 {
        return;
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk_dir(&path, depth - 1, pred);
            } else {
                pred(&path);
            }
        }
    }
}

fn push_candidate(out: &mut Vec<PathBuf>, p: PathBuf) {
    if !out.contains(&p) && out.len() < 10 {
        out.push(p);
    }
}

/// Find launchable candidates for an app name on this machine.
pub fn find_candidates(name: &str) -> Vec<PathBuf> {
    let q = normalize(name);
    if q.is_empty() {
        return vec![];
    }
    let mut out: Vec<PathBuf> = Vec::new();

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // 1. PATH lookup (where.exe)
        if let Ok(output) = Command::new("where")
            .arg(format!("{name}.exe"))
            .creation_flags(0x0800_0000)
            .output()
        {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                if let Some(first) = text.lines().next() {
                    let p = PathBuf::from(first.trim());
                    if p.exists() {
                        push_candidate(&mut out, p);
                    }
                }
            }
        }

        // 2. Start Menu shortcuts (user + all users)
        let mut start_dirs: Vec<PathBuf> = Vec::new();
        if let Some(appdata) = dirs::data_dir() {
            start_dirs.push(appdata.join(r"Microsoft\Windows\Start Menu\Programs"));
        }
        if let Some(pd) = std::env::var_os("ProgramData") {
            start_dirs.push(PathBuf::from(pd).join(r"Microsoft\Windows\Start Menu\Programs"));
        }
        for dir in start_dirs {
            walk_dir(&dir, 5, &mut |p: &Path| {
                if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                    if ext.eq_ignore_ascii_case("lnk") {
                        if let Some(fname) = p.file_stem().and_then(|f| f.to_str()) {
                            if normalize(fname).contains(&q) {
                                push_candidate(&mut out, p.to_path_buf());
                            }
                        }
                    }
                }
            });
        }

        // 3. Common install locations
        let mut exe_dirs: Vec<PathBuf> = Vec::new();
        if let Some(local) = dirs::data_local_dir() {
            exe_dirs.push(local.join("Programs"));
        }
        if let Some(pf) = std::env::var_os("ProgramFiles") {
            exe_dirs.push(PathBuf::from(pf));
        }
        if let Some(pf86) = std::env::var_os("ProgramFiles(x86)") {
            exe_dirs.push(PathBuf::from(pf86));
        }
        for dir in exe_dirs {
            walk_dir(&dir, 3, &mut |p: &Path| {
                if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                    if ext.eq_ignore_ascii_case("exe") {
                        if let Some(fname) = p.file_stem().and_then(|f| f.to_str()) {
                            if normalize(fname) == q || normalize(fname).contains(&q) {
                                push_candidate(&mut out, p.to_path_buf());
                            }
                        }
                    }
                }
            });
        }
    }

    #[cfg(not(windows))]
    {
        if let Ok(output) = Command::new("which").arg(name).output() {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                if let Some(first) = text.lines().next() {
                    push_candidate(&mut out, PathBuf::from(first.trim()));
                }
            }
        }
        // desktop applications
        for dir in [PathBuf::from("/usr/share/applications")] {
            walk_dir(&dir, 1, &mut |p: &Path| {
                if let Some(fname) = p.file_stem().and_then(|f| f.to_str()) {
                    if normalize(fname).contains(&q) {
                        push_candidate(&mut out, p.to_path_buf());
                    }
                }
            });
        }
    }

    out
}

fn score_candidate(name: &str, path: &Path) -> i32 {
    let q = normalize(name);
    let stem = normalize(
        path.file_stem()
            .and_then(|f| f.to_str())
            .unwrap_or_default(),
    );
    if stem == q {
        return 100;
    }
    if stem.starts_with(&q) {
        return 80;
    }
    if stem.contains(&q) {
        return 60;
    }
    10
}

fn launch(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if ext == "lnk" || ext == "url" {
            Command::new("cmd")
                .args(["/C", "start", "", &path.to_string_lossy()])
                .creation_flags(0x0800_0000)
                .spawn()
                .map_err(|e| format!("failed to launch shortcut: {e}"))?;
            Ok(())
        } else {
            Command::new(path)
                .creation_flags(0x0000_0200) // CREATE_NEW_PROCESS_GROUP
                .spawn()
                .map_err(|e| format!("failed to launch executable: {e}"))?;
            Ok(())
        }
    }
    #[cfg(not(windows))]
    {
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            if ext == "desktop" {
                Command::new("gtk-launch")
                    .arg(
                        path.file_stem()
                            .and_then(|f| f.to_str())
                            .unwrap_or_default(),
                    )
                    .spawn()
                    .map_err(|e| e.to_string())?;
                return Ok(());
            }
        }
        Command::new("sh")
            .arg("-c")
            .arg(format!("nohup '{}' >/dev/null 2>&1 &", path.to_string_lossy()))
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// Poll for evidence that the app is now running.
async fn verify_running(name: &str, timeout: Duration) -> (Option<bool>, Option<String>) {
    let q = normalize(name);
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        // window evidence first (stronger)
        for w in platform::visible_windows() {
            if proc_name_matches(&q, &w.process)
                || (!w.title.is_empty() && normalize(&w.title).contains(&q))
            {
                return (
                    Some(true),
                    Some(format!("window \"{}\" is visible ({})", w.title, w.process)),
                );
            }
        }
        let mut sys = sysinfo::System::new();
        sys.refresh_processes(ProcessesToUpdate::All, true);
        for (_pid, process) in sys.processes() {
            let pname = process.name().to_string_lossy().to_string();
            if proc_name_matches(&q, &pname) {
                return (Some(true), Some(format!("process '{pname}' is running")));
            }
        }
        tokio::time::sleep(Duration::from_millis(600)).await;
    }
    (Some(false), None)
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

pub async fn open_app(args: &Value) -> ToolResult {
    let name = args
        .get("app")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if name.trim().is_empty() {
        return ToolResult::failure("open_app", "safe", "No application name given.".into(), 0);
    }
    let candidates = find_candidates(&name);
    if candidates.is_empty() {
        return ToolResult::failure(
            "open_app",
            "safe",
            format!(
                "Couldn't find an installed application matching \"{name}\". \
                 Try the exact name as it appears in the Start Menu, or the full path to its .exe."
            ),
            0,
        );
    }
    let mut ranked: Vec<(i32, &PathBuf)> = candidates
        .iter()
        .map(|p| (score_candidate(&name, p), p))
        .collect();
    ranked.sort_by(|a, b| b.0.cmp(&a.0));
    let best = ranked[0].1.clone();
    if let Err(e) = launch(&best) {
        return ToolResult::failure("open_app", "safe", e, 0);
    }
    let (verified, evidence) = verify_running(&name, Duration::from_secs(7)).await;
    let mut r = ToolResult::success(
        "open_app",
        "safe",
        serde_json::json!({
            "app": name,
            "launched_from": best.to_string_lossy(),
            "candidates": candidates.iter().map(|p| p.to_string_lossy()).collect::<Vec<_>>(),
        }),
        0,
    );
    r.verified = verified;
    r.evidence = evidence.clone().or(Some(format!(
        "Launched {} but couldn't confirm its process/window yet.",
        best.to_string_lossy()
    )));
    if verified == Some(false) {
        r.evidence = Some(format!(
            "Launched \"{}\" — no matching process or window detected within 7s. It may still be starting up.",
            best.to_string_lossy()
        ));
    }
    r
}

pub async fn list_running_apps(_args: &Value) -> ToolResult {
    let windows = platform::visible_windows();
    let mut sys = sysinfo::System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let mut titles_by_pid: std::collections::HashMap<u32, Vec<String>> =
        std::collections::HashMap::new();
    for w in &windows {
        if !w.title.is_empty() {
            titles_by_pid.entry(w.pid).or_default().push(w.title.clone());
        }
    }
    let procs_by_pid: std::collections::HashMap<u32, String> = windows
        .iter()
        .filter(|w| !w.process.is_empty())
        .map(|w| (w.pid, w.process.clone()))
        .collect();

    let mut apps: std::collections::BTreeMap<String, serde_json::Value> =
        std::collections::BTreeMap::new();
    for (pid, process) in sys.processes() {
        let name = process.name().to_string_lossy().to_lowercase().to_string();
        if name.is_empty() || NOISE_PROCESSES.contains(&name.as_str()) {
            continue;
        }
        let key = name.clone();
        let entry = apps.entry(key).or_insert_with(|| {
            serde_json::json!({
                "name": name,
                "pid": pid.as_u32(),
                "window_title": Value::Null,
                "windows": 0
            })
        });
        if let Some(t) = titles_by_pid.get(&pid.as_u32()).and_then(|v| v.first()) {
            if entry.get("window_title").map(|v| v.is_null()).unwrap_or(true) {
                entry["window_title"] = serde_json::json!(t);
            }
        }
        if let Some(pname) = procs_by_pid.get(&pid.as_u32()) {
            if entry.get("window_title").map(|v| v.is_null()).unwrap_or(true) {
                entry["window_title"] = serde_json::json!(pname);
            }
        }
        entry["windows"] = serde_json::json!(entry["windows"].as_i64().unwrap_or(0) + 1);
    }

    let list: Vec<serde_json::Value> = apps.into_values().collect();
    let count = list.len();
    ToolResult::success(
        "list_running_apps",
        "safe",
        serde_json::json!({ "count": count, "apps": list }),
        0,
    )
}

pub async fn focus_app(args: &Value) -> ToolResult {
    let name = args.get("app").and_then(|v| v.as_str()).unwrap_or("");
    let q = normalize(name);
    if q.is_empty() {
        return ToolResult::failure("focus_app", "safe", "No application name given.".into(), 0);
    }
    let mut fallback_pid: Option<u32> = None;
    for w in platform::visible_windows() {
        let matched = proc_name_matches(&q, &w.process)
            || (!w.title.is_empty() && normalize(&w.title).contains(&q));
        if matched {
            if !w.title.is_empty() && platform::focus_window(w.hwnd) {
                return ToolResult::success(
                    "focus_app",
                    "safe",
                    serde_json::json!({ "app": name, "focused_window": w.title }),
                    0,
                )
                .with_verified(true, format!("window \"{}\" brought to front", w.title));
            }
            fallback_pid = Some(w.pid);
        }
    }
    let _ = fallback_pid;
    // Still attempt via window title search on Windows using taskkill-free
    // powershell fallback is overkill; report honestly.
    ToolResult::failure(
        "focus_app",
        "safe",
        format!("Couldn't find a visible window for \"{name}\". Is it running?"),
        0,
    )
}

impl ToolResult {
    pub fn with_verified(mut self, verified: bool, evidence: String) -> Self {
        self.verified = Some(verified);
        self.evidence = Some(evidence);
        self
    }
}

pub async fn close_app(args: &Value) -> ToolResult {
    let name = args.get("app").and_then(|v| v.as_str()).unwrap_or("");
    let force = args.get("force").and_then(|v| v.as_bool()).unwrap_or(false);
    let q = normalize(name);
    if q.is_empty() {
        return ToolResult::failure("close_app", "medium", "No application name given.".into(), 0);
    }

    let mut targets: Vec<platform::WindowInfo> = Vec::new();
    for w in platform::visible_windows() {
        if proc_name_matches(&q, &w.process)
            || (!w.title.is_empty() && normalize(&w.title).contains(&q))
        {
            targets.push(w);
        }
    }
    if targets.is_empty() {
        return ToolResult::failure(
            "close_app",
            "medium",
            format!("No visible window found for \"{name}\" — nothing to close."),
            0,
        );
    }

    let mut closed_any = false;
    for w in &targets {
        if platform::post_close(w.hwnd) {
            closed_any = true;
        }
    }
    if !closed_any {
        return ToolResult::failure(
            "close_app",
            "medium",
            "Couldn't send a close request to the app's windows.".into(),
            0,
        );
    }

    // poll for exit
    let deadline = Instant::now() + Duration::from_secs(6);
    let mut gone = false;
    while Instant::now() < deadline {
        if !process_still_running(&q) {
            gone = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    if gone {
        return ToolResult::success(
            "close_app",
            "medium",
            serde_json::json!({ "app": name, "closed": true, "forced": false }),
            0,
        )
        .with_verified(true, "process exited after WM_CLOSE".into());
    }

    if force {
        force_kill(&q);
        let gone = !process_still_running(&q);
        return ToolResult::success(
            "close_app",
            "medium",
            serde_json::json!({ "app": name, "closed": gone, "forced": true }),
            0,
        )
        .with_verified(
            gone,
            if gone {
                "process force-killed".into()
            } else {
                "force kill attempted".into()
            },
        );
    }

    ToolResult::failure(
        "close_app",
        "medium",
        format!(
            "\"{name}\" didn't close within 6s — it may be waiting on unsaved work. Retry with force: true to force-kill it."
        ),
        0,
    )
}

fn process_still_running(q: &str) -> bool {
    let mut sys = sysinfo::System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    sys.processes().values().any(|p| proc_name_matches(q, &p.name().to_string_lossy()))
}

fn force_kill(q: &str) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/F", "/IM", &format!("{q}.exe")])
            .creation_flags(0x0800_0000)
            .output();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("pkill").arg("-f").arg(q).output();
    }
}

pub async fn find_installed_app(args: &Value) -> ToolResult {
    let name = args.get("app").and_then(|v| v.as_str()).unwrap_or("");
    let candidates = find_candidates(name);
    if candidates.is_empty() {
        return ToolResult::failure(
            "find_installed_app",
            "safe",
            format!("No installed application found matching \"{name}\"."),
            0,
        );
    }
    ToolResult::success(
        "find_installed_app",
        "safe",
        serde_json::json!({
            "matches": candidates.iter().map(|p| p.to_string_lossy()).collect::<Vec<_>>()
        }),
        0,
    )
}
