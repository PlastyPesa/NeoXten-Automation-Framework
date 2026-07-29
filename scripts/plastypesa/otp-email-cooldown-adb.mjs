#!/usr/bin/env node
/**
 * ADB × P-OTP-EMAIL-COOLDOWN — signup-fold path + primed email → cooldown toast/hint.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { getConfig, url } from "./config.mjs";
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
const cfg = getConfig();
const PKG = "com.app.plasty_pesa";
const OUT_DIR = join(
  process.cwd(),
  ".neoxten",
  "proof",
  `otp-email-cooldown-adb-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);

const NEEDLES = [
  "wait a moment",
  "too many codes",
  "15 minutes",
  "please wait",
];

function decodeUi(value) {
  return String(value || "")
    .replace(/&#10;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\n/g, " ");
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

function launch(deviceId) {
  spawnSync("adb", ["-s", deviceId, "shell", "am", "force-stop", PKG], {
    stdio: "pipe",
  });
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
}

function uiBlob(nodes) {
  return nodes
    .map((n) => decodeUi(`${n.text || ""} ${n.contentDesc || ""}`))
    .join(" | ");
}

function findExactLabel(nodes, labels) {
  const wants = labels.map(normalizeText).filter(Boolean);
  for (const n of nodes) {
    if (n.packageName !== PKG || !n.bounds) continue;
    const hay = [n.text, n.contentDesc]
      .map((v) => normalizeText(decodeUi(v)))
      .filter(Boolean);
    for (const h of hay) {
      if (wants.includes(h) || wants.some((w) => h === `${w} ${w}`)) return n;
    }
  }
  return null;
}

async function waitTap(deviceId, labels, { timeoutMs = 15000 } = {}) {
  const start = Date.now();
  const expanded = labels.flatMap((l) => [l, decodeUi(l)]);
  while (Date.now() - start < timeoutMs) {
    const nodes = parseUiNodes(dumpUiHierarchy(deviceId, "wt").xml);
    let n = findNodeByText(nodes, expanded, { packageName: PKG });
    if (!n?.bounds) n = findExactLabel(nodes, labels);
    if (!n?.bounds) {
      n = nodes.find((node) => {
        if (node.packageName !== PKG || !node.bounds || !node.clickable)
          return false;
        const h = normalizeText(decodeUi(node.contentDesc || node.text || ""));
        return labels.some((l) => h.includes(normalizeText(decodeUi(l))));
      });
    }
    if (n?.bounds) {
      console.log("tap", labels[0], decodeUi(n.contentDesc || n.text));
      tapBounds(n.bounds, { deviceId });
      await sleep(1200);
      return true;
    }
    await sleep(700);
  }
  return false;
}

function isLoginScreen(nodes) {
  const blob = uiBlob(nodes);
  const hasEmail = nodes.some(
    (n) =>
      n.packageName === PKG &&
      n.className === "android.widget.EditText" &&
      !n.password &&
      n.bounds,
  );
  const hasPass = nodes.some(
    (n) =>
      n.packageName === PKG &&
      n.className === "android.widget.EditText" &&
      n.password &&
      n.bounds,
  );
  return (
    hasEmail &&
    hasPass &&
    /sign up|înregistrează|registrati|registrarse|anmelden|s'inscrire|inscrever/i.test(
      blob,
    )
  );
}

async function reachLogin(deviceId) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const nodes = parseUiNodes(dumpUiHierarchy(deviceId, "reach").xml);
    const blob = uiBlob(nodes);
    if (isLoginScreen(nodes)) return true;
    if (/privacy|usage analytics|save &/i.test(blob)) {
      await waitTap(deviceId, ["Save & continue", "Save & Continue"]);
      continue;
    }
    if (/choose your language|elige tu idioma|scegli|wähle|choisis|escolha|alege/i.test(blob)) {
      // Force English so later CTAs match EN labels.
      await waitTap(deviceId, ["English"], { timeoutMs: 5000 });
      await waitTap(deviceId, [
        "Continue",
        "Continuar",
        "Continua",
        "Weiter",
        "Continuer",
        "Continuați",
      ]);
      continue;
    }
    if (findExactLabel(nodes, ["Skip", "Next"])) {
      // Prefer Skip when present to cut carousel length.
      if (!(await waitTap(deviceId, ["Skip"], { timeoutMs: 2500 }))) {
        await waitTap(deviceId, ["Next"], { timeoutMs: 2500 });
      }
      continue;
    }
    if (/get started|welcome back/i.test(blob)) {
      await waitTap(deviceId, ["Get Started", "Get started", "Login"], {
        timeoutMs: 4000,
      });
      continue;
    }
    if (findExactLabel(nodes, ["Profile", "Home", "Learn"])) {
      const tab = findExactLabel(nodes, ["Profile"]);
      if (tab?.bounds) {
        tapBounds(tab.bounds, { deviceId });
        await sleep(1000);
        for (let i = 0; i < 5; i += 1) {
          spawnSync("adb", [
            "-s",
            deviceId,
            "shell",
            "input",
            "swipe",
            "360",
            "1200",
            "360",
            "400",
            "400",
          ]);
          await sleep(500);
          if (
            await waitTap(deviceId, ["Sign Out", "Sign out"], { timeoutMs: 3000 })
          ) {
            await waitTap(deviceId, ["Sign Out", "Confirm", "Yes", "OK"], {
              timeoutMs: 4000,
            });
            await sleep(1500);
            break;
          }
        }
      }
      continue;
    }
    await sleep(900);
  }
  return false;
}

async function typeEmail(deviceId, email) {
  const nodes = parseUiNodes(dumpUiHierarchy(deviceId, "email-field").xml);
  const field = nodes.find(
    (n) =>
      n.packageName === PKG &&
      n.className === "android.widget.EditText" &&
      !n.password &&
      n.bounds,
  );
  if (!field?.bounds) throw new Error("email field missing");
  tapBounds(field.bounds, { deviceId });
  await sleep(400);
  spawnSync(
    "adb",
    ["-s", deviceId, "shell", "input", "keyevent", "KEYCODE_MOVE_END"],
    { stdio: "pipe" },
  );
  for (let i = 0; i < 50; i++) {
    spawnSync("adb", ["-s", deviceId, "shell", "input", "keyevent", "67"], {
      stdio: "pipe",
    });
  }
  // `input text` treats %40 literally on this device — use clipboard paste.
  spawnSync(
    "adb",
    ["-s", deviceId, "shell", "cmd", "clipboard", "set", "--user", "0", email],
    { stdio: "pipe" },
  );
  await sleep(200);
  spawnSync(
    "adb",
    ["-s", deviceId, "shell", "input", "keyevent", "279"],
    { stdio: "pipe" },
  ); // KEYCODE_PASTE
  await sleep(400);
  // Fallback if paste failed: escape @ for input text
  const check = parseUiNodes(dumpUiHierarchy(deviceId, "email-check").xml);
  const blob = uiBlob(check);
  if (!blob.toLowerCase().includes(email.split("@")[0].toLowerCase()) || blob.includes("%40")) {
    const escaped = email.replace(/@/g, "\\@");
    spawnSync("adb", ["-s", deviceId, "shell", "input", "text", escaped], {
      stdio: "pipe",
    });
  }
}

function cooldownVisible(nodes) {
  const blob = uiBlob(nodes).toLowerCase();
  return NEEDLES.find((n) => blob.includes(n.toLowerCase())) || null;
}

async function primeApi(email) {
  const res = await fetch(url(cfg, "/auth/send-otp"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, type: "REGISTER" }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function navigateToEmailScreen(deviceId) {
  // Clean slate — language/onboarding is otherwise sticky across force-stops.
  spawnSync(
    "adb",
    ["-s", deviceId, "shell", "pm", "clear", PKG],
    { stdio: "pipe" },
  );
  await sleep(1500);
  launch(deviceId);
  await sleep(8000);
  if (!(await reachLogin(deviceId))) {
    shot(deviceId, "fail-login.png");
    throw new Error("Could not reach login");
  }
  if (
    !(await waitTap(
      deviceId,
      [
        "Sign Up",
        "sign up",
        "Sign up",
        "Înregistrează-te",
        "Regístrate",
        "Registrarse",
        "Registrati",
        "S'inscrire",
        "Inscrever-se",
        "Registrieren",
        "Create account",
      ],
      { timeoutMs: 20000 },
    ))
  ) {
    shot(deviceId, "fail-signup-link.png");
    throw new Error("Sign Up missing");
  }
  await sleep(800);
  await waitTap(deviceId, [
    "Continue",
    "Continuar",
    "Continua",
    "Weiter",
    "Continuer",
  ], { timeoutMs: 10000 });
  await sleep(800);
  await waitTap(deviceId, ["I live in Kenya — weekly M-Pesa rewards", "Kenya"], {
    timeoutMs: 8000,
  });
  await sleep(600);
  await waitTap(deviceId, [
    "Continue",
    "Continuar",
    "Continua",
    "Weiter",
    "Continuer",
  ], { timeoutMs: 8000 });
  await sleep(1200);
}

async function runOnce(deviceId, label) {
  const email = `adb.otp.cd${Date.now()}@gmail.com`;
  await navigateToEmailScreen(deviceId);
  const prime = await primeApi(email);
  console.log(label, "prime", prime.status, prime.body?.message || prime.body?.code);
  if (prime.status !== 200) {
    throw new Error(`prime failed ${prime.status}`);
  }

  await typeEmail(deviceId, email);
  await sleep(500);
  shot(deviceId, `${label}-before-verify.png`);

  if (
    !(await waitTap(
      deviceId,
      ["Verify OTP", "Verify", "Verifică OTP", "Verifica", "Send code"],
      { timeoutMs: 12000 },
    ))
  ) {
    throw new Error("Verify CTA missing");
  }

  // Hide keyboard so persistent hint + toast are visible to uiautomator.
  spawnSync(
    "adb",
    ["-s", deviceId, "shell", "input", "keyevent", "KEYCODE_BACK"],
    { stdio: "pipe" },
  );
  await sleep(900);

  // Persistent loginErrorHint on UserCheckScreen + toast — poll several seconds
  let hit = null;
  for (let i = 0; i < 12; i++) {
    await sleep(600);
    const nodes = parseUiNodes(dumpUiHierarchy(deviceId, `${label}-poll-${i}`).xml);
    hit = cooldownVisible(nodes);
    if (hit) break;
  }
  const shotPath = shot(deviceId, `${label}.png`);
  const nodes = parseUiNodes(dumpUiHierarchy(deviceId, `${label}-final`).xml);
  if (!hit) hit = cooldownVisible(nodes);

  writeFileSync(
    join(OUT_DIR, `${label}.json`),
    JSON.stringify(
      {
        email,
        prime,
        hit,
        blobSample: uiBlob(nodes).slice(0, 1000),
      },
      null,
      2,
    ),
  );
  return { email, hit, shotPath, prime };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const deviceId = getAdbDevice();
  if (!deviceId) throw new Error("No ADB device");

  const a = await runOnce(deviceId, "pass1");
  await sleep(1000);
  const b = await runOnce(deviceId, "pass2");

  const ok = Boolean(a.hit && b.hit);
  const summary = {
    ok,
    a: { hit: a.hit, shot: a.shotPath },
    b: { hit: b.hit, shot: b.shotPath },
    out: OUT_DIR,
  };
  writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (!ok) {
    console.error("FAIL: cooldown copy not visible — see screenshots");
    process.exit(1);
  }
  console.log("PASS", OUT_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
