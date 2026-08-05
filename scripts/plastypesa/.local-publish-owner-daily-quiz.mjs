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
 * 2026-08-05 Nairobi — theme: "Know your grade: the plastic in your own kitchen".
 *
 * Five questions, not ten: the 10Q + 2-hard redesign is a separate owner
 * decision and is deliberately out of this publish. Every question is
 * answerable from what is actually in the picture, and each picture was opened
 * and looked at this session before it was wired to its question:
 *
 *   milk jug        opaque white jug, moulded handle, pink screw cap  -> HDPE
 *   food container  translucent tub with an orange snap lid           -> PP
 *   bottle cage     mesh cage packed with clear/green/brown drink bottles -> PET
 *   street banks    green "bottles, cans, jars" beside blue "paper, card, cartons"
 *   littered shore  bottles, foam and sachets across rocks and sand, boats behind
 *
 * The theme is deliberately the Sort by Grade earn path: telling #1, #2 and #5
 * apart in your own kitchen is the skill that gets a sort photo approved.
 */
const Q = [
  {
    question:
      "This milk jug is stiff, cloudy-white rather than see-through, and has a moulded handle. Which grade is it?",
    options: [
      "HDPE — grade 2",
      "PET — grade 1",
      "PVC — grade 3",
      "Polystyrene — grade 6",
    ],
    answer: "HDPE — grade 2",
    explanation:
      "Milk and juice jugs are HDPE, grade 2. The giveaway is the look and feel: HDPE is opaque and rigid, and it is one of the easiest grades to sell on, so keep it in its own pile.",
    topic: "plastic-types",
    difficulty: "easy",
    imageUrl: s3url(
      "quiz-images/quiz-images/verified/plastic-types/plastic-milk-bottle.jpg",
    ),
  },
  {
    question:
      "A food tub like this — translucent body, snap-on lid, happy in the microwave — is usually which grade?",
    options: [
      "PP — grade 5",
      "PET — grade 1",
      "HDPE — grade 2",
      "It has no grade at all",
    ],
    answer: "PP — grade 5",
    explanation:
      "Reusable food tubs and their lids are normally polypropylene, grade 5. PP handles heat, which is why it survives the microwave and the dishwasher when a PET bottle would not.",
    topic: "plastic-types",
    difficulty: "medium",
    imageUrl: s3url(
      "quiz-images/quiz-images/verified/plastic-types/tupperware-polypropylene-container.jpg",
    ),
  },
  {
    question:
      "This cage is packed with clear and coloured drink bottles. What is the grade collectors are after here?",
    options: [
      "PET — grade 1",
      "PP — grade 5",
      "PVC — grade 3",
      "Mixed plastic with no grade",
    ],
    answer: "PET — grade 1",
    explanation:
      "Water and soda bottles are PET, grade 1 — the most wanted household plastic there is. Empty them, squash them and keep them apart from other grades and they stay worth collecting.",
    topic: "plastic-types",
    difficulty: "easy",
    imageUrl: s3url(
      "quiz-images/quiz-images/verified/plastic-types/clear-pet-bottles-recycling-pile.jpg",
    ),
  },
  {
    question:
      "Two banks stand side by side: green for bottles, cans and jars, blue for paper, card and drinks cartons. Where does an empty plastic water bottle belong?",
    options: [
      "The green bottles bank",
      "The blue paper and card bank, because the label is paper",
      "Either one — the lorry separates it later",
      "Neither; bottles cannot be recycled",
    ],
    answer: "The green bottles bank",
    explanation:
      "Read the label on the bank, not the label on the bottle. A drinks carton is lined card and belongs in blue; a plastic bottle belongs in green. One wrong item can down-grade a whole load.",
    topic: "recycling",
    difficulty: "easy",
    imageUrl: s3url(
      "quiz-images/quiz-images/verified/recycling/recycling-bins-north-west-england.jpg",
    ),
  },
  {
    question:
      "Bottles, foam and sachets are lying mixed across this shoreline. What does a scene like this cost most?",
    options: [
      "The material is now mixed and dirty, so almost none of it can be recycled",
      "Nothing — the sea breaks plastic down within a few weeks",
      "Only the look of the beach; the plastic is still perfectly sellable",
      "Only glass recycling, never plastic",
    ],
    answer:
      "The material is now mixed and dirty, so almost none of it can be recycled",
    explanation:
      "Value is lost the moment grades mix and get soiled. That is the whole point of sorting at home while your plastic is still clean and separate — it stays worth something instead of ending up like this.",
    topic: "environment",
    difficulty: "medium",
    imageUrl: s3url(
      "quiz-images/quiz-images/verified/environment/plastic-waste-pile-00998.jpg",
    ),
  },
];

const draftId = `owner-quiz-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
const content = {
  title: "Know your grade: the plastic in your own kitchen",
  description:
    "Tell HDPE, PP and PET apart on sight, put each one in the right bank, and see what it costs when grades get mixed. This is the skill that gets your sort photo approved.",
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
    missionTemplateId: "week2_day5_grades",
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
