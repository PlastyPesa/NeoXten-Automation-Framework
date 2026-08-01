/**
 * Pull PENDING_REVIEW sort photos for owner↔agent co-pilot.
 *   node scripts/plastypesa/sort-review-pull.mjs
 *   node scripts/plastypesa/sort-review-pull.mjs --limit 20
 *
 * Writes: .neoxten/sort-review-pending/<txnId>.jpg + manifest.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { getConfig, url } from "./config.mjs";
import { loadAdminDashboardCredentials } from "./credential-registry.mjs";

bootstrapPlastyPesaEnv();
const cfg = getConfig();
const limit = Number(process.argv.find((a, i, arr) => arr[i - 1] === "--limit") || 30);
const outDir = resolve(".neoxten/sort-review-pending");
mkdirSync(outDir, { recursive: true });

async function adminToken() {
  const login = await fetch(url(cfg, "/auth/admin-login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(loadAdminDashboardCredentials()),
  });
  const body = await login.json();
  const token = body?.data?.token || body?.token;
  if (!token) throw new Error(`LOGIN_FAILED ${login.status} ${body?.message || ""}`);
  return token;
}

const token = await adminToken();
const list = await fetch(
  url(cfg, `/admin/sort-proof-reviews?status=PENDING_REVIEW&page=1&limit=${limit}`),
  { headers: { Authorization: `Bearer ${token}` } },
);
const listBody = await list.json();
const rows =
  listBody?.data?.items ||
  listBody?.data?.reviews ||
  listBody?.data ||
  listBody?.items ||
  [];
const items = Array.isArray(rows) ? rows : [];

const manifest = {
  pulledAt: new Date().toISOString(),
  count: items.length,
  outDir,
  items: [],
};

for (const row of items) {
  const id = String(row._id || row.id || row.transactionId || "");
  if (!id) continue;
  const meta = {
    id,
    ecoHandle: row.ecoHandle || row.user?.ecoHandle || row.username || null,
    grade: row.plasticGrade || row.grade || row.sortGrade || null,
    itemCount: row.itemCount || row.claimedItemCount || row.itemsCount || null,
    submittedAt: row.createdAt || row.submittedAt || row.updatedAt || null,
    status: row.status || row.reviewStatus || "PENDING_REVIEW",
    imagePath: null,
    imageError: null,
  };
  try {
    const img = await fetch(url(cfg, `/admin/sort-proof-reviews/${id}/image`), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!img.ok) {
      meta.imageError = `HTTP ${img.status}`;
    } else {
      const buf = Buffer.from(await img.arrayBuffer());
      const ct = img.headers.get("content-type") || "";
      const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
      const path = resolve(outDir, `${id}.${ext}`);
      writeFileSync(path, buf);
      meta.imagePath = path;
      meta.bytes = buf.length;
    }
  } catch (e) {
    meta.imageError = String(e?.message || e);
  }
  manifest.items.push(meta);
  console.log(
    `${meta.imagePath ? "OK" : "FAIL"} ${id} ${meta.ecoHandle || "?"} grade=${meta.grade || "?"} items=${meta.itemCount ?? "?"} ${meta.imageError || ""}`,
  );
}

writeFileSync(resolve(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`\nPulled ${manifest.items.length} → ${outDir}`);
console.log(`Manifest: ${resolve(outDir, "manifest.json")}`);
