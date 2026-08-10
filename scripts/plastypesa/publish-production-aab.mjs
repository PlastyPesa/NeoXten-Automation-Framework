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
const RELEASE_NAME = process.env.PLASTYPESA_RELEASE_NAME || "PlastyPesa: Recycle & Learn — 1.0.46 (76)";

const RELEASE_NOTES = [
    {
        language: "en-GB",
        text: "Channel stays on Home between your week and Today — even when there is no news yet. Weekly climb numbers stay honest for Kenya. Daily quiz ads fail open calmly if an ad never loads. Sort and invite copy clearer. Closest Eco Guardian board while the founding campaign runs.",
    },
    {
        language: "it-IT",
        text: "Channel resta sulla Home tra la tua settimana e Oggi — anche senza notizie. I punti per salire in classifica in Kenya restano corretti. Se un annuncio del quiz non carica, il quiz continua con calma. Testi di sort e inviti più chiari. Tabellone Eco Guardian più vicino durante la campagna fondatrice.",
    },
    {
        language: "es-ES",
        text: "Channel permanece en Inicio entre tu semana y Hoy — aunque no haya noticias. Los puntos para subir en Kenia se muestran con honestidad. Si un anuncio del quiz no carga, el quiz sigue con calma. Textos de sort e invitaciones más claros. Tablero Eco Guardian cercano mientras dura la campaña fundadora.",
    },
    {
        language: "de-DE",
        text: "Channel bleibt auf Home zwischen deiner Woche und Heute — auch ohne Neuigkeiten. Die Kletterpunkte für Kenia bleiben ehrlich. Lädt eine Quiz-Anzeige nicht, geht das Quiz ruhig weiter. Sort- und Einladungs-Texte klarer. Nächstes Eco-Guardian-Board während der Gründerkampagne.",
    },
    {
        language: "fr-FR",
        text: "Channel reste sur l'accueil entre ta semaine et Aujourd'hui — même sans nouvelle. Les points pour monter au Kenya restent honnêtes. Si une pub du quiz ne charge pas, le quiz continue calmement. Textes de tri et d'invitation plus clairs. Tableau Eco Guardian proche pendant la campagne fondatrice.",
    },
    {
        language: "pt-PT",
        text: "O Channel fica no Início entre a tua semana e Hoje — mesmo sem notícias. Os pontos para subir no Quénia mantêm-se honestos. Se um anúncio do quiz não carregar, o quiz continua com calma. Textos de sort e convite mais claros. Quadro Eco Guardian próximo durante a campanha fundadora.",
    },
    {
        language: "ro",
        text: "Channel rămâne pe Acasă între săptămâna ta și Astăzi — chiar fără noutăți. Punctele pentru urcare în Kenya rămân corecte. Dacă o reclamă la quiz nu se încarcă, quiz-ul continuă calm. Texte de sort și invitații mai clare. Tabloul Eco Guardian apropiat în timpul campaniei fondatoare.",
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
