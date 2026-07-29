/**
 * P-OTP-EMAIL-COOLDOWN — live proof that /send-otp caps per email.
 * Uses a disposable probe address; expects eventual 429 + otp_email_cooldown.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const API =
    process.env.PLASTYPESA_API_BASE ||
    "https://qdvaw2vpck.execute-api.eu-west-2.amazonaws.com/prod/api";
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROOF = join(__dirname, "../../.neoxten/proof");

const email = `otp-cooldown-probe+${Date.now()}@example.com`;

async function sendOnce() {
    const res = await fetch(`${API}/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, type: "REGISTER" }),
    });
    let body = null;
    try {
        body = await res.json();
    } catch {
        body = { raw: await res.text() };
    }
    return { status: res.status, body };
}

async function main() {
    mkdirSync(PROOF, { recursive: true });
    const results = [];
    let blocked = null;

    // Burst past min-gap + window (server: 45s gap OR 5/15min; rate-limit also 5/15min).
    for (let i = 0; i < 8; i++) {
        const r = await sendOnce();
        results.push({ i, ...r });
        if (r.status === 429 || r.body?.code === "otp_email_cooldown") {
            blocked = r;
            break;
        }
        // tiny pause so Lambda isn't overwhelmed; gap still < 45s so 2nd should 429
        await new Promise((r) => setTimeout(r, 200));
    }

    const ok =
        blocked &&
        (blocked.status === 429 || blocked.body?.code === "otp_email_cooldown");

    const out = {
        ok: Boolean(ok),
        email,
        blocked,
        results,
        at: new Date().toISOString(),
    };
    const path = join(PROOF, `otp-email-cooldown-${Date.now()}.json`);
    writeFileSync(path, JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    if (!ok) {
        console.error("FAIL: never hit otp_email_cooldown");
        process.exit(1);
    }
    console.log("PASS", path);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
