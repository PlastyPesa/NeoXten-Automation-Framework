#!/usr/bin/env node
/**
 * Upload AAB + assign to production track + commit edit (bypasses broken Console Submit loop).
 *
 * After a successful commit this ALWAYS runs `release-gate.mjs sync` (FORCE
 * LATEST FOREVER, owner lock 2026-07-27): the gate floor follows every
 * production release automatically, with blockUnreported:true. If the sync
 * fails, this script exits non-zero — the publish is not done.
 *
 * Usage:
 *   node scripts/plastypesa/publish-production-aab.mjs <path-to.aab> [versionCode]
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";
import { readLivePlayVersion } from "./play-live-version.mjs";

const PACKAGE = process.env.PLASTYPESA_PACKAGE_NAME || "com.app.plasty_pesa";
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

const aabPath = process.argv[2];
const versionCodeArg = process.argv[3];

if (!aabPath || !fs.existsSync(aabPath)) {
    console.error("Usage: node publish-production-aab.mjs <aab-path> [versionCode]");
    process.exit(2);
}

// Play caps release notes at 500 characters per language; assertReleaseNotes
// below fails the upload rather than letting the API truncate mid-sentence.
const RELEASE_NAME = process.env.PLASTYPESA_RELEASE_NAME || "PlastyPesa: Recycle & Learn — 1.0.39 (59)";

const RELEASE_NOTES = [
    {
        language: "en-GB",
        text: "Learn Videos now play fullscreen. Daily tip on Learn. Clearer sort review notes and claim-day countdown. Points inbox for Read and EcoSort. Weekly board resets Monday. Install for the newest fixes.",
    },
    {
        language: "it-IT",
        text: "I video di Learn ora vanno a schermo intero. Suggerimento giornaliero in Learn. Note di revisione sort più chiare e conto alla rovescia dei giorni per la richiesta. Notifiche punti per Read e EcoSort. Classifica settimanale azzerata il lunedì.",
    },
    {
        language: "es-ES",
        text: "Los vídeos de Learn ahora a pantalla completa. Consejo diario en Learn. Notas de revisión de sort más claras y cuenta atrás de días para reclamar. Aviso de puntos por Read y EcoSort. El tablero semanal se reinicia el lunes.",
    },
    {
        language: "de-DE",
        text: "Learn-Videos jetzt im Vollbild. Täglicher Tipp unter Learn. Klarere Sort-Prüfnotizen und Tage-Countdown für die Anforderung. Punkte-Inbox für Read und EcoSort. Wochenboard setzt montags zurück.",
    },
    {
        language: "fr-FR",
        text: "Les vidéos Learn passent en plein écran. Astuce du jour dans Learn. Notes de révision sort plus claires et compte à rebours des jours pour la demande. Inbox de points pour Read et EcoSort. Le classement hebdo se réinitialise le lundi.",
    },
    {
        language: "pt-PT",
        text: "Vídeos de Learn agora em ecrã inteiro. Dica diária em Learn. Notas de revisão de sort mais claras e contagem de dias para reclamar. Caixa de pontos para Read e EcoSort. O quadro semanal reinicia à segunda-feira.",
    },
    {
        language: "ro",
        text: "Videoclipurile Learn rulează pe ecran complet. Sfat zilnic în Learn. Note de revizuire sort mai clare și numărătoare a zilelor pentru revendicare. Inbox de puncte pentru Read și EcoSort. Clasamentul săptămânal se resetează luni.",
    },
];

const PLAY_LOCALES = ["en-GB", "it-IT", "es-ES", "de-DE", "fr-FR", "pt-PT", "ro"];
// Brand lock: PlastyPesa is learning + recycling, never a game of chance.
// Checked here because a bad word reaches every Play listing at once.
const BANNED_WORDING =
    /\b(prize|prizes|lottery|jackpot|gambl\w*|premio|premi|lotteria|loteria|lotería|sorteo|vincita|vincere|loterie|cagnotte|tirage au sort|Lotterie|Gewinnspiel|sorteio)\b/i;

function assertReleaseNotes() {
    const seen = RELEASE_NOTES.map((n) => n.language);
    const missing = PLAY_LOCALES.filter((l) => !seen.includes(l));
    if (missing.length) throw new Error(`release notes missing locales: ${missing.join(", ")}`);

    for (const note of RELEASE_NOTES) {
        if (note.text.length > 500) {
            throw new Error(`release notes too long for ${note.language}: ${note.text.length} chars (max 500)`);
        }
        const hit = note.text.match(BANNED_WORDING);
        if (hit) throw new Error(`release notes for ${note.language} use banned wording: "${hit[0]}"`);
    }
    console.log(`Release notes OK: ${RELEASE_NOTES.length} locales, longest ${Math.max(...RELEASE_NOTES.map((n) => n.text.length))} chars`);
}

async function main() {
    assertReleaseNotes();

    const auth = await new google.auth.GoogleAuth({
        keyFile: SA_PATH,
        scopes: ["https://www.googleapis.com/auth/androidpublisher"],
    }).getClient();

    const ap = google.androidpublisher({ version: "v3", auth });

    console.log("Creating edit...");
    const editRes = await ap.edits.insert({ packageName: PACKAGE, requestBody: {} });
    const editId = editRes.data.id;

    try {
        console.log("Uploading bundle:", aabPath);
        const upload = await ap.edits.bundles.upload({
            packageName: PACKAGE,
            editId,
            media: { mimeType: "application/octet-stream", body: fs.createReadStream(aabPath) },
        });
        const versionCode = String(upload.data.versionCode || versionCodeArg);
        console.log("Uploaded versionCode:", versionCode);

        console.log("Updating production track...");
        await ap.edits.tracks.update({
            packageName: PACKAGE,
            editId,
            track: "production",
            requestBody: {
                track: "production",
                releases: [
                    {
                        name: RELEASE_NAME,
                        status: "completed",
                        versionCodes: [versionCode],
                        releaseNotes: RELEASE_NOTES,
                    },
                ],
            },
        });

        console.log("Committing edit (sends for review / publishes)...");
        const commit = await ap.edits.commit({ packageName: PACKAGE, editId });
        console.log("Commit OK:", JSON.stringify(commit.data, null, 2));

        // Verify committed production track
        const verifyEdit = (await ap.edits.insert({ packageName: PACKAGE, requestBody: {} })).data.id;
        try {
            const track = await ap.edits.tracks.get({
                packageName: PACKAGE,
                editId: verifyEdit,
                track: "production",
            });
            console.log("Post-commit production track:", JSON.stringify(track.data, null, 2));
        } finally {
            await ap.edits.delete({ packageName: PACKAGE, editId: verifyEdit });
        }

        // FORCE LATEST FOREVER (owner lock 2026-07-27): a production upload is
        // not done until the release gate follows it. `sync` arms the floor to
        // whatever Play reports as the *completed* live release — if this
        // upload is still in review, the previous live code stays the floor
        // and the operator must re-run sync once Play flips it live. Arming to
        // an unreleased code would refuse users who have no update to install.
        console.log("\nArming release gate to live Play (FORCE LATEST FOREVER)...");
        const sync = spawnSync(
            process.execPath,
            [path.join(path.dirname(fileURLToPath(import.meta.url)), "release-gate.mjs"), "sync"],
            { stdio: "inherit" }
        );
        if (sync.status !== 0) {
            console.error(
                "\n*** GATE NOT ARMED — the upload succeeded but the release gate did not sync. ***\n" +
                    "*** The publish is NOT complete. Fix and run:                               ***\n" +
                    "***   node scripts/plastypesa/release-gate.mjs sync                          ***"
            );
            process.exit(1);
        }
        const live = await readLivePlayVersion();
        if (String(live.versionCode) !== String(versionCode)) {
            console.warn(
                `\n*** Uploaded ${versionCode} but Play's live completed release is still ${live.versionCode} ` +
                    "(review pending?). Gate floor = " + live.versionCode + ". ***\n" +
                    "*** RE-RUN once the new release is live:                                     ***\n" +
                    "***   node scripts/plastypesa/release-gate.mjs sync                          ***"
            );
        }
    } catch (e) {
        console.error("FAILED:", e.response?.data || e.message || e);
        try {
            await ap.edits.delete({ packageName: PACKAGE, editId });
        } catch {
            /* ignore */
        }
        process.exit(1);
    }
}

main();
