/**
 * ADB — Daily Quiz must show 1000 (not "full 0 points").
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
  `quiz-display-adb-${new Date().toISOString().replace(/[:.]/g, "-")}`,
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
  await sleep(600);
  spawnSync(
    "adb",
    ["-s", deviceId, "shell", "am", "start", "-n", `${PKG}/.MainActivity`],
    { stdio: "pipe" },
  );
  await sleep(8000);
  shot(deviceId, "01-launch.png");

  await tapText(["Got it", "OK", "Dismiss", "Close"], {
    deviceId,
    timeoutMs: 2500,
    label: "dismiss",
  }).catch(() => false);

  await tapText(["Home"], { deviceId, timeoutMs: 6000, label: "home-tab" });
  await sleep(1500);

  let opened = false;
  for (let i = 0; i < 10 && !opened; i += 1) {
    opened = await tapText(
      [
        "Daily Quiz, +1000",
        "Daily Quiz",
        "Quiz zilnic",
        "Tagesquiz",
        "Quiz du Jour",
        "Quiz Diario",
        "Quiz Giornaliero",
      ],
      { deviceId, timeoutMs: 2200, label: `quiz-tile-${i}` },
    ).catch(() => false);
    if (opened) break;
    spawnSync(
      "adb",
      ["-s", deviceId, "shell", "input", "swipe", "540", "1300", "540", "400", "300"],
      { stdio: "pipe" },
    );
    await sleep(450);
  }
  await sleep(4000);
  shot(deviceId, "02-quiz.png");

  const nodes = parseUiNodes(dumpUiHierarchy(deviceId, "quiz").xml);
  const b = blob(nodes);
  const onQuizScreen =
    b.includes("today") ||
    b.includes("daily quiz") ||
    b.includes("quiz_todays") ||
    b.includes("completed") ||
    b.includes("know your plastics") ||
    b.includes("once per day");
  const hasZero =
    b.includes("full 0 points") ||
    b.includes("full 0 ") ||
    (b.includes("+0") && !b.includes("+1000"));
  const hasThousand =
    b.includes("1000") ||
    b.includes("+1000") ||
    b.includes("1,000") ||
    b.includes("1.000");

  const ok = opened && onQuizScreen && hasThousand && !hasZero;
  const summary = {
    ok,
    opened,
    onQuizScreen,
    hasThousand,
    hasZero,
    out: OUT,
    sample: b.slice(0, 800),
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
