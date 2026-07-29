/**
 * Insert owner+agent verified daily quiz draft → approve via admin API.
 *   node scripts/plastypesa/.local-publish-owner-daily-quiz.mjs
 *
 * Always replace Q + title before each publish — never republish yesterday's quiz.
 * Visual Q↔image proof required in-session before running (owner GO).
 */
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { loadBackendMongoEnv } from "./mongo-env.mjs";
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { getConfig, url } from "./config.mjs";
import { loadAdminDashboardCredentials } from "./credential-registry.mjs";

const require = createRequire(
  resolve("C:/Users/Bobby/Documents/plastypesa-backend-api/lib/lambda/backend/package.json"),
);
const { MongoClient } = require("mongodb");

const BUCKET = "prod-plasty-pesa-user-profile-imgs";
const REGION = "eu-west-2";
const s3url = (key) => `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;

/**
 * 2026-07-30 UTC — theme: Mission Campaign Week2 Day3 "Your sort creates jobs"
 * Visual verified this session (local catalogue files read pixel-side).
 */
const Q = [
  {
    question:
      "A dedicated plastic packaging bin like this is the first step toward what?",
    options: [
      "Collecting clean plastic so recycling plants and jobs can use it",
      "Throwing food waste and bottles into one mixed bag",
      "Burning all plastic in the street",
      "Stopping recycling forever",
    ],
    answer: "Collecting clean plastic so recycling plants and jobs can use it",
    explanation:
      "Household collection of plastic packaging is step one in the circular chain — collection, sorting hubs, and recycling jobs need clean material.",
    topic: "recycling",
    imageUrl: s3url(
      "quiz-images/quiz-images/verified/recycling/plastic-recycling-bin-reykjavik.jpg",
    ),
  },
  {
    question: "Bottles gathered in a cage like this are usually waiting for what?",
    options: [
      "Recycling collection / processing (often PET, code 1)",
      "Immediate landfill with no further use",
      "Only decorative display",
      "Mixing with wet food waste on purpose",
    ],
    answer: "Recycling collection / processing (often PET, code 1)",
    explanation:
      "Caged bottle take-back is a collection step. Clear drink bottles are typically PET (code 1). Clean empties keep the stream usable.",
    topic: "plastic-types",
    imageUrl: s3url(
      "quiz-images/quiz-images/verified/plastic-types/clear-pet-bottles-recycling-pile.jpg",
    ),
  },
  {
    question: "A large outdoor pile of bottles like this mainly shows what need?",
    options: [
      "Organised collection and recycling jobs — not leaving plastic in the open",
      "That plastic disappears on its own in a week",
      "That sorting at home never matters",
      "That only glass can be recycled",
    ],
    answer:
      "Organised collection and recycling jobs — not leaving plastic in the open",
    explanation:
      "Loose dumps of bottles are a collection failure. Grade-sorting at home + organised pickup feeds recycling work instead of open piles.",
    topic: "recycling",
    imageUrl: s3url(
      "quiz-images/quiz-images/verified/recycling/plastic-bottles-gathered-for-recycling.jpg",
    ),
  },
  {
    question: "Compressed bales of bottles like this usually mean what stage?",
    options: [
      "Industrial recycling processing after collection and sorting",
      "Brand-new bottles ready for the shop shelf",
      "Ocean cleanup with no land recycling",
      "Paper-only recycling",
    ],
    answer: "Industrial recycling processing after collection and sorting",
    explanation:
      "Baling PET bottles is a recycling-plant step. Clean, sorted household plastic is what makes those processing jobs possible.",
    topic: "recycling",
    imageUrl: s3url(
      "quiz-images/quiz-images/verified/plastic-types/bales-of-pet-bottles-closeup.jpg",
    ),
  },
  {
    question:
      "If plastic escapes the circular chain, scenes like this beach show what?",
    options: [
      "Plastic pollution on the coast — the cost of weak collection and sorting",
      "A clean natural beach with no human waste",
      "Successful home sorting already finished",
      "Only wooden fishing gear, never plastic",
    ],
    answer:
      "Plastic pollution on the coast — the cost of weak collection and sorting",
    explanation:
      "When plastic is not collected and recycled, it becomes marine debris. Home grade-sorting helps keep material in the jobs/circular loop.",
    topic: "ocean-pollution",
    imageUrl: s3url(
      "quiz-images/quiz-images/verified/ocean-pollution/marine-debris-hawaiian-coast.jpg",
    ),
  },
];

const draftId = `owner-quiz-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
const content = {
  title: "Your sort creates jobs: collection to recycling",
  description:
    "See how clean plastic packaging, PET collection, baling, and stopping coastal waste connect household sorting to recycling jobs.",
  questions: Q,
  quizConfigs: { difficulty: "medium", timeLimit: 90, maxAttempts: 1 },
  reward: {
    name: "Daily quiz",
    rewardType: "POINTS",
    rewardPoints: 1000,
    scorePercentageRequiredForReward: 0,
  },
  schedule: {
    startDate: new Date().toISOString(),
    startTime: "00:00:00",
  },
  source: "owner-agent-copilot",
};

loadBackendMongoEnv();
const client = new MongoClient(loadBackendMongoEnv());
await client.connect();
const db = client.db();
const master = await db.collection("masters").findOne({ name: "content-drafts" });
const prev = Array.isArray(master?.metadata?.drafts) ? master.metadata.drafts : [];
const draft = {
  id: draftId,
  type: "quiz",
  status: "pending",
  createdAt: new Date().toISOString(),
  content,
  meta: {
    authoredBy: "owner-agent-copilot",
    visualVerified: true,
    visualVerifiedAt: new Date().toISOString(),
    missionTemplateId: "week2_day3_jobs",
  },
};
await db.collection("masters").updateOne(
  { name: "content-drafts" },
  {
    $set: {
      metadata: { drafts: [...prev, draft] },
      updatedAt: new Date(),
    },
    $setOnInsert: {
      type: "dynamic",
      placeholder: "",
      data: [],
      name: "content-drafts",
    },
  },
  { upsert: true },
);
await client.close();
console.log("DRAFT_INSERTED", draftId);

bootstrapPlastyPesaEnv();
const cfg = getConfig();
let tok = existsSync(".neoxten/admin-token-tmp.txt")
  ? readFileSync(".neoxten/admin-token-tmp.txt", "utf8").trim()
  : "";
if (!tok) {
  const login = await fetch(url(cfg, "/auth/admin-login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(loadAdminDashboardCredentials()),
  });
  const b = await login.json();
  tok = b?.data?.token || b?.token;
}
const approve = await fetch(url(cfg, `/admin/automation/drafts/${draftId}`), {
  method: "PUT",
  headers: {
    Authorization: `Bearer ${tok}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ action: "approve" }),
});
const ab = await approve.json().catch(() => ({}));
console.log("APPROVE", approve.status, ab?.message || JSON.stringify(ab).slice(0, 300));
writeFileSync(
  ".neoxten/owner-daily-quiz-publish.json",
  JSON.stringify({ draftId, approveStatus: approve.status, body: ab, content }, null, 2),
);

const client2 = new MongoClient(loadBackendMongoEnv());
await client2.connect();
const db2 = client2.db();
const live = await db2
  .collection("games")
  .find({ dailyQuiz: true, status: "ACTIVE" })
  .project({ title: 1, createdAt: 1, dailyQuiz: 1, isAutomated: 1, quizGameId: 1, rewardId: 1 })
  .toArray();
console.log(
  "ACTIVE_DAILY",
  live.map((g) => `${g._id} ${g.title} automated=${g.isAutomated} rewardId=${g.rewardId}`),
);
for (const g of live) {
  if (!g.rewardId) continue;
  const rew = await db2.collection("game_rewards").findOne(
    { _id: g.rewardId },
    { projection: { rewardPoints: 1, name: 1 } },
  );
  console.log("REWARD", g._id.toString(), rew?.rewardPoints, rew?.name);
}
await client2.close();
