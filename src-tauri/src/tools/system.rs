//! Read-only system information tools (system / memory / disk / battery) and
//! the Windows Settings launcher. These power both AI-driven tool calls and
//! CIPHER's no-LLM "Local Command Mode". Everything here is Safe risk:
//! pure reads plus one deterministic OS hand-off.

use super::ToolResult;
use serde_json::Value;

fn fmt_gb(bytes: u64) -> String {
    format!("{:.1} GB", bytes as f64 / 1024.0 / 1024.0 / 1024.0)
}

fn fmt_uptime(secs: u64) -> String {
    let h = secs / 3600;
    let m = (secs % 3600) / 60;
    if h > 0 {
        format!("{h}h {m}m")
    } else {
        format!("{m}m")
    }
}

// ---------------------------------------------------------------------------
// get_system_info
// ---------------------------------------------------------------------------

pub async fn get_system_info(_args: &Value) -> ToolResult {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    sys.refresh_cpu_all();

    let hostname = sysinfo::System::host_name().unwrap_or_default();
    let name = sysinfo::System::name().unwrap_or_default();
    let long_os = sysinfo::System::long_os_version().unwrap_or_default();
    let os = if long_os.is_empty() {
        name.clone()
    } else if name.is_empty() {
        long_os
    } else {
        format!("{name} · {long_os}")
    };
    let kernel = sysinfo::System::kernel_version().unwrap_or_default();
    let cpu_brand = sys
        .cpus()
        .first()
        .map(|c| c.brand().trim().to_string())
        .unwrap_or_default();
    let cores = sys.cpus().len();
    let ram = fmt_gb(sys.total_memory());
    let uptime = fmt_uptime(sysinfo::System::uptime());

    ToolResult::success(
        "get_system_info",
        "safe",
        serde_json::json!({
            "hostname": hostname,
            "os": os,
            "kernel": kernel,
            "cpu": cpu_brand,
            "cores": cores,
            "ram": ram,
            "uptime": uptime,
        }),
        0,
    )
    .with_verified(true, "read from the OS directly".into())
}

// ---------------------------------------------------------------------------
// get_memory_info
// ---------------------------------------------------------------------------

pub async fn get_memory_info(_args: &Value) -> ToolResult {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();

    let total = sys.total_memory();
    let available = sys.available_memory();
    let used = sys.used_memory();
    let usage_percent = if total > 0 {
        ((used as f64 / total as f64) * 100.0).round() as u64
    } else {
        0
    };

    ToolResult::success(
        "get_memory_info",
        "safe",
        serde_json::json!({
            "total": total,
            "used": used,
            "available": available,
            "usage_percent": usage_percent,
        }),
        0,
    )
    .with_verified(true, "read from the OS directly".into())
}

// ---------------------------------------------------------------------------
// get_disk_info
// ---------------------------------------------------------------------------

pub async fn get_disk_info(_args: &Value) -> ToolResult {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let list: Vec<Value> = disks
        .list()
        .iter()
        .map(|d| {
            serde_json::json!({
                "mount": d.mount_point().to_string_lossy(),
                "total": d.total_space(),
                "available": d.available_space(),
                "fs": d.file_system().to_string_lossy(),
                "kind": if d.is_removable() { "removable" } else { "fixed" },
            })
        })
        .collect();
    let count = list.len();
    ToolResult::success(
        "get_disk_info",
        "safe",
        serde_json::json!({ "disks": list, "count": count }),
        0,
    )
    .with_verified(count > 0, format!("found {count} drive(s)"))
}

// ---------------------------------------------------------------------------
// get_battery_info
// ---------------------------------------------------------------------------

pub async fn get_battery_info(_args: &Value) -> ToolResult {
    let (present, percent, status) = read_battery().await;
    if !present {
        return ToolResult::success(
            "get_battery_info",
            "safe",
            serde_json::json!({ "present": false }),
            0,
        )
        .with_verified(true, "no battery reported by the OS".into());
    }
    ToolResult::success(
        "get_battery_info",
        "safe",
        serde_json::json!({ "present": true, "percent": percent, "status": status }),
        0,
    )
    .with_verified(true, "read from the OS power API".into())
}

/// (present, percent, status) — Windows via CIM, Linux via sysfs, else none.
async fn read_battery() -> (bool, Option<u64>, Option<String>) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let output = tokio::task::spawn_blocking(|| {
            std::process::Command::new("powershell")
                .args([
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "(Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1 EstimatedChargeRemaining, BatteryStatus | ConvertTo-Json -Compress)",
                ])
                .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
                .output()
        })
        .await;
        if let Ok(Ok(out)) = output {
            if out.status.success() {
                let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !text.is_empty() {
                    if let Ok(v) = serde_json::from_str::<Value>(&text) {
                        let percent = v
                            .get("EstimatedChargeRemaining")
                            .and_then(|x| x.as_u64());
                        let status = v.get("BatteryStatus").and_then(|x| x.as_u64());
                        return (true, percent, Some(battery_status_text(status)));
                    }
                }
                return (false, None, None);
            }
        }
        return (false, None, None);
    }

    #[cfg(not(windows))]
    {
        for base in ["BAT0", "BAT1", "BATT"] {
            let cap = format!("/sys/class/power_supply/{base}/capacity");
            if let Ok(p) = std::fs::read_to_string(&cap) {
                let percent = p.trim().parse::<u64>().ok();
                let st = std::fs::read_to_string(format!("/sys/class/power_supply/{base}/status"))
                    .map(|s| s.trim().to_lowercase())
                    .ok();
                return (true, percent, st);
            }
        }
        (false, None, None)
    }
}

#[cfg(windows)]
fn battery_status_text(code: Option<u64>) -> String {
    match code {
        Some(2) => "discharging".into(),
        Some(3) => "on AC power".into(),
        Some(4) => "fully charged".into(),
        Some(5..=10) => "charging".into(),
        Some(1) => "other".into(),
        _ => "unknown".into(),
    }
}

// ---------------------------------------------------------------------------
// open_windows_settings
// ---------------------------------------------------------------------------

pub async fn open_windows_settings(_args: &Value) -> ToolResult {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // `explorer ms-settings:` opens the Windows Settings app deterministically.
        let spawned = std::process::Command::new("explorer")
            .arg("ms-settings:")
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .spawn();
        match spawned {
            Ok(_) => ToolResult::success(
                "open_windows_settings",
                "safe",
                serde_json::json!({ "opened": true, "target": "ms-settings:" }),
                0,
            )
            .with_verified(true, "handed to the OS shell".into()),
            Err(e) => ToolResult::failure("open_windows_settings", "safe", e.to_string(), 0),
        }
    }

    #[cfg(not(windows))]
    {
        ToolResult::failure(
            "open_windows_settings",
            "safe",
            "Windows Settings is only available on Windows.".into(),
            0,
        )
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn system_info_reads_os() {
        let r = get_system_info(&Value::Null).await;
        assert!(r.ok);
        assert_eq!(r.risk, "safe");
        assert!(r.data["cores"].as_u64().unwrap_or(0) > 0);
        assert!(!r.data["ram"].as_str().unwrap_or("").is_empty());
    }

    #[tokio::test]
    async fn memory_info_has_percent() {
        let r = get_memory_info(&Value::Null).await;
        assert!(r.ok);
        assert!(r.data["total"].as_u64().unwrap_or(0) > 0);
        assert!(r.data["usage_percent"].as_u64().unwrap_or(99) <= 100);
    }

    #[tokio::test]
    async fn disk_info_lists_drives() {
        let r = get_disk_info(&Value::Null).await;
        assert!(r.ok);
        assert!(r.data["disks"].is_array());
    }

    #[tokio::test]
    async fn battery_info_never_crashes() {
        // Desktops/CI have no battery — the tool must still succeed honestly.
        let r = get_battery_info(&Value::Null).await;
        assert!(r.ok);
        assert!(r.data["present"].is_boolean());
        if r.data["present"].as_bool().unwrap() {
            assert!(r.data["percent"].is_u64());
        }
    }

    #[test]
    fn gb_formatting() {
        assert_eq!(fmt_gb(8 * 1024 * 1024 * 1024), "8.0 GB");
        assert_eq!(fmt_uptime(3600 * 3 + 120), "3h 2m");
    }
}
