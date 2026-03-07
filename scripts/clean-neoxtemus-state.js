/**
 * Clean persisted Neoxtemus vault state for deterministic test runs.
 * Removes vault.enc, vault_pin.enc, decoy.enc from known data dirs.
 * Run before neoxtemus-ocr-test to force onboarding flow.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

function rm(p) {
  try {
    if (fs.existsSync(p)) {
      fs.rmSync(p, { force: true });
      console.log('[clean] removed', p);
    }
  } catch (e) {
    console.warn('[clean] failed to remove', p, e.message);
  }
}

const VAULT_FILES = ['vault.enc', 'vault_pin.enc', 'decoy.enc'];

// Tauri app_data_dir + "neoxtemus" or dirs_next::data_local_dir + "neoxtemus"
const bases = [
  process.env.APPDATA,
  process.env.LOCALAPPDATA,
  path.join(os.homedir(), 'AppData', 'Roaming'),
  path.join(os.homedir(), 'AppData', 'Local'),
].filter(Boolean);

const seen = new Set();
for (const base of bases) {
  // Tauri: app_data_dir = base/com.neoxtemus.app, then join("neoxtemus")
  const tauriDir = path.join(base, 'com.neoxtemus.app', 'neoxtemus');
  if (!seen.has(tauriDir)) {
    seen.add(tauriDir);
    for (const f of VAULT_FILES) {
      rm(path.join(tauriDir, f));
    }
  }
  // Fallback: dirs_next::data_local_dir + "neoxtemus" (no app id)
  const fallbackDir = path.join(base, 'neoxtemus');
  if (!seen.has(fallbackDir)) {
    seen.add(fallbackDir);
    for (const f of VAULT_FILES) {
      rm(path.join(fallbackDir, f));
    }
  }
}
