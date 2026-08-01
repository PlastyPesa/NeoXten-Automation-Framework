/**
 * P-ADMIN-LIVE-TRUTH — admin source contracts (claims + Sort Review UX labels).
 * Run twice. Exit 1 on missing strings.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const label = process.argv[2] || "v1";
const admin =
  process.env.PLASTYPESA_ADMIN_REPO ||
  "C:/Users/Bobby/Documents/plastypesa-admin-dashboard";

const checks = [
  {
    path: "lib/frontend/src/pages/DailyCheck/Page.tsx",
    must: ["need form", "form in", "statusCounts?.PROVISIONAL", "As of ", "Pending + flagged"],
  },
  {
    path: "lib/frontend/src/pages/SortProofReview/Page.tsx",
    must: [
      "Today (Nairobi",
      "Rolling 24h new submissions",
      "Back to queue",
      "Approve from list",
      "Refresh queue",
    ],
  },
  {
    path: "lib/frontend/src/hooks/useDailyCheck.ts",
    must: ["refetchInterval: enabled ? 60_000"],
  },
  {
    path: "lib/frontend/src/hooks/useAdminOpsSummary.ts",
    must: ["flaggedTotal"],
  },
];

let failed = false;
for (const c of checks) {
  const full = join(admin, c.path);
  if (!existsSync(full)) {
    console.error(`[${label}] FAIL missing ${c.path}`);
    failed = true;
    continue;
  }
  const src = readFileSync(full, "utf8");
  for (const needle of c.must) {
    if (!src.includes(needle)) {
      console.error(`[${label}] FAIL ${c.path} missing: ${needle}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.error(`[${label}] PASS admin live-truth UI contract`);
console.log(JSON.stringify({ label, ok: true }, null, 2));
