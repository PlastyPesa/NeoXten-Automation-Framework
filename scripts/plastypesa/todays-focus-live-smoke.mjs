/**
 * Today's focus (P-TODAYS-FOCUS, glance Phase D) - live API proof.
 *
 *   node scripts/plastypesa/todays-focus-live-smoke.mjs
 *
 * Read-only. Logs in as OUR test user and reads `GET /api/home/earn-hub` in two
 * languages, then reports what the Home "Today" strip header will wear:
 *
 *   todaysFocus === null   -> strip falls back to its plain TODAY header
 *   todaysFocus === {..}   -> header becomes "<WEEKDAY> · <name>" + the line
 *
 * Both outcomes are legitimate - which one is correct depends on whether ops has
 * staged today in masters `daily-focus`. The script prints the staged day key so
 * a null can be told apart from a bug (see `.local-stage-daily-focus.mjs --show`).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { getConfig, url } from "./config.mjs";
import { loadMobileAppUserCredentials } from "./credential-registry.mjs";

bootstrapPlastyPesaEnv();
const cfg = getConfig();
const PROOF = join(dirname(fileURLToPath(import.meta.url)), "../../.neoxten/proof");
mkdirSync(PROOF, { recursive: true });

async function call(path, { method = "GET", token, body, lang } = {}) {
    const res = await fetch(url(cfg, path), {
        method,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(lang ? { "X-Language": lang } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
}

function pickToken(body) {
    return body?.data?.token || body?.token || body?.data?.accessToken || null;
}

function describe(focus) {
    if (focus === null || focus === undefined) return "null (plain TODAY header)";
    return `${focus.dayKey} | ${focus.name} | ${focus.line}`;
}

async function main() {
    const user = loadMobileAppUserCredentials();
    const login = await call("/auth/login", {
        method: "POST",
        body: {
            email: user.email,
            password: user.password,
            deviceId:
                process.env.PLASTYPESA_TEST_DEVICE_ID ||
                "adb-test-device-plastypesa-20260726",
        },
    });
    const token = pickToken(login.json);
    if (!token) {
        console.error(
            "USER_LOGIN_FAILED",
            login.status,
            JSON.stringify(login.json).slice(0, 300)
        );
        process.exit(1);
    }

    const rows = [];
    for (const lang of ["en", "ro"]) {
        const hub = await call("/home/earn-hub", { token, lang });
        const data = hub.json?.data || {};
        const focus = data.todaysFocus ?? null;
        rows.push({ lang, status: hub.status, earnDayKey: data.earnDayKey, focus });
        console.log(
            `${hub.status === 200 ? "OK  " : "FAIL"} lang=${lang} earnDay=${data.earnDayKey} todaysFocus=${describe(focus)}`
        );
        // The contract the client depends on: the field is always present, and
        // a focus is never half written.
        if (hub.status === 200 && focus) {
            const complete = Boolean(focus.name) && Boolean(focus.line);
            console.log(
                `${complete ? "OK  " : "FAIL"} lang=${lang} focus has both a name and a line`
            );
            const sameDay = focus.dayKey === data.earnDayKey;
            console.log(
                `${sameDay ? "OK  " : "FAIL"} lang=${lang} focus.dayKey matches the caller's earn day`
            );
        }
    }

    const out = join(PROOF, "todays-focus-live-smoke.json");
    writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), rows }, null, 2));
    console.log("PROOF", out);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
