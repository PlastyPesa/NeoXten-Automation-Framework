/**
 * I2-A - prove the Support chat desk actually RENDERS on production.
 *
 *   node scripts/plastypesa/admin-support-chat-live-render.mjs
 *
 * The page crashed on render before this fix (useCalloack / <outton>), so a
 * string match inside the JS bundle is not proof. This logs in as admin in a
 * real browser, opens /feedback, fails on any console error, and screenshots.
 */
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { loadAdminDashboardCredentials } from "./credential-registry.mjs";

const PROOF = join(dirname(fileURLToPath(import.meta.url)), "../../.neoxten/proof");
mkdirSync(PROOF, { recursive: true });

const BASE = process.env.PLASTYPESA_ADMIN_BASE || "https://plastypesa.com";

async function main() {
    const admin = loadAdminDashboardCredentials();
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
    const consoleErrors = [];
    page.on("console", (m) => {
        if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
    });
    page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR ${String(e).slice(0, 200)}`));

    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 45000 });
    await page.fill('input[type="email"], input[name="email"]', admin.email);
    await page.fill('input[type="password"], input[name="password"]', admin.password);
    await page.click('button[type="submit"]');
    // SPA: the post-login route change is client-side, so poll the URL.
    for (let i = 0; i < 40 && new URL(page.url()).pathname.includes("/login"); i += 1) {
        await page.waitForTimeout(1000);
    }
    const afterLogin = page.url();

    await page.goto(`${BASE}/feedback`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(6000);

    const body = await page.locator("body").innerText();
    const sidebarSupport = await page.getByText("Support chat", { exact: false }).count();
    const waiting = body.includes("Waiting on us");
    const answered = body.includes("Answered");
    const oldLabel = body.includes("User feedback inbox") || body.includes("User Feedback");
    const blank = body.trim().length < 200;

    await page.screenshot({ path: join(PROOF, "admin-support-chat-live.png"), fullPage: true });

    // Switch to Answered and open the composer on our own smoke row, so the
    // proof covers the parts an admin actually touches (chips + preview).
    let replyUi = "not reached";
    let answeredBody = "";
    try {
        // 1) composer on a row that is still waiting on us (open the UI only)
        await page.getByRole("button", { name: /^Reply$/ }).first().click();
        await page.waitForTimeout(3000);
        const composer = await page.locator("body").innerText();
        await page.screenshot({
            path: join(PROOF, "admin-support-chat-composer.png"),
            fullPage: true,
        });
        replyUi = [
            `sendButton=${composer.includes("Send reply")}`,
            `templateChips=${composer.includes("Thanks") || composer.includes("Looking into it")}`,
            `livePreview=${composer.includes("Karibu") || composer.includes("Preview")}`,
        ].join(" ");

        // 2) the answered smoke row (needs Status: All, because a replied row
        //    is ACKNOWLEDGED, not OPEN)
        await page.getByText("All", { exact: true }).first().click();
        await page.waitForTimeout(1500);
        await page.getByText("Answered", { exact: true }).first().click();
        await page.waitForTimeout(3000);
        answeredBody = await page.locator("body").innerText();
        await page.screenshot({
            path: join(PROOF, "admin-support-chat-answered.png"),
            fullPage: true,
        });
    } catch (e) {
        replyUi = `composer check failed: ${String(e).slice(0, 120)}`;
    }

    const ok = !blank && sidebarSupport > 0 && waiting && answered && !oldLabel && consoleErrors.length === 0;
    console.log(
        JSON.stringify(
            {
                ok,
                afterLogin,
                url: `${BASE}/feedback`,
                sidebarSupportChatMatches: sidebarSupport,
                waitingOnUsFilter: waiting,
                answeredFilter: answered,
                oldFeedbackLabelPresent: oldLabel,
                replyUi,
                answeredView: answeredBody
                    .split("\n")
                    .filter(Boolean)
                    .slice(12, 22),
                bodyChars: body.trim().length,
                consoleErrors,
                screenshot: ".neoxten/proof/admin-support-chat-live.png",
                firstLines: body.split("\n").filter(Boolean).slice(0, 12),
            },
            null,
            2
        )
    );
    await browser.close();
    process.exit(ok ? 0 : 1);
}

main().catch((e) => {
    console.error("RENDER_CHECK_CRASH", e);
    process.exit(1);
});
