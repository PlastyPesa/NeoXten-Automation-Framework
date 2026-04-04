pub mod bridge;
pub mod commands;
pub mod enforcer;
pub mod events;
pub mod product_paths;
pub mod types;

use std::sync::Mutex;

use bridge::FactoryBridge;
use commands::runtime_cmd::OperatorServiceChild;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            product_paths::init_bundled_paths_for_app(app.handle());
            Ok(())
        })
        .manage(Mutex::new(FactoryBridge::new()))
        .manage(OperatorServiceChild::default())
        .invoke_handler(tauri::generate_handler![
            commands::run::start_run,
            commands::run::abort_run,
            commands::query::get_run_status,
            commands::query::get_run_history,
            commands::query::get_gate_results,
            commands::query::get_evidence_range,
            commands::spec::validate_spec,
            commands::runtime_cmd::product_paths_command,
            commands::runtime_cmd::operator_service_health,
            commands::runtime_cmd::operator_ensure_running,
            commands::runtime_cmd::operator_stop_child,
            commands::runtime_cmd::product_first_run_state,
            commands::runtime_cmd::product_readiness_cli,
            commands::runtime_cmd::product_mark_first_run_cli,
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri application");
}
