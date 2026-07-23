#!/usr/bin/env node
/**
 * BUILD 50 — admin API + production bundle smoke (no browser timeout risk).
 */
import fs from 'node:fs';
import path from 'node:path';
import { bootstrapPlastyPesaEnv } from './env-bootstrap.mjs';
import { loadAdminDashboardCredentials } from './credential-registry.mjs';

const API = 'https://qdvaw2vpck.execute-api.eu-west-2.amazonaws.com/prod/api';
const OUT = path.join(process.cwd(), '.neoxten-out', 'build50-admin-smoke');
const results = [];

function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  bootstrapPlastyPesaEnv();
  fs.mkdirSync(OUT, { recursive: true });
  const admin = loadAdminDashboardCredentials();

  const login = await fetch(`${API}/auth/admin-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: admin.email, password: admin.password }),
  });
  const lj = await login.json();
  const token = lj?.data?.token || lj?.token;
  record('admin API login', login.status === 200 && !!token, `status ${login.status}`);
  if (!token) process.exit(2);

  const headers = { Authorization: `Bearer ${token}` };
  const ops = await fetch(`${API}/admin/ops/summary`, { headers });
  const oj = await ops.json();
  record(
    'ops summary BUILD50 endpoint',
    ops.status === 200 && oj?.data?.sortProof && oj?.data?.community,
    JSON.stringify(oj?.data?.priority || oj?.message || ops.status).slice(0, 120),
  );

  const drafts = await fetch(`${API}/admin/automation/drafts`, { headers });
  const dj = await drafts.json();
  const pending = (dj?.data?.drafts || []).filter((d) => d.status === 'pending').length;
  record('content queue drafts reachable', drafts.status === 200, `pending=${pending}`);

  const alerts = await fetch(`${API}/admin/automation/alerts`, { headers });
  const aj = await alerts.json();
  record(
    'AI alerts endpoint (bell data)',
    alerts.status === 200 && Array.isArray(aj?.data?.alerts ?? aj?.data),
    `status ${alerts.status}`,
  );

  const bundle = await fetch('https://plastypesa.com/assets/index-B0-9N6Da.js');
  const bundleText = await bundle.text();
  record(
    'deployed admin bundle has AdminOpsAlert',
    bundle.ok && /AdminOpsAlert|ops\/summary|useAdminOpsSummary/.test(bundleText),
  );

  const page = await fetch('https://plastypesa.com/login');
  const pageText = await page.text();
  record('production login page live', page.ok && /PlastyPesa|login/i.test(pageText));

  const failed = results.filter((r) => !r.pass);
  const report = {
    generatedAt: new Date().toISOString(),
    pass: results.length - failed.length,
    fail: failed.length,
    results,
  };
  fs.writeFileSync(path.join(OUT, 'build50-admin-api-smoke.json'), JSON.stringify(report, null, 2));
  console.log(`\n[build50-admin-api] ${report.pass} pass, ${report.fail} fail`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('[build50-admin-api]', err);
  process.exit(2);
});
