/**
 * P-QUIZ-ZERO-DISPLAY — active daily quiz must expose rewardPoints > 0
 * matching earn-hub quizCompletionPoints (not "full 0 points").
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { getConfig, url } from "./config.mjs";
import { loadMobileAppUserCredentials } from "./credential-registry.mjs";

bootstrapPlastyPesaEnv();
const cfg = getConfig();
const PROOF = join(dirname(fileURLToPath(import.meta.url)), "../../.neoxten/proof");

async function main() {
  mkdirSync(PROOF, { recursive: true });
  const creds = loadMobileAppUserCredentials();
  const login = await fetch(url(cfg, "/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
  });
  const loginBody = await login.json();
  const token = loginBody?.data?.token || loginBody?.token;
  if (!token) {
    console.error("LOGIN_FAILED", login.status, loginBody);
    process.exit(1);
  }
  const headers = { Authorization: `Bearer ${token}` };

  const hubRes = await fetch(url(cfg, "/home/earn-hub"), { headers });
  const hubBody = await hubRes.json();
  const hubPts = Number(hubBody?.data?.quizCompletionPoints || 0);

  const gamesRes = await fetch(url(cfg, "/game/all"), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ gameType: "QUIZ", status: ["ACTIVE"], page: 1, limit: 10 }),
  });
  const gamesText = await gamesRes.text();
  let gamesBody;
  try {
    gamesBody = JSON.parse(gamesText);
  } catch {
    throw new Error(`game/all not JSON ${gamesRes.status}: ${gamesText.slice(0, 200)}`);
  }
  const list =
    gamesBody?.data?.docs ||
    gamesBody?.data?.games ||
    gamesBody?.data ||
    [];
  const arr = Array.isArray(list) ? list : [];
  const today =
    arr.find(
      (g) =>
        g?.dailyQuiz === true &&
        String(g?.status || "").toUpperCase() === "ACTIVE",
    ) || arr[0];
  const rewardPts = Number(
    today?.reward?.rewardPoints ?? today?.rewardPoints ?? 0,
  );

  const ok =
    hubRes.status === 200 &&
    hubPts >= 1000 &&
    gamesRes.status === 200 &&
    !!today &&
    rewardPts >= 1000;

  const out = {
    ok,
    hubPts,
    rewardPts,
    gameId: today?._id || today?.sId || null,
    title: today?.title || null,
    at: new Date().toISOString(),
  };
  const path = join(PROOF, `quiz-display-points-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  if (!ok) {
    console.error("FAIL quiz display points");
    process.exit(1);
  }
  console.log("PASS", path);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
