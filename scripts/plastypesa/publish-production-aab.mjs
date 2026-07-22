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
        text: "Clearer home updates: pinned fairness messages, tap any notification for the full text, daily tips and articles first on Learn, and honest “kg sorted (est.)” labels until hubs weigh material. Fair weekly ranking help.",
    },
    {
        language: "it-IT",
        text: "Home più chiara: messaggi importanti fissi, tocca una notifica per il testo completo, consigli e articoli per primi in Impara, etichette oneste “kg smistati (st.)” finché gli hub non pesano. Classifica settimanale più equa.",
    },
    {
        language: "es-ES",
        text: "Inicio más claro: avisos fijados, toca una notificación para leer todo, consejos y artículos primero en Aprender, etiquetas honestas “kg clasificados (est.)” hasta que los hubs pesen. Clasificación semanal más justa.",
    },
    {
        language: "de-DE",
        text: "Klareres Home: angeheftete Hinweise, tippe Benachrichtigungen für den vollen Text, Tipps und Artikel zuerst unter Lernen, ehrliche „kg sortiert (Schätz.)“ bis Hubs wiegen. Fairere Wochenrangliste.",
    },
    {
        language: "fr-FR",
        text: "Accueil plus clair : messages épinglés, touche une notification pour le texte complet, conseils et articles en premier dans Apprendre, libellés honnêtes « kg triés (est.) » jusqu’aux hubs. Classement hebdo plus équitable.",
    },
    {
        language: "pt-PT",
        text: "Início mais claro: avisos fixos, toca numa notificação para ler tudo, dicas e artigos primeiro em Aprender, rótulos honestos “kg triados (est.)” até os hubs pesarem. Classificação semanal mais justa.",
    },
    {
        language: "ro",
        text: "Acasă mai clar: mesaje fixate, apasă o notificare pentru textul complet, sfaturi și articole primele la Învață, etichete oneste „kg sortate (est.)” până cântăresc hub-urile. Clasament săptămânal mai corect.",
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
