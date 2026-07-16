// Read-only Play Console status: tracks, releases, listings.
// Usage: node scripts/play-console/status.js

import { getAndroidPublisher, PACKAGE_NAME } from "./lib/play-auth.js";

const publisher = await getAndroidPublisher();

const edit = await publisher.edits.insert({ packageName: PACKAGE_NAME });
const editId = edit.data.id;

try {
  const tracks = await publisher.edits.tracks.list({
    packageName: PACKAGE_NAME,
    editId,
  });
  console.log("=== TRACKS ===");
  for (const t of tracks.data.tracks || []) {
    console.log(`\nTrack: ${t.track}`);
    for (const r of t.releases || []) {
      console.log(
        `  Release: name="${r.name || ""}" status=${r.status} versionCodes=${(r.versionCodes || []).join(",")}`
      );
      if (r.userFraction) console.log(`  userFraction: ${r.userFraction}`);
    }
  }

  const bundles = await publisher.edits.bundles.list({
    packageName: PACKAGE_NAME,
    editId,
  });
  console.log("\n=== UPLOADED BUNDLES ===");
  for (const b of bundles.data.bundles || []) {
    console.log(`  versionCode=${b.versionCode} sha256=${(b.sha256 || "").slice(0, 16)}...`);
  }

  const listings = await publisher.edits.listings.list({
    packageName: PACKAGE_NAME,
    editId,
  });
  console.log("\n=== DEFAULT LISTING LOCALES ===");
  for (const l of listings.data.listings || []) {
    console.log(`\nLocale: ${l.language}`);
    console.log(`  Title: ${l.title}`);
    console.log(`  Short: ${l.shortDescription}`);
  }
} finally {
  await publisher.edits.delete({ packageName: PACKAGE_NAME, editId });
}
