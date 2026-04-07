use crate::product_paths;
use crate::types::SpecValidationResult;
use std::path::PathBuf;
use std::process::Command;

#[tauri::command]
pub async fn validate_spec(spec_path: String) -> Result<SpecValidationResult, String> {
    let node: PathBuf = product_paths::resolved_node_exe()?;
    let root = product_paths::resolved_framework_root()?;
    let escaped = spec_path.replace('\\', "\\\\").replace('\'', "\\'");
    let output = Command::new(&node)
        .current_dir(&root)
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
            escaped
        )])
        .env("NEOXTEN_FRAMEWORK_ROOT", &root)
        .env("NEOXTEN_DATA_DIR", product_paths::product_data_dir())
        .env("NEOXTEN_OPERATOR_HOME", product_paths::operator_home())
        .output()
        .map_err(|e| format!("spawn error: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("validation process failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(stdout.trim()).map_err(|e| format!("parse error: {}", e))
}
