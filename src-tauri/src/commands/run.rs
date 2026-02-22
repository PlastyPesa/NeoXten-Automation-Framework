use std::sync::Mutex;
use tauri::{AppHandle, State};

use crate::bridge::FactoryBridge;
use crate::enforcer::FactoryCommand;

#[tauri::command]
pub async fn start_run(
    app: AppHandle,
    bridge: State<'_, Mutex<FactoryBridge>>,
    spec_path: String,
    blueprint_path: Option<String>,
) -> Result<String, String> {
    let cmd = FactoryCommand::StartRun {
        spec_path,
        blueprint_path,
    };

    let mut b = bridge.lock().map_err(|e| e.to_string())?;
    if !b.is_running() {
        b.spawn(&app)?;
    }
    b.send_command(cmd.to_bridge_json())?;

    Ok("run started".into())
}

#[tauri::command]
pub async fn abort_run(
    bridge: State<'_, Mutex<FactoryBridge>>,
    run_id: String,
) -> Result<String, String> {
    let cmd = FactoryCommand::AbortRun { run_id };

    let b = bridge.lock().map_err(|e| e.to_string())?;
    b.send_command(cmd.to_bridge_json())?;

    Ok("abort requested".into())
}
