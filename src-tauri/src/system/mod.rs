pub mod palette;
pub mod platform;
pub mod shortcuts;
pub mod tray;

use tauri::{AppHandle, Manager};

/// Show + focus the main window (used by tray, palette submit, single
/// instance).
pub fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}
