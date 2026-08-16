#!/usr/bin/env node
/**
 * Daily quiz guard — "is tomorrow's quiz staged, and is today's the right one?"
 *
 * Why this exists (2026-08-16): nobody staged a payload for the Nairobi day
 * 2026-08-16. The 21:05 UTC publish job looks the day up by key, found nothing,
 * and did the only safe thing it could — nothing. So 2026-08-15's quiz stayed
 * ACTIVE, every member who had already played it opened the app to a quiz they
 * had finished, and the first anybody heard of it was members texting that "the
 * daily quiz is not working". Two members earned quiz points that morning
 * against 26–39 on an ordinary day.
 *
 * The failure was silent in both directions: nothing alarmed when the staging
 * was missed, and nothing alarmed when the publisher no-opped. A daily ritual
 * performed by a human will eventually be missed; the job of this script is to
 * make sure the *next* miss is discovered before midnight instead of by the
 * people we owe points to.
 *
 * Exit codes: 0 all clear · 1 something is wrong. Run it any time; it is
 * read-only and answers for whatever moment you run it.
 *
 *   npm run test:plastypesa-quiz-guard
 */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { loadBackendMongoEnv } from "./mongo-env.mjs";

const require = createRequire(
  resolve("C:/Users/Bobby/Documents/plastypesa-backend-api/lib/lambda/backend/package.json"),
);
const { MongoClient, ObjectId } = require("mongodb");

const nairobiKey = (at = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);

const oid = (v) => {
  try {
    return v instanceof ObjectId ? v : new ObjectId(String(v));
  } catch {
    return null;
  }
};

const today = nairobiKey();
const tomorrow = nairobiKey(new Date(Date.now() + 86400000));

const problems = [];
const notes = [];

const client = new MongoClient(loadBackendMongoEnv());
await client.connect();
const db = client.db();

/* ── 1. exactly one live daily quiz ─────────────────────────────────────── */
const live = await db
  .collection("games")
  .find({ gameType: "QUIZ", dailyQuiz: true, status: "ACTIVE" })
  .toArray();

if (live.length === 0) {
  problems.push("No ACTIVE daily quiz at all — the Learn tab has nothing to open.");
} else if (live.length > 1) {
  problems.push(
    `${live.length} daily quizzes are ACTIVE at once. Members can earn the full ` +
      `award more than once a day only if the per-day guard holds; either way the ` +
      `Home tile becomes ambiguous. Ids: ${live.map((g) => g._id).join(", ")}`,
  );
}

/* ── 2. today's live quiz must be today's, not a leftover ───────────────── */
// The publisher runs at 00:05 Nairobi, so the row it creates is stamped with
// today's Nairobi date. A live quiz stamped with an earlier day means the job
// had nothing to publish and yesterday's simply never got replaced — which is
// exactly the shape of the 2026-08-16 outage.
for (const g of live) {
  const born = nairobiKey(new Date(g.createdAt));
  if (born !== today) {
    problems.push(
      `The live quiz "${g.title}" was created on Nairobi day ${born}, but today is ` +
        `${today}. Members who played it already see a quiz they have finished.`,
    );
  } else {
    notes.push(`Live quiz is today's (${born}): "${g.title}"`);
  }

  /* ── 3. and it must actually be playable ──────────────────────────────── */
  const qg = g.quizGameId ? await db.collection("quiz_games").findOne({ _id: oid(g.quizGameId) }) : null;
  const qs = qg?.questions ?? [];
  if (!qs.length) {
    problems.push(`The live quiz "${g.title}" has no questions attached.`);
  } else {
    if (qs.length !== 10) problems.push(`The live quiz has ${qs.length} questions; the lock is 10.`);
    const noImage = qs.filter((q) => !q.image && !q.imageUrl).length;
    if (noImage) problems.push(`${noImage} of ${qs.length} live questions have no image.`);
    const noAnswer = qs.filter(
      (q) => q.correctAnswerIndex === undefined || q.correctAnswerIndex === null,
    ).length;
    if (noAnswer) problems.push(`${noAnswer} live questions have no correct answer index.`);
    notes.push(`Live quiz shape: ${qs.length} questions, ${qs.length - noImage} with images`);
  }

  const reward = g.rewardId ? await db.collection("game_rewards").findOne({ _id: oid(g.rewardId) }) : null;
  if (!reward) problems.push(`The live quiz "${g.title}" has no reward row — finishing it pays nothing.`);
  else notes.push(`Live quiz reward: ${reward.rewardPoints} points`);
}

/* ── 4. tomorrow has to already be staged ───────────────────────────────── */
// This is the check that would have caught the outage. The publisher fires at
// 21:05 UTC today for tomorrow's Nairobi day; if the payload is not sitting in
// Mongo by then, tomorrow repeats today.
const sched = await db.collection("masters").findOne({ name: "scheduled-daily-publish" });
const byDate = sched?.metadata?.byDate ?? {};
const staged = byDate[tomorrow];

if (!staged) {
  problems.push(
    `Nothing is staged for tomorrow (${tomorrow} Nairobi). The publish job fires at ` +
      `21:05 UTC today and will find no payload, so today's quiz stays live and ` +
      `tomorrow repeats this outage. Stage it with .local-stage-daily-publish.mjs.`,
  );
} else {
  const qCount = Array.isArray(staged.quizContent?.questions) ? staged.quizContent.questions.length : 0;
  if (qCount !== 10) problems.push(`Tomorrow is staged with ${qCount} questions; the lock is 10.`);
  const missingImages = (staged.quizContent?.questions ?? []).filter(
    (q) => !q.imageUrl && !q.image,
  ).length;
  if (missingImages) problems.push(`Tomorrow has ${missingImages} questions with no image.`);
  if (!staged.visualVerified) {
    problems.push("Tomorrow is staged but not marked visually verified.");
  }
  const hard = (staged.quizContent?.questions ?? []).filter(
    (q) => String(q.difficulty).toLowerCase() === "hard",
  ).length;
  if (hard !== 2) notes.push(`Tomorrow has ${hard} hard questions (the shape is 2).`);
  notes.push(`Tomorrow (${tomorrow}) staged: "${staged.quizContent?.title}" · ${qCount} questions`);
}

/* ── 5. did today's members actually earn? ──────────────────────────────── */
// A live quiz that nobody completes is the same outage wearing a disguise, so
// the guard reports the count rather than trusting the rows above.
const txToday = await db
  .collection("transactions")
  .countDocuments({ type: "QUIZ_COMPLETION", activityDayKey: today, awardReason: "active_daily" });
notes.push(`Full daily awards written so far today: ${txToday}`);

await client.close();

for (const n of notes) console.log(`  ok   ${n}`);
if (problems.length) {
  console.log("");
  for (const p of problems) console.log(`  FAIL ${p}`);
  console.log(`\nDAILY_QUIZ_GUARD FAIL (${problems.length})`);
  process.exit(1);
}
console.log("\nDAILY_QUIZ_GUARD PASS");
