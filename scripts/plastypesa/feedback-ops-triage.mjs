/**
 * P-FEEDBACK-OPS — weekly triage of Profile → Feedback (idea/bug/…).
 * No new Suggestions tab. Does not blast community posts (owner GO).
 *
 *   node scripts/plastypesa/feedback-ops-triage.mjs
 *   node scripts/plastypesa/feedback-ops-triage.mjs --pass 2
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { MongoClient, ObjectId } from "mongodb";
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { loadBackendMongoEnv } from "./mongo-env.mjs";

bootstrapPlastyPesaEnv();
const pass = process.argv.includes("--pass")
  ? process.argv[process.argv.indexOf("--pass") + 1]
  : "1";
const OUT_DIR = join(process.cwd(), ".neoxten", "proof");
mkdirSync(OUT_DIR, { recursive: true });
const OUT = join(OUT_DIR, `feedback-ops-pass${pass}-${Date.now()}.json`);

function mapRow(r, userById) {
  const uid = String(r.userId || "");
  const u = userById.get(uid) || {};
  return {
    eco: u.ecoHandle || null,
    email: u.email || null,
    category: r.category || "unknown",
    text: String(r.message || "").slice(0, 240),
    status: r.status,
    appVersion: r.appVersion || "",
    screen: r.screen || "",
    createdAt: r.createdAt,
  };
}

async function main() {
  const uri = loadBackendMongoEnv();
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 25000 });
  await client.connect();
  try {
    // Mongoose model name "user_feedback" → collection `user_feedbacks`
    const feedback = client.db().collection("user_feedbacks");
    const users = client.db().collection("users");
    const since = new Date(Date.now() - 90 * 864e5);
    const rows = await feedback
      .find({ createdAt: { $gte: since } })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    const ids = [
      ...new Set(
        rows
          .map((r) => r.userId)
          .filter(Boolean)
          .map((id) => String(id))
      ),
    ]
      .filter((id) => ObjectId.isValid(id))
      .map((id) => new ObjectId(id));

    const userDocs = ids.length
      ? await users
          .find({ _id: { $in: ids } })
          .project({ email: 1, ecoHandle: 1 })
          .toArray()
      : [];
    const userById = new Map(
      userDocs.map((u) => [String(u._id), u])
    );

    const byCategory = {};
    const byStatus = {};
    for (const r of rows) {
      const c = r.category || "unknown";
      const s = r.status || "unknown";
      byCategory[c] = (byCategory[c] || 0) + 1;
      byStatus[s] = (byStatus[s] || 0) + 1;
    }
    const ideas = rows.filter((r) => r.category === "idea");
    const bugs = rows.filter((r) => r.category === "bug");
    const open = rows.filter((r) => r.status === "OPEN");

    const report = {
      pass,
      generatedAt: new Date().toISOString(),
      collection: "user_feedbacks",
      windowDays: 90,
      lastWindowTotal: rows.length,
      byCategory,
      byStatus,
      openCount: open.length,
      ideas: ideas.slice(0, 20).map((r) => mapRow(r, userById)),
      bugs: bugs.slice(0, 15).map((r) => mapRow(r, userById)),
      recentOpen: open.slice(0, 15).map((r) => mapRow(r, userById)),
      ownerNext: {
        youAskedWeBuiltCandidate:
          "FreshKoala971 / EcoSort daily-task clarity — ship Home AAB first, then community post (owner GO).",
        noNewSuggestionsTab: true,
        measure: "Watch idea volume next weeks before any new UI shortcut.",
      },
    };

    writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log("══ P-FEEDBACK-OPS triage ══");
    console.log(`collection=user_feedbacks last90d=${rows.length}`);
    console.log("byCategory", JSON.stringify(byCategory));
    console.log("byStatus", JSON.stringify(byStatus));
    console.log(`ideas=${ideas.length} bugs=${bugs.length} open=${open.length}`);
    for (const i of ideas.slice(0, 8)) {
      const m = mapRow(i, userById);
      console.log(`  IDEA ${m.eco || m.email || "?"}: ${m.text.slice(0, 100)}`);
    }
    for (const b of bugs.slice(0, 5)) {
      const m = mapRow(b, userById);
      console.log(`  BUG  ${m.eco || m.email || "?"}: ${m.text.slice(0, 100)}`);
    }
    if (rows.length === 0) {
      throw new Error("expected some user_feedbacks in window — wrong collection?");
    }
    console.log("Report:", OUT);
    console.log(`OK feedback-ops-triage pass=${pass}`);
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
