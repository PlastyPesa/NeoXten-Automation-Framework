/**
 * Phase 2 staff access — admin RBAC suite (LOCAL backend only).
 *
 * Runs against an isolated local backend (in-memory MongoDB) started by
 * scripts/plastypesa-admin-rbac-local.js — NEVER against production. It
 * proves, over real HTTP the way the dashboard calls the API:
 *
 *   1. Admin can create operator accounts (role hardcoded server-side).
 *   2. Operator can log in and work the whitelisted surface
 *      (sort-proof review queue + community moderation).
 *   3. Operator responses carry NO user PII (name/email stripped).
 *   4. Operator is 403-blocked from every admin-only surface probed.
 *   5. Operator mutations land in the append-only admin_audit_log
 *      (metadata only — no body content).
 *   6. Disabling an operator revokes access on the NEXT request
 *      (instant revocation) and blocks login; enabling restores it.
 *   7. The staff endpoints can never disable an admin account.
 *
 * Context (ctx) comes from the orchestrator: baseUrl, seeded ids, a live
 * `db` handle to the in-memory MongoDB for direct evidence reads.
 */

const OPERATOR_EMAIL = 'rbac-operator@test.local';
const OPERATOR_PASSWORD = 'OperatorPass123!';

function api(ctx, p) {
  return `${ctx.baseUrl}${p.startsWith('/') ? p : `/${p}`}`;
}

function authHeaders(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function jsonOf(r) {
  const text = await r.text();
  try {
    return { body: JSON.parse(text), text };
  } catch {
    return { body: null, text };
  }
}

async function adminLogin(ctx, email, password) {
  const r = await fetch(api(ctx, '/auth/admin-login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const { body } = await jsonOf(r);
  return { status: r.status, token: body?.token || null, body };
}

export const id = 'admin-rbac';

export async function run(ctx, runner) {
  let operatorToken = null;
  let operatorId = null;

  // ---- Admin session --------------------------------------------------
  await runner.test('admin_login_works', async () => {
    const { status, token } = await adminLogin(ctx, ctx.adminEmail, ctx.adminPassword);
    if (status !== 200 || !token) throw new Error(`admin login failed: ${status}`);
    ctx.adminToken = token;
  });

  // ---- Operator provisioning (admin-only) ------------------------------
  await runner.test('admin_creates_operator_account', async () => {
    const r = await fetch(api(ctx, '/admin/staff/operators'), {
      method: 'POST',
      headers: authHeaders(ctx.adminToken),
      body: JSON.stringify({
        email: OPERATOR_EMAIL,
        password: OPERATOR_PASSWORD,
        firstName: 'Remote',
        lastName: 'Operator',
        // Deliberate smuggling attempt — server must ignore it:
        role: ['admin'],
      }),
    });
    const { body, text } = await jsonOf(r);
    if (r.status !== 201) throw new Error(`Expected 201, got ${r.status}: ${text.slice(0, 200)}`);
    operatorId = body?.data?.operator?.id;
    if (!operatorId) throw new Error('No operator id in response');
  });

  await runner.test('created_operator_role_is_operator_only_in_db', async () => {
    const row = await ctx.db.collection('users').findOne({ email: OPERATOR_EMAIL });
    if (!row) throw new Error('operator row missing');
    const roles = Array.isArray(row.role) ? row.role : [row.role];
    if (roles.includes('admin')) throw new Error(`role smuggling succeeded: ${roles}`);
    if (!roles.includes('operator')) throw new Error(`operator role missing: ${roles}`);
    if (!String(row.password || '').startsWith('$2')) {
      throw new Error('operator password stored unhashed');
    }
  });

  await runner.test('operator_login_works', async () => {
    const { status, token } = await adminLogin(ctx, OPERATOR_EMAIL, OPERATOR_PASSWORD);
    if (status !== 200 || !token) throw new Error(`operator login failed: ${status}`);
    operatorToken = token;
  });

  // ---- Whitelisted surface: sort-proof review --------------------------
  await runner.test('operator_summary_endpoint_ok', async () => {
    const r = await fetch(api(ctx, '/admin/sort-proof-reviews/summary'), {
      headers: authHeaders(operatorToken),
    });
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
  });

  await runner.test('operator_queue_has_rows_but_no_pii', async () => {
    const r = await fetch(api(ctx, '/admin/sort-proof-reviews?status=PENDING_REVIEW'), {
      headers: authHeaders(operatorToken),
    });
    const { body, text } = await jsonOf(r);
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}: ${text.slice(0, 200)}`);
    const reviews = body?.data?.reviews || [];
    if (reviews.length < 1) throw new Error('queue empty — seeding failed');
    for (const row of reviews) {
      if (row.userInfo) throw new Error('PII LEAK: userInfo present for operator');
    }
    if (text.includes(ctx.subjectEmail)) throw new Error('PII LEAK: subject email in body');
    if (text.includes(ctx.subjectLastName)) throw new Error('PII LEAK: subject last name in body');
  });

  await runner.test('admin_queue_still_has_pii', async () => {
    const r = await fetch(api(ctx, '/admin/sort-proof-reviews?status=PENDING_REVIEW'), {
      headers: authHeaders(ctx.adminToken),
    });
    const { body } = await jsonOf(r);
    const reviews = body?.data?.reviews || [];
    const withInfo = reviews.find((x) => x.userInfo && x.userInfo.email);
    if (!withInfo) throw new Error('admin lost userInfo — masking over-applied');
  });

  await runner.test('operator_can_reject_sort_proof', async () => {
    const r = await fetch(api(ctx, `/admin/sort-proof-reviews/${ctx.rejectTxnId}/reject`), {
      method: 'PUT',
      headers: authHeaders(operatorToken),
      body: JSON.stringify({ reason: 'rbac-suite-secret-reason' }),
    });
    const { text } = await jsonOf(r);
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}: ${text.slice(0, 200)}`);
  });

  await runner.test('operator_mutation_recorded_in_audit_log_without_body', async () => {
    const row = await ctx.db
      .collection('admin_audit_log')
      .findOne({ path: `/api/admin/sort-proof-reviews/${ctx.rejectTxnId}/reject` });
    if (!row) throw new Error('no audit row for operator reject');
    if (String(row.actorId) !== String(operatorId)) {
      throw new Error(`audit actor mismatch: ${row.actorId} != ${operatorId}`);
    }
    if (!row.actorRoles?.includes('operator')) throw new Error('actorRoles missing operator');
    if (!row.bodyKeys?.includes('reason')) throw new Error('bodyKeys missing');
    if (JSON.stringify(row).includes('rbac-suite-secret-reason')) {
      throw new Error('AUDIT LEAK: raw body value persisted');
    }
  });

  // ---- Whitelisted surface: community moderation -----------------------
  await runner.test('operator_sees_moderation_queue', async () => {
    const r = await fetch(api(ctx, '/community/admin/moderation-queue'), {
      headers: authHeaders(operatorToken),
    });
    const { body, text } = await jsonOf(r);
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}: ${text.slice(0, 200)}`);
    const posts = body?.data?.posts || [];
    if (!posts.some((p) => p.id === String(ctx.flaggedPostId))) {
      throw new Error('flagged post missing from queue');
    }
  });

  await runner.test('operator_can_remove_flagged_post', async () => {
    const r = await fetch(api(ctx, `/community/admin/posts/${ctx.flaggedPostId}/remove`), {
      method: 'POST',
      headers: authHeaders(operatorToken),
      body: JSON.stringify({ reason: 'spam' }),
    });
    const { text } = await jsonOf(r);
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}: ${text.slice(0, 200)}`);
  });

  // ---- Deny-by-default: operator blocked everywhere else ----------------
  const blockedProbes = [
    ['GET', '/admin/staff/operators', 'staff management'],
    ['PUT', '/admin/sort-proof-config', 'decision config write'],
    ['GET', '/admin/sort-proof-reviews/agreement', 'analytics'],
    ['GET', '/market-rewards/admin/markets', 'market rewards admin'],
    ['POST', `/community/admin/posts/${'0'.repeat(24)}/feature`, 'feature post'],
    ['POST', `/community/admin/users/${'0'.repeat(24)}/warn`, 'warn user'],
    ['GET', '/weekly-rewards/admin/current-week', 'weekly rewards admin'],
    ['GET', '/admin/dashboard', 'admin dashboard'],
    ['POST', `/admin/users/${'0'.repeat(24)}/purge`, 'user purge'],
    ['POST', '/admin/announcements', 'announcements'],
  ];
  for (const [method, path, label] of blockedProbes) {
    await runner.test(`operator_blocked_${label.replace(/[^a-z0-9]+/gi, '_')}`, async () => {
      const r = await fetch(api(ctx, path), {
        method,
        headers: authHeaders(operatorToken),
        body: method === 'GET' ? undefined : JSON.stringify({}),
      });
      // 403 expected; 401 acceptable; 404 means the probe path is wrong and
      // proves nothing — fail loudly so the suite stays honest.
      if (r.status === 404) throw new Error(`probe path unknown (404): ${path}`);
      if (r.status !== 403 && r.status !== 401) {
        throw new Error(`SECURITY: expected 403 for operator on ${path}, got ${r.status}`);
      }
    });
  }

  // ---- Instant revocation ----------------------------------------------
  await runner.test('admin_disables_operator', async () => {
    const r = await fetch(api(ctx, `/admin/staff/operators/${operatorId}/disable`), {
      method: 'POST',
      headers: authHeaders(ctx.adminToken),
      body: JSON.stringify({}),
    });
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
  });

  await runner.test('disabled_operator_existing_token_rejected_immediately', async () => {
    const r = await fetch(api(ctx, '/admin/sort-proof-reviews/summary'), {
      headers: authHeaders(operatorToken),
    });
    if (r.status !== 403) {
      throw new Error(`SECURITY: disabled operator still served (${r.status})`);
    }
  });

  await runner.test('disabled_operator_cannot_login', async () => {
    const { status } = await adminLogin(ctx, OPERATOR_EMAIL, OPERATOR_PASSWORD);
    if (status !== 403) throw new Error(`Expected 403 login block, got ${status}`);
  });

  await runner.test('enable_restores_operator_access', async () => {
    const r = await fetch(api(ctx, `/admin/staff/operators/${operatorId}/enable`), {
      method: 'POST',
      headers: authHeaders(ctx.adminToken),
      body: JSON.stringify({}),
    });
    if (r.status !== 200) throw new Error(`enable failed: ${r.status}`);
    const { status, token } = await adminLogin(ctx, OPERATOR_EMAIL, OPERATOR_PASSWORD);
    if (status !== 200 || !token) throw new Error(`re-login failed: ${status}`);
    const r2 = await fetch(api(ctx, '/admin/sort-proof-reviews/summary'), {
      headers: authHeaders(token),
    });
    if (r2.status !== 200) throw new Error(`summary after re-enable: ${r2.status}`);
  });

  // ---- Owner lockout protection -----------------------------------------
  await runner.test('staff_endpoints_cannot_disable_admin_account', async () => {
    const r = await fetch(api(ctx, `/admin/staff/operators/${ctx.adminUserId}/disable`), {
      method: 'POST',
      headers: authHeaders(ctx.adminToken),
      body: JSON.stringify({}),
    });
    if (r.status !== 403) {
      throw new Error(`SECURITY: admin account disable returned ${r.status}, expected 403`);
    }
  });
}
