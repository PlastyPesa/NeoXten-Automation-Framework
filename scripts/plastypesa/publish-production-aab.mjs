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
const RELEASE_NAME = process.env.PLASTYPESA_RELEASE_NAME || "PlastyPesa: Recycle & Learn — 1.0.49 (80)";

const RELEASE_NOTES = [
    {
        language: "en-GB",
        text: `Sort photos now use the PlastyPesa camera inside the app — take it, check it, retake if you want, then send. No more photos lost handing off to another camera app. It works for Sort by Grade and for Eco Action.
Support reads better: the Send button and the privacy note stay clear of your phone's navigation bar, and your message screenshots show properly.
Home, Leaderboard and Profile are tidier, with more translations.
Keep sorting, keep learning, keep earning rewards.`,
    },
    {
        language: "it-IT",
        text: `Le foto di raccolta ora usano la fotocamera PlastyPesa dentro l'app: scatta, controlla, rifai se vuoi, poi invia. Niente più foto perse passando a un'altra app fotocamera. Vale per la raccolta per tipo e per Eco Action.
L'Assistenza si legge meglio: il pulsante Invia e la nota sulla privacy restano sopra la barra di navigazione e le schermate dei messaggi si vedono bene.
Home, Classifica e Profilo più ordinati, con più traduzioni.
Continua a raccogliere, imparare e ottenere ricompense.`,
    },
    {
        language: "es-ES",
        text: `Las fotos de clasificación ya usan la cámara de PlastyPesa dentro de la app: hazla, revísala, repítela si quieres y envíala. No se pierden fotos al usar otra app. Sirve para clasificar por tipo y para Eco Action.
Soporte se lee mejor: el botón Enviar y el aviso de privacidad quedan por encima de la barra de navegación, y las capturas de tus mensajes se ven bien.
Inicio, Clasificación y Perfil más ordenados, con más traducciones.
Sigue clasificando, aprendiendo y ganando recompensas.`,
    },
    {
        language: "de-DE",
        text: `Sortier-Fotos nutzen jetzt die PlastyPesa-Kamera in der App: aufnehmen, prüfen, bei Bedarf wiederholen, dann senden. Keine verlorenen Fotos mehr durch andere Kamera-Apps. Gilt für Sortieren und Eco Action.
Der Support ist klarer: Senden-Button und Datenschutzhinweis bleiben über der Navigationsleiste, und Screenshots deiner Nachrichten werden richtig angezeigt.
Start, Rangliste und Profil sind aufgeräumter, mit mehr Übersetzungen.
Weiter sortieren, lernen und Belohnungen verdienen.`,
    },
    {
        language: "fr-FR",
        text: `Les photos de tri utilisent l'appareil photo PlastyPesa dans l'app : prends, vérifie, refais si tu veux, puis envoie. Plus de photos perdues via une autre app photo. Valable pour le tri par type et Eco Action.
Le Support se lit mieux : le bouton Envoyer et la note de confidentialité restent au-dessus de la barre de navigation ; les captures de tes messages s'affichent bien.
Accueil, Classement et Profil plus nets et mieux traduits.
Continue à trier, apprendre et gagner des récompenses.`,
    },
    {
        language: "pt-PT",
        text: `As fotos de separação passam a usar a câmara PlastyPesa dentro da app: tira, confere, repete se quiseres e envia. Já não se perdem fotos ao passar para outra app de câmara. Serve para separar por tipo e para a Eco Action.
O Suporte lê-se melhor: o botão Enviar e a nota de privacidade ficam acima da barra de navegação, e as capturas das tuas mensagens aparecem bem.
Início, Classificação e Perfil mais arrumados, com mais traduções.
Continua a separar, aprender e ganhar recompensas.`,
    },
    {
        language: "ro",
        text: `Pozele de sortare folosesc acum camera PlastyPesa din aplicație: fotografiază, verifică, reia dacă vrei, apoi trimite. Nu se mai pierd poze la altă aplicație de cameră. Merge pentru sortarea după grad și Eco Action.
Asistența se citește mai bine: butonul Trimite și nota de confidențialitate rămân deasupra barei de navigare, iar capturile mesajelor tale se văd corect.
Acasă, Clasament și Profil mai ordonate, cu mai multe traduceri.
Continuă să sortezi, să înveți și să câștigi recompense.`,
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
        const totalBytes = fs.statSync(aabPath).size;
        console.log(`Uploading bundle: ${aabPath} (${totalBytes} bytes)`);

        // A 100 MB upload on a flaky line once hung for ~53 minutes with no output,
        // so the stream reports progress: silent bytes mean dead, not slow.
        const body = fs.createReadStream(aabPath);
        let sent = 0;
        let lastLogged = 0;
        body.on("data", (chunk) => {
            sent += chunk.length;
            if (sent - lastLogged >= 10 * 1024 * 1024 || sent === totalBytes) {
                lastLogged = sent;
                const pct = ((sent / totalBytes) * 100).toFixed(1);
                console.log(`  sent ${sent}/${totalBytes} bytes (${pct}%) ${new Date().toISOString()}`);
            }
        });

        const upload = await ap.edits.bundles.upload(
            {
                packageName: PACKAGE,
                editId,
                media: { mimeType: "application/octet-stream", body },
            },
            { timeout: 30 * 60 * 1000 }
        );
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
