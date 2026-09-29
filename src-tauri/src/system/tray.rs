//! System tray icon + menu (Open CIPHER / Ask CIPHER / Start Listening /
//! Pause Agent / Settings / Quit).

use crate::system::show_main;
use std::sync::atomic::Ordering;
use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};

pub fn create(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let open = MenuItem::with_id(app, "open", "Open CIPHER", true, None::<&str>)?;
    let ask = MenuItem::with_id(app, "ask", "Ask CIPHER", true, None::<&str>)?;
    let listen = MenuItem::with_id(app, "listen", "Start Listening", true, None::<&str>)?;
    let paused = app
        .state::<crate::state::AppState>()
        .paused
        .load(Ordering::SeqCst);
    let pause = CheckMenuItem::with_id(app, "pause", "Pause Agent", true, paused, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&open, &ask, &listen, &pause, &settings, &quit])?;
    let pause_item = pause.clone();

    TrayIconBuilder::with_id("cipher-tray")
        .icon(app.default_window_icon().expect("app icon").clone())
        .tooltip("CIPHER")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "ask" => {
                show_main(app);
                crate::system::palette::toggle(app);
            }
            "listen" => {
                show_main(app);
                let _ = app.emit("cipher-tray-listen", ());
            }
            "pause" => {
                let now = !app
                    .state::<crate::state::AppState>()
                    .paused
                    .load(Ordering::SeqCst);
                app.state::<crate::state::AppState>()
                    .paused
                    .store(now, Ordering::SeqCst);
                let _ = pause_item.set_checked(now);
                let _ = app.emit("cipher-paused", serde_json::json!({ "paused": now }));
            }
            "settings" => {
                show_main(app);
                let _ = app.emit("cipher-open-settings", ());
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}
