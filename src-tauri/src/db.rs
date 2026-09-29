use rusqlite::Connection;
use tauri::Manager;

/// Open (and migrate) the CIPHER SQLite database in the app data directory.
pub fn init(app: &tauri::AppHandle) -> Result<Connection, Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let db_path = dir.join("cipher.db");
    let conn = Connection::open(&db_path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS conversations (
            id         TEXT PRIMARY KEY,
            request    TEXT NOT NULL,
            response   TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tasks (
            id          TEXT PRIMARY KEY,
            request     TEXT NOT NULL,
            status      TEXT NOT NULL DEFAULT 'running',
            plan_json   TEXT,
            report      TEXT,
            created_at  TEXT NOT NULL,
            finished_at TEXT
        );
        CREATE TABLE IF NOT EXISTS task_steps (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id     TEXT NOT NULL,
            idx         INTEGER NOT NULL,
            description TEXT NOT NULL,
            tool        TEXT,
            status      TEXT NOT NULL DEFAULT 'pending'
        );
        CREATE TABLE IF NOT EXISTS actions (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id    TEXT,
            tool       TEXT NOT NULL,
            risk       TEXT NOT NULL,
            ok         INTEGER NOT NULL,
            summary    TEXT NOT NULL,
            detail     TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS permission_rules (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            tool       TEXT NOT NULL UNIQUE,
            risk       TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        "#,
    )?;
    Ok(conn)
}

/// Run a closure with a DB connection, mapping errors to String.
pub fn with_db<T>(
    state: &tauri::State<'_, crate::state::AppState>,
    f: impl FnOnce(&Connection) -> rusqlite::Result<T>,
) -> Result<T, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    f(&conn).map_err(|e| e.to_string())
}

pub fn now_ts() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

pub fn now_time() -> String {
    chrono::Local::now().format("%H:%M:%S").to_string()
}
