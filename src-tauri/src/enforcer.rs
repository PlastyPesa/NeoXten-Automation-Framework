/// FactoryCommand — the exhaustive whitelist of allowed operations.
///
/// This enum IS the security boundary. Commands not in this enum
/// do not exist. The Rust compiler enforces exhaustiveness.
/// No SkipGate, ForceShip, OverrideGate, ModifyCode, ModifyRunState,
/// SetGateResult, or DeleteEvidence variants exist. They cannot be called.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "params")]
pub enum FactoryCommand {
    // Queries (read-only, always allowed)
    GetRunStatus,
    GetGateResults,
    GetEvidenceEntry { seq: u64 },
    GetEvidenceRange { from: u64, to: u64 },
    GetArtifact { path: String },
    GetConsequenceMemory { domain: Option<String> },
    GetRunHistory,

    // Run control (state-changing, audit-logged)
    StartRun { spec_path: String, blueprint_path: Option<String> },
    AbortRun { run_id: String },

    // Spec management (pre-run only)
    ValidateSpec { spec_path: String },
    DeriveSpecFromPlan { plan_text: String },
}

impl FactoryCommand {
    pub fn is_read_only(&self) -> bool {
        matches!(
            self,
            FactoryCommand::GetRunStatus
                | FactoryCommand::GetGateResults
                | FactoryCommand::GetEvidenceEntry { .. }
                | FactoryCommand::GetEvidenceRange { .. }
                | FactoryCommand::GetArtifact { .. }
                | FactoryCommand::GetConsequenceMemory { .. }
                | FactoryCommand::GetRunHistory
        )
    }

    pub fn to_bridge_json(&self) -> serde_json::Value {
        match self {
            FactoryCommand::StartRun { spec_path, blueprint_path } => {
                serde_json::json!({
                    "type": "start_run",
                    "specPath": spec_path,
                    "blueprintPath": blueprint_path,
                })
            }
            FactoryCommand::AbortRun { run_id } => {
                serde_json::json!({
                    "type": "abort_run",
                    "runId": run_id,
                })
            }
            FactoryCommand::ValidateSpec { spec_path } => {
                serde_json::json!({
                    "type": "validate_spec",
                    "specPath": spec_path,
                })
            }
            FactoryCommand::DeriveSpecFromPlan { plan_text } => {
                serde_json::json!({
                    "type": "derive_spec",
                    "planText": plan_text,
                })
            }
            FactoryCommand::GetRunStatus => serde_json::json!({"type": "query", "queryType": "run_status"}),
            FactoryCommand::GetGateResults => serde_json::json!({"type": "query", "queryType": "gate_results"}),
            FactoryCommand::GetEvidenceEntry { seq } => serde_json::json!({"type": "query", "queryType": "evidence_entry", "params": {"seq": seq}}),
            FactoryCommand::GetEvidenceRange { from, to } => serde_json::json!({"type": "query", "queryType": "evidence_range", "params": {"from": from, "to": to}}),
            FactoryCommand::GetArtifact { path } => serde_json::json!({"type": "query", "queryType": "artifact", "params": {"path": path}}),
            FactoryCommand::GetConsequenceMemory { domain } => serde_json::json!({"type": "query", "queryType": "consequence_memory", "params": {"domain": domain}}),
            FactoryCommand::GetRunHistory => serde_json::json!({"type": "query", "queryType": "run_history"}),
        }
    }
}
