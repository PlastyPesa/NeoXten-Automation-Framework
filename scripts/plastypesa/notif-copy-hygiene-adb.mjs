/**
 * ADB ×2: open Notifications inbox and prove UI has no mojibake â€"
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
  `notif-copy-hygiene-adb-${new Date().toISOString().replace(/[:.]/g, "-")}`
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
    .join(" | ");
}

function looksLikeInbox(b) {
  const lower = b.toLowerCase();
  // Must leave Home chrome — inbox usually drops the bottom nav labels density
  // or shows notification row copy / empty state.
  if (/pending review|sort by grade|sort proof|ecosort|read reward|for reading|no notifications|inbox|mark all/i.test(b)) {
    return true;
  }
  // Opened notifications route often loses "Earn M-Pesa this week" hero
  if (
    /notifications/i.test(lower) &&
    !/earn m-pesa this week/i.test(lower) &&
    !/see top 10 this week/i.test(lower)
  ) {
    return true;
  }
  return false;
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

  for (let i = 0; i < 6; i += 1) {
    const nodes = parseUiNodes(dumpUiHierarchy(deviceId, "h").xml);
    const bell = nodes.find((n) => {
      const s = `${n.contentDesc || ""} ${n.text || ""}`;
      return /^notifications$/i.test(s.trim()) || /notifications/i.test(n.contentDesc || "");
    });
    if (bell?.bounds) tapBounds(bell.bounds, deviceId);
    else {
      await tapText(["Notifications"], {
        deviceId,
        timeoutMs: 5000,
        label: "bell",
      }).catch(() => false);
    }
    await sleep(3000);
    const b = blob(deviceId);
    if (looksLikeInbox(b)) {
      shot(deviceId, `${tag}-inbox.png`);
      const hasMojibake =
        b.includes("â€") || b.includes("â€”") || /Ã¢â‚¬/.test(b);
      return {
        ok: !hasMojibake,
        hasMojibake,
        hasPendingClean: /pending review\s*-\s*you will be notified/i.test(b),
        sample: b.slice(0, 700),
      };
    }
  }
  shot(deviceId, `${tag}-fail.png`);
  return {
    ok: false,
    reason: "inbox_not_opened",
    sample: blob(deviceId).slice(0, 400),
  };
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
