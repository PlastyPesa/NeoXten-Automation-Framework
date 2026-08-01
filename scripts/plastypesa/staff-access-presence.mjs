/**
 * P-STAFF-ACCESS-PRESENCE — OWNER PRIVATE readout.
 *
 * Shows lastStaffAccessedAt for admin/operator accounts.
 * NEVER wire into Daily Check or the admin dashboard UI.
 *
 * Usage (from NeoXten root):
 *   npm run staff:access
 *   node scripts/plastypesa/staff-access-presence.mjs
 */
import { MongoClient } from "mongodb";
import { loadBackendMongoEnv } from "./mongo-env.mjs";

const uri = loadBackendMongoEnv();
const client = new MongoClient(uri);

await client.connect();
const db = client.db();

const staff = await db
  .collection("users")
  .find(
    {
      role: { $in: ["admin", "operator", "ADMIN", "OPERATOR"] },
    },
    {
      projection: {
        email: 1,
        role: 1,
        staffDisabled: 1,
        lastStaffAccessedAt: 1,
      },
    }
  )
  .sort({ lastStaffAccessedAt: -1 })
  .toArray();

const now = Date.now();
const dayStartUtc = new Date();
dayStartUtc.setUTCHours(0, 0, 0, 0);

const rows = staff.map((u) => {
  const at = u.lastStaffAccessedAt ? new Date(u.lastStaffAccessedAt) : null;
  const msAgo = at ? now - at.getTime() : null;
  return {
    email: u.email || "(no email)",
    role: u.role,
    staffDisabled: u.staffDisabled === true,
    lastStaffAccessedAt: at ? at.toISOString() : null,
    accessedTodayUtc: at ? at >= dayStartUtc : false,
    minutesAgo: msAgo == null ? null : Math.round(msAgo / 60000),
  };
});

const accessedToday = rows.filter((r) => r.accessedTodayUtc && !r.staffDisabled);

console.log(
  JSON.stringify(
    {
      ownerPrivate: true,
      note: "Not for Daily Check or admin UI. Shared admin email = cannot tell wife vs Bobby.",
      generatedAt: new Date().toISOString(),
      staffCount: rows.length,
      accessedTodayUtcCount: accessedToday.length,
      accessedTodayUtc: accessedToday.map((r) => r.email),
      staff: rows,
    },
    null,
    2
  )
);

await client.close();
