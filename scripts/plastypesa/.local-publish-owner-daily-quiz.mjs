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
 * 2026-08-06 — owner GO: publish immediately after Play vc71 + gate arm.
 * Theme: "Sort smart: grades, banks, and what the ocean keeps".
 *
 * Ten questions, exactly two hard. Every question is answerable from what is
 * actually in the picture; each verified S3 asset was opened and matched this
 * session before wiring:
 *
 *   milk jug        opaque white jug, moulded handle, pink screw cap     -> HDPE
 *   food tub        translucent body, bright orange snap lid             -> PP
 *   bottle cage     green/clear/brown drink bottles in wire mesh         -> PET
 *   street banks    green bottles/cans/jars beside blue paper/card       -> green for bottle
 *   Reykjavik bin   purple "PLASTUMBÚÐIR / PLASTIC PACKAGING"            -> plastic packaging only
 *   dusty lot pile  clear bottles + filled sacks beside trees            -> bulk collection
 *   harbour shore   foam, bottles, sachets, nets, boats                  -> soiled mix loses value
 *   Tenerife pebbles yellow/clear bottles + white fragments on dark rock -> sea soaks grades
 *   HARD baled PET  wall of crushed clear bottles + coloured caps        -> baled for transport
 *   HARD Hawaii     floats, crates, barrels on remote beach              -> fishing/maritime debris
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
    difficulty: "easy",
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
      "This bin’s purple sign says PLASTUMBÚÐIR / PLASTIC PACKAGING and shows a bag and a jug. What belongs in it?",
    options: [
      "Clean plastic packaging such as bottles, jugs and bags",
      "Glass bottles only",
      "Food leftovers and wet kitchen waste",
      "Paper, card and drinks cartons",
    ],
    answer: "Clean plastic packaging such as bottles, jugs and bags",
    explanation:
      "The icons and the word “plastic packaging” are the rule: plastic bottles, jugs and bags go here — not glass, not organics, not paper.",
    topic: "recycling",
    difficulty: "easy",
    imageUrl: s3url(
      "quiz-images/quiz-images/verified/recycling/plastic-recycling-bin-reykjavik.jpg",
    ),
  },
  {
    question:
      "Hundreds of clear bottles sit loose on dusty ground, with big filled sacks nearby. What is happening here?",
    options: [
      "Plastic is being bulk-collected so it can be sorted and sold later",
      "The bottles are already finished recycled pellets",
      "This is the correct place to dump mixed household rubbish",
      "Only glass is being gathered; plastic is ignored",
    ],
    answer: "Plastic is being bulk-collected so it can be sorted and sold later",
    explanation:
      "Loose piles and stuffed sacks are the start of the value chain: gather volume first, then sort grades so the load stays sellable.",
    topic: "recycling",
    difficulty: "medium",
    imageUrl: s3url(
      "quiz-images/quiz-images/verified/recycling/plastic-bottles-gathered-for-recycling.jpg",
    ),
  },
  {
    question:
      "Bottles, foam and sachets are lying mixed across this shoreline next to nets and boats. What does a scene like this cost most?",
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
  {
    question:
      "On this dark pebble shore, bottles and white fragments sit where the waves wash. Why is plastic here so hard to turn into new packaging?",
    options: [
      "Salt, sand and mixed fragments ruin the material for clean recycling",
      "Dark pebbles turn plastic into glass overnight",
      "Yellow bottles cannot be recycled anywhere in the world",
      "Only wood from the shore can be recycled, never plastic",
    ],
    answer: "Salt, sand and mixed fragments ruin the material for clean recycling",
    explanation:
      "Once plastic rides the tide it picks up salt, grit and other grades. Recyclers need clean, sorted feedstock — beach litter almost never qualifies.",
    topic: "ocean-pollution",
    difficulty: "medium",
    imageUrl: s3url(
      "quiz-images/quiz-images/verified/ocean-pollution/beach-pollution-tenerife-plastic-debris.jpg",
    ),
  },
  {
    question:
      "You are looking at a solid wall of crushed clear drink bottles pressed flat with coloured caps still visible. What recycling step is this?",
    options: [
      "Baled PET ready to move to a reprocessor",
      "Finished clothing fibre already spun from plastic",
      "Household rubbish waiting for landfill burial",
      "Glass cullet after bottles were melted",
    ],
    answer: "Baled PET ready to move to a reprocessor",
    explanation:
      "A baler compresses sorted PET bottles into dense blocks so they can be trucked or shipped to a plant that flakes and remelts them. Caps and labels you still see are normal at this stage.",
    topic: "plastic-types",
    difficulty: "hard",
    imageUrl: s3url(
      "quiz-images/quiz-images/verified/plastic-types/bales-of-pet-bottles-closeup.jpg",
    ),
  },
  {
    question:
      "This remote shore is piled with black floats, crates, barrels and buckets — not just drinks bottles. Where did most of this plastic likely come from?",
    options: [
      "Fishing and maritime activity carried by ocean currents",
      "Only kitchen milk jugs washed from one nearby village",
      "Paper and card that somehow turned into plastic at sea",
      "Volcanic rock that looks like plastic in photos",
    ],
    answer: "Fishing and maritime activity carried by ocean currents",
    explanation:
      "Floats, crates and industrial barrels are classic fishing and shipping gear. Currents can dump that maritime debris on beaches far from where it was lost — different from a household PET bottle left in a kitchen bin.",
    topic: "ocean-pollution",
    difficulty: "hard",
    imageUrl: s3url(
      "quiz-images/quiz-images/verified/ocean-pollution/marine-debris-hawaiian-coast.jpg",
    ),
  },
];

const draftId = `owner-quiz-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
const content = {
  title: "Sort smart: grades, banks, and what the ocean keeps",
  description:
    "Tell HDPE, PP and PET apart, put each item in the right bank, then see what happens when plastic hits the shore — including two harder reads on baled PET and maritime debris.",
  questions: Q,
  quizConfigs: { difficulty: "medium", timeLimit: 180, maxAttempts: 1 },
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
    questionCount: Q.length,
    hardCount: Q.filter((q) => q.difficulty === "hard").length,
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
console.log(
  "Q_COUNTS",
  Q.length,
  "hard=",
  Q.filter((q) => q.difficulty === "hard").length,
);

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
  if (g.quizGameId) {
    const qg = await db2.collection("quiz_games").findOne(
      { _id: g.quizGameId },
      { projection: { questions: 1, title: 1 } },
    );
    const qs = qg?.questions || [];
    console.log(
      "QUIZ_SHAPE",
      g._id.toString(),
      "n=",
      qs.length,
      "hard=",
      qs.filter((q) => q.difficulty === "hard").length,
      "images=",
      qs.filter((q) => !!q.imageUrl).length,
    );
  }
}
await client2.close();
