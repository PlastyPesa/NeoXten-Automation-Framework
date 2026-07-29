#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
    dumpUiHierarchy,
    parseUiNodes,
    typeText,
    sleep,
    getAdbDevice,
    tapBounds,
    findNodeByText,
} from "./localization/adb-ui.mjs";

const API =
    process.env.PLASTYPESA_API_BASE ||
    "https://qdvaw2vpck.execute-api.eu-west-2.amazonaws.com/prod/api";
const PKG = "com.app.plasty_pesa";
const adminEmail = process.env.PLASTYPESA_ADMIN_EMAIL;
const adminPassword = process.env.PLASTYPESA_ADMIN_PASSWORD;
const probeEmail = process.env.PLASTYPESA_SUSPEND_PROBE_EMAIL;
const probePassword = process.env.PLASTYPESA_SUSPEND_PROBE_PASSWORD;
const probeId = process.env.PLASTYPESA_SUSPEND_PROBE_ID;
const reason = process.env.PLASTYPESA_SUSPEND_REASON || "MULTI_ACCOUNT";
const label = process.env.PLASTYPESA_PROOF_LABEL || "batch3-suspend-blocked";

async function json(method, path, { token, body } = {}) {
    const r = await fetch(API + path, {
        method,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json().catch(() => ({})) };
}

async function adminToken() {
    const { status, data } = await json("POST", "/auth/admin-login", {
        body: { email: adminEmail, password: adminPassword },
    });
    const t = data.token || data.data?.token;
    if (status !== 200 || !t) throw new Error("admin login failed");
    return t;
}

async function setStatus(token, status, suspensionReason) {
    const body = { id: probeId, status };
    if (suspensionReason) body.suspensionReason = suspensionReason;
    const o = await json("PUT", "/user/update", { token, body });
    if (o.status !== 200) throw new Error(JSON.stringify(o.data));
}

function shot(deviceId, name) {
    const p = join(process.cwd(), ".neoxten/proof", name);
    const r = spawnSync("adb", ["-s", deviceId, "exec-out", "screencap", "-p"], {
        encoding: "buffer",
        maxBuffer: 25 * 1024 * 1024,
    });
    if (r.status === 0) writeFileSync(p, r.stdout);
    console.log("shot", p, r.stdout?.length);
    return p;
}

async function main() {
    const deviceId = getAdbDevice();
    const token = await adminToken();
    await setStatus(token, "SUSPENDED", reason);
    spawnSync("adb", ["-s", deviceId, "shell", "am", "force-stop", PKG]);
    spawnSync("adb", [
        "-s",
        deviceId,
        "shell",
        "am",
        "start",
        "-n",
        `${PKG}/.MainActivity`,
    ]);
    await sleep(7000);

    try {
        for (let i = 0; i < 20; i++) {
            const nodes = parseUiNodes(dumpUiHierarchy(deviceId, "loop").xml);
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
            if (email && pass) {
                tapBounds(email.bounds, { deviceId });
                await sleep(300);
                spawnSync("adb", [
                    "-s",
                    deviceId,
                    "shell",
                    "input",
                    "keyevent",
                    "123",
                    ...Array.from({ length: 90 }, () => "67"),
                ]);
                await typeText(probeEmail, {
                    deviceId,
                    perCharacter: true,
                    charDelayMs: 20,
                });
                tapBounds(pass.bounds, { deviceId });
                await sleep(300);
                spawnSync("adb", [
                    "-s",
                    deviceId,
                    "shell",
                    "input",
                    "keyevent",
                    "123",
                    ...Array.from({ length: 60 }, () => "67"),
                ]);
                await typeText(probePassword, {
                    deviceId,
                    perCharacter: true,
                    charDelayMs: 16,
                });
                spawnSync("adb", [
                    "-s",
                    deviceId,
                    "shell",
                    "input",
                    "keyevent",
                    "4",
                ]);
                await sleep(500);
                const nodes2 = parseUiNodes(
                    dumpUiHierarchy(deviceId, "prelogin").xml
                );
                const login = findNodeByText(nodes2, ["Login"], {
                    packageName: PKG,
                });
                if (login?.bounds) tapBounds(login.bounds, { deviceId });
                else
                    spawnSync("adb", [
                        "-s",
                        deviceId,
                        "shell",
                        "input",
                        "tap",
                        "360",
                        "1180",
                    ]);
                let blob = "";
                let hit = false;
                let wa = false;
                const needles =
                    reason === "MULTI_ACCOUNT"
                        ? /multiple accounts|same device|share one device|mai multe|dispozitiv/i
                        : /sorting photos|sorting policy|sortare|fotograf|photo policy|paused/i;
                for (let w = 0; w < 15; w++) {
                    await sleep(1000);
                    const after = parseUiNodes(
                        dumpUiHierarchy(deviceId, `after-${w}`).xml
                    );
                    blob = after
                        .map((n) => `${n.text || ""} ${n.contentDesc || ""}`)
                        .join(" ");
                    hit = needles.test(blob) || /account is paused|account paused/i.test(blob);
                    wa = /whatsapp|support@plastypesa|asisten/i.test(blob);
                    if (hit) break;
                    // still on login → tap Login again
                    if (/Welcome|Login|Password/i.test(blob)) {
                        const loginAgain = findNodeByText(after, ["Login"], {
                            packageName: PKG,
                        });
                        if (loginAgain?.bounds)
                            tapBounds(loginAgain.bounds, { deviceId });
                    }
                }
                shot(deviceId, `${label}.png`);
                writeFileSync(
                    join(process.cwd(), ".neoxten/proof", `${label}.txt`),
                    blob
                );
                console.log(
                    JSON.stringify({
                        reason,
                        hit,
                        wa,
                        blobPreview: blob.slice(0, 500),
                    })
                );
                await setStatus(token, "ACTIVE");
                if (!hit) process.exit(2);
                console.log("PASS");
                return;
            }
            const btn =
                findNodeByText(nodes, ["Save & continue", "Save & Continue"], {
                    packageName: PKG,
                }) ||
                findNodeByText(nodes, ["Continue"], { packageName: PKG }) ||
                findNodeByText(nodes, ["Skip"], { packageName: PKG }) ||
                findNodeByText(nodes, ["Next"], { packageName: PKG }) ||
                findNodeByText(nodes, ["Get Started", "Get started"], {
                    packageName: PKG,
                });
            if (btn?.bounds) tapBounds(btn.bounds, { deviceId });
            await sleep(900);
        }
        throw new Error("no login fields");
    } catch (e) {
        await setStatus(token, "ACTIVE");
        throw e;
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
