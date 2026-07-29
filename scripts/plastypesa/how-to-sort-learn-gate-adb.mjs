#!/usr/bin/env node
/**
 * ADB × P-HOW-TO-SORT-VIDEO — reach Sort learn gate; prove EN + Kiswahili chips.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { loadMobileAppUserCredentials } from "./credential-registry.mjs";
import {
  dumpUiHierarchy,
  parseUiNodes,
  sleep,
  getAdbDevice,
  tapBounds,
  findNodeByText,
  normalizeText,
  tapText,
  typeText,
  swipeUp,
  buildTextCandidates,
} from "./localization/adb-ui.mjs";

bootstrapPlastyPesaEnv();
const PKG = "com.app.plasty_pesa";
const OUT_DIR = join(
  process.cwd(),
  ".neoxten",
  "proof",
  `how-to-sort-gate-adb-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);

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

function findPasswordEditBounds(nodes) {
  for (const n of nodes) {
    if (n.className === "android.widget.EditText" && n.password && n.bounds) {
      return n.bounds;
    }
  }
  return null;
}

function findFirstPlainEditBounds(nodes) {
  for (const n of nodes) {
    if (
      n.packageName === PKG &&
      n.className === "android.widget.EditText" &&
      !n.password &&
      n.bounds
    ) {
      return n.bounds;
    }
  }
  return null;
}

function findLoginButtonBounds(nodes) {
  for (const n of nodes) {
    if (n.className !== "android.widget.Button" || !n.bounds) continue;
    const d = normalizeText(n.contentDesc || n.text || "");
    if (d === "login" || d.includes("log in") || d.includes("sign in")) {
      return n.bounds;
    }
  }
  return null;
}

function clearFocusedField(deviceId) {
  spawnSync(
    "adb",
    [
      "-s",
      deviceId,
      "shell",
      "input",
      "keyevent",
      "123",
      ...Array.from({ length: 96 }, () => "67"),
    ],
    { stdio: "pipe" },
  );
}

async function ensureLoggedIn(deviceId, mobile) {
  let nodes = parseUiNodes(dumpUiHierarchy(deviceId, "hts-probe").xml);
  let blob = uiBlob(nodes);
  if (
    blob.includes("leaderboard") ||
    blob.includes("quizzes") ||
    blob.includes("sort") ||
    blob.includes("home") ||
    blob.includes("clasament")
  ) {
    console.log("already on main shell");
    return;
  }

  if (blob.includes("choose your language") || blob.includes("continue")) {
    await tapText(["Continue", "Continuă", "Continuar", "Weiter", "Continuer"], {
      deviceId,
      timeoutMs: 12000,
      label: "language-continue",
    });
    await sleep(1200);
  }

  for (let step = 0; step < 2; step += 1) {
    const next = await tapText(
      ["Next", "Următorul", "Weiter", "Siguiente", "Suivant", "Avanti", "Próximo"],
      { deviceId, timeoutMs: 8000, label: `onboarding-next-${step}` },
    );
    if (!next) break;
    await sleep(900);
  }
  await tapText(
    [
      "Get Started",
      "Get started",
      "Începe",
      "Inizia",
      "Comenzar",
      "Commencer",
      "Loslegen",
      "Começar",
      "Skip",
    ],
    { deviceId, timeoutMs: 10000, label: "onboarding-done" },
  );
  await sleep(2000);

  nodes = parseUiNodes(dumpUiHierarchy(deviceId, "hts-post-onb").xml);
  blob = uiBlob(nodes);
  if (
    blob.includes("leaderboard") ||
    blob.includes("quizzes") ||
    blob.includes("clasament")
  ) {
    console.log("session restored after onboarding");
    return;
  }

  // Login form
  await tapText(
    buildTextCandidates(["enter_email"], ["Email", "E-mail", "Enter Email"]),
    { deviceId, timeoutMs: 12000, label: "email-label" },
  );
  let emailBounds = findFirstPlainEditBounds(
    parseUiNodes(dumpUiHierarchy(deviceId, "hts-email").xml),
  );
  if (emailBounds) {
    tapBounds(emailBounds, { deviceId });
    await sleep(400);
    clearFocusedField(deviceId);
    await typeText(mobile.email, { deviceId, perCharacter: true, charDelayMs: 28 });
  }
  await sleep(600);
  await tapText(
    buildTextCandidates(["enter_password"], ["Password", "Parolă", "Parola"]),
    { deviceId, timeoutMs: 10000, label: "password-label" },
  );
  const pwdBounds = findPasswordEditBounds(
    parseUiNodes(dumpUiHierarchy(deviceId, "hts-pwd").xml),
  );
  if (pwdBounds) {
    tapBounds(pwdBounds, { deviceId });
    await sleep(300);
  }
  clearFocusedField(deviceId);
  await typeText(mobile.password, { deviceId, perCharacter: true, charDelayMs: 35 });
  await sleep(500);
  spawnSync("adb", ["-s", deviceId, "shell", "input", "keyevent", "4"], {
    stdio: "pipe",
  });
  await sleep(500);
  await swipeUp({ deviceId });
  await sleep(400);
  nodes = parseUiNodes(dumpUiHierarchy(deviceId, "hts-pre-login").xml);
  const loginB = findLoginButtonBounds(nodes);
  if (loginB) {
    tapBounds(loginB, { deviceId });
  } else {
    await tapText(
      ["Login", "Log in", "Sign In", "Conectează-te", "Entrar"],
      { deviceId, timeoutMs: 10000, label: "login-btn" },
    );
  }
  await sleep(7000);
}

async function openSortLearnGate(deviceId) {
  // Dismiss kenya / tips if any
  await tapText(["Got it", "OK", "Dismiss", "Close"], {
    deviceId,
    timeoutMs: 4000,
    label: "dismiss-tip",
  });

  // Bottom nav / home cards
  let openedNav = await tapText(
    ["Sort", "Sort & Earn", "Sortează", "Sortieren", "Trier", "Separar"],
    { deviceId, timeoutMs: 12000, label: "nav-sort" },
  );
  if (!openedNav) {
    await tapText(["Home", "Acasă", "Início"], {
      deviceId,
      timeoutMs: 6000,
      label: "nav-home",
    });
    openedNav = await tapText(
      ["Sort", "Sort & Earn", "Sortează", "Sortieren"],
      { deviceId, timeoutMs: 10000, label: "nav-sort-2" },
    );
  }
  await sleep(2500);
  shot(deviceId, "03-sort-screen.png");

  // Required banner CTA or optional rewatch
  const opened =
    (await tapText(
      [
        "Tap to watch",
        "Tippen zum Ansehen",
        "Atinge pentru a urmări",
        "Watch again",
        "Nochmal ansehen",
        "Vezi din nou",
        "Rewatch",
        "How-to-Sort video",
        "How-to-Sort-Video",
      ],
      { deviceId, timeoutMs: 12000, label: "open-gate" },
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
      { deviceId, timeoutMs: 8000, label: "open-gate-title" },
    ));

  await sleep(3500);
  shot(deviceId, "04-learn-gate.png");
  return opened;
}

function gateSignals(nodes) {
  const blob = uiBlob(nodes);
  // Must NOT be the app language picker
  const languagePicker =
    blob.includes("choose your language") ||
    blob.includes("pick the language you want");
  const hasEnChip = /\benglish\b/.test(blob);
  const hasSwChip = blob.includes("kiswahili") || /\bswahili\b/.test(blob);
  const hasTitle =
    blob.includes("how to sort") ||
    blob.includes("cum să sortezi") ||
    blob.includes("so sortierst") ||
    blob.includes("como separar") ||
    blob.includes("come separare") ||
    blob.includes("comment trier") ||
    blob.includes("como separar");
  const hasFinish =
    blob.includes("i've finished") ||
    blob.includes("finished") ||
    blob.includes("fertig") ||
    blob.includes("am terminat") ||
    blob.includes("done");
  return {
    languagePicker,
    hasEnChip,
    hasSwChip,
    hasTitle,
    hasFinish,
    blobSample: blob.slice(0, 400),
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const deviceId = getAdbDevice();
  const mobile = loadMobileAppUserCredentials();
  console.log("device", deviceId);

  // Keep Chrome/WebView consent from stealing focus during ADB taps.
  spawnSync("adb", ["-s", deviceId, "shell", "am", "force-stop", "com.android.chrome"], {
    stdio: "pipe",
  });
  spawnSync("adb", ["-s", deviceId, "shell", "am", "force-stop", PKG], {
    stdio: "pipe",
  });
  await sleep(800);
  spawnSync(
    "adb",
    [
      "-s",
      deviceId,
      "shell",
      "am",
      "start",
      "-n",
      `${PKG}/.MainActivity`,
    ],
    { stdio: "pipe" },
  );
  await sleep(8000);
  shot(deviceId, "01-launch.png");
  const focus = spawnSync(
    "adb",
    ["-s", deviceId, "shell", "dumpsys", "window", "windows"],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  const focusTxt = focus.stdout || "";
  if (!focusTxt.includes(PKG)) {
    console.warn("WARN: app may not be focused — retrying am start");
    spawnSync(
      "adb",
      ["-s", deviceId, "shell", "am", "start", "-n", `${PKG}/.MainActivity`],
      { stdio: "pipe" },
    );
    await sleep(4000);
  }

  await ensureLoggedIn(deviceId, mobile);
  shot(deviceId, "02-after-login.png");

  const opened = await openSortLearnGate(deviceId);
  let nodes = parseUiNodes(dumpUiHierarchy(deviceId, "hts-gate").xml);
  let sig = gateSignals(nodes);

  // Owner lock 2026-07-29: EN only — no Kiswahili chip (locale toggle hidden).
  const ok =
    opened && !sig.languagePicker && sig.hasTitle && !sig.hasSwChip;

  const summary = {
    ok,
    opened,
    ...sig,
    outDir: OUT_DIR,
    at: new Date().toISOString(),
  };
  writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (!ok) process.exit(1);
  console.log("PASS", OUT_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
