#!/usr/bin/env node
/**
 * ADB × Learn → Videos classroom (How-to-Sort clips visible).
 * Run after device-login-e2e + debug APK install.
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
  `educational-videos-adb-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);

function shot(deviceId, name) {
  const path = join(OUT, name);
  const r = spawnSync("adb", ["-s", deviceId, "exec-out", "screencap", "-p"], {
    encoding: "buffer",
    maxBuffer: 25 * 1024 * 1024,
  });
  if (r.status === 0 && r.stdout?.length) writeFileSync(path, r.stdout);
  console.log("screenshot", path);
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
  spawnSync("adb", ["-s", deviceId, "shell", "am", "force-stop", PKG], {
    stdio: "pipe",
  });
  await sleep(700);
  spawnSync(
    "adb",
    ["-s", deviceId, "shell", "am", "start", "-n", `${PKG}/.MainActivity`],
    { stdio: "pipe" },
  );
  await sleep(7000);
  shot(deviceId, "01-launch.png");

  await tapText(["Learn", "Învață", "Lernen", "Apprendre", "Aprender"], {
    deviceId,
    timeoutMs: 12000,
    label: "learn-tab",
  });
  await sleep(2500);
  shot(deviceId, "02-learn.png");

  // Videos section may need a short scroll
  for (let i = 0; i < 3; i += 1) {
    const nodes = parseUiNodes(dumpUiHierarchy(deviceId, "learn").xml);
    const b = blob(nodes);
    if (b.includes("how to sort") || b.includes("videos") || b.includes("videoclipuri")) {
      break;
    }
    spawnSync(
      "adb",
      ["-s", deviceId, "shell", "input", "swipe", "540", "1200", "540", "500", "300"],
      { stdio: "pipe" },
    );
    await sleep(500);
  }
  shot(deviceId, "03-videos-section.png");

  const listNodes = parseUiNodes(dumpUiHierarchy(deviceId, "videos-list").xml);
  const listBlob = blob(listNodes);
  const hasSwClip =
    listBlob.includes("kiswahili") ||
    listBlob.includes("how to sort (swahili)") ||
    /\bswahili\b/.test(listBlob);

  const hasEnClip =
    listBlob.includes("how to sort (english)") ||
    listBlob.includes("how to sort");

  const opened = await tapText(
    ["How to Sort (English)", "How to Sort"],
    { deviceId, timeoutMs: 10000, label: "open-clip" },
  );
  await sleep(5000);
  shot(deviceId, "04-player.png");

  const nodes = parseUiNodes(dumpUiHierarchy(deviceId, "player").xml);
  const b = blob(nodes);
  const hasPlayer =
    b.includes("how to sort") ||
    b.includes("done") ||
    b.includes("fertig") ||
    b.includes("gata") ||
    b.includes("terminé") ||
    b.includes("i've finished") ||
    b.includes("fullscreen");

  // Owner lock 2026-07-29: EN list without Kiswahili is the hard bar.
  const ok = hasEnClip && !hasSwClip && (opened || hasPlayer);
  const summary = {
    ok,
    opened,
    hasPlayer,
    hasEnClip,
    hasSwClip,
    out: OUT,
    listSample: listBlob.slice(0, 400),
    sample: b.slice(0, 400),
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
