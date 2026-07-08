/**
 * Phase 2 staff access — shared local environment for RBAC verification.
 *
 * Boots an in-memory MongoDB + the real PlastyPesa backend on a local port
 * and seeds the fixtures both the API suite and the dashboard browser flow
 * need. Production is never touched.
 */
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, ObjectId } from 'mongodb';

export const BACKEND_DIR = resolve(
  process.env.PLASTYPESA_BACKEND_DIR ||
    'C:\\Users\\Bobby\\Documents\\plastypesa-backend-api',
);
export const BACKEND_ENTRY = join(
  BACKEND_DIR,
  'lib',
  'lambda',
  'backend',
  'index.js',
);
export const PORT = Number(process.env.PLASTYPESA_RBAC_PORT || 4181);
export const BASE_URL = `http://127.0.0.1:${PORT}/api`;
export const BACKEND_ORIGIN = `http://127.0.0.1:${PORT}`;

export const ADMIN_EMAIL = 'rbac-admin@test.local';
export const ADMIN_PASSWORD = 'RbacAdminPass123!';
export const SUBJECT_EMAIL = 'rbac-subject@test.local';
export const SUBJECT_LAST_NAME = 'Subjectson';

async function seed(db) {
  const adminId = new ObjectId();
  const subjectId = new ObjectId();
  const now = new Date();

  await db.collection('users').insertMany([
    {
      _id: adminId,
      email: ADMIN_EMAIL,
      // Plaintext on purpose: adminLoginHandler upgrades legacy plaintext
      // passwords to bcrypt on first successful login — same as prod data.
      password: ADMIN_PASSWORD,
      firstName: 'Rbac',
      lastName: 'Admin',
      role: ['admin'],
      staffDisabled: false,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: subjectId,
      email: SUBJECT_EMAIL,
      firstName: 'Jane',
      lastName: SUBJECT_LAST_NAME,
      role: ['user'],
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  ]);

  // Two pending sort proofs: one stays pending for the queue/PII assertions,
  // one is consumed by the operator reject test.
  const queueTxnId = new ObjectId();
  const rejectTxnId = new ObjectId();
  await db.collection('transactions').insertMany([
    {
      _id: queueTxnId,
      type: 'SORT_PROOF',
      status: 'PENDING_REVIEW',
      from: String(subjectId),
      points: 300,
      imageKey: 'sort-proof/rbac-queue.jpg',
      stream: 'PET',
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: rejectTxnId,
      type: 'SORT_PROOF',
      status: 'PENDING_REVIEW',
      from: String(subjectId),
      points: 300,
      imageKey: 'sort-proof/rbac-reject.jpg',
      stream: 'PET',
      createdAt: new Date(now.getTime() - 1000),
      updatedAt: now,
    },
  ]);

  const flaggedPostId = new ObjectId();
  await db.collection('community_posts').insertOne({
    _id: flaggedPostId,
    authorId: subjectId,
    ecoHandle: 'GreenJane',
    category: 'general',
    body: 'rbac suite flagged post',
    status: 'flagged',
    reportCount: 3,
    createdAt: now,
    updatedAt: now,
  });

  return {
    adminUserId: String(adminId),
    subjectUserId: String(subjectId),
    rejectTxnId: String(rejectTxnId),
    flaggedPostId: String(flaggedPostId),
  };
}

function startBackend(mongoUri, { quiet = false } = {}) {
  const child = spawn(process.execPath, [BACKEND_ENTRY], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      MONGO_URL: mongoUri,
      DEPLOYMENT_ENV: 'local-rbac-test',
      PORT: String(PORT),
      EXPRESS_SESSION_SECRET_KEY: 'local-rbac-session-secret',
      JWT_SECRET: 'local-rbac-jwt-secret',
      // Passport's GoogleStrategy throws at load without a client id; these
      // dummies are never used because no Google flow runs in this suite.
      GOOGLE_CLIENT_ID: 'dummy-local',
      GOOGLE_CLIENT_SECRET: 'dummy-local',
      GOOGLE_CALLBACK_URL: 'http://127.0.0.1/never-called',
      CORS_ALLOWED_ORIGINS: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!quiet) {
    child.stdout.on('data', (d) => process.stdout.write(`[backend] ${d}`));
    child.stderr.on('data', (d) => process.stderr.write(`[backend:err] ${d}`));
  } else {
    child.stdout.resume();
    child.stderr.resume();
  }
  return child;
}

async function waitForHealth(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE_URL}/health`);
      if (r.status === 200) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * Starts memory Mongo + backend, seeds fixtures. Returns an env object with
 * a `stop()` for teardown and everything the tests need.
 */
export async function startLocalRbacEnv({ quietBackend = false } = {}) {
  console.log('Starting in-memory MongoDB...');
  const mongod = await MongoMemoryServer.create();
  const mongoUri = mongod.getUri('plastypesa-rbac');

  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db('plastypesa-rbac');

  console.log('Seeding fixtures...');
  const seeded = await seed(db);

  console.log(`Starting backend on :${PORT} (${BACKEND_ENTRY})...`);
  const backend = startBackend(mongoUri, { quiet: quietBackend });

  const healthy = await waitForHealth();
  if (!healthy) {
    backend.kill();
    await client.close().catch(() => {});
    await mongod.stop().catch(() => {});
    throw new Error('Backend did not become healthy within 60s');
  }
  console.log(`Backend healthy at ${BASE_URL}\n`);

  return {
    baseUrl: BASE_URL,
    backendOrigin: BACKEND_ORIGIN,
    db,
    adminEmail: ADMIN_EMAIL,
    adminPassword: ADMIN_PASSWORD,
    subjectEmail: SUBJECT_EMAIL,
    subjectLastName: SUBJECT_LAST_NAME,
    ...seeded,
    async stop() {
      backend.kill();
      await client.close().catch(() => {});
      await mongod.stop().catch(() => {});
    },
  };
}
