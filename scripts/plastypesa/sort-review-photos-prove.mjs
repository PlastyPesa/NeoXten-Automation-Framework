/**
 * Prove Sort Review photos from the real admin UI (not just API list counts).
 * Run twice after deploy: node scripts/plastypesa/sort-review-photos-prove.mjs
 */
import { chromium } from "playwright";
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { loadAdminDashboardCredentials } from "./credential-registry.mjs";

bootstrapPlastyPesaEnv();
const { email, password } = loadAdminDashboardCredentials();
const label = process.argv[2] || "v1";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto("https://plastypesa.com/login", { waitUntil: "domcontentloaded" });
await page.locator('input[type="password"]').first().waitFor({ timeout: 20000 });
await page.locator('input[type="email"], input[name="email"]').first().fill(email);
await page.locator('input[type="password"]').first().fill(password);
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(5000);

await page.goto("https://plastypesa.com/sort-proof-review?status=OPEN", {
  waitUntil: "domcontentloaded",
});
await page.waitForSelector('button:text-is("Review")', { timeout: 30000 });
// Wait for thumbnail prefetch
await page.waitForTimeout(4000);

const list = await page.evaluate(() => {
  const thumbs = [...document.querySelectorAll("button img")].filter((img) =>
    (img.alt || "").toLowerCase().includes("sort proof")
  );
  const whiteGhostButtons = [...document.querySelectorAll("button")].filter((b) => {
    const t = (b.textContent || "").trim();
    if (t !== "View Photo") return false;
    const cs = getComputedStyle(b);
    return cs.backgroundColor === "rgb(245, 245, 245)";
  });
  return {
    thumbCount: thumbs.length,
    thumbsWithPixels: thumbs.filter((img) => img.naturalWidth > 0).length,
    ghostViewPhoto: whiteGhostButtons.length,
  };
});

const detailWait = page.waitForResponse(
  (r) => r.url().includes("/detail") && r.request().method() === "GET",
  { timeout: 20000 }
);
await page.locator('button:text-is("Review")').first().click();
const detailRes = await detailWait;
const detailBody = await detailRes.json();
await page.waitForSelector("text=This submission", { timeout: 20000 });
await page.waitForTimeout(3000);

const modal = await page.evaluate(() => {
  const txt = document.body.innerText;
  const imgs = [...document.querySelectorAll("img")].map((img) => ({
    alt: img.alt,
    nw: img.naturalWidth,
    srcOk: typeof img.src === "string" && img.src.length > 20,
  }));
  return {
    hasImageNotAvailable: txt.includes("Image not available"),
    submissionImgs: imgs.filter((i) => (i.alt || "").includes("This submission")),
    anyLargeImg: imgs.some((i) => i.nw > 50),
  };
});

const ok =
  list.thumbCount >= 1 &&
  list.thumbsWithPixels >= 1 &&
  list.ghostViewPhoto === 0 &&
  !!detailBody?.data?.imageUrl &&
  modal.anyLargeImg === true &&
  modal.hasImageNotAvailable === false;

console.log(
  JSON.stringify(
    {
      label,
      ok,
      list,
      detailImageUrl: !!detailBody?.data?.imageUrl,
      modal,
    },
    null,
    2
  )
);

await page.screenshot({
  path: `C:/Users/Bobby/Documents/NeoXten-Automation-Framework/.neoxten/sort-photos-${label}.png`,
});
await browser.close();
process.exit(ok ? 0 : 1);
