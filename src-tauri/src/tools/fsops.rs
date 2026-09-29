//! Filesystem tools: list / search / open / create / copy / move / rename /
//! info / delete (Recycle Bin). Deletion is classified HIGH RISK by the
//! permission engine and additionally refuses obvious system paths.

use super::ToolResult;
use serde_json::Value;
use std::path::{Path, PathBuf};

pub fn expand_path(raw: &str) -> PathBuf {
    let mut p = raw.trim().to_string();
    if p == "~" {
        if let Some(h) = dirs::home_dir() {
            return h;
        }
    }
    if let Some(rest) = p.strip_prefix("~/").or_else(|| p.strip_prefix("~\\")) {
        if let Some(h) = dirs::home_dir() {
            p = h.join(rest).to_string_lossy().to_string();
        }
    }
    // common Windows env vars
    for var in ["USERPROFILE", "ProgramData", "LOCALAPPDATA", "APPDATA"] {
        if let Some(value) = std::env::var_os(var) {
            p = p.replace(&format!("%{var}%"), &value.to_string_lossy());
        }
    }
    PathBuf::from(p)
}

fn entry_json(p: &Path) -> serde_json::Value {
    let meta = std::fs::metadata(p);
    let (is_dir, size, modified) = match &meta {
        Ok(m) => (
            m.is_dir(),
            if m.is_file() { m.len() } else { 0 },
            m.modified()
                .ok()
                .map(|t| chrono::DateTime::<chrono::Local>::from(t).format("%Y-%m-%d %H:%M").to_string()),
        ),
        Err(_) => (false, 0, None),
    };
    serde_json::json!({
        "name": p.file_name().and_then(|f| f.to_str()).unwrap_or(""),
        "path": p.to_string_lossy(),
        "is_dir": is_dir,
        "size": size,
        "modified": modified,
    })
}

/// Refuse obviously dangerous delete targets.
fn is_protected_path(p: &Path) -> bool {
    let s = p.to_string_lossy().to_lowercase();
    let protected = ["c:\\windows", "c:\\program files", "c:\\program files (x86)", "c:\\users", "c:\\programdata"];
    if p.parent().is_none() && p.has_root() {
        return true; // drive root like C:\
    }
    if protected.iter().any(|pr| s == *pr || s == format!("{pr}\\")) {
        return true;
    }
    false
}

pub async fn list_directory(args: &Value) -> ToolResult {
    let raw = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
    if raw.is_empty() {
        return ToolResult::failure("list_directory", "safe", "No path given.".into(), 0);
    }
    let path = expand_path(raw);
    match std::fs::read_dir(&path) {
        Ok(entries) => {
            let mut items: Vec<serde_json::Value> = entries
                .flatten()
                .map(|e| entry_json(&e.path()))
                .collect();
            let total = items.len();
            items.truncate(500);
            items.sort_by(|a, b| {
                let d = b["is_dir"].as_bool().unwrap_or(false)
                    .cmp(&a["is_dir"].as_bool().unwrap_or(false));
                d.then(a["name"].to_string().cmp(&b["name"].to_string()))
            });
            ToolResult::success(
                "list_directory",
                "safe",
                serde_json::json!({ "path": path.to_string_lossy(), "count": total, "entries": items }),
                0,
            )
        }
        Err(e) => ToolResult::failure(
            "list_directory",
            "safe",
            format!("Couldn't list {}: {e}. Check that the folder exists and is readable.", path.to_string_lossy()),
            0,
        ),
    }
}

pub async fn search_files(args: &Value) -> ToolResult {
    let directory = args.get("directory").and_then(|v| v.as_str()).unwrap_or("");
    let pattern = args.get("pattern").and_then(|v| v.as_str()).unwrap_or("");
    if pattern.is_empty() {
        return ToolResult::failure("search_files", "safe", "No search pattern given.".into(), 0);
    }
    let base = expand_path(directory);
    if !base.exists() {
        return ToolResult::failure(
            "search_files",
            "safe",
            format!("Directory {} doesn't exist.", base.to_string_lossy()),
            0,
        );
    }
    // wildcard -> contains matching on each segment
    let lower_pat = pattern.to_lowercase();
    let needle = lower_pat.trim_matches('*');
    let mut matches: Vec<serde_json::Value> = Vec::new();
    walkdir::WalkDir::new(&base)
        .max_depth(8)
        .into_iter()
        .filter_entry(|e| !is_hidden(e.file_name().to_string_lossy().as_ref()))
        .filter_map(|e| e.ok())
        .for_each(|e| {
            if matches.len() >= 200 {
                return;
            }
            let name = e.file_name().to_string_lossy().to_lowercase();
            if name.contains(needle) || (needle.is_empty() && !name.is_empty()) {
                matches.push(entry_json(e.path()));
            }
        });
    let count = matches.len();
    ToolResult::success(
        "search_files",
        "safe",
        serde_json::json!({ "pattern": pattern, "count": count, "matches": matches }),
        0,
    )
}

fn is_hidden(name: &str) -> bool {
    // skip windows system noise but keep normal folders
    name.starts_with('$')
}

pub async fn open_file(args: &Value) -> ToolResult {
    let path = expand_path(args.get("path").and_then(|v| v.as_str()).unwrap_or(""));
    if !path.exists() {
        return ToolResult::failure(
            "open_file",
            "safe",
            format!("File {} doesn't exist.", path.to_string_lossy()),
            0,
        );
    }
    match open::that(&path) {
        Ok(()) => ToolResult::success(
            "open_file",
            "safe",
            serde_json::json!({ "path": path.to_string_lossy(), "opened": true }),
            0,
        )
        .with_verified(true, "handed to the OS default handler".into()),
        Err(e) => ToolResult::failure(
            "open_file",
            "safe",
            format!("Couldn't open {}: {e}", path.to_string_lossy()),
            0,
        ),
    }
}

pub async fn create_folder(args: &Value) -> ToolResult {
    let path = expand_path(args.get("path").and_then(|v| v.as_str()).unwrap_or(""));
    if path.as_os_str().is_empty() {
        return ToolResult::failure("create_folder", "medium", "No path given.".into(), 0);
    }
    match std::fs::create_dir_all(&path) {
        Ok(()) => {
            let verified = path.is_dir();
            ToolResult::success(
                "create_folder",
                "medium",
                serde_json::json!({ "path": path.to_string_lossy(), "created": true }),
                0,
            )
            .with_verified(verified, format!("folder exists at {}", path.to_string_lossy()))
        }
        Err(e) => ToolResult::failure(
            "create_folder",
            "medium",
            format!("Couldn't create {}: {e}", path.to_string_lossy()),
            0,
        ),
    }
}

pub async fn copy_file(args: &Value) -> ToolResult {
    let from = expand_path(args.get("from").and_then(|v| v.as_str()).unwrap_or(""));
    let to = expand_path(args.get("to").and_then(|v| v.as_str()).unwrap_or(""));
    if !from.exists() {
        return ToolResult::failure(
            "copy_file",
            "medium",
            format!("Source {} doesn't exist.", from.to_string_lossy()),
            0,
        );
    }
    // if `to` is an existing directory, copy into it
    let target = if to.is_dir() {
        to.join(from.file_name().unwrap_or_default())
    } else {
        if let Some(parent) = to.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        to
    };
    let result = if from.is_dir() {
        copy_dir_recursive(&from, &target)
    } else {
        std::fs::copy(&from, &target).map(|_| ())
    };
    match result {
        Ok(()) => {
            let verified = target.exists();
            ToolResult::success(
                "copy_file",
                "medium",
                serde_json::json!({ "from": from.to_string_lossy(), "to": target.to_string_lossy() }),
                0,
            )
            .with_verified(verified, format!("destination exists: {}", target.to_string_lossy()))
        }
        Err(e) => ToolResult::failure(
            "copy_file",
            "medium",
            format!("Couldn't copy {} → {}: {e}", from.to_string_lossy(), target.to_string_lossy()),
            0,
        ),
    }
}

fn copy_dir_recursive(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let target = to.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

pub async fn move_file(args: &Value) -> ToolResult {
    let from = expand_path(args.get("from").and_then(|v| v.as_str()).unwrap_or(""));
    let to = expand_path(args.get("to").and_then(|v| v.as_str()).unwrap_or(""));
    if !from.exists() {
        return ToolResult::failure(
            "move_file",
            "medium",
            format!("Source {} doesn't exist.", from.to_string_lossy()),
            0,
        );
    }
    let target = if to.is_dir() {
        to.join(from.file_name().unwrap_or_default())
    } else {
        if let Some(parent) = to.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        to
    };
    // rename first (same volume), fall back to copy+delete (cross volume)
    let moved = std::fs::rename(&from, &target).or_else(|_| -> std::io::Result<()> {
        if from.is_dir() {
            copy_dir_recursive(&from, &target)?;
            std::fs::remove_dir_all(&from)?;
        } else {
            std::fs::copy(&from, &target)?;
            std::fs::remove_file(&from)?;
        }
        Ok(())
    });
    match moved {
        Ok(()) => {
            let verified = target.exists() && !from.exists();
            ToolResult::success(
                "move_file",
                "medium",
                serde_json::json!({ "from": from.to_string_lossy(), "to": target.to_string_lossy() }),
                0,
            )
            .with_verified(
                verified,
                format!(
                    "destination exists: {}{}",
                    target.to_string_lossy(),
                    if from.exists() { " (source still present!)" } else { ", source removed" }
                ),
            )
        }
        Err(e) => ToolResult::failure(
            "move_file",
            "medium",
            format!("Couldn't move {} → {}: {e}", from.to_string_lossy(), target.to_string_lossy()),
            0,
        ),
    }
}

pub async fn rename_file(args: &Value) -> ToolResult {
    let path = expand_path(args.get("path").and_then(|v| v.as_str()).unwrap_or(""));
    let new_name = args.get("new_name").and_then(|v| v.as_str()).unwrap_or("");
    if new_name.is_empty() || !path.exists() {
        return ToolResult::failure(
            "rename_file",
            "medium",
            format!("Either the path doesn't exist or the new name is empty ({path:?})."),
            0,
        );
    }
    let target = path
        .parent()
        .unwrap_or(Path::new("."))
        .join(new_name);
    match std::fs::rename(&path, &target) {
        Ok(()) => {
            let verified = target.exists();
            ToolResult::success(
                "rename_file",
                "medium",
                serde_json::json!({ "from": path.to_string_lossy(), "to": target.to_string_lossy() }),
                0,
            )
            .with_verified(verified, format!("renamed to {}", target.to_string_lossy()))
        }
        Err(e) => ToolResult::failure(
            "rename_file",
            "medium",
            format!("Couldn't rename: {e}"),
            0,
        ),
    }
}

pub async fn get_file_info(args: &Value) -> ToolResult {
    let path = expand_path(args.get("path").and_then(|v| v.as_str()).unwrap_or(""));
    match std::fs::metadata(&path) {
        Ok(m) => {
            let kind = if m.is_dir() {
                "folder"
            } else if m.is_file() {
                "file"
            } else {
                "other"
            };
            ToolResult::success(
                "get_file_info",
                "safe",
                serde_json::json!({
                    "path": path.to_string_lossy(),
                    "kind": kind,
                    "size": if m.is_file() { serde_json::json!(m.len()) } else { serde_json::json!(null) },
                    "modified": m.modified().ok().map(|t| chrono::DateTime::<chrono::Local>::from(t).to_rfc3339()),
                    "readonly": m.permissions().readonly(),
                }),
                0,
            )
        }
        Err(e) => ToolResult::failure(
            "get_file_info",
            "safe",
            format!("Couldn't read {}: {e}", path.to_string_lossy()),
            0,
        ),
    }
}

pub async fn delete_file(args: &Value) -> ToolResult {
    let path = expand_path(args.get("path").and_then(|v| v.as_str()).unwrap_or(""));
    if is_protected_path(&path) {
        return ToolResult::failure(
            "delete_file",
            "high",
            format!("Refused: {} is a protected system path.", path.to_string_lossy()),
            0,
        );
    }
    if !path.is_file() {
        return ToolResult::failure(
            "delete_file",
            "high",
            format!("{} is not a file (use delete_folder for folders).", path.to_string_lossy()),
            0,
        );
    }
    match trash::delete(&path) {
        Ok(()) => ToolResult::success(
            "delete_file",
            "high",
            serde_json::json!({ "path": path.to_string_lossy(), "deleted": true, "method": "recycle_bin" }),
            0,
        )
        .with_verified(!path.exists(), "moved to the Recycle Bin".into()),
        Err(e) => ToolResult::failure(
            "delete_file",
            "high",
            format!("Couldn't delete {}: {e}", path.to_string_lossy()),
            0,
        ),
    }
}

pub async fn delete_folder(args: &Value) -> ToolResult {
    let path = expand_path(args.get("path").and_then(|v| v.as_str()).unwrap_or(""));
    if is_protected_path(&path) {
        return ToolResult::failure(
            "delete_folder",
            "high",
            format!("Refused: {} is a protected system path.", path.to_string_lossy()),
            0,
        );
    }
    if !path.is_dir() {
        return ToolResult::failure(
            "delete_folder",
            "high",
            format!("{} is not a folder.", path.to_string_lossy()),
            0,
        );
    }
    match trash::delete(&path) {
        Ok(()) => ToolResult::success(
            "delete_folder",
            "high",
            serde_json::json!({ "path": path.to_string_lossy(), "deleted": true, "method": "recycle_bin" }),
            0,
        )
        .with_verified(!path.exists(), "moved to the Recycle Bin".into()),
        Err(e) => ToolResult::failure(
            "delete_folder",
            "high",
            format!("Couldn't delete {}: {e}", path.to_string_lossy()),
            0,
        ),
    }
}
