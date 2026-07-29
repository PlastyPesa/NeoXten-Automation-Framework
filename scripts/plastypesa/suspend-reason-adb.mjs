#!/usr/bin/env node
/**
 * ADB: suspend probe → login → assert reason-specific blocked screen → restore ACTIVE.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
    dumpUiHierarchy,
    parseUiNodes,
    typeText,
    sleep,
    getAdbDevice,
    tapBounds,
    findNodeByText,
    normalizeText,
} from "./localization/adb-ui.mjs";

const require = createRequire(import.meta.url);
try {
    require("dotenv").config({ path: join(process.cwd(), ".env.local") });
} catch {
    /* optional */
}

const PKG = "com.app.plasty_pesa";
const API =
    process.env.PLASTYPESA_API_BASE ||
    "https://qdvaw2vpck.execute-api.eu-west-2.amazonaws.com/prod/api";

const adminEmail = process.env.PLASTYPESA_ADMIN_EMAIL;
const adminPassword = process.env.PLASTYPESA_ADMIN_PASSWORD;
const probeEmail = process.env.PLASTYPESA_SUSPEND_PROBE_EMAIL;
const probePassword = process.env.PLASTYPESA_SUSPEND_PROBE_PASSWORD;
const probeId = process.env.PLASTYPESA_SUSPEND_PROBE_ID;
const reason = process.env.PLASTYPESA_SUSPEND_REASON || "MULTI_ACCOUNT";
const label = process.env.PLASTYPESA_PROOF_LABEL || "suspend-adb";

const OUT_DIR = join(process.cwd(), ".neoxten", "proof");
mkdirSync(OUT_DIR, { recursive: true });

const REASON_NEEDLES = {
    MULTI_ACCOUNT: [
        "multiple accounts",
        "same device",
        "mai multe conturi",
        "același dispozitiv",
        "acelasi dispozitiv",
    ],
    SORT_POLICY: ["sorting", "sort", "photo", "policy", "sortare", "fotograf"],
    OWNER_PAUSE: ["paused by plastypesa", "suspendat", "paused"],
};

function decodeUi(value) {
    return String(value || "")
        .replace(/&#10;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\n/g, " ");
}

function findExactLabel(nodes, labels) {
    const wants = labels.map(normalizeText).filter(Boolean);
    for (const n of nodes) {
        if (n.packageName !== PKG || !n.bounds) continue;
        const hay = [n.text, n.contentDesc]
            .map((v) => normalizeText(decodeUi(v)))
            .filter(Boolean);
        for (const h of hay) {
            if (wants.includes(h)) return n;
            if (wants.some((w) => h === `${w} ${w}` || h.startsWith(`${w} `)))
                return n;
        }
    }
    return null;
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

function clearFocusedField(deviceId) {
    spawnSync("adb", [
        "-s",
        deviceId,
        "shell",
        "input",
        "keyevent",
        "123",
        ...Array.from({ length: 96 }, () => "67"),
    ]);
}

function launch(deviceId) {
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
        { stdio: "inherit" }
    );
}

async function json(method, urlPath, { token, body } = {}) {
    const res = await fetch(`${API}${urlPath}`, {
        method,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
}

async function adminToken() {
    const { status, data } = await json("POST", "/auth/admin-login", {
        body: { email: adminEmail, password: adminPassword },
    });
    const token = data?.token || data?.data?.token;
    if (status !== 200 || !token) throw new Error("admin login failed");
    return token;
}

async function setStatus(token, status, suspensionReason) {
    const body = { id: probeId, status };
    if (suspensionReason) body.suspensionReason = suspensionReason;
    const out = await json("PUT", "/user/update", { token, body });
    if (out.status !== 200) throw new Error(JSON.stringify(out.data));
}

async function waitTap(deviceId, labels, { timeoutMs = 20000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const nodes = parseUiNodes(dumpUiHierarchy(deviceId, "wt").xml);
        let n = findNodeByText(nodes, labels, { packageName: PKG });
        if (!n?.bounds) n = findExactLabel(nodes, labels);
        if (n?.bounds) {
            tapBounds(n.bounds, { deviceId });
            await sleep(1400);
            return true;
        }
        await sleep(700);
    }
    return false;
}

function hasLoginFields(nodes) {
    const email = nodes.find(
        (n) =>
            n.packageName === PKG &&
            n.className === "android.widget.EditText" &&
            !n.password &&
            n.bounds
    );
    const pass = nodes.find(
        (n) =>
            n.packageName === PKG &&
            n.className === "android.widget.EditText" &&
            n.password &&
            n.bounds
    );
    return { email, pass };
}

function isLoggedInShell(nodes) {
    return Boolean(
        findExactLabel(nodes, [
            "Home",
            "Acasă",
            "Leaderboard",
            "Clasament",
            "Learn",
            "Învață",
            "Scan",
            "Community",
            "Profile",
            "Profil",
        ])
    );
}

const SIGN_OUT_LABELS = [
    "Sign Out",
    "Sign out",
    "Deconectare",
    "Abmelden",
    "Déconnexion",
    "Cerrar Sesión",
    "Sair",
    "Esci",
];
const PROFILE_LABELS = [
    "Profile",
    "Profil",
    "Profilo",
    "Perfil",
    "Profilul",
];

async function signOutIfNeeded(deviceId, nodes) {
    if (!isLoggedInShell(nodes)) return false;
    console.log("session present — signing out");
    await waitTap(deviceId, PROFILE_LABELS, { timeoutMs: 12000 });
    for (let i = 0; i < 6; i += 1) {
        const cur = parseUiNodes(dumpUiHierarchy(deviceId, `so-${i}`).xml);
        if (findNodeByText(cur, SIGN_OUT_LABELS, { packageName: PKG })) break;
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
        await sleep(700);
    }
    const signed = await waitTap(deviceId, SIGN_OUT_LABELS, {
        timeoutMs: 12000,
    });
    if (!signed) {
        console.log("Sign Out missing — clearing app data for clean login");
        spawnSync("adb", [
            "-s",
            deviceId,
            "shell",
            "pm",
            "clear",
            PKG,
        ]);
        launch(deviceId);
        await sleep(10000);
        return true;
    }
    await waitTap(
        deviceId,
        [...SIGN_OUT_LABELS, "Confirm", "Yes", "OK", "Da", "Confirma"],
        { timeoutMs: 5000 }
    );
    await sleep(2000);
    return true;
}

async function ensureLoginScreen(deviceId) {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
        const nodes = parseUiNodes(dumpUiHierarchy(deviceId, "ensure").xml);
        const fields = hasLoginFields(nodes);
        if (fields.email && fields.pass) return fields;
        const blob = nodes
            .map((n) => decodeUi(n.contentDesc || n.text || ""))
            .join(" | ");
        if (await signOutIfNeeded(deviceId, nodes)) continue;
        if (/privacy|usage analytics|save &/i.test(blob)) {
            await waitTap(deviceId, ["Save & continue", "Save & Continue"]);
            continue;
        }
        if (/choose your language/i.test(blob)) {
            await waitTap(deviceId, ["Continue"]);
            continue;
        }
        if (/get started/i.test(blob)) {
            await waitTap(deviceId, ["Get Started", "Get started"]);
            continue;
        }
        if (findExactLabel(nodes, ["Login", "Sign In", "Sign in"])) {
            await waitTap(deviceId, ["Login", "Sign In", "Sign in"]);
            continue;
        }
        await sleep(900);
    }
    throw new Error("Could not reach login fields");
}

function reasonHit(nodes) {
    const blob = nodes
        .map((n) => `${n.text || ""} ${n.contentDesc || ""}`)
        .join(" ")
        .toLowerCase();
    const needles = (REASON_NEEDLES[reason] || ["suspended", "paused"]).map(
        (s) => s.toLowerCase()
    );
    return needles.find((n) => blob.includes(n)) || null;
}

async function main() {
    if (!adminEmail || !probeId || !probeEmail || !probePassword) {
        throw new Error("Missing admin/probe env");
    }
    const deviceId = getAdbDevice();
    if (!deviceId) throw new Error("No adb device");

    const token = await adminToken();
    await setStatus(token, "SUSPENDED", reason);
    console.log("suspended", { probeId, reason });

    spawnSync("adb", ["-s", deviceId, "shell", "am", "force-stop", PKG]);
    launch(deviceId);
    await sleep(10000);

    const fields = await ensureLoginScreen(deviceId);
    shot(deviceId, `${label}-01-login.png`);

    tapBounds(fields.email.bounds, { deviceId });
    await sleep(400);
    clearFocusedField(deviceId);
    await typeText(probeEmail, { deviceId, perCharacter: true, charDelayMs: 18 });
    tapBounds(fields.pass.bounds, { deviceId });
    await sleep(400);
    clearFocusedField(deviceId);
    await typeText(probePassword, {
        deviceId,
        perCharacter: true,
        charDelayMs: 16,
    });
    spawnSync("adb", ["-s", deviceId, "shell", "input", "keyevent", "4"]);
    await sleep(700);

    let nodes = parseUiNodes(dumpUiHierarchy(deviceId, "pre").xml);
    let login = findNodeByText(nodes, ["Login", "Logging in"], {
        packageName: PKG,
    });
    if (!login?.bounds) login = findExactLabel(nodes, ["Login"]);
    if (!login?.bounds) {
        spawnSync("adb", [
            "-s",
            deviceId,
            "shell",
            "input",
            "tap",
            "360",
            "1180",
        ]);
    } else {
        tapBounds(login.bounds, { deviceId });
    }

    let matched = null;
    let support = false;
    const started = Date.now();
    while (Date.now() - started < 20000) {
        await sleep(900);
        nodes = parseUiNodes(dumpUiHierarchy(deviceId, "after").xml);
        matched = reasonHit(nodes);
        const blob = nodes
            .map((n) => `${n.text || ""} ${n.contentDesc || ""}`)
            .join(" ");
        support = /whatsapp|support@plastypesa|wa\.me|asisten/i.test(blob);
        if (matched) break;
    }
    const shotPath = shot(deviceId, `${label}-02-blocked.png`);
    writeFileSync(
        join(OUT_DIR, `${label}-ui.txt`),
        nodes.map((n) => n.contentDesc || n.text).filter(Boolean).join("\n")
    );

    await setStatus(token, "ACTIVE");
    console.log(
        JSON.stringify({ reason, matched, support, shotPath }, null, 2)
    );
    if (!matched) {
        console.error("FAIL: reason copy not in UI");
        process.exit(2);
    }
    console.log("PASS suspend-reason-adb");
}

main().catch(async (e) => {
    console.error(e);
    try {
        if (adminEmail && probeId) {
            const token = await adminToken();
            await setStatus(token, "ACTIVE");
            console.error("restored ACTIVE after error");
        }
    } catch {
        /* ignore */
    }
    process.exit(1);
});
