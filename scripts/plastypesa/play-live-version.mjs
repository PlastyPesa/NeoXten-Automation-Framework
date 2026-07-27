/**
 * Live Play production versionCode — the single source of truth for "latest".
 *
 * FORCE LATEST FOREVER (owner lock 2026-07-27) pins the release gate's floor to
 * whatever Play is actually serving, so both the arm ritual (`release-gate.mjs
 * sync`) and the NeoXten forever-assert read the same number from the same
 * place. Reads the production track via the Publisher API with the same
 * service account the monitor uses; never guesses from local artifacts.
 */
import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";

export const PLAY_PACKAGE =
  process.env.PLASTYPESA_PACKAGE_NAME || "com.app.plasty_pesa";

const DEFAULT_SA = path.join(
  "C:",
  "Users",
  "Bobby",
  "Documents",
  "plastypesa-admin-dashboard",
  "ALL CREDENTIALS FOR PLASTYPESA 15-03-2026",
  "Play Console API - created 16-07-2026",
  "play-publisher-plastypesa-f5274-16-07-2026.json"
);

export const SA_PATH = process.env.PLASTYPESA_PLAY_SA_JSON || DEFAULT_SA;

export function playServiceAccountAvailable() {
  return fs.existsSync(SA_PATH);
}

/**
 * Returns `{ versionCode, releaseName, status }` for the live production
 * release. Throws with an actionable message if the SA file is missing or the
 * track has no completed release — callers must fail loudly, not guess.
 */
export async function readLivePlayVersion() {
  if (!playServiceAccountAvailable()) {
    throw new Error(
      `Play service-account JSON not found: ${SA_PATH}\n` +
        "Set PLASTYPESA_PLAY_SA_JSON — the gate floor must come from live Play, never a guess."
    );
  }

  const auth = await new google.auth.GoogleAuth({
    keyFile: SA_PATH,
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  }).getClient();

  const ap = google.androidpublisher({ version: "v3", auth });
  const edit = await ap.edits.insert({ packageName: PLAY_PACKAGE, requestBody: {} });
  const editId = edit.data.id;
  try {
    const track = await ap.edits.tracks.get({
      packageName: PLAY_PACKAGE,
      editId,
      track: "production",
    });
    const releases = track.data.releases || [];
    // "completed" = fully live. inProgress/halted staged rollouts are not the
    // floor: forcing users onto a build Play is not serving to everyone yet
    // would strand whoever the rollout has not reached.
    const live = releases.find((r) => r.status === "completed");
    if (!live || !live.versionCodes?.length) {
      throw new Error(
        `No completed production release found for ${PLAY_PACKAGE}. ` +
          `Track releases: ${JSON.stringify(releases.map((r) => ({ name: r.name, status: r.status, versionCodes: r.versionCodes })))}`
      );
    }
    const versionCode = Math.max(...live.versionCodes.map((v) => Number(v)));
    return { versionCode, releaseName: live.name || "", status: live.status };
  } finally {
    try {
      await ap.edits.delete({ packageName: PLAY_PACKAGE, editId });
    } catch {
      /* read-only edit; leak is harmless and expires server-side */
    }
  }
}
