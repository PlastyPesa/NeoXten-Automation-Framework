/**
 * Load gitignored local Play stats env (bucket name, optional overrides).
 * File: NeoXten-Automation-Framework/.local/play-stats.env
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEOXTEN_ROOT = resolve(__dirname, "../..");
const ENV_FILE = resolve(NEOXTEN_ROOT, ".local", "play-stats.env");

export function loadPlayLocalEnv() {
  if (!existsSync(ENV_FILE)) return { loaded: false, path: ENV_FILE };
  for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    let val = m[2].trim().replace(/^["']|["']$/g, "");
    if (key === "PLASTYPESA_PLAY_STATS_BUCKET") {
      val = val.replace(/^gs:\/\//, "").replace(/\/.*$/, "");
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
  return { loaded: true, path: ENV_FILE, bucket: process.env.PLASTYPESA_PLAY_STATS_BUCKET || null };
}

export function playLocalEnvPath() {
  return ENV_FILE;
}
