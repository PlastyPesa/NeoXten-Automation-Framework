// List main-listing images per locale (read-only).
// Usage: node scripts/play-console/list-images.js [locale] [imageType]

import { getAndroidPublisher, PACKAGE_NAME } from "./lib/play-auth.js";

const locale = process.argv[2] || "en-GB";
const types = process.argv[3]
  ? [process.argv[3]]
  : ["phoneScreenshots", "icon", "featureGraphic"];

const publisher = await getAndroidPublisher();
const edit = await publisher.edits.insert({ packageName: PACKAGE_NAME });
const editId = edit.data.id;

try {
  for (const imageType of types) {
    const res = await publisher.edits.images.list({
      packageName: PACKAGE_NAME,
      editId,
      language: locale,
      imageType,
    });
    const images = res.data.images || [];
    console.log(`\n=== ${locale} / ${imageType}: ${images.length} image(s) ===`);
    images.forEach((img, i) => {
      console.log(`  ${i + 1}. id=${img.id} sha256=${(img.sha256 || "").slice(0, 12)} url=${img.url}`);
    });
  }
} finally {
  await publisher.edits.delete({ packageName: PACKAGE_NAME, editId });
}
