import { createRequire } from "node:module";
import { resolve } from "node:path";
import { loadBackendMongoEnv } from "../mongo-env.mjs";

const require = createRequire(
  resolve("C:/Users/Bobby/Documents/plastypesa-backend-api/lib/lambda/backend/package.json"),
);
const { MongoClient } = require("mongodb");
const client = new MongoClient(loadBackendMongoEnv(), { serverSelectionTimeoutMS: 20000 });
await client.connect();
const db = client.db();
const lc = await db.collection("masters").findOne({ name: "learn-content" });
const items = lc?.metadata || [];
function words(a) {
  const tips = Array.isArray(a.tips) ? a.tips.join(" ") : "";
  const text = [a.content || "", tips]
    .join(" ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}
const newOnes = items.filter((a) => String(a._id || "").startsWith("learn-ke-20260816"));
const locales = ["en", "it", "es", "de", "fr", "pt", "ro"];
const localesOk = newOnes.filter((a) => locales.every((c) => a.translations?.[c]?.content));
const under = items.filter((a) => words(a) < 250).map((a) => `${a._id || a.title}:${words(a)}`);
const bannedRe = /\b(KES|KSh|Top\s*10|1[\s,.]?000|2[\s,.]?000|4[\s,.]?000)\b/i;
const newBanned = newOnes.filter((a) =>
  bannedRe.test([a.title, a.description, a.content, (a.tips || []).join(" ")].join(" ")),
);
console.log(
  JSON.stringify(
    {
      total: items.length,
      newCount: newOnes.length,
      newWith7locales: localesOk.length,
      under250: under,
      newBanned: newBanned.map((a) => a._id),
      uniqueDaysAt5: Math.floor(items.length / 5),
    },
    null,
    2,
  ),
);
const now = new Date();
const lines = await db
  .collection("channel_lines")
  .find({ active: true, expiresAt: { $gt: now } })
  .toArray();
console.log(
  "LIVE_CHANNEL",
  lines.map((l) => ({ text: l.text, expiresAt: l.expiresAt })),
);
await client.close();
