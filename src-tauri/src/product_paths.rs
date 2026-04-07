//! Match `src/runtime/product-paths.ts` (local-first layout).
//! Packaged installs set `PACKAGED_FRAMEWORK` / `BUNDLED_NODE` from bundled `resources/`.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tauri::{AppHandle, Manager};

static PACKAGED_FRAMEWORK: OnceLock<PathBuf> = OnceLock::new();
static BUNDLED_NODE: OnceLock<PathBuf> = OnceLock::new();

/// Returns true if both bundled runtime CLI and Node were found and registered.
fn try_init_bundled_resources_dir(resource_dir: &Path) -> bool {
    let fw = resource_dir.join("neoxten-runtime");
    let cli = fw.join("dist").join("cli").join("index.js");
    let node_win = resource_dir.join("nodejs").join("node.exe");
    let node_nix = resource_dir.join("nodejs").join("bin").join("node");
    let node = if node_win.is_file() {
        Some(node_win)
    } else if node_nix.is_file() {
        Some(node_nix)
    } else {
        None
    };
    if cli.is_file() {
        if let Some(n) = node {
            let _ = PACKAGED_FRAMEWORK.set(fw);
            let _ = BUNDLED_NODE.set(n);
            return true;
        }
    }
    false
}

/// Prefer Tauri `resource_dir()`, then `<executable_dir>/resources` (NSIS sidecar layout).
/// The API `resource_dir()` can fail on some Windows installs; the exe-relative path matches NSIS output.
pub fn init_bundled_paths_for_app(app: &AppHandle) {
    if let Ok(dir) = app.path().resource_dir() {
        if try_init_bundled_resources_dir(&dir) {
            return;
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().map(PathBuf::from);
        for _ in 0..10 {
            let Some(ref d) = dir else {
                break;
            };
            let resources = d.join("resources");
            if try_init_bundled_resources_dir(&resources) {
                return;
            }
            dir = d.parent().map(PathBuf::from);
        }
    }
}

/// Legacy hook — single directory (tests or custom callers).
pub fn init_bundled_paths_from_resource_dir(resource_dir: PathBuf) {
    let _ = try_init_bundled_resources_dir(&resource_dir);
}

pub fn product_data_dir() -> PathBuf {
    if let Ok(p) = std::env::var("NEOXTEN_DATA_DIR") {
        let t = p.trim();
        if !t.is_empty() {
            return PathBuf::from(t);
        }
    }
    match std::env::consts::OS {
        "windows" => {
            let base = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| {
                dirs::data_local_dir()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|| ".".to_string())
            });
            PathBuf::from(base).join("NeoXten")
        }
        "macos" => dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Library")
            .join("Application Support")
            .join("NeoXten"),
        _ => dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("neoxten"),
    }
}

pub fn operator_home() -> PathBuf {
    if let Ok(p) = std::env::var("NEOXTEN_OPERATOR_HOME") {
        let t = p.trim();
        if !t.is_empty() {
            return PathBuf::from(t);
        }
    }
    product_data_dir().join("operator")
}

pub fn service_lock_path() -> PathBuf {
    operator_home().join("service-lock.json")
}

pub fn resolved_framework_root() -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("NEOXTEN_FRAMEWORK_ROOT") {
        let t = p.trim();
        if !t.is_empty() {
            return Ok(PathBuf::from(t));
        }
    }
    if let Some(p) = PACKAGED_FRAMEWORK.get() {
        return Ok(p.clone());
    }
    if !cfg!(debug_assertions) {
        return Err(
            "Bundled framework is missing from the app install (resources/neoxten-runtime). Reinstall NeoXten Desktop."
                .into(),
        );
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .canonicalize()
        .map_err(|e| format!("framework root: {}", e))
}

pub fn resolved_node_exe() -> Result<PathBuf, String> {
    if let Some(p) = BUNDLED_NODE.get() {
        return Ok(p.clone());
    }
    if !cfg!(debug_assertions) {
        return Err(
            "Bundled Node.js is missing from the app install (resources/nodejs). Reinstall NeoXten Desktop.".into(),
        );
    }
    which::which("node").map_err(|e| {
        format!(
            "Node.js not found ({e}). Install Node 18+ or use the packaged desktop app with bundled runtime."
        )
    })
}

/// Legacy name — same as `resolved_framework_root`.
pub fn framework_root() -> Result<PathBuf, String> {
    resolved_framework_root()
}
