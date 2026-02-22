use crate::types::SpecValidationResult;
use std::process::Command;

#[tauri::command]
pub async fn validate_spec(spec_path: String) -> Result<SpecValidationResult, String> {
    let output = Command::new("node")
        .args(["-e", &format!(
            r#"
            const {{ validateSpec }} = require('./dist/factory/spec/validator.js');
            const yaml = require('js-yaml');
            const fs = require('fs');
            const raw = fs.readFileSync('{}', 'utf-8');
            const parsed = yaml.load(raw);
            const result = validateSpec(parsed);
            console.log(JSON.stringify({{
                valid: result.valid,
                errors: result.errors ? result.errors.map(e => e.message) : []
            }}));
            "#,
            spec_path.replace('\\', "\\\\").replace('\'', "\\'")
        )])
        .output()
        .map_err(|e| format!("spawn error: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("validation process failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(stdout.trim()).map_err(|e| format!("parse error: {}", e))
}
