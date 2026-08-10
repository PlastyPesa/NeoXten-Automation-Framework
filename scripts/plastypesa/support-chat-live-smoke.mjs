/**
 * I2-A Support chat - live deploy proof (a-e).
 *
 *   node scripts/plastypesa/support-chat-live-smoke.mjs
 *
 * Uses OUR test user, never a real Kenyan user: it submits a clearly marked
 * smoke message as the tester, then replies to that row as admin. Nothing a
 * real person wrote is touched.
 *
 * a) GET  /admin/feedback/reply-templates -> 6 templates + greeting
 * b) PATCH /admin/feedback/:id (THANKS body) -> 200, repliedAt, notify gate OFF
 * c) GET  /feedback/mine (as user) -> replyText, userState REPLIED, NO adminNote
 * d) GET  /home/earn-hub -> support.unreadReplies >= 1
 * e) PATCH /feedback/:id/read twice -> userReadAt set, unread 0 and stays 0
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { getConfig, url } from "./config.mjs";
import {
    loadAdminDashboardCredentials,
    loadMobileAppUserCredentials,
} from "./credential-registry.mjs";

bootstrapPlastyPesaEnv();
const cfg = getConfig();
const PROOF = join(dirname(fileURLToPath(import.meta.url)), "../../.neoxten/proof");
mkdirSync(PROOF, { recursive: true });

const results = [];
function check(id, pass, detail) {
    results.push({ id, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"}  ${id}  ${detail}`);
}

async function call(path, { method = "GET", token, body } = {}) {
    const res = await fetch(url(cfg, path), {
        method,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
}

function pickToken(body) {
    return (
        body?.data?.token ||
        body?.token ||
        body?.data?.accessToken ||
        body?.accessToken ||
        null
    );
}

async function main() {
    const user = loadMobileAppUserCredentials();
    const admin = loadAdminDashboardCredentials();

    const userLogin = await call("/auth/login", {
        method: "POST",
        body: {
            email: user.email,
            password: user.password,
            deviceId:
                process.env.PLASTYPESA_TEST_DEVICE_ID ||
                "adb-test-device-plastypesa-20260726",
        },
    });
    const userToken = pickToken(userLogin.json);
    if (!userToken) {
        console.error("USER_LOGIN_FAILED", userLogin.status, JSON.stringify(userLogin.json).slice(0, 300));
        process.exit(1);
    }

    let adminToken = null;
    for (const route of ["/auth/admin/login", "/auth/login", "/admin/auth/login"]) {
        const r = await call(route, {
            method: "POST",
            body: { email: admin.email, password: admin.password },
        });
        adminToken = pickToken(r.json);
        if (adminToken) break;
    }
    if (!adminToken) {
        console.error("ADMIN_LOGIN_FAILED");
        process.exit(1);
    }

    // Seed one message from the tester so no real user's row is used.
    const stamp = new Date().toISOString();
    const seed = await call("/feedback", {
        method: "POST",
        token: userToken,
        body: {
            category: "other",
            message: `[I2-A live smoke ${stamp}] Deploy proof for the Support chat reply pipe. Safe to close.`,
            locale: "en",
            platform: "android",
            appVersion: "smoke",
            screen: "smoke",
        },
    });
    const feedbackId = seed.json?.data?.feedback?._id;
    check(
        "seed",
        seed.status === 200 && Boolean(feedbackId),
        `POST /feedback -> ${seed.status} id=${feedbackId} userState=${seed.json?.data?.feedback?.userState}`
    );
    if (!feedbackId) process.exit(1);

    // a) reply templates
    const tpl = await call(
        "/admin/feedback/reply-templates?locale=en&ecoHandle=TestHandle",
        { token: adminToken }
    );
    const templates = tpl.json?.data?.templates || [];
    check(
        "a",
        tpl.status === 200 && templates.length === 6 && Boolean(tpl.json?.data?.greeting),
        `${tpl.status} templates=${templates.length} greeting="${tpl.json?.data?.greeting}" keys=${templates
            .map((t) => t.key)
            .join(",")}`
    );

    // b) admin reply
    const thanks = templates.find((t) => t.key === "THANKS")?.body || "Thank you for writing to us.";
    const patch = await call(`/admin/feedback/${feedbackId}`, {
        method: "PATCH",
        token: adminToken,
        body: { replyText: thanks, replyTemplateKey: "THANKS" },
    });
    const fb = patch.json?.data?.feedback;
    const notif = patch.json?.data?.notification;
    check(
        "b",
        patch.status === 200 &&
            Boolean(fb?.repliedAt) &&
            fb?.status === "ACKNOWLEDGED" &&
            notif?.mode === "off" &&
            notif?.sent === false,
        `${patch.status} repliedAt=${fb?.repliedAt} status=${fb?.status} notification=${JSON.stringify(notif)}`
    );
    console.log("      reply the user will read:\n" + String(fb?.replyText || "").split("\n").map((l) => "      | " + l).join("\n"));

    // c) user view - reply present, adminNote absent
    const mine = await call("/feedback/mine", { token: userToken });
    const row = (mine.json?.data?.items || []).find((i) => i._id === feedbackId);
    const leaks = row ? Object.keys(row).filter((k) => k === "adminNote" || k === "status") : [];
    check(
        "c",
        mine.status === 200 &&
            Boolean(row?.replyText) &&
            row?.userState === "REPLIED" &&
            leaks.length === 0,
        `${mine.status} userState=${row?.userState} replyLen=${String(row?.replyText || "").length} leakedFields=[${leaks.join(",")}] unreadReplies=${mine.json?.data?.unreadReplies}`
    );

    // d) earn-hub badge
    const hub1 = await call("/home/earn-hub", { token: userToken });
    check(
        "d",
        hub1.status === 200 && Number(hub1.json?.data?.support?.unreadReplies) >= 1,
        `${hub1.status} support=${JSON.stringify(hub1.json?.data?.support)}`
    );

    // e) mark read twice -> idempotent, badge clears and stays clear
    const read1 = await call(`/feedback/${feedbackId}/read`, { method: "PATCH", token: userToken });
    const hub2 = await call("/home/earn-hub", { token: userToken });
    const read2 = await call(`/feedback/${feedbackId}/read`, { method: "PATCH", token: userToken });
    const hub3 = await call("/home/earn-hub", { token: userToken });
    const readAt1 = read1.json?.data?.feedback?.userReadAt;
    const readAt2 = read2.json?.data?.feedback?.userReadAt;
    check(
        "e",
        read1.status === 200 &&
            read2.status === 200 &&
            Boolean(readAt1) &&
            readAt1 === readAt2 &&
            Number(hub2.json?.data?.support?.unreadReplies) === 0 &&
            Number(hub3.json?.data?.support?.unreadReplies) === 0,
        `read1=${read1.status} read2=${read2.status} userReadAt=${readAt1} stable=${readAt1 === readAt2} unreadAfter1=${hub2.json?.data?.support?.unreadReplies} unreadAfter2=${hub3.json?.data?.support?.unreadReplies}`
    );

    const ok = results.every((r) => r.pass);
    writeFileSync(
        join(PROOF, "support-chat-live-smoke.json"),
        JSON.stringify({ ok, at: stamp, apiBase: cfg.apiBase, feedbackId, results }, null, 2)
    );
    console.log(`\n${ok ? "ALL PASS" : "FAILURES PRESENT"} - proof: .neoxten/proof/support-chat-live-smoke.json`);
    process.exit(ok ? 0 : 1);
}

main().catch((e) => {
    console.error("SMOKE_CRASH", e);
    process.exit(1);
});
