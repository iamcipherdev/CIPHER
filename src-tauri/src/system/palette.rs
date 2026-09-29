//! Compact always-on-top command palette window, toggled with the global
//! shortcut. Shares the frontend build (palette.html).

use crate::system::show_main;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "palette";

pub fn create(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    if app.get_webview_window(LABEL).is_some() {
        return Ok(());
    }
    let win = WebviewWindowBuilder::new(
        app,
        LABEL,
        WebviewUrl::App("palette.html".into()),
    )
    .title("CIPHER")
    .inner_size(640.0, 104.0)
    .decorations(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .focused(false)
    .build()?;

    // position: top-center
    if let Ok(Some(monitor)) = win.primary_monitor() {
        let size = monitor.size();
        let scale = monitor.scale_factor();
        let w = (640.0 * scale) as i32;
        let x = ((size.width as i32 - w) / 2).max(0);
        let y = (size.height as f64 * 0.16) as i32;
        let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
    }
    Ok(())
}

pub fn toggle(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(LABEL) {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
            let _ = win.emit_to(LABEL, "cipher-palette-shown", ());
        }
    }
}

/// Called from the palette webview: submit text to the main window.
pub fn submit(app: &AppHandle, text: String) -> Result<(), String> {
    show_main(app);
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.hide();
    }
    app.emit("cipher-palette-submit", serde_json::json!({ "text": text }))
        .map_err(|e| e.to_string())
}
