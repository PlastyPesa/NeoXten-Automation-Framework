/**
 * P-SUSPEND-UI admin reason picker — live API proof.
 *
 * 1) Admin login
 * 2) Suspend a disposable probe user with MULTI_ACCOUNT
 * 3) Consumer login → 403 + data.reason === MULTI_ACCOUNT + WhatsApp contact
 * 4) Restore ACTIVE
 * 5) Repeat once with SORT_POLICY (second non-ADB proof)
 *
 * Env: PLASTYPESA_ADMIN_EMAIL / PLASTYPESA_ADMIN_PASSWORD
 * Optional: PLASTYPESA_SUSPEND_PROBE_EMAIL / PLASTYPESA_SUSPEND_PROBE_PASSWORD
 *   (defaults to a known plus-alias probe if set in .env.local)
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../..");

try {
    require("dotenv").config({ path: path.join(root, ".env.local") });
} catch {
    /* optional */
}

const API =
    process.env.PLASTYPESA_API_BASE ||
    "https://qdvaw2vpck.execute-api.eu-west-2.amazonaws.com/prod/api";

const adminEmail =
    process.env.PLASTYPESA_ADMIN_EMAIL || process.env.ADMIN_EMAIL;
const adminPassword =
    process.env.PLASTYPESA_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;
const probeEmail = process.env.PLASTYPESA_SUSPEND_PROBE_EMAIL;
const probePassword = process.env.PLASTYPESA_SUSPEND_PROBE_PASSWORD;
const probeIdEnv = process.env.PLASTYPESA_SUSPEND_PROBE_ID;

function fail(msg) {
    console.error("FAIL:", msg);
    process.exit(1);
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
    const text = await res.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        data = { raw: text };
    }
    return { status: res.status, data };
}

async function adminLogin() {
    if (!adminEmail || !adminPassword) {
        fail("Missing admin credentials (PLASTYPESA_ADMIN_EMAIL/PASSWORD)");
    }
    const { status, data } = await json("POST", "/auth/admin-login", {
        body: { email: adminEmail, password: adminPassword },
    });
    const token =
        data?.token ||
        data?.data?.token ||
        data?.accessToken ||
        data?.data?.accessToken;
    if (status !== 200 || !token) {
        fail(`Admin login failed: ${status} ${JSON.stringify(data)}`);
    }
    return token;
}

async function findProbeUserId(token) {
    if (probeIdEnv) return probeIdEnv;
    if (!probeEmail) {
        fail(
            "Set PLASTYPESA_SUSPEND_PROBE_EMAIL (or PLASTYPESA_SUSPEND_PROBE_ID) to a disposable consumer account"
        );
    }
    // Plus-aliases often miss substring search — try exact then local-part.
    const searches = [probeEmail, probeEmail.split("+")[0], probeEmail.split("@")[0]];
    for (const search of searches) {
        const { status, data } = await json("POST", "/user/all", {
            token,
            body: { page: 1, limit: 50, search },
        });
        if (status !== 200) continue;
        const rows = Array.isArray(data?.data)
            ? data.data
            : data?.data?.users || data?.users || [];
        const hit = rows.find(
            (u) =>
                String(u.email || "").toLowerCase() ===
                String(probeEmail).toLowerCase()
        );
        if (hit?._id) return hit._id;
    }
    fail(`Probe user not found for ${probeEmail}`);
}

async function setStatus(token, id, status, suspensionReason) {
    const body = { id, status };
    if (suspensionReason) body.suspensionReason = suspensionReason;
    const out = await json("PUT", "/user/update", { token, body });
    if (out.status !== 200) {
        fail(`update failed: ${out.status} ${JSON.stringify(out.data)}`);
    }
    return out.data;
}

async function assertLoginBlocked(reason) {
    if (!probePassword) {
        fail("Set PLASTYPESA_SUSPEND_PROBE_PASSWORD for login proof");
    }
    const { status, data } = await json("POST", "/auth/login", {
        body: { email: probeEmail, password: probePassword },
    });
    if (status !== 403) {
        fail(`Expected login 403, got ${status} ${JSON.stringify(data)}`);
    }
    if (data?.code !== "account_suspended") {
        fail(`Expected code account_suspended, got ${JSON.stringify(data)}`);
    }
    if (data?.data?.reason !== reason) {
        fail(
            `Expected reason ${reason}, got ${data?.data?.reason} — ${JSON.stringify(data)}`
        );
    }
    if (!data?.data?.supportWhatsApp && !data?.data?.supportEmail) {
        fail("Expected support contact on suspended payload");
    }
    console.log(
        `OK login blocked reason=${reason} wa=${data?.data?.supportWhatsApp || "n/a"}`
    );
}

async function runOnce(token, userId, reason) {
    await setStatus(token, userId, "SUSPENDED", reason);
    await assertLoginBlocked(reason);
    await setStatus(token, userId, "ACTIVE");
    const { status, data } = await json("POST", "/auth/login", {
        body: { email: probeEmail, password: probePassword },
    });
    if (status !== 200) {
        fail(
            `Restore ACTIVE but login still fails: ${status} ${JSON.stringify(data)}`
        );
    }
    console.log(`OK restored ACTIVE after ${reason}`);
}

async function main() {
    const token = await adminLogin();
    const userId = await findProbeUserId(token);
    console.log("probe userId", userId);

    await runOnce(token, userId, "MULTI_ACCOUNT");
    await runOnce(token, userId, "SORT_POLICY");
    console.log("PASS suspend-admin-reason-picker ×2 reasons");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
