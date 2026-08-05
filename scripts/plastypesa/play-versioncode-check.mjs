/**
 * Has Play ever received a given versionCode?
 *
 * The health monitor only reads the production track, which is not enough to
 * answer "can we reuse +60?". Play burns a versionCode the moment a bundle is
 * *uploaded*, on any track, including an internal test or a draft release that
 * was never rolled out. Re-uploading a burnt code fails at upload time.
 *
 * So this asks two questions:
 *  1. every track (production, beta, alpha, internal) — what codes are staged?
 *  2. edits.bundles.list — every AAB the account has ever uploaded.
 *
 * Read-only: it opens an edit to read, then deletes that edit. It never commits.
 *
 * Usage: node scripts/plastypesa/.local-play-versioncode-check.mjs [code]
 */
import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";

const PACKAGE = process.env.PLASTYPESA_PACKAGE_NAME || "com.app.plasty_pesa";
const WANTED = Number(process.argv[2] || 60);

const SA_PATH =
  process.env.PLASTYPESA_PLAY_SA_JSON ||
  path.join(
    "C:",
    "Users",
    "Bobby",
    "Documents",
    "plastypesa-admin-dashboard",
    "ALL CREDENTIALS FOR PLASTYPESA 15-03-2026",
    "Play Console API - created 16-07-2026",
    "play-publisher-plastypesa-f5274-16-07-2026.json"
  );

async function main() {
  if (!fs.existsSync(SA_PATH)) {
    throw new Error(`Play service-account JSON not found: ${SA_PATH}`);
  }

  const auth = await new google.auth.GoogleAuth({
    keyFile: SA_PATH,
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  }).getClient();

  const play = google.androidpublisher({ version: "v3", auth });
  const edit = await play.edits.insert({ packageName: PACKAGE });
  const editId = edit.data.id;

  const seen = new Set();

  try {
    const tracks = await play.edits.tracks.list({
      packageName: PACKAGE,
      editId,
    });

    console.log("── tracks ──");
    for (const track of tracks.data.tracks || []) {
      const releases = track.releases || [];
      if (releases.length === 0) {
        console.log(`  ${track.track}: (no releases)`);
        continue;
      }
      for (const release of releases) {
        const codes = (release.versionCodes || []).map(Number);
        codes.forEach((c) => seen.add(c));
        console.log(
          `  ${track.track}: name=${release.name ?? "-"} status=${
            release.status
          } codes=[${codes.join(", ") || "-"}]`
        );
      }
    }

    const bundles = await play.edits.bundles.list({
      packageName: PACKAGE,
      editId,
    });
    const uploaded = (bundles.data.bundles || []).map((b) =>
      Number(b.versionCode)
    );
    uploaded.forEach((c) => seen.add(c));

    console.log("── uploaded bundles (every AAB Play has ever accepted) ──");
    console.log(`  [${uploaded.sort((a, b) => a - b).join(", ") || "none"}]`);
  } finally {
    await play.edits.delete({ packageName: PACKAGE, editId });
  }

  const all = [...seen].sort((a, b) => a - b);
  const highest = all.length ? all[all.length - 1] : 0;
  const burnt = seen.has(WANTED);

  console.log("── verdict ──");
  console.log(`  codes known to Play: [${all.join(", ") || "none"}]`);
  console.log(`  highest: ${highest}`);
  console.log(
    burnt
      ? `  ${WANTED} IS ALREADY TAKEN → build must bump to ${highest + 1}`
      : `  ${WANTED} is FREE → safe to ship as +${WANTED}`
  );
}

main().catch((err) => {
  console.error("FAILED:", err?.message || err);
  process.exitCode = 1;
});
