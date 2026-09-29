mod commands;
mod db;
mod permissions;
mod secure;
mod settings;
mod state;
mod system;
mod tools;

use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;

pub fn run() {
    #[cfg(windows)]
    crate::system::platform::set_dpi_aware();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            system::show_main(app);
        }))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    system::shortcuts::handle(app, event.state());
                })
                .build(),
        )
        .setup(|app| {
            let handle = app.handle().clone();
            let conn = db::init(&handle)?;
            let state = state::AppState::new(conn);
            app.manage(state);
            let state_ref: tauri::State<state::AppState> = app.state();
            settings::ensure_defaults(&state_ref);
            system::palette::create(&handle)?;
            system::tray::create(&handle)?;
            if let Err(e) = system::shortcuts::register_default(&handle) {
                eprintln!("global shortcut: {e}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                match window.label() {
                    "main" => {
                        let state: tauri::State<state::AppState> = window.app_handle().state();
                        let minimize = settings::get_flag(&state, "general", "minimize_to_tray", true);
                        if minimize {
                            api.prevent_close();
                            let _ = window.hide();
                        }
                    }
                    "palette" => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::set_setting,
            commands::get_secret,
            commands::set_secret,
            commands::delete_secret,
            commands::request_tool_execution,
            commands::resolve_permission,
            commands::cancel_task,
            commands::permission_rules,
            commands::clear_permission_rules,
            commands::create_task,
            commands::set_task_plan,
            commands::complete_task,
            commands::list_tasks,
            commands::list_actions,
            commands::clear_history,
            commands::save_conversation,
            commands::list_conversations,
            commands::clear_conversations,
            commands::speak,
            commands::ollama_detect,
            commands::get_sidecar_status,
            commands::start_browser_sidecar,
            commands::system_info,
            commands::set_launch_on_startup,
            commands::set_global_shortcut_cmd,
            commands::submit_palette,
            commands::set_paused,
        ])
        .run(tauri::generate_context!())
        .expect("CIPHER failed to start");
}
