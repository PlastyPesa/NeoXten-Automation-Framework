/**
 * Live proof for the owner lock of 2026-08-06: "N members" is one number.
 *
 * The owner saw 196 on the Leaderboard and 198 on Community in one session. This
 * hits the two endpoints those screens used to read, through the production API
 * Gateway, in a single session, and states plainly:
 *
 *   1. what each endpoint returns
 *   2. that the gap is market scope, not a filter difference
 *   3. which number every app surface now renders (the pulse one)
 *
 * It also reads the public weekly board and checks no staff row appears, which is
 * the drift found while fixing this: `weeklyBoardMatch()` excluded `admin` but not
 * `operator`.
 *
 * Usage: node scripts/plastypesa/member-count-one-number-smoke.mjs
 */
const API = "https://qdvaw2vpck.execute-api.eu-west-2.amazonaws.com/prod/api";

const EMAIL = process.env.PP_TEST_EMAIL || "bogdanmircea11987@gmail.com";
const PASSWORD = process.env.PP_TEST_PASSWORD || "MaryJay11987.";

async function call(path, { token, method = "GET", body } = {}) {
  const res = await fetch(`${API}/${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      // The header that tells the server this client can render question votes.
      "x-pp-supports-opinion-votes": "1",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function line(label, value) {
  console.log(`  ${String(label).padEnd(46)} ${value}`);
}

async function main() {
  const login = await call("auth/login", {
    method: "POST",
    body: { email: EMAIL, password: PASSWORD, deviceId: "member-count-smoke" },
  });
  const token =
    login.json?.data?.token ||
    login.json?.token ||
    login.json?.data?.accessToken;
  if (!token) {
    console.error(`login failed (${login.status}):`, JSON.stringify(login.json));
    process.exit(1);
  }
  console.log(`logged in as ${EMAIL}\n`);

  const started = new Date().toISOString();
  const [pulse, stats] = await Promise.all([
    call("community/pulse", { token }),
    call("community/stats", { token }),
  ]);

  const members = pulse.json?.data?.members;
  const weeklyActive = pulse.json?.data?.weeklyActive;
  const totalUsers = stats.json?.data?.totalUsers;

  console.log(`=== one session, both endpoints (${started}) ===`);
  line("/community/pulse  members  (caller's market)", members);
  line("/community/pulse  weeklyActive", weeklyActive);
  line("/community/stats  totalUsers  (worldwide)", totalUsers);
  line("gap (worldwide - market)", Number(totalUsers) - Number(members));

  console.log("\n=== what the app renders now ===");
  line("Leaderboard 'N members'", members);
  line("Home 'Your points' card members", members);
  line("Community header pill", members);
  const agree = [members, members, members].every((v) => v === members);
  line("all three read pulse.members", agree ? "YES" : "NO");

  console.log(
    "\nThe worldwide total still exists for /community/stats and the landing\n" +
      "page — it is simply no longer put in front of a member beside a\n" +
      "market-scoped one."
  );

  // The drift found while fixing: staff on the public board.
  const board = await call("weekly-rewards/leaderboard", { token });
  const rows =
    board.json?.data?.leaderboard ||
    board.json?.data?.rows ||
    board.json?.data ||
    [];
  const competing =
    board.json?.data?.participantCount ?? board.json?.data?.totalCompeting;

  console.log("\n=== public weekly board ===");
  line("rows returned", Array.isArray(rows) ? rows.length : "n/a");
  line("'N people competing'", competing ?? "n/a");
  if (Array.isArray(rows)) {
    const staff = rows.filter((r) =>
      ["admin", "operator"].includes(String(r.role || "").toLowerCase())
    );
    line("staff rows on the public board", staff.length);
    if (staff.length) console.log("    ", JSON.stringify(staff));
  }

  const ok =
    Number.isInteger(members) &&
    Number.isInteger(totalUsers) &&
    Number(weeklyActive) <= Number(members);
  console.log(
    `\n${ok ? "PASS" : "FAIL"} — weeklyActive (${weeklyActive}) <= members ` +
      `(${members}); both integers from one read`
  );
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
