//! Global shortcut registration (default Ctrl+Space) that toggles the
//! command palette.

use crate::system::palette;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub fn register_default(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let state: tauri::State<'_, crate::state::AppState> = app.state();
    let general = crate::settings::get_section(&state, "general");
    let shortcut = general
        .get("global_shortcut")
        .and_then(|v| v.as_str())
        .unwrap_or("ctrl+space")
        .to_string();
    register(app, &shortcut)?;
    Ok(())
}

pub fn register(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    gs.register(shortcut)
        .map_err(|e| format!("Couldn't register global shortcut \"{shortcut}\": {e}"))
}

/// Handler installed on the plugin builder — fires for every registered
/// shortcut.
pub fn handle(app: &AppHandle, state: ShortcutState) {
    if state == ShortcutState::Pressed {
        palette::toggle(app);
    }
}
