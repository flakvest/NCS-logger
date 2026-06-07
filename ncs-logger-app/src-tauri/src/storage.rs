use std::{
    fs, io,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{Map, Value};
use tauri::{AppHandle, Manager, Wry};

const DATA_FILE_NAME: &str = "ncs-logs.json";
const BACKUP_DIR_NAME: &str = "backups";
const BACKUP_KEEP_COUNT: usize = 5;
const DEFAULT_LOGGER_JSON: &str = r#"{
  "version": 1,
  "activeLogId": null,
  "logs": []
}"#;

fn storage_root(app: &AppHandle<Wry>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|err| format!("Unable to resolve the app data folder: {err}"))
}

fn data_file_path(app: &AppHandle<Wry>) -> Result<PathBuf, String> {
    Ok(storage_root(app)?.join(DATA_FILE_NAME))
}

fn ensure_storage_dirs(app: &AppHandle<Wry>) -> Result<(PathBuf, PathBuf), String> {
    let root = storage_root(app)?;
    let backups = root.join(BACKUP_DIR_NAME);

    fs::create_dir_all(&root)
        .map_err(|err| format!("Unable to create the app data folder: {err}"))?;
    fs::create_dir_all(&backups)
        .map_err(|err| format!("Unable to create the backup folder: {err}"))?;

    Ok((root, backups))
}

fn looks_like_json_object(raw: &str) -> bool {
    let trimmed = raw.trim();
    trimmed.starts_with('{') && trimmed.ends_with('}')
}

fn timestamp_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

fn backup_file_name() -> String {
    format!("ncs-logs-{:020}.json", timestamp_nanos())
}

fn temp_file_name() -> String {
    format!("ncs-logs-{:020}.tmp", timestamp_nanos())
}

fn parse_json_object(raw: &str, context: &str) -> Result<Map<String, Value>, String> {
    let value: Value = serde_json::from_str(raw)
        .map_err(|err| format!("Unable to parse {context} as JSON: {err}"))?;

    match value {
        Value::Object(object) => Ok(object),
        _ => Err(format!("{context} must be a JSON object.")),
    }
}

fn create_backup(contents: &str, backup_dir: &Path) -> Result<(), String> {
    let backup_name = backup_file_name();
    let mut backup_path = backup_dir.join(&backup_name);
    let mut collision = 1u32;

    while backup_path.exists() {
        backup_path = backup_dir.join(format!("ncs-logs-{collision:04}-{backup_name}"));
        collision += 1;
    }

    fs::write(&backup_path, contents).map_err(|err| {
        format!(
            "Unable to create a backup at {}: {err}",
            backup_path.display()
        )
    })?;

    Ok(())
}

fn write_json_atomically(path: &Path, contents: &str) -> Result<(), String> {
    let temp_file = path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(temp_file_name());

    fs::write(&temp_file, contents).map_err(|err| {
        format!(
            "Unable to write temporary logger data to {}: {err}",
            temp_file.display()
        )
    })?;

    if path.exists() {
        fs::remove_file(path).map_err(|err| {
            format!(
                "Unable to replace logger data at {}: {err}",
                path.display()
            )
        })?;
    }

    fs::rename(&temp_file, path).map_err(|err| {
        format!(
            "Unable to move logger data into place at {}: {err}",
            path.display()
        )
    })?;

    Ok(())
}

fn prune_backups(backup_dir: &Path) -> Result<(), String> {
    let mut backups = Vec::new();

    for entry in fs::read_dir(backup_dir)
        .map_err(|err| format!("Unable to read the backup folder: {err}"))?
    {
        let entry = entry.map_err(|err| format!("Unable to read a backup file entry: {err}"))?;
        let path = entry.path();

        let is_backup = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.starts_with("ncs-logs-") && name.ends_with(".json"))
            .unwrap_or(false);

        if is_backup {
            backups.push((entry.file_name().to_string_lossy().into_owned(), path));
        }
    }

    backups.sort_by(|left, right| right.0.cmp(&left.0));

    for (_, path) in backups.into_iter().skip(BACKUP_KEEP_COUNT) {
        if let Err(err) = fs::remove_file(&path) {
            eprintln!("Failed to remove old backup {}: {err}", path.display());
        }
    }

    Ok(())
}

#[tauri::command]
pub fn get_logger_storage_paths(app: AppHandle<Wry>) -> Result<(String, String, String), String> {
    let data_file = data_file_path(&app)?;
    let root = storage_root(&app)?;
    let backup_dir = root.join(BACKUP_DIR_NAME);

    Ok((
        data_file.display().to_string(),
        root.display().to_string(),
        backup_dir.display().to_string(),
    ))
}

#[tauri::command]
pub fn load_logger_data(app: AppHandle<Wry>) -> Result<String, String> {
    let data_file = data_file_path(&app)?;

    match fs::read_to_string(&data_file) {
        Ok(contents) if !contents.trim().is_empty() => {
            parse_json_object(&contents, DATA_FILE_NAME)?;
            Ok(contents)
        }
        Ok(_) => Ok(DEFAULT_LOGGER_JSON.to_string()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(DEFAULT_LOGGER_JSON.to_string()),
        Err(err) => Err(format!(
            "Unable to read logger data from {}: {err}",
            data_file.display()
        )),
    }
}

#[tauri::command]
pub fn save_logger_data(app: AppHandle<Wry>, json: String) -> Result<(), String> {
    if !looks_like_json_object(&json) {
        return Err("Logger data must be a JSON object.".to_string());
    }

    parse_json_object(&json, "logger data")?;

    let (_, backup_dir) = ensure_storage_dirs(&app)?;
    let data_file = data_file_path(&app)?;

    if data_file.exists() {
        let current_json = load_logger_data(app.clone())?;
        create_backup(&current_json, &backup_dir)?;
    }

    write_json_atomically(&data_file, &json)?;
    prune_backups(&backup_dir)?;

    Ok(())
}

#[tauri::command]
pub fn open_logger_data_folder(app: AppHandle<Wry>) -> Result<(), String> {
    let (root, _) = ensure_storage_dirs(&app)?;

    open_folder(&root)
}

#[cfg(target_os = "windows")]
fn open_folder(path: &Path) -> Result<(), String> {
    Command::new("explorer")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|err| format!("Unable to open the app data folder: {err}"))
}

#[cfg(not(target_os = "windows"))]
fn open_folder(_path: &Path) -> Result<(), String> {
    Err("Opening the app data folder is only implemented on Windows.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_json_objects_only() {
        assert!(looks_like_json_object(r#"{ "version": 1 }"#));
        assert!(!looks_like_json_object(r#"[]"#));
    }

    #[test]
    fn parses_json_object() {
        let parsed = parse_json_object(r#"{ "version": 1 }"#, "test").unwrap();

        assert_eq!(parsed.get("version"), Some(&Value::from(1)));
    }
}
