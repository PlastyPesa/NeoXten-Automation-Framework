import { resolveProductDataDir, getProductPathSnapshot } from '../../runtime/product-paths.js';
import {
  loadAppConfig,
  loadFirstRunState,
  saveFirstRunState,
} from '../../runtime/app-config.js';
import { runReadinessChecks, runReadinessChecksSync } from '../../runtime/readiness.js';
import { getOperatorHome } from '../../operator/paths.js';

export function productPathsCommand(opts: { json?: boolean }) {
  const operatorHome = getOperatorHome();
  const snap = getProductPathSnapshot(operatorHome);
  const payload = {
    productDataDir: snap.productDataDir,
    configDir: snap.configDir,
    logsDir: snap.logsDir,
    operatorHome: snap.operatorHome,
    operatorSqlitePath: snap.operatorSqlitePath,
    operatorBlobsDir: snap.operatorBlobsDir,
    appConfigPath: snap.appConfigPath,
    firstRunStatePath: snap.firstRunStatePath,
    serviceLockPath: snap.serviceLockPath,
    env: {
      NEOXTEN_DATA_DIR: process.env.NEOXTEN_DATA_DIR ?? null,
      NEOXTEN_OPERATOR_HOME: process.env.NEOXTEN_OPERATOR_HOME ?? null,
      NEOXTEN_USE_CWD_OPERATOR_HOME: process.env.NEOXTEN_USE_CWD_OPERATOR_HOME ?? null,
    },
  };
  if (opts.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log('NeoXten product paths (local-first)\n');
    for (const [k, v] of Object.entries(payload)) {
      if (k === 'env') {
        console.log('  env:', JSON.stringify(v, null, 2));
      } else {
        console.log(`  ${k}: ${v}`);
      }
    }
  }
}

export async function productReadinessCommand(opts: {
  json?: boolean;
  checkService?: boolean;
  servicePort?: string;
}) {
  const operatorHome = getOperatorHome();
  let url: string | undefined;
  if (opts.checkService) {
    const port = parseInt(opts.servicePort ?? process.env.NEOXTEN_OPERATOR_PORT ?? '8787', 10);
    const host = process.env.NEOXTEN_OPERATOR_HOST ?? '127.0.0.1';
    url = `http://${host}:${port}/api/health`;
  }
  const report = await runReadinessChecks({ operatorHome, serviceHealthUrl: url });
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
    return;
  }
  console.log(`Readiness: ${report.ok ? 'PASS' : 'FAIL'}\n`);
  for (const c of report.checks) {
    console.log(`  [${c.severity.toUpperCase()}] ${c.label}`);
    if (c.detail) console.log(`         ${c.detail}`);
  }
  process.exit(report.ok ? 0 : 1);
}

export function productReadinessSyncCommand(opts: { json?: boolean }) {
  const report = runReadinessChecksSync({ operatorHome: getOperatorHome() });
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
    return;
  }
  console.log(`Readiness (sync): ${report.ok ? 'PASS' : 'FAIL'}\n`);
  for (const c of report.checks) {
    console.log(`  [${c.severity.toUpperCase()}] ${c.label}`);
    if (c.detail) console.log(`         ${c.detail}`);
  }
  process.exit(report.ok ? 0 : 1);
}

export function productFirstRunStatusCommand(opts: { json?: boolean }) {
  const state = loadFirstRunState();
  const cfg = loadAppConfig();
  const dataDir = resolveProductDataDir();
  const payload = {
    firstRun: state,
    appConfig: cfg,
    productDataDir: dataDir,
  };
  if (opts.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(JSON.stringify(payload, null, 2));
  }
}

export function productMarkFirstRunCommand(opts: { json?: boolean; version?: string }) {
  saveFirstRunState({
    complete: true,
    completedAt: new Date().toISOString(),
    productVersion: opts.version ?? '2.1.0',
  });
  const out = { ok: true, ...loadFirstRunState() };
  if (opts.json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log('First-run marked complete.', out);
  }
}
