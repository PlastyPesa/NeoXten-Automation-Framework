/**
 * Starts Velarune Studio API+UI for Playwright (NeoXten e2e).
 * Builds sibling ../Veralune Studio if needed, then runs dist/studio/serve.js.
 */
import { execSync, spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const neoRoot = path.dirname(path.dirname(scriptPath));
const velaruneRoot = path.resolve(neoRoot, "..", "Veralune Studio");
const dataDir = path.join(neoRoot, ".velarune-studio-e2e-data");
const port = process.env.VELARUNE_E2E_PORT || "9876";

if (!existsSync(velaruneRoot)) {
  console.error("Velarune Studio not found at", velaruneRoot);
  process.exit(2);
}

mkdirSync(dataDir, { recursive: true });

execSync("npm run build", { cwd: velaruneRoot, stdio: "inherit" });
execSync("npm run build --prefix ui", { cwd: velaruneRoot, stdio: "inherit" });

const serveJs = path.join(velaruneRoot, "dist", "studio", "serve.js");
if (!existsSync(serveJs)) {
  console.error("Missing", serveJs);
  process.exit(2);
}

const child = spawn(process.execPath, [serveJs], {
  cwd: velaruneRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    VELARUNE_STUDIO_PORT: port,
    VELARUNE_STUDIO_HOST: "127.0.0.1",
    VELARUNE_STUDIO_DATA: dataDir,
  },
});

child.on("exit", (code) => process.exit(code ?? 0));
