//! Desktop shell ↔ local Operator service (Option C).

use crate::product_paths;
use serde_json::{json, Value};
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::State;

pub struct OperatorServiceChild(pub Mutex<Option<Child>>);

impl Default for OperatorServiceChild {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

/// Require NeoXten Operator `/api/health` (avoids reusing unrelated HTTP servers on the same port).
fn http_operator_health(host: &str, port: u16) -> bool {
    let addr: SocketAddr = match format!("{}:{}", host, port).parse() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_secs(2)) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    let req = format!(
        "GET /api/health HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",
        host
    );
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 4096];
    match stream.read(&mut buf) {
        Ok(n) if n > 0 => {
            let s = String::from_utf8_lossy(&buf[..n]);
            if !s.contains("200 OK") {
                return false;
            }
            let body = s
                .split("\r\n\r\n")
                .nth(1)
                .map(str::trim)
                .unwrap_or("");
            body.contains("neoxten-operator") && body.contains("ok")
        }
        _ => false,
    }
}

#[tauri::command]
pub fn product_paths_command() -> serde_json::Value {
    let data = product_paths::product_data_dir();
    let op = product_paths::operator_home();
    json!({
        "productDataDir": data,
        "operatorHome": op,
        "configDir": data.join("config"),
        "logsDir": data.join("logs"),
        "operatorSqlitePath": op.join("operator.sqlite"),
        "serviceLockPath": product_paths::service_lock_path(),
        "frameworkRoot": product_paths::resolved_framework_root().ok().map(|p| p.to_string_lossy().to_string()),
        "bundledNode": product_paths::resolved_node_exe().ok().map(|p| p.to_string_lossy().to_string()),
    })
}

#[tauri::command]
pub fn operator_service_health(port: u16) -> bool {
    http_operator_health("127.0.0.1", port)
}

/// First-run.json on disk (no subprocess).
#[tauri::command]
pub fn product_first_run_state() -> serde_json::Value {
    let p = product_paths::product_data_dir().join("config").join("first-run.json");
    if let Ok(raw) = std::fs::read_to_string(&p) {
        if let Ok(v) = serde_json::from_str::<Value>(&raw) {
            return json!({ "path": p, "state": v });
        }
    }
    json!({ "path": p, "state": { "complete": false } })
}

fn run_packaged_cli_output(args: &[&str]) -> Result<std::process::Output, String> {
    let node = product_paths::resolved_node_exe()?;
    let root = product_paths::resolved_framework_root()?;
    let cli = root.join("dist").join("cli").join("index.js");
    if !cli.is_file() {
        return Err(format!("CLI missing: {}", cli.display()));
    }
    Command::new(&node)
        .arg(&cli)
        .args(args)
        .env("NEOXTEN_FRAMEWORK_ROOT", &root)
        .env("NEOXTEN_DATA_DIR", product_paths::product_data_dir())
        .env("NEOXTEN_OPERATOR_HOME", product_paths::operator_home())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("spawn CLI: {}", e))
}

/// Runs `product readiness` or `readiness-sync` against the same paths the shell uses.
#[tauri::command]
pub fn product_readiness_cli(service_port: Option<u16>) -> Result<Value, String> {
    let out = if let Some(port) = service_port {
        let p = port.to_string();
        run_packaged_cli_output(&[
            "product",
            "readiness",
            "--json",
            "--check-service",
            "--service-port",
            &p,
        ])?
    } else {
        run_packaged_cli_output(&["product", "readiness-sync", "--json"])?
    };
    let stdout = String::from_utf8_lossy(&out.stdout);
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!(
            "readiness CLI produced no stdout (status {:?}): {}",
            out.status.code(),
            err
        ));
    }
    serde_json::from_str(trimmed).map_err(|e| format!("readiness JSON: {} — {}", e, trimmed))
}

#[tauri::command]
pub fn product_mark_first_run_cli() -> Result<Value, String> {
    let out = run_packaged_cli_output(&["product", "mark-first-run", "--json"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let trimmed = stdout.trim();
    serde_json::from_str(trimmed).map_err(|e| format!("mark-first-run JSON: {} — {}", e, trimmed))
}

/// Try lock file for bound port + health; else scan common range.
fn detect_healthy_port() -> Option<u16> {
    let lock = product_paths::service_lock_path();
    if let Ok(raw) = std::fs::read_to_string(&lock) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(p) = v.get("port").and_then(|x| x.as_u64()) {
                let port = p as u16;
                if http_operator_health("127.0.0.1", port) {
                    return Some(port);
                }
            }
        }
    }
    for port in 8787u16..=8807u16 {
        if http_operator_health("127.0.0.1", port) {
            return Some(port);
        }
    }
    None
}

#[tauri::command]
pub fn operator_ensure_running(state: State<'_, OperatorServiceChild>) -> Result<serde_json::Value, String> {
    if let Some(port) = detect_healthy_port() {
        return Ok(json!({
            "ok": true,
            "started": false,
            "port": port,
            "reused": true,
        }));
    }

    let node: PathBuf = product_paths::resolved_node_exe()?;
    let root = product_paths::resolved_framework_root()?;
    let cli = root.join("dist").join("cli").join("index.js");
    if !cli.is_file() {
        return Err(format!(
            "Framework CLI not built: {} (run `npm run build` in repo root)",
            cli.display()
        ));
    }

    let data = product_paths::product_data_dir();
    let op_home = product_paths::operator_home();

    {
        let mut g = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(ref mut c) = *g {
            if c.try_wait().map(|s| s.is_none()).unwrap_or(false) {
                let port = detect_healthy_port().ok_or_else(|| {
                    "Operator child process is running but Control API is not healthy yet.".to_string()
                })?;
                return Ok(json!({
                    "ok": true,
                    "started": false,
                    "port": port,
                    "reused": true,
                    "note": "existing child still running",
                }));
            }
            *g = None;
        }
    }

    let log_dir = data.join("logs");
    let _ = std::fs::create_dir_all(&log_dir);
    let stderr_dest = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("operator-serve.stderr.log"));

    let mut cmd = Command::new(&node);
    cmd.arg(&cli)
        .arg("operator")
        .arg("serve")
        .env("NEOXTEN_DATA_DIR", &data)
        .env("NEOXTEN_FRAMEWORK_ROOT", &root)
        .env("NEOXTEN_OPERATOR_HOME", &op_home)
        .stdout(Stdio::null());
    match stderr_dest {
        Ok(f) => {
            cmd.stderr(Stdio::from(f));
        }
        Err(_) => {
            cmd.stderr(Stdio::null());
        }
    }

    let child = cmd.spawn().map_err(|e| format!("spawn operator serve: {}", e))?;

    {
        let mut g = state.0.lock().map_err(|e| e.to_string())?;
        *g = Some(child);
    }

    let lock_path = product_paths::service_lock_path();
    let deadline = Instant::now() + Duration::from_secs(45);
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(300));
        if let Ok(raw) = std::fs::read_to_string(&lock_path) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(p) = v.get("port").and_then(|x| x.as_u64()) {
                    let port = p as u16;
                    if http_operator_health("127.0.0.1", port) {
                        return Ok(json!({
                            "ok": true,
                            "started": true,
                            "port": port,
                            "reused": false,
                        }));
                    }
                }
            }
        }
        if let Some(port) = detect_healthy_port() {
            return Ok(json!({
                "ok": true,
                "started": true,
                "port": port,
                "reused": false,
            }));
        }
    }

    {
        let mut g = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(mut c) = g.take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }

    Err("Operator Control API did not become healthy (timeout). Ensure `npm run build` at repo root.".into())
}

#[tauri::command]
pub fn operator_stop_child(state: State<'_, OperatorServiceChild>) -> Result<(), String> {
    let mut g = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut c) = g.take() {
        let _ = c.kill();
        let _ = c.wait();
    }
    Ok(())
}
