#!/usr/bin/env node
/**
 * Upload AAB + assign to production track + commit edit (bypasses broken Console Submit loop).
 *
 * Usage:
 *   node scripts/plastypesa/publish-production-aab.mjs <path-to.aab> [versionCode]
 */
import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";

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

const RELEASE_NOTES = [
    {
        language: "en-GB",
        text: "Learn-first daily tip: tap the tip on Learn to read the lesson and take the quiz. Home no longer duplicates it. Past champions history shows last week’s winners. Install the latest version for the best experience.",
    },
    {
        language: "it-IT",
        text: "Consiglio giornaliero in Impara: tocca il consiglio per leggere la lezione e fare il quiz. Home non lo duplica più. Storico campioni passati aggiornato. Installa l’ultima versione.",
    },
    {
        language: "es-ES",
        text: "Consejo diario en Aprender: toca el consejo para leer la lección y hacer el quiz. Inicio ya no lo duplica. Historial de campeones pasados actualizado. Instala la última versión.",
    },
    {
        language: "de-DE",
        text: "Tipp des Tages unter Lernen: tippe den Tipp, lies die Lektion und mache das Quiz. Home zeigt ihn nicht mehr doppelt. Vergangene Champions aktualisiert. Neueste Version installieren.",
    },
    {
        language: "fr-FR",
        text: "Conseil du jour dans Apprendre : touche le conseil pour lire la leçon et faire le quiz. Accueil ne le duplique plus. Historique des champions passés à jour. Installe la dernière version.",
    },
    {
        language: "pt-PT",
        text: "Dica diária em Aprender: toca na dica para ler a lição e fazer o quiz. Início já não duplica. Histórico de campeões passados atualizado. Instala a versão mais recente.",
    },
    {
        language: "ro",
        text: "Sfat zilnic la Învață: apasă sfatul pentru lecție și quiz. Acasă nu mai duplică. Istoric campioni trecuți actualizat. Instalează cea mai recentă versiune.",
    },
];

async function main() {
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
                        name: "PlastyPesa: Recycle & Learn",
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
