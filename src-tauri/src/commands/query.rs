use std::fs;
use std::path::Path;

use crate::types::{RunHistoryEntry, RunStatus};

#[tauri::command]
pub async fn get_run_status(run_id: String) -> Result<RunStatus, String> {
    let state_path = format!("ops/factory/runs/{}/run-state.json", run_id);
    let data =
        fs::read_to_string(&state_path).map_err(|e| format!("read error: {}", e))?;
    let parsed: serde_json::Value =
        serde_json::from_str(&data).map_err(|e| format!("parse error: {}", e))?;

    Ok(RunStatus {
        run_id: parsed["runId"].as_str().unwrap_or("").to_string(),
        status: parsed["status"].as_str().unwrap_or("unknown").to_string(),
        current_stage: parsed["currentStage"].as_str().unwrap_or("").to_string(),
        gates_passed: parsed["gateResults"]
            .as_array()
            .map(|a| a.iter().filter(|g| g["passed"].as_bool() == Some(true)).count() as u32)
            .unwrap_or(0),
        gates_failed: parsed["gateResults"]
            .as_array()
            .map(|a| a.iter().filter(|g| g["passed"].as_bool() == Some(false)).count() as u32)
            .unwrap_or(0),
        duration_ms: 0,
    })
}

#[tauri::command]
pub async fn get_run_history() -> Result<Vec<RunHistoryEntry>, String> {
    let runs_dir = Path::new("ops/factory/runs");
    if !runs_dir.exists() {
        return Ok(vec![]);
    }

    let mut entries = Vec::new();
    let dirs = fs::read_dir(runs_dir).map_err(|e| format!("read dir error: {}", e))?;

    for entry in dirs.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let manifest_path = entry.path().join("manifest.json");
        if manifest_path.exists() {
            if let Ok(data) = fs::read_to_string(&manifest_path) {
                if let Ok(m) = serde_json::from_str::<serde_json::Value>(&data) {
                    entries.push(RunHistoryEntry {
                        run_id: m["runId"].as_str().unwrap_or("").to_string(),
                        status: m["status"].as_str().unwrap_or("unknown").to_string(),
                        started_at: m["startedAt"].as_str().unwrap_or("").to_string(),
                        duration_ms: m["durationMs"].as_u64().unwrap_or(0),
                    });
                }
            }
        }
    }

    entries.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    Ok(entries)
}

#[tauri::command]
pub async fn get_gate_results(run_id: String) -> Result<Vec<serde_json::Value>, String> {
    let state_path = format!("ops/factory/runs/{}/run-state.json", run_id);
    let data =
        fs::read_to_string(&state_path).map_err(|e| format!("read error: {}", e))?;
    let parsed: serde_json::Value =
        serde_json::from_str(&data).map_err(|e| format!("parse error: {}", e))?;

    Ok(parsed["gateResults"]
        .as_array()
        .cloned()
        .unwrap_or_default())
}

#[tauri::command]
pub async fn get_evidence_range(
    run_id: String,
    from: u64,
    to: u64,
) -> Result<Vec<serde_json::Value>, String> {
    let chain_path = format!("ops/factory/runs/{}/evidence-chain.ndjson", run_id);
    let data =
        fs::read_to_string(&chain_path).map_err(|e| format!("read error: {}", e))?;

    let entries: Vec<serde_json::Value> = data
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str(l).ok())
        .filter(|e: &serde_json::Value| {
            let seq = e["seq"].as_u64().unwrap_or(0);
            seq >= from && seq <= to
        })
        .collect();

    Ok(entries)
}
