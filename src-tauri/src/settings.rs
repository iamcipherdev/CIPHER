use rusqlite::OptionalExtension;
use serde_json::Value;

/// Defaults for every settings section. Written once at first launch.
pub fn defaults() -> Vec<(&'static str, Value)> {
    vec![
        (
            "general",
            serde_json::json!({
                "launch_on_startup": false,
                "minimize_to_tray": true,
                "global_shortcut": "ctrl+space",
                "theme": "dark"
            }),
        ),
        (
            "ai",
            serde_json::json!({
                "provider": "openrouter",
                "model": "",
                "custom_endpoint": "",
                "ollama_endpoint": "http://localhost:11434",
                "stt_provider": "openai",
                "stt_model": "whisper-1",
                "stt_custom_endpoint": "",
                "tts_mode": "important"
            }),
        ),
        (
            "voice",
            serde_json::json!({
                "microphone": "default",
                "wake_word": false,
                "wake_word_local_only": true
            }),
        ),
        (
            "desktop",
            serde_json::json!({
                "file_access": true,
                "app_control": true,
                "terminal_access": true,
                "screenshot_access": true,
                "clipboard_access": true
            }),
        ),
        (
            "security",
            serde_json::json!({
                "auto_run_safe": true,
                "confirm_medium": true,
                "show_terminal_commands": true,
                "always_confirm_destructive": true
            }),
        ),
        (
            "privacy",
            serde_json::json!({
                "disable_screenshot_analysis": false,
                "disable_clipboard": false,
                "disable_voice": false
            }),
        ),
        ("onboarded", serde_json::json!(false)),
    ]
}

/// Insert any missing default sections.
pub fn ensure_defaults(state: &tauri::State<'_, crate::state::AppState>) {
    for (key, value) in defaults() {
        let exists = crate::db::with_db(state, |c| {
            c.query_row(
                "SELECT 1 FROM settings WHERE key = ?1",
                [&key],
                |_| Ok(()),
            )
            .optional()
            .map(|o| o.is_some())
        });
        if matches!(exists, Ok(false)) {
            let _ = crate::db::with_db(state, |c| {
                c.execute(
                    "INSERT INTO settings (key, value) VALUES (?1, ?2)",
                    rusqlite::params![key, value.to_string()],
                )
            });
        }
    }
}

pub fn get_section(
    state: &tauri::State<'_, crate::state::AppState>,
    key: &str,
) -> Value {
    crate::db::with_db(state, |c| {
        c.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            [key],
            |row| row.get::<_, String>(0),
        )
    })
    .ok()
    .and_then(|s| serde_json::from_str(&s).ok())
    .unwrap_or(serde_json::json!({}))
}

pub fn set_section(state: &tauri::State<'_, crate::state::AppState>, key: &str, value: Value) {
    let _ = crate::db::with_db(state, |c| {
        c.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![key, value.to_string()],
        )
    });
}

/// Read a boolean flag inside a section.
pub fn flag(section: &Value, name: &str, default: bool) -> bool {
    section.get(name).and_then(|v| v.as_bool()).unwrap_or(default)
}

pub fn get_flag(
    state: &tauri::State<'_, crate::state::AppState>,
    section: &str,
    name: &str,
    default: bool,
) -> bool {
    flag(&get_section(state, section), name, default)
}
