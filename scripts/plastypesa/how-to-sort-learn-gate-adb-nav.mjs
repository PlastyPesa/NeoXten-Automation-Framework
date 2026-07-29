#!/usr/bin/env node
/**
 * Assumes a logged-in session (run device-login-e2e first). Opens Sort learn gate.
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
  tapText,
} from "./localization/adb-ui.mjs";

bootstrapPlastyPesaEnv();
const PKG = "com.app.plasty_pesa";
const OUT = join(
  process.cwd(),
  ".neoxten",
  "proof",
  `how-to-sort-gate-adb-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);

function shot(deviceId, name) {
  const path = join(OUT, name);
  const r = spawnSync("adb", ["-s", deviceId, "exec-out", "screencap", "-p"], {
    encoding: "buffer",
    maxBuffer: 25 * 1024 * 1024,
  });
  if (r.status === 0 && r.stdout?.length) writeFileSync(path, r.stdout);
  console.log("screenshot", path);
  return path;
}

function blob(nodes) {
  return nodes
    .map((n) => `${n.text || ""} ${n.contentDesc || ""}`)
    .join(" | ")
    .toLowerCase();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const deviceId = getAdbDevice();
  spawnSync("adb", ["-s", deviceId, "shell", "am", "force-stop", "com.android.chrome"], {
    stdio: "pipe",
  });
  spawnSync(
    "adb",
    ["-s", deviceId, "shell", "am", "start", "-n", `${PKG}/.MainActivity`],
    { stdio: "pipe" },
  );
  await sleep(5000);
  shot(deviceId, "01-home.png");

  await tapText(["Got it", "OK", "Dismiss", "Close"], {
    deviceId,
    timeoutMs: 3000,
    label: "dismiss",
  });

  // Ensure Home tab (content-desc is often "Home\nHome").
  await tapText(["Home"], { deviceId, timeoutMs: 6000, label: "home-tab" });
  await sleep(1200);

  // Scroll until Earn hub tile "Sort by Grade, +4000" is visible, then open it.
  let onSort = false;
  for (let i = 0; i < 12 && !onSort; i += 1) {
    onSort = await tapText(
      ["Sort by Grade, +4000", "Sort by Grade"],
      { deviceId, timeoutMs: 2200, label: `sort-tile-${i}` },
    );
    if (onSort) break;
    spawnSync(
      "adb",
      ["-s", deviceId, "shell", "input", "swipe", "540", "1200", "540", "200", "300"],
      { stdio: "pipe" },
    );
    await sleep(450);
  }
  await sleep(3000);
  shot(deviceId, "02-sort.png");

  // Scroll a bit — rewatch card may be below fold
  spawnSync("adb", ["-s", deviceId, "shell", "input", "swipe", "540", "1600", "540", "700"], {
    stdio: "pipe",
  });
  await sleep(800);

  const opened =
    (await tapText(
      [
        "Watch again",
        "Tap to watch",
        "Nochmal ansehen",
        "Vezi din nou",
        "How-to-Sort video",
        "How-to-Sort-Video",
        "Rewatch",
      ],
      { deviceId, timeoutMs: 10000, label: "rewatch" },
    )) ||
    (await tapText(
      [
        "How to Sort",
        "How to sort",
        "So sortierst du",
        "Cum să sortezi",
        "Como separar",
        "Come separare",
      ],
      { deviceId, timeoutMs: 8000, label: "title" },
    ));

  await sleep(4000);
  shot(deviceId, "03-gate.png");

  let nodes = parseUiNodes(dumpUiHierarchy(deviceId, "gate").xml);
  let b = blob(nodes);
  let hasEn = /\benglish\b/.test(b);
  let hasSw = b.includes("kiswahili") || /\bswahili\b/.test(b);
  let hasTitle =
    b.includes("how to sort") ||
    b.includes("cum să sortezi") ||
    b.includes("so sortierst") ||
    b.includes("como separar") ||
    b.includes("come separare") ||
    b.includes("comment trier");
  const languagePicker =
    b.includes("choose your language") ||
    b.includes("pick the language you want");

  if (hasSw) {
    await tapText(["Kiswahili", "Swahili"], {
      deviceId,
      timeoutMs: 6000,
      label: "sw",
    });
    await sleep(2500);
    shot(deviceId, "04-sw.png");
    await tapText(["English"], { deviceId, timeoutMs: 6000, label: "en" });
    await sleep(2000);
    shot(deviceId, "05-en.png");
    nodes = parseUiNodes(dumpUiHierarchy(deviceId, "gate2").xml);
    b = blob(nodes);
    hasEn = /\benglish\b/.test(b);
    hasSw = b.includes("kiswahili") || /\bswahili\b/.test(b);
    hasTitle =
      b.includes("how to sort") ||
      b.includes("cum să sortezi") ||
      b.includes("so sortierst") ||
      b.includes("como separar") ||
      b.includes("come separare");
  }

  // onSort may be false if we resumed already on the gate; EN+SW chips are the bar.
  const ok = opened && !languagePicker && hasTitle && hasEn && hasSw;
  const summary = {
    ok,
    onSort,
    opened,
    hasTitle,
    hasEn,
    hasSw,
    languagePicker,
    out: OUT,
    sample: b.slice(0, 600),
    at: new Date().toISOString(),
  };
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (!ok) process.exit(1);
  console.log("PASS", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
