// Shared Google Play Developer API auth for PlastyPesa publishing scripts.
// Requires env var PLAY_JSON_PATH pointing at the service-account JSON key.
// The key must NEVER be committed — it lives in the local credentials folder.

import fs from "node:fs";
import { google } from "googleapis";

export const PACKAGE_NAME = "com.app.plasty_pesa";

const DEFAULT_KEY_PATH =
  "C:/Users/Bobby/Documents/plastypesa-admin-dashboard/ALL CREDENTIALS FOR PLASTYPESA 15-03-2026/Play Console API - created 16-07-2026/play-publisher-plastypesa-f5274-16-07-2026.json";

export function getKeyPath() {
  const p = process.env.PLAY_JSON_PATH || DEFAULT_KEY_PATH;
  if (!fs.existsSync(p)) {
    throw new Error(
      `Play service-account key not found at: ${p}\n` +
        "Set PLAY_JSON_PATH to the JSON key file location."
    );
  }
  return p;
}

export async function getAndroidPublisher() {
  const auth = new google.auth.GoogleAuth({
    keyFile: getKeyPath(),
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  });
  const authClient = await auth.getClient();
  return google.androidpublisher({ version: "v3", auth: authClient });
}
