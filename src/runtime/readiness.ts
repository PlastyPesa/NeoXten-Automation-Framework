/**
 * First-run / system readiness for the local Operator product.
 */
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getProductPathSnapshot, resolveProductDataDir } from './product-paths.js';
import { getOperatorHome } from '../operator/paths.js';
import { openOperatorDb } from '../operator/db/client.js';
import { projects } from '../operator/db/schema.js';

export type ReadinessSeverity = 'ok' | 'warn' | 'fail';

export interface ReadinessCheck {
  id: string;
  label: string;
  severity: ReadinessSeverity;
  detail?: string;
}

function checkWritableDir(path: string, label: string): ReadinessCheck {
  try {
    mkdirSync(path, { recursive: true });
    const probe = join(path, `.neoxten-write-probe-${Date.now()}`);
    writeFileSync(probe, 'ok', 'utf-8');
    unlinkSync(probe);
    return { id: `writable:${label}`, label: `${label} is writable`, severity: 'ok' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      id: `writable:${label}`,
      label: `${label} must be writable`,
      severity: 'fail',
      detail: msg,
    };
  }
}

function checkGit(): ReadinessCheck {
  try {
    const v = execFileSync('git', ['--version'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    return { id: 'git', label: 'Git CLI available', severity: 'ok', detail: v.trim() };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      id: 'git',
      label: 'Git CLI',
      severity: 'warn',
      detail: `Not found or failed: ${msg}. Code map / patch flows need git.`,
    };
  }
}

function checkNodeRuntime(): ReadinessCheck {
  const major = parseInt(process.versions.node.split('.')[0] || '0', 10);
  if (major >= 18) {
    return {
      id: 'node',
      label: 'Node.js runtime',
      severity: 'ok',
      detail: `${process.version} (>=18 required)`,
    };
  }
  return {
    id: 'node',
    label: 'Node.js runtime',
    severity: 'fail',
    detail: `${process.version} — need Node 18+`,
  };
}

function playwrightBrowserProbe(): ReadinessCheck {
  const candidates: string[] = [];
  if (process.platform === 'win32') {
    const la = process.env.LOCALAPPDATA;
    if (la) candidates.push(join(la, 'ms-playwright'));
  } else if (process.platform === 'darwin') {
    candidates.push(join(homedir(), 'Library', 'Caches', 'ms-playwright'));
  } else {
    const xdg = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
    candidates.push(join(xdg, 'ms-playwright'));
  }

  for (const root of candidates) {
    if (!existsSync(root)) continue;
    try {
      const names = readdirSync(root);
      const hasChromium = names.some((n) => n.includes('chromium') || n.includes('chrome'));
      if (hasChromium) {
        return {
          id: 'playwright-browsers',
          label: 'Playwright browser cache',
          severity: 'ok',
          detail: `Found under ${root}`,
        };
      }
    } catch {
      /* skip */
    }
  }

  return {
    id: 'playwright-browsers',
    label: 'Playwright browsers',
    severity: 'warn',
    detail:
      'No Chromium cache detected. Run `npx playwright install chromium` (or framework postinstall) before UI automation gates.',
  };
}

function checkProjectRepoPaths(operatorHome: string): ReadinessCheck[] {
  const out: ReadinessCheck[] = [];
  try {
    const { db } = openOperatorDb(operatorHome);
    const rows = db.select().from(projects).all();
    const root = process.env.NEOXTEN_FRAMEWORK_ROOT?.trim() || process.cwd();
    for (const p of rows) {
      const abs = join(root, p.repoRoot);
      const ok = existsSync(abs);
      out.push({
        id: `project:${p.slug}`,
        label: `Project registry path: ${p.displayName}`,
        severity: ok ? 'ok' : 'warn',
        detail: ok ? abs : `Missing or not found: ${abs} (relative to framework root ${root})`,
      });
    }
  } catch (e) {
    out.push({
      id: 'project-registry',
      label: 'Project registry',
      severity: 'warn',
      detail: e instanceof Error ? e.message : String(e),
    });
  }
  return out;
}

export interface ReadinessReport {
  ok: boolean;
  checks: ReadinessCheck[];
  paths: ReturnType<typeof getProductPathSnapshot>;
  firstRunRecommended: boolean;
}

/**
 * @param serviceHealthUrl - e.g. http://127.0.0.1:8787/api/health — optional
 */
export async function runReadinessChecks(options: {
  operatorHome?: string;
  serviceHealthUrl?: string;
}): Promise<ReadinessReport> {
  const dataDir = resolveProductDataDir();
  const operatorHome = options.operatorHome ?? getOperatorHome();
  const paths = getProductPathSnapshot(operatorHome);

  const checks: ReadinessCheck[] = [];

  checks.push(checkWritableDir(dataDir, 'Product data directory'));
  checks.push(checkWritableDir(paths.configDir, 'Config directory'));
  checks.push(checkWritableDir(paths.logsDir, 'Logs directory'));
  checks.push(checkWritableDir(paths.operatorHome, 'Operator home (SQLite + blobs)'));
  checks.push(checkWritableDir(paths.operatorBlobsDir, 'Artifact blob directory'));

  checks.push(checkNodeRuntime());
  checks.push(checkGit());
  checks.push(playwrightBrowserProbe());

  checks.push(...checkProjectRepoPaths(operatorHome));

  if (options.serviceHealthUrl) {
    try {
      const res = await fetch(options.serviceHealthUrl, { signal: AbortSignal.timeout(4000) });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (res.ok && body.ok === true) {
        checks.push({
          id: 'service-health',
          label: 'Operator Control API',
          severity: 'ok',
          detail: options.serviceHealthUrl,
        });
      } else {
        checks.push({
          id: 'service-health',
          label: 'Operator Control API',
          severity: 'fail',
          detail: `HTTP ${res.status} at ${options.serviceHealthUrl}`,
        });
      }
    } catch (e) {
      checks.push({
        id: 'service-health',
        label: 'Operator Control API',
        severity: 'fail',
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  } else {
    checks.push({
      id: 'service-health',
      label: 'Operator Control API',
      severity: 'warn',
      detail: 'Not checked (no service URL). Start `nx operator serve` or use the desktop shell.',
    });
  }

  const failed = checks.some((c) => c.severity === 'fail');
  const firstRunRecommended = failed || checks.some((c) => c.severity === 'warn');

  return {
    ok: !failed,
    checks,
    paths,
    firstRunRecommended,
  };
}

/** For CLI / Rust: sync wrapper without service check */
export function runReadinessChecksSync(options: { operatorHome?: string } = {}): ReadinessReport {
  const dataDir = resolveProductDataDir();
  const operatorHome = options.operatorHome ?? getOperatorHome();
  const paths = getProductPathSnapshot(operatorHome);

  const checks: ReadinessCheck[] = [];
  checks.push(checkWritableDir(dataDir, 'Product data directory'));
  checks.push(checkWritableDir(paths.configDir, 'Config directory'));
  checks.push(checkWritableDir(paths.logsDir, 'Logs directory'));
  checks.push(checkWritableDir(paths.operatorHome, 'Operator home'));
  checks.push(checkWritableDir(paths.operatorBlobsDir, 'Artifact blob directory'));
  checks.push(checkNodeRuntime());
  checks.push(checkGit());
  checks.push(playwrightBrowserProbe());
  checks.push(...checkProjectRepoPaths(operatorHome));
  checks.push({
    id: 'service-health',
    label: 'Operator Control API',
    severity: 'warn',
    detail: 'Use `product readiness` with --check-service or async readiness for HTTP probe.',
  });

  const failed = checks.some((c) => c.severity === 'fail');
  return {
    ok: !failed,
    checks,
    paths,
    firstRunRecommended: failed || checks.some((c) => c.severity === 'warn'),
  };
}
