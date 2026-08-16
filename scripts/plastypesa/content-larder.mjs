/**
 * The content larder — how many days of content we actually have banked.
 *
 * Owner question 2026-08-16: *"whatever we need must be all ready, even if we
 * run for example daily tv episodes, we have everything ready."*
 *
 * Answers it from production, never from a board. Per surface: how much is
 * authored, how much is switched on, and how many days it lasts if we run it
 * daily.
 *
 * Collection names are the **Mongoose plurals** (`games`, `quiz_games`,
 * `masters`) — the singular names in `configs.json` are the model names and
 * reading them returns a confident zero, which is how a full quiz shelf once
 * looked empty.
 *
 *   node scripts/plastypesa/content-larder.mjs
 */
import { MongoClient } from "mongodb";
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(
  "C:/Users/Bobby/Documents/plastypesa-backend-api/.local/enable-sort-proof-master.js",
  "utf8",
);
const uri = vm.runInNewContext(src.match(/const DIRECT_URI\s*=\s*([\s\S]*?);[\r\n]/)[1], {});

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
await client.connect();
const db = client.db("plasty-pesa-prod");

const master = async (name) => {
  const doc = await db.collection("masters").findOne({ name });
  return doc ? doc.metadata : null;
};
const line = (label, value, note = "") =>
  console.log(`${label.padEnd(36)} ${String(value).padEnd(10)} ${note}`);

console.log("\n=== PLASTY TV (dormant) ===");
const eps = await db.collection("plasty_episodes").find({}).sort({ episodeNumber: 1 }).toArray();
const activeEps = eps.filter((e) => e.active === true);
const voiced = eps.filter((e) => (e.scenes || []).some((s) => s?.voice || s?.audio || s?.voiceKey));
line("episodes authored", eps.length);
line("episodes marked active", activeEps.length, `→ ${activeEps.length} days if daily`);
line("episodes with voice clips", voiced.length, voiced.length ? "" : "text-only for now");
line("switch  plasty-tv-enabled", JSON.stringify(await master("plasty-tv-enabled")), "null = OFF");
line("season  plasty-tv-season", JSON.stringify(await master("plasty-tv-season")));
line("voice   plasty-tv-voice-base", JSON.stringify(await master("plasty-tv-voice-base")));
line("award   plasty-tv-points", JSON.stringify(await master("plasty-tv-points")));
const missingCover = eps.filter((e) => !e.coverImageName).length;
const scenesNoImage = eps.reduce(
  (n, e) => n + (e.scenes || []).filter((s) => !s?.imageName && !s?.image).length,
  0,
);
line("episodes missing a cover", missingCover);
line("scenes missing an image", scenesNoImage);

console.log("\n=== SORTING DESK ===");
const sets = await db.collection("desk_weeksets").find({}).toArray();
line("week-sets authored", sets.length);
line("week-sets ACTIVE", sets.filter((s) => s.active === true).length, "0 = /desk/shift returns NO_DECK");
for (const s of sets) {
  console.log(
    `   - ${String(s.setKey || s._id).padEnd(14)} active=${String(s.active).padEnd(6)} days=${(s.days || []).length} items=${(s.items || []).length}  ${String(s.title || "")}`,
  );
}

console.log("\n=== DAILY QUIZ ===");
// The discriminator is `gameType`, not `type`. Reading `type` returns an empty
// distinct list and the shelf looks bare while a quiz is live — that false zero
// is exactly the kind of "evidence" that gets a working feature declared broken.
for (const t of await db.collection("games").distinct("gameType")) {
  const statuses = {};
  for (const st of await db.collection("games").distinct("status", { gameType: t })) {
    statuses[st] = await db.collection("games").countDocuments({ gameType: t, status: st });
  }
  line(`games gameType=${t}`, await db.collection("games").countDocuments({ gameType: t }), JSON.stringify(statuses));
}
const liveQuiz = await db.collection("games").find({ gameType: "QUIZ", status: "ACTIVE" }).toArray();
line(
  "ACTIVE quiz right now",
  liveQuiz.length,
  liveQuiz.map((q) => `"${String(q.title).slice(0, 46)}" daily=${q.dailyQuiz} played=${q.statistics?.totalAttempts ?? 0}`).join(" | ") ||
    "NOTHING LIVE — members have no quiz to earn",
);
const ahead = await db
  .collection("games")
  .find({ status: { $in: ["SCHEDULED", "STAGED", "DRAFT", "PENDING"] } })
  .toArray();
line(
  "staged for future days",
  ahead.length,
  ahead.length ? ahead.map((q) => `${q.status}:${String(q.title).slice(0, 40)}`).join(" | ") : "nothing queued — tomorrow is empty until someone stages it",
);
line("quiz_games (question banks)", await db.collection("quiz_games").countDocuments({}), "one per day already run");

console.log("\n=== LEARN / READ-TO-EARN ===");
const mods = await db.collection("learning_modules").find({}).toArray();
line("learning modules total", mods.length);
line("active", mods.filter((m) => m.isActive === true).length);
const themes = {};
for (const m of mods) themes[m.weeklyTheme || "-"] = (themes[m.weeklyTheme || "-"] || 0) + 1;
line("weekly themes covered", Object.keys(themes).length, JSON.stringify(themes));
line("read-min-words floor", JSON.stringify(await master("read-min-words")));
const rotation = await master("read-reward-rotation");
line("daily read rotation", Array.isArray(rotation) ? rotation.length : "no row");

console.log("\n=== CHANNEL ===");
const lines = await db.collection("channel_lines").find({}).toArray();
line("channel lines total", lines.length);
line("live now", lines.filter((l) => l.active === true || l.status === "ACTIVE").length);

console.log("\n=== WEEKLY CHALLENGE ===");
for (const k of [
  "weekly-challenge-state",
  "weekly-challenge-week",
  "weekly-challenge-title",
  "weekly-challenge-task",
  "weekly-challenge-winners",
  "weekly-challenge-payout-kes",
]) {
  line(k, JSON.stringify(await master(k)));
}
line("entries submitted", await db.collection("weekly_challenge_submissions").countDocuments({}).catch(() => 0));

console.log("\n=== ECO ACTION (deck source) ===");
line("eco action types", await db.collection("eco_action_types").countDocuments({}));
line("eco materials", await db.collection("eco_materials").countDocuments({}));

await client.close();
console.log("");
