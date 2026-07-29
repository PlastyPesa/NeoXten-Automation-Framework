#!/usr/bin/env node
/**
 * ADB ×2: open Notifications via Semantics label and prove Read/EcoSort earn rows.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  dumpUiHierarchy,
  parseUiNodes,
  sleep,
  getAdbDevice,
  tapText,
  tapBounds,
} from "./localization/adb-ui.mjs";
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";

bootstrapPlastyPesaEnv();
const PKG = "com.app.plasty_pesa";
const OUT = join(
  process.cwd(),
  ".neoxten",
  "proof",
  `silent-earn-notify-adb-${new Date().toISOString().replace(/[:.]/g, "-")}`
);
mkdirSync(OUT, { recursive: true });

function shot(deviceId, name) {
  const r = spawnSync("adb", ["-s", deviceId, "exec-out", "screencap", "-p"], {
    encoding: "buffer",
    maxBuffer: 25 * 1024 * 1024,
  });
  if (r.status === 0 && r.stdout?.length) writeFileSync(join(OUT, name), r.stdout);
}

function blob(deviceId) {
  return parseUiNodes(dumpUiHierarchy(deviceId, "x").xml)
    .map((n) => `${n.text || ""} ${n.contentDesc || ""}`)
    .join(" | ")
    .toLowerCase();
}

async function openInbox(deviceId, tag) {
  spawnSync("adb", ["-s", deviceId, "shell", "am", "force-stop", PKG], {
    stdio: "pipe",
  });
  spawnSync(
    "adb",
    ["-s", deviceId, "shell", "am", "start", "-n", `${PKG}/.MainActivity`],
    { stdio: "pipe" }
  );
  await sleep(14000);
  shot(deviceId, `${tag}-home.png`);

  for (let i = 0; i < 4; i += 1) {
    const nodes = parseUiNodes(dumpUiHierarchy(deviceId, "h").xml);
    const bell = nodes.find((n) =>
      /notifications/i.test(`${n.contentDesc || ""} ${n.text || ""}`)
    );
    if (bell?.bounds) tapBounds(bell.bounds, deviceId);
    else {
      await tapText(["Notifications"], {
        deviceId,
        timeoutMs: 5000,
        label: "bell",
      }).catch(() => false);
    }
    await sleep(2500);
    const b = blob(deviceId);
    if (
      b.includes("ecosort") ||
      b.includes("read reward") ||
      b.includes("for reading")
    ) {
      shot(deviceId, `${tag}-inbox.png`);
      return {
        ok: true,
        hasEco: b.includes("ecosort"),
        hasRead: b.includes("read reward") || b.includes("for reading"),
        sample: b.slice(0, 500),
      };
    }
  }
  shot(deviceId, `${tag}-fail.png`);
  return { ok: false, sample: blob(deviceId).slice(0, 300) };
}

async function main() {
  const deviceId = getAdbDevice();
  const p1 = await openInbox(deviceId, "p1");
  const p2 = await openInbox(deviceId, "p2");
  const ok = p1.ok && p2.ok;
  const summary = { ok, p1, p2, out: OUT };
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (!ok) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
