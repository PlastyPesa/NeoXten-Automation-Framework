/**
 * Strict checks for staged Windows bundle (src-tauri/resources) before/without full NSIS build.
 * Run: node scripts/validate-windows-bundle.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const res = join(root, 'src-tauri', 'resources');
const rt = join(res, 'neoxten-runtime');
const nodeWin = join(res, 'nodejs', 'node.exe');

function fail(msg) {
  console.error('validate-windows-bundle: FAIL —', msg);
  process.exit(1);
}

function main() {
  const cli = join(rt, 'dist', 'cli', 'index.js');
  if (!existsSync(cli)) {
    if (process.env.REQUIRE_WINDOWS_BUNDLE === '1') {
      fail(`missing staged runtime: ${cli} (run node scripts/prepare-windows-bundle.mjs)`);
    }
    console.log('validate-windows-bundle: skip (no staged bundle). Set REQUIRE_WINDOWS_BUNDLE=1 to enforce.');
    process.exit(0);
  }
  if (process.platform === 'win32' && !existsSync(nodeWin)) {
    fail(`missing portable Node: ${nodeWin}`);
  }
  const required = [
    join(rt, 'node_modules', 'fastify', 'package.json'),
    join(rt, 'operator', 'content'),
    join(rt, 'suites', 'operator.yaml'),
  ];
  for (const p of required) {
    if (!existsSync(p)) {
      fail(`missing ${p}`);
    }
  }
  const node = process.platform === 'win32' && existsSync(nodeWin) ? nodeWin : process.execPath;
  const env = {
    ...process.env,
    NEOXTEN_FRAMEWORK_ROOT: rt,
    NEOXTEN_DATA_DIR: join(root, '.neoxten-bundle-validate'),
    NEOXTEN_OPERATOR_HOME: join(root, '.neoxten-bundle-validate', 'operator'),
  };
  const r = spawnSync(node, [cli, 'product', 'readiness-sync', '--json'], { encoding: 'utf-8', env });
  if (r.status !== 0) {
    fail(`product readiness-sync exited ${r.status}\n${r.stdout}\n${r.stderr}`);
  }
  let report;
  try {
    report = JSON.parse(r.stdout);
  } catch {
    fail(`invalid JSON from readiness:\n${r.stdout}`);
  }
  if (!report.ok) {
    fail(`readiness report not ok:\n${JSON.stringify(report, null, 2)}`);
  }
  console.log('validate-windows-bundle: ok (readiness ok=true)');
}

main();
