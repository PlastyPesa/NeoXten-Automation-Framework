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

// Play caps release notes at 500 characters per language; assertReleaseNotes
// below fails the upload rather than letting the API truncate mid-sentence.
const RELEASE_NAME = process.env.PLASTYPESA_RELEASE_NAME || "PlastyPesa: Recycle & Learn — 1.0.37 (57)";

const RELEASE_NOTES = [
    {
        language: "en-GB",
        text: "Weekly points now reset every Monday, and the app says so clearly. Past reward slots show their real status — closed or paid — instead of a stale \"being processed\". Updated reward rules in Terms: a 7-day claim window and what happens when a slot is not claimed. In-app updates now arrive in your language. Long reward and proof lists scroll inside their card. Home shows how active the community is. Install the latest version.",
    },
    {
        language: "it-IT",
        text: "I punti settimanali si azzerano ogni lunedì e l'app lo indica chiaramente. Le posizioni di ricompensa passate mostrano lo stato reale — chiusa o pagata — invece di un \"in elaborazione\" non aggiornato. Regole aggiornate nei Termini: finestra di 7 giorni per la richiesta e cosa succede se una posizione non viene richiesta. Gli avvisi in-app arrivano nella tua lingua. Le liste lunghe scorrono dentro la scheda. La home mostra quanto è attiva la community. Installa l'ultima versione.",
    },
    {
        language: "es-ES",
        text: "Los puntos semanales se reinician cada lunes y la app lo indica con claridad. Las plazas de recompensa pasadas muestran su estado real — cerrada o pagada — en lugar de un \"en proceso\" desactualizado. Reglas actualizadas en los Términos: plazo de 7 días para reclamar y qué ocurre si una plaza no se reclama. Los avisos dentro de la app llegan en tu idioma. Las listas largas se desplazan dentro de la tarjeta. El inicio muestra la actividad de la comunidad. Instala la última versión.",
    },
    {
        language: "de-DE",
        text: "Wochenpunkte werden jetzt jeden Montag zurückgesetzt, und die App sagt das klar. Frühere Belohnungsplätze zeigen ihren echten Status — abgeschlossen oder ausgezahlt — statt eines veralteten \"wird bearbeitet\". Aktualisierte Regeln in den Nutzungsbedingungen: 7 Tage Zeit für die Anforderung und was passiert, wenn ein Platz nicht angefordert wird. Hinweise in der App kommen in deiner Sprache. Lange Listen scrollen innerhalb der Karte. Neueste Version installieren.",
    },
    {
        language: "fr-FR",
        text: "Les points hebdomadaires sont remis à zéro chaque lundi, et l'app l'indique clairement. Les places de récompense passées affichent leur vrai statut — clôturée ou payée — au lieu d'un \"en cours de traitement\" obsolète. Règles mises à jour dans les Conditions : 7 jours pour faire la demande et ce qui se passe si une place n'est pas demandée. Les avis dans l'app arrivent dans ta langue. Les longues listes défilent dans la carte. Installe la dernière version.",
    },
    {
        language: "pt-PT",
        text: "Os pontos semanais são reiniciados todas as segundas-feiras e a app indica-o com clareza. As posições de recompensa anteriores mostram o estado real — fechada ou paga — em vez de um \"em processamento\" desatualizado. Regras atualizadas nos Termos: prazo de 7 dias para pedir e o que acontece se uma posição não for pedida. Os avisos na app chegam no teu idioma. As listas longas deslizam dentro do cartão. Instala a versão mais recente.",
    },
    {
        language: "ro",
        text: "Punctele săptămânale se resetează în fiecare luni, iar aplicația spune asta clar. Locurile de recompensă din trecut arată starea reală — închisă sau plătită — în loc de un \"în procesare\" învechit. Reguli actualizate în Termeni: termen de 7 zile pentru cerere și ce se întâmplă dacă un loc nu este cerut. Anunțurile din aplicație ajung în limba ta. Listele lungi derulează în interiorul cardului. Instalează cea mai recentă versiune.",
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
