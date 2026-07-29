#!/usr/bin/env node
/**
 * ADB × P-MARKET-GEO-MISMATCH — non-KE device locale + Kenya market → confirm dialog.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
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
const PKG = "com.app.plasty_pesa";
const OUT_DIR = join(
  process.cwd(),
  ".neoxten",
  "proof",
  `market-geo-warn-adb-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);

const NEEDLES = [
  "confirm kenya",
  "kenya cash",
  "device looks",
  "take part in kenya",
  "confirma",
  "confirmă",
  "bestätigen",
  "confirmer",
];

function decodeUi(v) {
  return String(v || "")
    .replace(/&#10;/g, " ")
    .replace(/&amp;/g, "&");
}

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
    .map((n) => decodeUi(`${n.text || ""} ${n.contentDesc || ""}`))
    .join(" | ")
    .toLowerCase();
}

function hitWarn(nodes) {
  const blob = uiBlob(nodes);
  return NEEDLES.find((n) => blob.includes(n)) || null;
}

function findExactLabel(nodes, labels) {
  const wants = labels.map(normalizeText).filter(Boolean);
  for (const n of nodes) {
    if (n.packageName !== PKG || !n.bounds) continue;
    const hay = [n.text, n.contentDesc]
      .map((v) => normalizeText(decodeUi(v)))
      .filter(Boolean);
    for (const h of hay) {
      if (wants.includes(h) || wants.some((w) => h.includes(w))) return n;
    }
  }
  return null;
}

async function waitTap(deviceId, labels, { timeoutMs = 15000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const nodes = parseUiNodes(dumpUiHierarchy(deviceId, "geo").xml);
    let n = findNodeByText(nodes, labels, { packageName: PKG });
    if (!n?.bounds) n = findExactLabel(nodes, labels);
    if (n?.bounds) {
      console.log("tap", labels[0]);
      tapBounds(n.bounds, { deviceId });
      await sleep(1200);
      return true;
    }
    await sleep(700);
  }
  return false;
}

async function reachMarketPicker(deviceId) {
  spawnSync("adb", ["-s", deviceId, "shell", "pm", "clear", PKG], {
    stdio: "pipe",
  });
  await sleep(1200);
  spawnSync(
    "adb",
    [
      "-s",
      deviceId,
      "shell",
      "monkey",
      "-p",
      PKG,
      "-c",
      "android.intent.category.LAUNCHER",
      "1",
    ],
    { stdio: "pipe" },
  );
  await sleep(8000);

  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const nodes = parseUiNodes(dumpUiHierarchy(deviceId, "reach-m").xml);
    const blob = uiBlob(nodes);
    if (/kenya|m-pesa|reward region|regiune|région|región|region/i.test(blob)) {
      return true;
    }
    if (/elige tu idioma|choose your language/i.test(blob)) {
      await waitTap(deviceId, ["English"], { timeoutMs: 4000 });
      await waitTap(deviceId, ["Continue", "Continuar"], { timeoutMs: 4000 });
      continue;
    }
    if (findExactLabel(nodes, ["Skip"])) {
      await waitTap(deviceId, ["Skip"], { timeoutMs: 3000 });
      continue;
    }
    if (findExactLabel(nodes, ["Next"])) {
      await waitTap(deviceId, ["Next"], { timeoutMs: 3000 });
      continue;
    }
    if (/privacy|save &/i.test(blob)) {
      await waitTap(deviceId, ["Save & continue", "Save & Continue"], {
        timeoutMs: 5000,
      });
      continue;
    }
    if (/sign up|login|welcome back/i.test(blob)) {
      await waitTap(deviceId, ["Sign Up", "sign up"], { timeoutMs: 8000 });
      continue;
    }
    await sleep(800);
  }
  return false;
}

async function runOnce(deviceId, label) {
  if (!(await reachMarketPicker(deviceId))) {
    shot(deviceId, `${label}-fail-reach.png`);
    throw new Error("market picker not reached");
  }
  shot(deviceId, `${label}-market.png`);

  await waitTap(
    deviceId,
    [
      "I live in Kenya — weekly M-Pesa rewards",
      "Kenya",
      "M-Pesa",
    ],
    { timeoutMs: 10000 },
  );
  await sleep(600);
  await waitTap(
    deviceId,
    ["Continue", "Continuar", "Continua", "Weiter", "Continuer"],
    { timeoutMs: 8000 },
  );
  await sleep(1500);

  let hit = null;
  for (let i = 0; i < 8; i++) {
    const nodes = parseUiNodes(dumpUiHierarchy(deviceId, `${label}-w${i}`).xml);
    hit = hitWarn(nodes);
    if (hit) break;
    await sleep(500);
  }
  const shotPath = shot(deviceId, `${label}.png`);
  writeFileSync(
    join(OUT_DIR, `${label}.json`),
    JSON.stringify({ hit }, null, 2),
  );
  return { hit, shotPath };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const deviceId = getAdbDevice();
  if (!deviceId) throw new Error("No ADB device");

  // Ensure debug APK with warn dialog is installed by caller.
  const a = await runOnce(deviceId, "pass1");
  await sleep(1000);
  const b = await runOnce(deviceId, "pass2");
  const ok = Boolean(a.hit && b.hit);
  const summary = { ok, a, b, out: OUT_DIR };
  writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (!ok) process.exit(1);
  console.log("PASS", OUT_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
