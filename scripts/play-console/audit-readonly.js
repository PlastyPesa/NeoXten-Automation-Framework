/**
 * Full read-only Play audit via API + public store fetch. NO writes.
 * Usage: node scripts/play-console/audit-readonly.js
 */

import { google } from "googleapis";
import { getAndroidPublisher, getKeyPath, PACKAGE_NAME } from "./lib/play-auth.js";

const LOCALES = ["en-GB", "it-IT", "es-ES", "de-DE", "fr-FR", "pt-PT", "ro"];
const BRAND_BAD = /\b(prize|prizes|lottery|gambling|competition|winnings?)\b/i;
const IMAGE_TYPES = [
  "phoneScreenshots",
  "sevenInchScreenshots",
  "tenInchScreenshots",
  "tvScreenshots",
  "wearScreenshots",
  "icon",
  "featureGraphic",
  "promoGraphic",
];

const issues = [];
const ok = [];
const info = [];

function flag(msg) {
  issues.push(msg);
}
function pass(msg) {
  ok.push(msg);
}
function note(msg) {
  info.push(msg);
}

async function tryReportingVitals() {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: getKeyPath(),
      scopes: ["https://www.googleapis.com/auth/playdeveloperreporting"],
    });
    const client = await auth.getClient();
    const reporting = google.playdeveloperreporting({ version: "v1beta1", auth: client });
    const name = `apps/${PACKAGE_NAME}/crashRateMetricSet`;
    const res = await reporting.vitals.crashrate.query({
      name,
      requestBody: {
        timelineSpec: {
          aggregationPeriod: "DAILY",
          startTime: { year: 2026, month: 7, day: 1 },
          endTime: { year: 2026, month: 7, day: 16 },
        },
        metrics: ["crashRate", "userPerceivedCrashRate"],
      },
    });
    const rows = res.data.rows || [];
    if (rows.length) {
      pass(`Reporting API: crash metrics returned (${rows.length} row(s)).`);
      note(`Latest crash row sample: ${JSON.stringify(rows[rows.length - 1]?.metrics || {}).slice(0, 200)}`);
    } else {
      note("Reporting API: connected but no crash rows in window (low traffic or API lag).");
    }
  } catch (e) {
    note(
      `Reporting API not available: ${e.message?.slice(0, 120)} — enable Play Developer Reporting API in GCP + grant service account View app info in Play Console → Users and permissions.`,
    );
  }
}

async function fetchStore(country, lang = "en") {
  const url = `https://play.google.com/store/apps/details?id=${PACKAGE_NAME}&hl=${lang}&gl=${country}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const html = await res.text();
  const title = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] || "";
  const desc = html.match(/<meta property="og:description" content="([^"]+)"/)?.[1] || "";
  return { status: res.status, title, desc, html };
}

const publisher = await getAndroidPublisher();
const edit = await publisher.edits.insert({ packageName: PACKAGE_NAME });
const editId = edit.data.id;

console.log("=== PLASTYPESA READ-ONLY AUDIT (API ONLY) ===");
console.log(`Package: ${PACKAGE_NAME}`);
console.log(`Time: ${new Date().toISOString()}\n`);

try {
  // --- Production release ---
  console.log("--- PRODUCTION RELEASE ---");
  const tracks = await publisher.edits.tracks.list({ packageName: PACKAGE_NAME, editId });
  const prod = (tracks.data.tracks || []).find((t) => t.track === "production");
  for (const r of prod?.releases || []) {
    console.log(`  "${r.name}" status=${r.status} versionCodes=${(r.versionCodes || []).join(",")}`);
    if (r.userFraction != null) console.log(`  rollout=${(Number(r.userFraction) * 100).toFixed(0)}%`);
    if (r.status === "completed" && (r.versionCodes || []).includes("26")) {
      pass("1.0.17 (26) completed on production.");
    }
  }
  if (!(prod?.releases || []).some((r) => (r.versionCodes || []).includes("26"))) {
    flag("versionCode 26 not on production track.");
  }

  // --- App details ---
  console.log("\n--- APP DETAILS ---");
  const details = await publisher.edits.details.get({ packageName: PACKAGE_NAME, editId });
  console.log(`  defaultLanguage: ${details.data.defaultLanguage}`);
  console.log(`  contactWebsite: ${details.data.contactWebsite}`);
  console.log(`  contactEmail: ${details.data.contactEmail}`);
  if (details.data.contactWebsite?.includes("plastypesa.com")) {
    pass("Developer website set (AdMob / trust).");
  } else {
    flag("Developer website missing or wrong.");
  }

  // --- Country availability ---
  console.log("\n--- COUNTRY AVAILABILITY (production) ---");
  const avail = await publisher.edits.countryavailability.get({
    packageName: PACKAGE_NAME,
    editId,
    track: "production",
  });
  const codes = (avail.data.countries || []).map((c) => c.countryCode || c);
  console.log(`  ${codes.length} countries`);
  if (codes.includes("KE")) pass("Kenya (KE) in production country list.");
  else flag("Kenya (KE) NOT in production country list.");
  if (codes.includes("DE")) pass("Germany (DE) in production country list.");

  // --- Bundles ---
  console.log("\n--- BUNDLES ---");
  const bundles = await publisher.edits.bundles.list({ packageName: PACKAGE_NAME, editId });
  const v26 = (bundles.data.bundles || []).find((b) => String(b.versionCode) === "26");
  if (v26) {
    console.log(`  v26 sha256=${v26.sha256}`);
    pass("AAB versionCode 26 uploaded.");
  } else flag("AAB versionCode 26 not in bundle list.");

  // --- Listings all locales ---
  console.log("\n--- DEFAULT LISTINGS (7 locales) ---");
  for (const loc of LOCALES) {
    const l = await publisher.edits.listings.get({
      packageName: PACKAGE_NAME,
      editId,
      language: loc,
    });
    const d = l.data;
    const blob = `${d.title} ${d.shortDescription} ${d.fullDescription || ""}`;
    console.log(`  [${loc}] title="${d.title}" shortLen=${(d.shortDescription || "").length} fullLen=${(d.fullDescription || "").length}`);
    if (BRAND_BAD.test(blob)) flag(`${loc}: brand-violating word in listing.`);
    if ((d.shortDescription || "").length > 80) flag(`${loc}: short description >80 chars.`);
  }
  pass("All 7 default listing locales present via API.");

  // --- Images en-GB ---
  console.log("\n--- IMAGES (en-GB) ---");
  for (const imageType of IMAGE_TYPES) {
    try {
      const imgs = await publisher.edits.images.list({
        packageName: PACKAGE_NAME,
        editId,
        language: "en-GB",
        imageType,
      });
      const n = (imgs.data.images || []).length;
      if (n) console.log(`  ${imageType}: ${n}`);
      if (imageType === "phoneScreenshots" && n >= 4) pass(`${n} phone screenshots on en-GB.`);
      if (imageType === "phoneScreenshots" && n < 4) flag(`Only ${n} phone screenshots on en-GB.`);
    } catch {
      // optional type
    }
  }

  // --- Public store (Kenya custom + EU) ---
  console.log("\n--- PUBLIC STORE (automated fetch, not Console UI) ---");
  for (const [gl, label, expect] of [
    ["KE", "Kenya", /M-Pesa|Mpesa/i],
    ["DE", "Germany", /Recycle/i],
    ["RO", "Romania", /Recycle|Recicleaz/i],
  ]) {
    const s = await fetchStore(gl);
    console.log(`  ${label} (${gl}): ${s.status} title="${s.title.slice(0, 60)}"`);
    console.log(`    short: ${s.desc.slice(0, 100)}`);
    if (expect.test(s.title + s.desc)) pass(`${label} public listing matches market story.`);
    else flag(`${label} public listing may not match expected market copy.`);
    if (BRAND_BAD.test(s.title + s.desc)) flag(`${label} public listing has brand-violating term.`);
  }

  // --- Reviews ---
  console.log("\n--- REVIEWS API ---");
  try {
    const rev = await publisher.reviews.list({ packageName: PACKAGE_NAME, maxResults: 10 });
    const n = rev.data.reviews?.length ?? 0;
    console.log(`  ${n} review(s) returned`);
    note(n === 0 ? "No reviews via API (normal for new app)." : "Reviews readable via API.");
  } catch (e) {
    note(`Reviews API: ${e.message?.slice(0, 80)}`);
  }

  // --- Reporting API vitals ---
  console.log("\n--- ANDROID VITALS (Reporting API) ---");
  await tryReportingVitals();

  console.log("\n=== CANNOT BE READ BY ANY PLAY API (Google limitation) ===");
  console.log("  Policy status / policy deadlines / July 2026 announcement items");
  console.log("  Data safety form completion status (API is WRITE-only for dataSafety)");
  console.log("  Content rating questionnaire status");
  console.log("  Pre-launch report");
  console.log("  Custom store listing editor fields (Kenya) — use public gl=KE fetch above");
  console.log("  Dashboard yellow/red suggestion banners");

  console.log("\n=== SUMMARY ===");
  console.log(`PASS (${ok.length}):`);
  ok.forEach((m) => console.log(`  ✓ ${m}`));
  console.log(`\nISSUES (${issues.length}):`);
  if (!issues.length) console.log("  (none)");
  else issues.forEach((m) => console.log(`  ! ${m}`));
  console.log(`\nINFO (${info.length}):`);
  info.forEach((m) => console.log(`  · ${m}`));
  console.log("\nDone. No Play Console data was modified.");
} finally {
  await publisher.edits.delete({ packageName: PACKAGE_NAME, editId });
}
