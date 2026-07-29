/**
 * ADB ×2: bottom-nav Learn → Videos → How to Sort (English) → Fullscreen expand.
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
  tapBounds,
  findNodeByText,
  normalizeText,
} from "./localization/adb-ui.mjs";

bootstrapPlastyPesaEnv();
const PKG = "com.app.plasty_pesa";
const OUT = join(
  process.cwd(),
  ".neoxten",
  "proof",
  `learn-video-fullscreen-adb-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);
mkdirSync(OUT, { recursive: true });

const LEARN_LABELS = [
  "Learn",
  "Învață",
  "Invata",
  "Impara",
  "Aprender",
  "Lernen",
  "Apprendre",
];

function decodeUi(value) {
  return String(value || "")
    .replace(/&#10;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\n/g, " ");
}

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

function findBottomTab(nodes, labels) {
  const wants = labels.map(normalizeText).filter(Boolean);
  let best = null;
  for (const n of nodes) {
    if (n.packageName !== PKG || !n.bounds) continue;
    // Bottom nav only — ignore mid-screen "Read & Learn" / similar.
    if (n.bounds.top < 1300) continue;
    const hay = [n.text, n.contentDesc]
      .map((v) => normalizeText(decodeUi(v)))
      .filter(Boolean);
    for (const h of hay) {
      const exact = wants.some(
        (w) => h === w || h === `${w} ${w}` || h.startsWith(`${w} `),
      );
      if (exact) {
        // Prefer clickable; still allow Semantics-labeled non-clickable children.
        if (
          !best ||
          (n.clickable && !best.clickable) ||
          n.bounds.top > best.bounds.top
        ) {
          best = n;
        }
      }
    }
  }
  return best;
}

async function tapLearnTab(deviceId) {
  const start = Date.now();
  while (Date.now() - start < 25000) {
    const nodes = parseUiNodes(dumpUiHierarchy(deviceId, "learn-tab").xml);
    const n = findBottomTab(nodes, LEARN_LABELS);
    if (n?.bounds) {
      tapBounds(n.bounds, { deviceId });
      await sleep(2000);
      const after = blob(parseUiNodes(dumpUiHierarchy(deviceId, "after-learn").xml));
      if (
        after.includes("daily tip") ||
        after.includes("videos") ||
        after.includes("how to sort") ||
        after.includes("sfatul") ||
        after.includes("articles")
      ) {
        return true;
      }
      // Fallback: raw coordinate tap near Learn slot (2nd of 5 tabs).
      spawnSync(
        "adb",
        ["-s", deviceId, "shell", "input", "tap", `${n.bounds.centerX}`, `${n.bounds.centerY}`],
        { stdio: "pipe" },
      );
      await sleep(2000);
      return true;
    }
    await sleep(500);
  }
  return false;
}

function resetPortrait(deviceId) {
  // Fullscreen player unlocks landscape; force portrait before next pass.
  spawnSync(
    "adb",
    ["-s", deviceId, "shell", "settings", "put", "system", "user_rotation", "0"],
    { stdio: "pipe" },
  );
  spawnSync(
    "adb",
    [
      "-s",
      deviceId,
      "shell",
      "settings",
      "put",
      "system",
      "accelerometer_rotation",
      "1",
    ],
    { stdio: "pipe" },
  );
  spawnSync(
    "adb",
    ["-s", deviceId, "shell", "wm", "set-user-rotation", "free"],
    { stdio: "pipe" },
  );
}

async function onePass(deviceId, tag) {
  spawnSync("adb", ["-s", deviceId, "shell", "input", "keyevent", "4"], {
    stdio: "pipe",
  });
  await sleep(400);
  spawnSync("adb", ["-s", deviceId, "shell", "am", "force-stop", PKG], {
    stdio: "pipe",
  });
  resetPortrait(deviceId);
  await sleep(800);
  spawnSync(
    "adb",
    ["-s", deviceId, "shell", "am", "start", "-n", `${PKG}/.MainActivity`],
    { stdio: "pipe" },
  );
  await sleep(11000);
  shot(deviceId, `${tag}-01-launch.png`);

  const learnOk = await tapLearnTab(deviceId);
  if (!learnOk) {
    return { ok: false, step: "learn-tab", sample: "" };
  }
  await sleep(2000);
  shot(deviceId, `${tag}-02-learn.png`);

  for (let i = 0; i < 5; i += 1) {
    const nodes = parseUiNodes(dumpUiHierarchy(deviceId, "learn").xml);
    const b = blob(nodes);
    if (
      b.includes("how to sort") ||
      b.includes("videos") ||
      b.includes("videoclipuri") ||
      b.includes("daily tip")
    ) {
      if (b.includes("how to sort") || b.includes("videos")) break;
    }
    spawnSync(
      "adb",
      ["-s", deviceId, "shell", "input", "swipe", "540", "1400", "540", "600", "280"],
      { stdio: "pipe" },
    );
    await sleep(700);
  }
  shot(deviceId, `${tag}-03-videos.png`);

  const opened = await tapText(
    ["How to Sort (English)", "How to Sort"],
    { deviceId, timeoutMs: 12000, label: "open-clip", packageName: PKG },
  ).catch(() => false);
  await sleep(5000);
  shot(deviceId, `${tag}-04-player.png`);

  const list = parseUiNodes(dumpUiHierarchy(deviceId, "player").xml);
  const b = blob(list);
  const expand = list.find((n) =>
    /fullscreen/i.test(`${n.text || ""} ${n.contentDesc || ""}`)
  );
  const hasExpand = !!expand;
  let enteredFs = false;
  if (expand?.bounds) {
    tapBounds(expand.bounds, { deviceId });
    await sleep(2200);
    shot(deviceId, `${tag}-05-fullscreen.png`);
    enteredFs = true;
    // Exit fullscreen (close X) so next pass starts portrait on Home.
    const fsNodes = parseUiNodes(dumpUiHierarchy(deviceId, "fs").xml);
    const close = fsNodes.find(
      (n) =>
        n.clickable &&
        n.bounds &&
        (n.bounds.top < 120 || /close|back/i.test(`${n.text || ""} ${n.contentDesc || ""}`)),
    );
    if (close?.bounds) tapBounds(close.bounds, { deviceId });
    else {
      spawnSync("adb", ["-s", deviceId, "shell", "input", "keyevent", "4"], {
        stdio: "pipe",
      });
    }
    await sleep(1000);
    resetPortrait(deviceId);
  }

  const onPlayer =
    b.includes("how to sort") ||
    b.includes("done") ||
    b.includes("fullscreen") ||
    b.includes("fertig") ||
    b.includes("gata");

  return {
    ok: Boolean(opened && onPlayer && hasExpand),
    opened: Boolean(opened),
    onPlayer,
    hasExpand,
    enteredFs,
    sample: b.slice(0, 450),
  };
}

async function main() {
  const deviceId = getAdbDevice();
  const r1 = await onePass(deviceId, "pass1");
  const r2 = await onePass(deviceId, "pass2");
  const out = { ok: r1.ok && r2.ok, r1, r2, out: OUT };
  writeFileSync(join(OUT, "result.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  if (!out.ok) process.exit(1);
  console.log("PASS", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
