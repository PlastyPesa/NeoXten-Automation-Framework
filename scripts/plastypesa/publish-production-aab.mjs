#!/usr/bin/env node
/**
 * Upload AAB + assign to production track + commit edit (bypasses broken Console Submit loop).
 *
 * STOP 45 (2026-08-08): Publisher "completed/available" ≠ every phone can Update yet.
 * Default = upload ONLY. Do NOT auto-arm the release-gate floor to the new code.
 * Arm only after a real device proves Play Update installs the new versionCode, then:
 *   node scripts/plastypesa/release-gate.mjs sync --force
 * or re-run this script with --arm-gate (or PLASTYPESA_GATE_SYNC=1).
 *
 * Usage:
 *   node scripts/plastypesa/publish-production-aab.mjs <path-to.aab> [versionCode]
 *   node scripts/plastypesa/publish-production-aab.mjs <path-to.aab> [versionCode] --arm-gate
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

const rawArgs = process.argv.slice(2);
const wantArmGate =
    rawArgs.includes("--arm-gate") || process.env.PLASTYPESA_GATE_SYNC === "1";
const positional = rawArgs.filter((a) => !a.startsWith("--") && a !== "arm-gate");
const aabPath = positional[0];
const versionCodeArg = positional[1];

if (!aabPath || !fs.existsSync(aabPath)) {
    console.error(
        "Usage: node publish-production-aab.mjs <aab-path> [versionCode] [--arm-gate]\n" +
            "  Default: upload only (stop 45 — no blind gate sync).\n" +
            "  --arm-gate or PLASTYPESA_GATE_SYNC=1: run release-gate sync --force after commit\n" +
            "    (only after a real phone proves Play Update installs this code)."
    );
    process.exit(2);
}

// Play caps release notes at 500 characters per language; assertReleaseNotes
// below fails the upload rather than letting the API truncate mid-sentence.
const RELEASE_NAME = process.env.PLASTYPESA_RELEASE_NAME || "PlastyPesa: Recycle & Learn — 1.0.43 (73)";

const RELEASE_NOTES = [
    {
        language: "en-GB",
        text: "The Home strip now carries only messages from the team, so nothing important gets buried. Paid Rewards Proof scrolls properly. A sort waiting for review shows as pending instead of a points total, so nothing is counted twice. If a sort photo fails to send, you now see why and can retry — calmly, without red alarm screens. Support replies can include images.",
    },
    {
        language: "it-IT",
        text: "La striscia in Home mostra solo i messaggi del team, così niente di importante resta nascosto. La prova delle ricompense pagate ora scorre correttamente. Un sort in attesa di revisione appare come in revisione invece di un totale punti, così nulla viene contato due volte. Se l'invio di una foto fallisce, vedi il motivo e puoi riprovare. Le risposte del supporto possono includere immagini.",
    },
    {
        language: "es-ES",
        text: "La franja de Inicio solo muestra mensajes del equipo, así nada importante queda oculto. La prueba de recompensas pagadas ahora se desplaza bien. Un sort en revisión aparece como pendiente en vez de un total de puntos, así nada se cuenta dos veces. Si el envío de una foto falla, ves el motivo y puedes reintentar. Las respuestas de soporte pueden incluir imágenes.",
    },
    {
        language: "de-DE",
        text: "Der Streifen auf Home zeigt nur noch Nachrichten vom Team, damit nichts Wichtiges untergeht. Der Nachweis ausgezahlter Belohnungen lässt sich jetzt richtig scrollen. Ein Sort in Prüfung erscheint als ausstehend statt mit Punktesumme, damit nichts doppelt zählt. Schlägt das Senden eines Fotos fehl, siehst du den Grund und kannst es erneut versuchen. Support-Antworten können Bilder enthalten.",
    },
    {
        language: "fr-FR",
        text: "Le bandeau de l'accueil ne montre plus que les messages de l'équipe, rien d'important n'est enfoui. La preuve des récompenses versées défile correctement. Un tri en attente de vérification s'affiche comme en cours plutôt qu'avec un total de points, rien n'est compté deux fois. Si l'envoi d'une photo échoue, tu vois pourquoi et tu peux réessayer. Le support peut répondre avec des images.",
    },
    {
        language: "pt-PT",
        text: "A faixa do Início mostra apenas mensagens da equipa, para nada importante ficar escondido. A prova de recompensas pagas já faz scroll corretamente. Um sort à espera de revisão aparece como pendente em vez de um total de pontos, para nada ser contado duas vezes. Se o envio de uma foto falhar, vês o motivo e podes tentar de novo. As respostas do apoio podem incluir imagens.",
    },
    {
        language: "ro",
        text: "Banda de pe Acasă arată doar mesajele echipei, ca nimic important să nu fie îngropat. Dovada recompenselor plătite se derulează corect. Un sort care așteaptă verificarea apare ca în așteptare, nu cu un total de puncte, ca nimic să nu fie numărat de două ori. Dacă trimiterea unei poze eșuează, vezi motivul și poți încerca din nou. Răspunsurile de la suport pot conține imagini.",
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

        const live = await readLivePlayVersion();
        console.log(
            `\nPlay live completed: ${live.releaseName} · versionCode ${live.versionCode} · ${live.status}`
        );
        if (String(live.versionCode) !== String(versionCode)) {
            console.warn(
                `\n*** Uploaded ${versionCode} but Play's live completed release is still ${live.versionCode} ` +
                    "(review pending?). ***"
            );
        }

        // STOP 45: never auto-raise floor on Publisher completed alone.
        if (!wantArmGate) {
            console.log(
                "\n*** PUBLISH OK — gate floor NOT changed (stop 45 default). ***\n" +
                    "*** Leave floor where it is until a real phone proves Play Update installs ***\n" +
                    `*** versionCode ${versionCode}. Then either:                                      ***\n` +
                    "***   node scripts/plastypesa/release-gate.mjs sync --force                     ***\n" +
                    "*** or re-run publish with --arm-gate / PLASTYPESA_GATE_SYNC=1                  ***\n"
            );
            return;
        }

        console.log(
            "\n--arm-gate / PLASTYPESA_GATE_SYNC=1: syncing gate to live Play (requires --force on blast)..."
        );
        const sync = spawnSync(
            process.execPath,
            [
                path.join(path.dirname(fileURLToPath(import.meta.url)), "release-gate.mjs"),
                "sync",
                "--force",
            ],
            { stdio: "inherit" }
        );
        if (sync.status !== 0) {
            console.error(
                "\n*** GATE NOT ARMED — upload succeeded but release-gate sync failed. ***\n" +
                    "*** Fix blast / --force policy, then:                                       ***\n" +
                    "***   node scripts/plastypesa/release-gate.mjs sync --force                 ***"
            );
            process.exit(1);
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
