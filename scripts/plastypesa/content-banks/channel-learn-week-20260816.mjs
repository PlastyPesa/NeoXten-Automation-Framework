/**
 * One number-free Channel line — Learn batch is live.
 * Public cap is 2. Creator-film line stays until 25 Aug.
 *
 *   node scripts/plastypesa/content-banks/channel-learn-week-20260816.mjs --send
 */
import { readFileSync } from "node:fs";

const API = "https://qdvaw2vpck.execute-api.eu-west-2.amazonaws.com/prod/api";
const SEND = process.argv.includes("--send");

const TEXT =
  "New Learn reads this week — open Learn, finish the article, earn points.";
const HIGHLIGHT = "New Learn reads";
if (TEXT.length > 140) throw new Error(`too long ${TEXT.length}`);
if (!TEXT.includes(HIGHLIGHT)) throw new Error("highlight missing");
if (/\b(KES|KSh|Top\s*10|1[\s,.]?000|2[\s,.]?000|4[\s,.]?000)\b/i.test(TEXT)) {
  throw new Error("banned amount");
}

const expiresAt = new Date(Date.now() + 14 * 86400 * 1000).toISOString();
const body = {
  text: TEXT,
  highlight: HIGHLIGHT,
  attention: false,
  active: true,
  markets: ["KE"],
  expiresAt,
};

console.log("LINE", JSON.stringify(body));
if (!SEND) {
  console.log("Dry — pass --send to publish.");
  process.exit(0);
}

const credentials = readFileSync(
  "C:/Users/Bobby/Documents/plastypesa-admin-dashboard/.local/plastypesa-test-credentials.md",
  "utf8",
);
const adminBlock = credentials.split("## Production mobile app")[0];
const email = adminBlock.match(/\*\*Email:\*\*\s*(\S+)/)?.[1];
const password = adminBlock.match(/\*\*Password:\*\*\s*(.+)/)?.[1]?.trim();

const login = await fetch(`${API}/auth/admin-login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
}).then((r) => r.json());
const token = login?.data?.token || login?.token;
if (!token) throw new Error("no admin token");

const res = await fetch(`${API}/admin/channel-lines`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
});
const json = await res.json();
if (!res.ok || json.type === "Error") {
  throw new Error(`create failed ${res.status} ${json.message || ""}`);
}
console.log("PUBLISHED", json.data?.id, json.data?.expiresAt, json.data?.text);
