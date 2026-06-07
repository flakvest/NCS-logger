#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod storage;

fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      storage::get_logger_storage_paths,
      storage::load_logger_data,
      storage::open_logger_data_folder,
      storage::save_logger_data,
    ])
    .run(tauri::generate_context!())
    .expect("error while running Tauri application");
}
