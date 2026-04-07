import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { resolve, join } from 'path';
import { openOperatorDb } from '../db/client.js';
import { getDefaultWorkspaceId } from '../db/client.js';
import {
  runs,
  issues,
  runArtifacts,
  projects,
  patchProposals,
  findings as findingsTable,
  retestItems,
  issueRuns,
  explainBindings,
} from '../db/schema.js';
import { desc, eq } from 'drizzle-orm';
import {
  ingestRunManifest,
  parseManifestFromPath,
} from '../ingest/service.js';
import { RunManifestSchema } from '../manifest/schema.js';
import { executeGateSuite } from '../../cli/commands/gate.js';
import { scanDataTestIds } from '../code-map/scan.js';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { randomUUID, createHash } from 'crypto';
import {
  RetestHintSchema,
  FindingSchema,
  type Finding,
  type ValidationClosureSummary,
} from '../findings/schema.js';
import { planRetestFromChangedFilesAndFindings } from '../retest/planner.js';
import { explainFindingStrictJson } from '../findings/narrative.js';
import { recordVisualBaseline } from '../baselines/store.js';
import { getProductPathSnapshot, type ProductPathSnapshot } from '../../runtime/product-paths.js';
import { writeServiceLock, clearServiceLock } from '../../runtime/service-lock.js';
import { loadAppConfig, saveAppConfig } from '../../runtime/app-config.js';

export interface StartOperatorApiOptions {
  operatorHome: string;
  host?: string;
  port: number;
  /** Write service-lock.json and register SIGINT/SIGTERM cleanup (default: true unless NEOXTEN_OPERATOR_NO_LOCK=1). */
  manageServiceLock?: boolean;
}

function checkToken(authHeader: string | undefined, expected: string | undefined): boolean {
  if (!expected?.trim()) return true;
  const m = authHeader?.match(/^Bearer\s+(.+)$/i);
  return m?.[1] === expected.trim();
}

function frameworkRoot(): string {
  return (
    process.env.NEOXTEN_FRAMEWORK_ROOT?.trim() ||
    process.cwd()
  );
}

export async function createOperatorApp(
  opts: StartOperatorApiOptions,
): Promise<{ app: FastifyInstance; db: ReturnType<typeof openOperatorDb>['db'] }> {
  const { db } = openOperatorDb(opts.operatorHome);
  const token = process.env.NEOXTEN_OPERATOR_API_TOKEN;

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  app.addHook('preHandler', async (req, reply) => {
    if (req.url === '/api/health' || req.url.startsWith('/ws')) return;
    if (!checkToken(req.headers.authorization, token)) {
      reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.get('/api/health', async () => ({ ok: true, service: 'neoxten-operator' }));

  app.post<{
    Body: {
      runDir: string;
      archiveBlobs?: boolean;
      projectId?: string | null;
      environmentProfileId?: string | null;
      suiteId?: string | null;
      manifest?: unknown;
    };
  }>('/api/runs/ingest', async (req) => {
    const runDir = resolve(req.body.runDir);
    const manifest = req.body.manifest
      ? RunManifestSchema.parse(req.body.manifest)
      : parseManifestFromPath(runDir);
    const result = ingestRunManifest(db, manifest, runDir, {
      operatorHome: opts.operatorHome,
      archiveBlobs: Boolean(req.body.archiveBlobs),
      projectId: req.body.projectId,
      environmentProfileId: req.body.environmentProfileId,
      suiteId: req.body.suiteId,
    });
    return { ok: true, ...result, neoxtenRunId: manifest.runId };
  });

  app.get('/api/runs', async () => {
    const workspaceId = getDefaultWorkspaceId(db);
    const rows = db
      .select()
      .from(runs)
      .where(eq(runs.workspaceId, workspaceId))
      .orderBy(desc(runs.completedAt))
      .limit(100)
      .all();
    return { runs: rows };
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id', async (req, reply) => {
    const row = db.select().from(runs).where(eq(runs.id, req.params.id)).limit(1).all();
    if (!row.length) {
      reply.code(404).send({ error: 'not_found' });
      return;
    }
    const arts = db
      .select()
      .from(runArtifacts)
      .where(eq(runArtifacts.runDbId, req.params.id))
      .all();
    return { run: row[0], artifacts: arts };
  });

  app.get<{ Params: { id: string }; Querystring: { relpath?: string } }>(
    '/api/runs/:id/raw',
    async (req, reply) => {
      const relpath = req.query.relpath;
      if (!relpath || relpath.includes('..') || relpath.startsWith('/') || relpath.startsWith('\\')) {
        reply.code(400).send({ error: 'invalid_relpath' });
        return;
      }
      const row = db.select().from(runs).where(eq(runs.id, req.params.id)).limit(1).all();
      if (!row.length) {
        reply.code(404).send({ error: 'not_found' });
        return;
      }
      const base = resolve(row[0]!.sourceRunDir);
      const full = resolve(base, relpath);
      if (!full.startsWith(base)) {
        reply.code(403).send({ error: 'path_escape' });
        return;
      }
      if (!existsSync(full)) {
        reply.code(404).send({ error: 'file_not_found' });
        return;
      }
      const buf = readFileSync(full);
      const lower = relpath.toLowerCase();
      if (lower.endsWith('.png')) reply.header('Content-Type', 'image/png');
      else if (lower.endsWith('.json')) reply.header('Content-Type', 'application/json');
      else if (lower.endsWith('.log') || lower.endsWith('.txt')) reply.header('Content-Type', 'text/plain; charset=utf-8');
      return reply.send(buf);
    },
  );

  app.get<{ Params: { id: string } }>('/api/runs/:id/findings', async (req, reply) => {
    const row = db.select().from(runs).where(eq(runs.id, req.params.id)).limit(1).all();
    if (!row.length) {
      reply.code(404).send({ error: 'not_found' });
      return;
    }
    const rows = db
      .select()
      .from(findingsTable)
      .where(eq(findingsTable.runDbId, req.params.id))
      .all();
    const findings = rows.map((r) => JSON.parse(r.payloadJson) as Finding);
    return { findings };
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id/validation-closure', async (req, reply) => {
    const row = db.select().from(runs).where(eq(runs.id, req.params.id)).limit(1).all();
    if (!row.length) {
      reply.code(404).send({ error: 'not_found' });
      return;
    }
    const r = row[0]!;
    if (r.validationClosureJson) {
      return JSON.parse(r.validationClosureJson) as ValidationClosureSummary;
    }
    try {
      const manifest = JSON.parse(r.manifestJson) as { validationClosure?: ValidationClosureSummary };
      if (manifest.validationClosure) return manifest.validationClosure;
    } catch {
      /* fall through */
    }
    reply.code(404).send({ error: 'no_closure' });
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id/retest-items', async (req, reply) => {
    const row = db.select().from(runs).where(eq(runs.id, req.params.id)).limit(1).all();
    if (!row.length) {
      reply.code(404).send({ error: 'not_found' });
      return;
    }
    const rows = db
      .select()
      .from(retestItems)
      .where(eq(retestItems.runDbId, req.params.id))
      .all();
    return { retestItems: rows };
  });

  app.get<{ Params: { id: string } }>('/api/findings/:id/narrative', async (req, reply) => {
    const row = db.select().from(findingsTable).where(eq(findingsTable.id, req.params.id)).limit(1).all();
    if (!row.length) {
      reply.code(404).send({ error: 'not_found' });
      return;
    }
    const finding = JSON.parse(row[0]!.payloadJson) as Finding;
    const parsed = FindingSchema.parse(finding);
    return explainFindingStrictJson(parsed);
  });

  app.patch<{
    Params: { id: string };
    Body: { promotionState?: string; mergePayload?: Record<string, unknown> };
  }>('/api/findings/:id', async (req, reply) => {
    const row = db.select().from(findingsTable).where(eq(findingsTable.id, req.params.id)).limit(1).all();
    if (!row.length) {
      reply.code(404).send({ error: 'not_found' });
      return;
    }
    const cur = row[0]!;
    let payload = JSON.parse(cur.payloadJson) as Record<string, unknown>;
    if (req.body.mergePayload) {
      payload = { ...payload, ...req.body.mergePayload };
    }
    if (req.body.promotionState) {
      payload.promotion_state = req.body.promotionState;
    }
    const parsed = FindingSchema.parse(payload);
    db.update(findingsTable)
      .set({
        payloadJson: JSON.stringify(parsed),
        promotionState: parsed.promotion_state,
        fingerprint: parsed.fingerprint ?? cur.fingerprint,
      })
      .where(eq(findingsTable.id, req.params.id))
      .run();
    return { ok: true, finding: parsed };
  });

  app.post<{ Params: { runId: string; findingId: string } }>(
    '/api/runs/:runId/findings/:findingId/promote',
    async (req, reply) => {
      const runRow = db.select().from(runs).where(eq(runs.id, req.params.runId)).limit(1).all();
      if (!runRow.length) {
        reply.code(404).send({ error: 'run_not_found' });
        return;
      }
      const fRow = db
        .select()
        .from(findingsTable)
        .where(eq(findingsTable.id, req.params.findingId))
        .limit(1)
        .all();
      if (!fRow.length || fRow[0]!.runDbId !== req.params.runId) {
        reply.code(404).send({ error: 'finding_not_found' });
        return;
      }
      const finding = JSON.parse(fRow[0]!.payloadJson) as Finding;
      const workspaceId = getDefaultWorkspaceId(db);
      const now = new Date().toISOString();
      const fp =
        finding.fingerprint ??
        `neo-fp-${createHash('sha256').update(finding.id + finding.title).digest('hex').slice(0, 24)}`;
      const issueId = randomUUID();
      const classification =
        finding.kind === 'design_system' ? 'design_system_promoted' : 'promoted_finding';
      db.insert(issues)
        .values({
          id: issueId,
          workspaceId,
          projectId: runRow[0]!.projectId,
          fingerprint: fp,
          status: 'triage',
          severity: finding.severity === 'blocker' ? 'high' : 'medium',
          title: finding.title,
          classification,
          codeBridgeJson: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      db.insert(issueRuns).values({ issueId, runDbId: req.params.runId }).run();
      const narrative = explainFindingStrictJson(finding);
      const ih = createHash('sha256').update(JSON.stringify(narrative)).digest('hex').slice(0, 24);
      db.insert(explainBindings)
        .values({
          id: randomUUID(),
          entityType: 'finding',
          entityKey: finding.id,
          templateSlug: narrative.template_slug,
          inputsHash: ih,
          renderedJson: JSON.stringify(narrative),
          createdAt: now,
        })
        .run();
      const promoted = FindingSchema.parse({ ...finding, promotion_state: 'promoted' });
      db.update(findingsTable)
        .set({
          promotionState: promoted.promotion_state,
          payloadJson: JSON.stringify(promoted),
        })
        .where(eq(findingsTable.id, finding.id))
        .run();
      return { ok: true, issueId };
    },
  );

  app.patch<{
    Params: { id: string };
    Body: { status: string; waiveReason?: string };
  }>('/api/retest-items/:id', async (req, reply) => {
    const row = db.select().from(retestItems).where(eq(retestItems.id, req.params.id)).limit(1).all();
    if (!row.length) {
      reply.code(404).send({ error: 'not_found' });
      return;
    }
    const st = req.body.status;
    if (!['pending', 'passed', 'waived'].includes(st)) {
      reply.code(400).send({ error: 'invalid_status' });
      return;
    }
    db.update(retestItems)
      .set({
        status: st,
        waiveReason: st === 'waived' ? req.body.waiveReason ?? 'waived' : null,
      })
      .where(eq(retestItems.id, req.params.id))
      .run();
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/patches/:id/retest-items', async (req, reply) => {
    const row = db.select().from(patchProposals).where(eq(patchProposals.id, req.params.id)).limit(1).all();
    if (!row.length) {
      reply.code(404).send({ error: 'not_found' });
      return;
    }
    const rows = db
      .select()
      .from(retestItems)
      .where(eq(retestItems.patchProposalId, req.params.id))
      .all();
    return { retestItems: rows };
  });

  app.post<{
    Body: {
      baselineKey: string;
      contentSha256: string;
      projectId?: string | null;
      approvedRunDbId?: string | null;
    };
  }>('/api/baselines/record', async (req, reply) => {
    const { baselineKey, contentSha256 } = req.body ?? {};
    if (!baselineKey || !contentSha256) {
      reply.code(400).send({ error: 'baselineKey and contentSha256 required' });
      return;
    }
    const id = recordVisualBaseline(db, {
      baselineKey,
      contentSha256,
      projectId: req.body.projectId,
      approvedRunDbId: req.body.approvedRunDbId,
    });
    return { ok: true, id };
  });

  app.get('/api/issues', async () => {
    const workspaceId = getDefaultWorkspaceId(db);
    const rows = db
      .select()
      .from(issues)
      .where(eq(issues.workspaceId, workspaceId))
      .orderBy(desc(issues.updatedAt))
      .limit(100)
      .all();
    return { issues: rows };
  });

  app.patch<{ Params: { id: string }; Body: { status?: string; classification?: string } }>(
    '/api/issues/:id',
    async (req, reply) => {
      const row = db.select().from(issues).where(eq(issues.id, req.params.id)).limit(1).all();
      if (!row.length) {
        reply.code(404).send({ error: 'not_found' });
        return;
      }
      const now = new Date().toISOString();
      const updates: { updatedAt: string; status?: string; classification?: string | null } = {
        updatedAt: now,
      };
      if (req.body.status) updates.status = req.body.status;
      if (req.body.classification !== undefined) updates.classification = req.body.classification;
      db.update(issues).set(updates).where(eq(issues.id, req.params.id)).run();
      return { ok: true };
    },
  );

  app.get<{ Params: { id: string } }>('/api/projects/:id/code-map', async (req, reply) => {
    const row = db.select().from(projects).where(eq(projects.id, req.params.id)).limit(1).all();
    if (!row.length) {
      reply.code(404).send({ error: 'not_found' });
      return;
    }
    const root = resolve(frameworkRoot(), row[0]!.repoRoot);
    const testIds = scanDataTestIds(root);
    return {
      projectId: row[0]!.id,
      slug: row[0]!.slug,
      resolvedRepoRoot: root,
      testIds,
      testIdCount: testIds.length,
    };
  });

  app.get('/api/regression/summary', async () => {
    const workspaceId = getDefaultWorkspaceId(db);
    const all = db
      .select()
      .from(runs)
      .where(eq(runs.workspaceId, workspaceId))
      .orderBy(desc(runs.completedAt))
      .limit(300)
      .all();
    const byConfig: Record<string, { lastPassAt?: string; lastFailAt?: string }> = {};
    for (const r of all) {
      try {
        const v = JSON.parse(r.verdictJson) as { verdict?: string };
        const key = r.configPath;
        if (!byConfig[key]) byConfig[key] = {};
        const b = byConfig[key]!;
        if (v.verdict === 'PASS' && !b.lastPassAt) b.lastPassAt = r.completedAt;
        if (v.verdict !== 'PASS' && !b.lastFailAt) b.lastFailAt = r.completedAt;
      } catch {
        /* skip */
      }
    }
    return { byConfig };
  });

  app.get('/api/patches', async () => {
    const workspaceId = getDefaultWorkspaceId(db);
    const rows = db
      .select()
      .from(patchProposals)
      .where(eq(patchProposals.workspaceId, workspaceId))
      .orderBy(desc(patchProposals.updatedAt))
      .limit(50)
      .all();
    return { patches: rows };
  });

  app.post<{
    Body: {
      baseSha: string;
      unifiedDiff: string;
      authorKind?: string;
      projectId?: string | null;
      state?: string;
      changedFiles?: string[];
      linkedRunDbId?: string | null;
    };
  }>('/api/patches', async (req, reply) => {
    const { baseSha, unifiedDiff } = req.body ?? {};
    if (!baseSha || !unifiedDiff) {
      reply.code(400).send({ error: 'baseSha and unifiedDiff required' });
      return;
    }
    const workspaceId = getDefaultWorkspaceId(db);
    const now = new Date().toISOString();
    const id = randomUUID();
    db.insert(patchProposals)
      .values({
        id,
        workspaceId,
        projectId: req.body.projectId ?? null,
        baseSha,
        unifiedDiff,
        authorKind: req.body.authorKind ?? 'human',
        state: req.body.state ?? 'proposed',
        validationRunIdsJson: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const changed = req.body.changedFiles ?? [];
    let linkedFindings: Finding[] = [];
    if (req.body.linkedRunDbId) {
      const fr = db
        .select()
        .from(findingsTable)
        .where(eq(findingsTable.runDbId, req.body.linkedRunDbId))
        .all();
      linkedFindings = fr.map((r) => JSON.parse(r.payloadJson) as Finding);
    }
    const hints = planRetestFromChangedFilesAndFindings(changed, linkedFindings);
    for (const h of hints) {
      const parsed = RetestHintSchema.parse(h);
      db.insert(retestItems)
        .values({
          id: randomUUID(),
          runDbId: null,
          issueId: null,
          patchProposalId: id,
          checkId: parsed.check_id,
          rationale: parsed.rationale,
          required: parsed.required,
          status: 'pending',
          waiveReason: null,
          relatedFindingIdsJson: parsed.related_finding_ids
            ? JSON.stringify(parsed.related_finding_ids)
            : null,
          createdAt: now,
        })
        .run();
    }

    return { ok: true, id, retestHintsCreated: hints.length };
  });

  app.get('/api/explain/:slug', async (req, reply) => {
    const safe = (req.params as { slug: string }).slug.replace(/[^a-z0-9-_]/gi, '');
    const p = join(frameworkRoot(), 'operator', 'content', 'explain', `${safe}.json`);
    if (!existsSync(p)) {
      reply.code(404).send({ error: 'not_found' });
      return;
    }
    return JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>;
  });

  app.get('/api/playbooks', async () => {
    const dir = join(frameworkRoot(), 'operator', 'content', 'playbooks');
    const list: Array<{ id: string; title?: string }> = [];
    try {
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        const id = f.replace(/\.json$/i, '');
        try {
          const raw = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as { title?: string };
          list.push({ id, title: raw.title });
        } catch {
          list.push({ id });
        }
      }
    } catch {
      /* no playbooks dir */
    }
    return { playbooks: list };
  });

  app.get<{ Params: { id: string } }>('/api/playbooks/:id', async (req, reply) => {
    const safe = req.params.id.replace(/[^a-z0-9-_]/gi, '');
    if (safe !== req.params.id) {
      reply.code(400).send({ error: 'invalid id' });
      return;
    }
    const p = join(frameworkRoot(), 'operator', 'content', 'playbooks', `${safe}.json`);
    if (!existsSync(p)) {
      reply.code(404).send({ error: 'not_found' });
      return;
    }
    return JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>;
  });

  app.post('/api/factory/import-timeline', async () => ({
    ok: false,
    note:
      'Batch NDJSON import is not implemented; ingest each completed run with POST /api/runs/ingest or nx operator ingest.',
  }));

  app.get('/api/modules/manifest', async () => {
    const p = join(opts.operatorHome, 'modules.json');
    if (!existsSync(p)) {
      return { modules: [], note: 'Create modules.json in operator home (see operator/modules.example.json)' };
    }
    try {
      return JSON.parse(readFileSync(p, 'utf-8')) as unknown;
    } catch {
      return { error: 'invalid_json' };
    }
  });

  app.post<{
    Body: {
      slug: string;
      displayName: string;
      repoRoot: string;
      adapterTypes?: string[];
    };
  }>('/api/projects', async (req, reply) => {
    const { slug, displayName, repoRoot } = req.body ?? {};
    if (!slug || !displayName || !repoRoot) {
      reply.code(400).send({ error: 'slug, displayName, repoRoot required' });
      return;
    }
    const workspaceId = getDefaultWorkspaceId(db);
    const id = randomUUID();
    const now = new Date().toISOString();
    db.insert(projects)
      .values({
        id,
        workspaceId,
        slug,
        displayName,
        repoRoot,
        adapterTypes: JSON.stringify(req.body.adapterTypes ?? []),
        createdAt: now,
      })
      .run();
    return { ok: true, id };
  });

  app.get('/api/projects', async () => {
    const workspaceId = getDefaultWorkspaceId(db);
    const rows = db
      .select()
      .from(projects)
      .where(eq(projects.workspaceId, workspaceId))
      .all();
    return { projects: rows };
  });

  app.get('/api/suites', async () => {
    const root = frameworkRoot();
    const dir = join(root, 'suites');
    let ids: string[] = [];
    try {
      ids = readdirSync(dir)
        .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
        .map((f) => f.replace(/\.ya?ml$/i, ''));
    } catch {
      ids = [];
    }
    return { frameworkRoot: root, suites: ids };
  });

  app.post<{
    Body: { preset: string; outDir?: string; skipIntegration?: boolean };
  }>('/api/gate/execute', async (req, reply) => {
    const preset = req.body?.preset;
    if (!preset) {
      reply.code(400).send({ error: 'preset required' });
      return;
    }
    try {
      const result = await executeGateSuite({
        preset,
        frameworkRoot: frameworkRoot(),
        outDir: req.body.outDir,
        skipIntegration: req.body.skipIntegration,
      });
      return { ok: true, ...result };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      reply.code(500).send({ error: msg });
    }
  });

  app.get('/ws', { websocket: true }, (conn) => {
    conn.socket.send(JSON.stringify({ type: 'hello', service: 'neoxten-operator' }));
  });

  return { app, db };
}

function registerOperatorShutdown(app: FastifyInstance, paths: ProductPathSnapshot): void {
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearServiceLock(paths);
    try {
      await app.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

export async function startOperatorApi(opts: StartOperatorApiOptions): Promise<void> {
  const { app } = await createOperatorApp(opts);
  const host = opts.host ?? '127.0.0.1';
  await app.listen({ port: opts.port, host });

  const addr = app.server.address();
  const boundPort =
    typeof addr === 'object' && addr && 'port' in addr ? (addr as { port: number }).port : opts.port;

  console.log(`NeoXten Operator API listening on http://${host}:${boundPort}`);

  const lockEnabled =
    opts.manageServiceLock !== false && process.env.NEOXTEN_OPERATOR_NO_LOCK !== '1';
  if (lockEnabled) {
    const paths = getProductPathSnapshot(opts.operatorHome);
    writeServiceLock(paths, boundPort, host);
    const cfg = loadAppConfig();
    saveAppConfig({ ...cfg, lastBoundPort: boundPort, operatorPort: boundPort });
    registerOperatorShutdown(app, paths);
  }
}
