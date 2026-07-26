/**
 * Load MONGO_URL from plastypesa-backend-api .env files (never commit secrets).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(
  process.env.PLASTYPESA_BACKEND_DIR ||
    "C:/Users/Bobby/Documents/plastypesa-backend-api",
);

function applyEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    let val = m[2].trim().replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

export function loadBackendMongoEnv() {
  applyEnvFile(resolve(BACKEND_ROOT, ".env"));
  applyEnvFile(resolve(BACKEND_ROOT, "lib/lambda/backend/.env"));
  const uri =
    process.env.PLASTYPESA_MONGO_URI ||
    process.env.MONGO_URL ||
    process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "Mongo URI missing — set PLASTYPESA_MONGO_URI or ensure backend .env has MONGO_URL",
    );
  }
  return uri;
}
