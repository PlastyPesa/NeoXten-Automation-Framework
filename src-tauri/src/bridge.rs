/// Factory Bridge — manages the Factory Core Node.js child process.
///
/// Spawns bundled `node` + `dist/cli/index.js` from `resources/neoxten-runtime` (or dev repo root).
/// Sends commands via stdin (JSON lines).
/// Reads NDJSON events from stdout and relays them to the Tauri event system.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

use crate::product_paths;
use crate::types::FactoryEvent;

pub struct FactoryBridge {
    child: Option<Child>,
    stdin_writer: Option<Arc<Mutex<Box<dyn Write + Send>>>>,
}

impl FactoryBridge {
    pub fn new() -> Self {
        Self {
            child: None,
            stdin_writer: None,
        }
    }

    pub fn spawn(&mut self, app: &AppHandle) -> Result<(), String> {
        if self.child.is_some() {
            return Err("factory process already running".into());
        }

        let node: PathBuf = product_paths::resolved_node_exe()?;
        let root = product_paths::resolved_framework_root()?;
        let cli = root.join("dist").join("cli").join("index.js");
        if !cli.is_file() {
            return Err(format!("factory CLI missing: {}", cli.display()));
        }

        let mut child = Command::new(&node)
            .current_dir(&root)
            .arg(&cli)
            .args(["factory", "run", "--spec", "pending"])
            .env("NEOXTEN_FRAMEWORK_ROOT", &root)
            .env("NEOXTEN_DATA_DIR", product_paths::product_data_dir())
            .env("NEOXTEN_OPERATOR_HOME", product_paths::operator_home())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("failed to spawn factory: {}", e))?;

        let stdout = child.stdout.take().ok_or("no stdout")?;
        let stdin = child.stdin.take().ok_or("no stdin")?;

        self.stdin_writer = Some(Arc::new(Mutex::new(Box::new(stdin))));

        let app_handle = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(text) if !text.trim().is_empty() => {
                        if let Ok(event) = serde_json::from_str::<FactoryEvent>(&text) {
                            let event_name = format!("factory://{}", event.event);
                            let _ = app_handle.emit(&event_name, event.data);
                        }
                        let _ = app_handle.emit("factory://raw", text);
                    }
                    Err(_) => break,
                    _ => {}
                }
            }
        });

        self.child = Some(child);
        Ok(())
    }

    pub fn send_command(&self, json: serde_json::Value) -> Result<(), String> {
        let writer = self
            .stdin_writer
            .as_ref()
            .ok_or("factory process not running")?;

        let mut guard = writer.lock().map_err(|e| format!("lock error: {}", e))?;
        let line = serde_json::to_string(&json).map_err(|e| format!("serialize error: {}", e))?;
        guard
            .write_all(line.as_bytes())
            .map_err(|e| format!("write error: {}", e))?;
        guard
            .write_all(b"\n")
            .map_err(|e| format!("write newline error: {}", e))?;
        guard.flush().map_err(|e| format!("flush error: {}", e))?;
        Ok(())
    }

    pub fn is_running(&self) -> bool {
        self.child.is_some()
    }

    pub fn kill(&mut self) -> Result<(), String> {
        if let Some(ref mut child) = self.child {
            child.kill().map_err(|e| format!("kill error: {}", e))?;
            child.wait().map_err(|e| format!("wait error: {}", e))?;
        }
        self.child = None;
        self.stdin_writer = None;
        Ok(())
    }
}

impl Drop for FactoryBridge {
    fn drop(&mut self) {
        let _ = self.kill();
    }
}
