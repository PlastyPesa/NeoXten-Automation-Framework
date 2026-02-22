pub mod bridge;
pub mod commands;
pub mod enforcer;
pub mod events;
pub mod types;

use std::sync::Mutex;

use bridge::FactoryBridge;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(FactoryBridge::new()))
        .invoke_handler(tauri::generate_handler![
            commands::run::start_run,
            commands::run::abort_run,
            commands::query::get_run_status,
            commands::query::get_run_history,
            commands::query::get_gate_results,
            commands::query::get_evidence_range,
            commands::spec::validate_spec,
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri application");
}
