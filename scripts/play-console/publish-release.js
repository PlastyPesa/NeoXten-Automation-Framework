// Upload an AAB and roll it out to the production track with localized notes.
// Usage: node scripts/play-console/publish-release.js [path-to-aab]
// Optional env: PLAY_RELEASE_DRAFT=1 -> create the release as draft instead of completed.

import fs from "node:fs";
import { getAndroidPublisher, PACKAGE_NAME } from "./lib/play-auth.js";

const AAB_PATH =
  process.argv[2] ||
  "C:/Users/Bobby/Documents/plastypesa-mobile-app/build/app/outputs/bundle/release/app-release.aab";

const RELEASE_NAME = "1.0.17 (26) Kenya M-Pesa UI lock";

// Locale codes must match the listing locales configured in Play Console.
const RELEASE_NOTES = [
  {
    language: "en-GB",
    text: "Kenya: Home and Leaderboard always show M-Pesa weekly rewards and Ksh tiers. Clearer reward info for your market. Small fixes.",
  },
  {
    language: "it-IT",
    text: "Kenya: Home e Classifica mostrano sempre le ricompense M-Pesa settimanali e i livelli Ksh. Info più chiare per il tuo mercato. Piccole correzioni.",
  },
  {
    language: "es-ES",
    text: "Kenia: Inicio y Clasificación muestran siempre recompensas M-Pesa semanales y niveles Ksh. Información más clara para tu mercado. Pequeñas correcciones.",
  },
  {
    language: "de-DE",
    text: "Kenia: Start und Bestenliste zeigen immer wöchentliche M-Pesa-Belohnungen und Ksh-Stufen. Klarere Infos für deinen Markt. Kleine Fehlerbehebungen.",
  },
  {
    language: "fr-FR",
    text: "Kenya : Accueil et Classement affichent toujours les récompenses M-Pesa hebdomadaires et les paliers Ksh. Infos plus claires pour ton marché. Petites corrections.",
  },
  {
    language: "pt-PT",
    text: "Quénia: Início e Classificação mostram sempre recompensas M-Pesa semanais e níveis Ksh. Informação mais clara para o teu mercado. Pequenas correções.",
  },
  {
    language: "ro",
    text: "Kenya: Acasă și Clasament afișează mereu recompense M-Pesa săptămânale și niveluri Ksh. Informații mai clare pentru piața ta. Mici corecturi.",
  },
];

if (!fs.existsSync(AAB_PATH)) {
  console.error(`AAB not found: ${AAB_PATH}`);
  process.exit(1);
}
const stat = fs.statSync(AAB_PATH);
console.log(`AAB: ${AAB_PATH}`);
console.log(`Size: ${(stat.size / 1024 / 1024).toFixed(1)} MB, modified ${stat.mtime.toISOString()}`);

const publisher = await getAndroidPublisher();

const edit = await publisher.edits.insert({ packageName: PACKAGE_NAME });
const editId = edit.data.id;
console.log(`Edit created: ${editId}`);

try {
  console.log("Uploading AAB (this can take a few minutes)...");
  const upload = await publisher.edits.bundles.upload(
    {
      packageName: PACKAGE_NAME,
      editId,
      media: {
        mimeType: "application/octet-stream",
        body: fs.createReadStream(AAB_PATH),
      },
    },
    { timeout: 40 * 60 * 1000 }
  );
  const versionCode = upload.data.versionCode;
  console.log(`Uploaded. versionCode=${versionCode} sha256=${upload.data.sha256}`);

  const releaseStatus = process.env.PLAY_RELEASE_DRAFT ? "draft" : "completed";
  await publisher.edits.tracks.update({
    packageName: PACKAGE_NAME,
    editId,
    track: "production",
    requestBody: {
      track: "production",
      releases: [
        {
          name: RELEASE_NAME,
          status: releaseStatus,
          versionCodes: [String(versionCode)],
          releaseNotes: RELEASE_NOTES,
        },
      ],
    },
  });
  console.log(`Production track set: "${RELEASE_NAME}" status=${releaseStatus}`);

  console.log("Committing edit...");
  try {
    const commit = await publisher.edits.commit({
      packageName: PACKAGE_NAME,
      editId,
    });
    console.log(`COMMITTED (sent for review). Edit id: ${commit.data.id}`);
  } catch (e) {
    const msg = e.message || "";
    console.warn(`Plain commit failed: ${msg}`);
    console.log("Retrying with changesNotSentForReview=true ...");
    const commit = await publisher.edits.commit({
      packageName: PACKAGE_NAME,
      editId,
      changesNotSentForReview: true,
    });
    console.log(
      `COMMITTED but NOT sent for review — owner must click "Send for review" in Publishing overview. Edit id: ${commit.data.id}`
    );
  }
} catch (e) {
  console.error("PUBLISH FAILED:", e.message);
  if (e.response?.data) console.error(JSON.stringify(e.response.data, null, 2));
  try {
    await publisher.edits.delete({ packageName: PACKAGE_NAME, editId });
    console.log("Edit deleted (rolled back).");
  } catch {}
  process.exit(1);
}
