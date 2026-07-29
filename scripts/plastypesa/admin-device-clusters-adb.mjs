#!/usr/bin/env node
/**
 * ADB × P-ADMIN-DEVICE-EMAIL-OPS — Chrome → Daily Check shows device-cap copy.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { loadAdminDashboardCredentials } from "./credential-registry.mjs";
import {
  dumpUiHierarchy,
  parseUiNodes,
  sleep,
  getAdbDevice,
  tapBounds,
  findNodeByText,
  normalizeText,
} from "./localization/adb-ui.mjs";

bootstrapPlastyPesaEnv();
const OUT_DIR = join(
  process.cwd(),
  ".neoxten",
  "proof",
  `admin-device-clusters-adb-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);

const NEEDLES = [
  "devices at account cap",
  "multi-account devices",
  "no devices currently at the 2-account",
  "similar-email clusters",
  "look-alike email",
];

function shot(deviceId, name) {
  const path = join(OUT_DIR, name);
  const r = spawnSync("adb", ["-s", deviceId, "exec-out", "screencap", "-p"], {
    encoding: "buffer",
    maxBuffer: 25 * 1024 * 1024,
  });
  if (r.status === 0 && r.stdout?.length) writeFileSync(path, r.stdout);
  console.log("screenshot", path);
  return path;
}

function uiBlob(nodes) {
  return nodes
    .map((n) => `${n.text || ""} ${n.contentDesc || ""}`)
    .join(" | ")
    .toLowerCase();
}

function hitNeedles(nodes) {
  const blob = uiBlob(nodes);
  return NEEDLES.find((n) => blob.includes(n)) || null;
}

async function waitTap(deviceId, labels, { timeoutMs = 15000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const nodes = parseUiNodes(dumpUiHierarchy(deviceId, "adm").xml);
    const n = findNodeByText(nodes, labels);
    if (n?.bounds) {
      tapBounds(n.bounds, { deviceId });
      await sleep(1200);
      return true;
    }
    await sleep(700);
  }
  return false;
}

async function typeIntoFocused(deviceId, text) {
  // Prefer clipboard paste for passwords with special chars.
  spawnSync(
    "adb",
    ["-s", deviceId, "shell", "cmd", "clipboard", "set", "--user", "0", text],
    { stdio: "pipe" },
  );
  await sleep(200);
  spawnSync("adb", ["-s", deviceId, "shell", "input", "keyevent", "279"], {
    stdio: "pipe",
  });
}

async function runOnce(deviceId, label) {
  const { email, password } = loadAdminDashboardCredentials();
  spawnSync(
    "adb",
    [
      "-s",
      deviceId,
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      "https://plastypesa.com/login",
    ],
    { stdio: "pipe" },
  );
  await sleep(6000);
  shot(deviceId, `${label}-login.png`);

  // Best-effort login fields
  const nodes0 = parseUiNodes(dumpUiHierarchy(deviceId, "login0").xml);
  const edits = nodes0.filter(
    (n) => n.className?.includes("EditText") && n.bounds,
  );
  if (edits[0]?.bounds) {
    tapBounds(edits[0].bounds, { deviceId });
    await sleep(300);
    await typeIntoFocused(deviceId, email);
  }
  if (edits[1]?.bounds) {
    tapBounds(edits[1].bounds, { deviceId });
    await sleep(300);
    await typeIntoFocused(deviceId, password);
  }
  await waitTap(deviceId, ["Login", "Sign in", "Log in"], { timeoutMs: 10000 });
  await sleep(5000);

  // Navigate Daily Check — try menu / URL
  spawnSync(
    "adb",
    [
      "-s",
      deviceId,
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      "https://plastypesa.com/daily-check",
    ],
    { stdio: "pipe" },
  );
  await sleep(5000);

  // Scroll for signup watch section
  for (let i = 0; i < 8; i++) {
    spawnSync(
      "adb",
      ["-s", deviceId, "shell", "input", "swipe", "360", "1200", "360", "400", "400"],
      { stdio: "pipe" },
    );
    await sleep(700);
    const nodes = parseUiNodes(dumpUiHierarchy(deviceId, `${label}-s${i}`).xml);
    const hit = hitNeedles(nodes);
    if (hit) {
      const shotPath = shot(deviceId, `${label}.png`);
      writeFileSync(
        join(OUT_DIR, `${label}.json`),
        JSON.stringify({ hit, blob: uiBlob(nodes).slice(0, 1200) }, null, 2),
      );
      return { hit, shotPath };
    }
  }

  const shotPath = shot(deviceId, `${label}-miss.png`);
  return { hit: null, shotPath };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const deviceId = getAdbDevice();
  if (!deviceId) throw new Error("No ADB device");
  const a = await runOnce(deviceId, "pass1");
  await sleep(1500);
  const b = await runOnce(deviceId, "pass2");
  const ok = Boolean(a.hit && b.hit);
  const summary = { ok, a, b, out: OUT_DIR };
  writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (!ok) {
    console.error("FAIL admin device clusters ADB");
    process.exit(1);
  }
  console.log("PASS", OUT_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
