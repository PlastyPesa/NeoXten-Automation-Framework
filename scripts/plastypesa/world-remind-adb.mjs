/**
 * ADB ×2: Learn → Videos → How to Sort (English) → Done → Kenya world remind dialog.
 * Clears kenyaWorldRemindAt for the NeoXten mobile test user before each pass.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { MongoClient } from "mongodb";
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { loadMobileAppUserCredentials } from "./credential-registry.mjs";
import { loadBackendMongoEnv } from "./mongo-env.mjs";
import {
  dumpUiHierarchy,
  parseUiNodes,
  sleep,
  getAdbDevice,
  tapText,
  tapBounds,
  normalizeText,
} from "./localization/adb-ui.mjs";

bootstrapPlastyPesaEnv();
const PKG = "com.app.plasty_pesa";
const OUT = join(
  process.cwd(),
  ".neoxten",
  "proof",
  `world-remind-adb-${new Date().toISOString().replace(/[:.]/g, "-")}`,
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
    if (n.bounds.top < 1300) continue;
    const hay = [n.text, n.contentDesc]
      .map((v) => normalizeText(decodeUi(v)))
      .filter(Boolean);
    for (const h of hay) {
      const exact = wants.some(
        (w) => h === w || h === `${w} ${w}` || h.startsWith(`${w} `),
      );
      if (exact) {
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

async function clearRemindCooldown(email) {
  const client = new MongoClient(loadBackendMongoEnv(), {
    serverSelectionTimeoutMS: 15000,
  });
  await client.connect();
  const db = client.db("plasty-pesa-prod");
  const r = await db
    .collection("users")
    .updateOne({ email }, { $unset: { kenyaWorldRemindAt: "" } });
  const user = await db.collection("users").findOne(
    { email },
    { projection: { countryCode: 1, market: 1, signupMarket: 1, email: 1 } },
  );
  await client.close();
  return { matched: r.matchedCount, modified: r.modifiedCount, user };
}

async function tapLearnTab(deviceId) {
  const start = Date.now();
  while (Date.now() - start < 25000) {
    const nodes = parseUiNodes(dumpUiHierarchy(deviceId, "learn-tab").xml);
    const n = findBottomTab(nodes, LEARN_LABELS);
    if (n?.bounds) {
      tapBounds(n.bounds, { deviceId });
      await sleep(2000);
      const after = blob(
        parseUiNodes(dumpUiHierarchy(deviceId, "after-learn").xml),
      );
      if (
        after.includes("daily tip") ||
        after.includes("videos") ||
        after.includes("how to sort") ||
        after.includes("articles") ||
        after.includes("sfatul")
      ) {
        return true;
      }
      spawnSync(
        "adb",
        [
          "-s",
          deviceId,
          "shell",
          "input",
          "tap",
          `${n.bounds.centerX}`,
          `${n.bounds.centerY}`,
        ],
        { stdio: "pipe" },
      );
      await sleep(2200);
      const after2 = blob(
        parseUiNodes(dumpUiHierarchy(deviceId, "after-learn2").xml),
      );
      if (
        after2.includes("daily tip") ||
        after2.includes("videos") ||
        after2.includes("how to sort") ||
        after2.includes("articles")
      ) {
        return true;
      }
    }
    await sleep(500);
  }
  return false;
}

async function onePass(deviceId, tag, email) {
  const cleared = await clearRemindCooldown(email);
  spawnSync("adb", ["-s", deviceId, "shell", "input", "keyevent", "4"], {
    stdio: "pipe",
  });
  await sleep(300);
  spawnSync("adb", ["-s", deviceId, "shell", "am", "force-stop", PKG], {
    stdio: "pipe",
  });
  await sleep(700);
  spawnSync(
    "adb",
    ["-s", deviceId, "shell", "am", "start", "-n", `${PKG}/.MainActivity`],
    { stdio: "pipe" },
  );
  await sleep(15000);
  shot(deviceId, `${tag}-01-launch.png`);

  if (!(await tapLearnTab(deviceId))) {
    return { ok: false, step: "learn-tab", cleared };
  }
  await sleep(1800);
  shot(deviceId, `${tag}-02-learn.png`);

  for (let i = 0; i < 4; i += 1) {
    const b = blob(parseUiNodes(dumpUiHierarchy(deviceId, "scroll").xml));
    if (b.includes("how to sort") || b.includes("videos")) break;
    spawnSync(
      "adb",
      ["-s", deviceId, "shell", "input", "swipe", "540", "1400", "540", "600", "280"],
      { stdio: "pipe" },
    );
    await sleep(600);
  }

  const opened = await tapText(
    ["How to Sort (English)", "How to Sort"],
    { deviceId, timeoutMs: 12000, label: "open-clip", packageName: PKG },
  ).catch(() => false);
  await sleep(4500);
  shot(deviceId, `${tag}-03-player.png`);

  let done = false;
  const doneStart = Date.now();
  while (Date.now() - doneStart < 12000) {
    const playerNodes = parseUiNodes(dumpUiHierarchy(deviceId, "done-hunt").xml);
    const doneNode = playerNodes.find((n) => {
      if (n.packageName !== PKG || !n.bounds) return false;
      const hay = `${n.text || ""} ${n.contentDesc || ""}`.toLowerCase();
      return (
        /\bdone\b/.test(hay) ||
        hay.includes("gata") ||
        hay.includes("fertig") ||
        hay.includes("terminé") ||
        hay.includes("listo")
      );
    });
    if (doneNode?.bounds) {
      tapBounds(doneNode.bounds, { deviceId });
      done = true;
      break;
    }
    await sleep(400);
  }
  if (!done) {
    done = await tapText(["Done", "Gata", "Fertig", "Terminé", "Listo"], {
      deviceId,
      timeoutMs: 4000,
      label: "done",
      packageName: PKG,
    }).catch(() => false);
  }
  await sleep(2800);
  shot(deviceId, `${tag}-04-after-done.png`);

  const nodes = parseUiNodes(dumpUiHierarchy(deviceId, "remind").xml);
  const b = blob(nodes);
  const hasRemind =
    b.includes("kenya leading the way") ||
    b.includes("kenya deschide") ||
    b.includes("kenya_world_remind") ||
    b.includes("among the few") ||
    b.includes("leading the way");

  // Dismiss if shown so next pass is clean.
  if (hasRemind) {
    await tapText(["Keep going", "Continua", "Continuar", "Weiter so", "Continuă"], {
      deviceId,
      timeoutMs: 4000,
      label: "dismiss-remind",
      packageName: PKG,
    }).catch(() => false);
    await sleep(800);
  }

  return {
    ok: Boolean(opened && done && hasRemind),
    opened: Boolean(opened),
    done: Boolean(done),
    hasRemind,
    cleared,
    sample: b.slice(0, 500),
  };
}

async function main() {
  const deviceId = getAdbDevice();
  const creds = loadMobileAppUserCredentials();
  const r1 = await onePass(deviceId, "pass1", creds.email);
  const r2 = await onePass(deviceId, "pass2", creds.email);
  const out = {
    ok: r1.ok && r2.ok,
    email: creds.email,
    r1,
    r2,
    out: OUT,
  };
  writeFileSync(join(OUT, "result.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  if (!out.ok) process.exit(1);
  console.log("PASS", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
