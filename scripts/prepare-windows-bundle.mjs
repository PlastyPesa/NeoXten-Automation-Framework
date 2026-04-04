/**
 * Stage NeoXten Operator runtime + portable Node for Tauri `bundle.resources` (Windows desktop install).
 *
 * Prerequisites: `npm run build` at repo root (dist/).
 *
 * Env:
 *   PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 (set automatically in npm ci).
 *   NEOXTEN_FORCE_NODE_FETCH=1 — re-download portable Node even if node.exe exists.
 *   NEOXTEN_SKIP_NPM_CI=1 — skip npm ci when node_modules already present.
 *   NEOXTEN_PORTABLE_NODE_URL — override Node win-x64 zip URL.
 */
import { createWriteStream, existsSync, mkdirSync, rmSync, cpSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import https from 'node:https';
import { pipeline } from 'node:stream/promises';

const __root = join(dirname(fileURLToPath(import.meta.url)), '..');
const RES = join(__root, 'src-tauri', 'resources');
const RUNTIME_DEST = join(RES, 'neoxten-runtime');
const NODE_DEST = join(RES, 'nodejs');

const NODE_WIN_X64_ZIP =
  process.env.NEOXTEN_PORTABLE_NODE_URL?.trim() ||
  'https://nodejs.org/dist/v20.19.0/node-v20.19.0-win-x64.zip';

async function downloadToFile(url, dest, redirectDepth = 0) {
  if (redirectDepth > 8) {
    throw new Error('too many redirects');
  }
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  await new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const loc = res.headers.location;
        res.resume();
        if (!loc) {
          reject(new Error('Redirect without location'));
          return;
        }
        const next = new URL(loc, url).href;
        downloadToFile(next, dest, redirectDepth + 1).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`GET ${url} -> ${res.statusCode}`));
        return;
      }
      const out = createWriteStream(tmp);
      pipeline(res, out).then(resolve).catch(reject);
    }).on('error', reject);
  });
  const fs = await import('node:fs/promises');
  await fs.rename(tmp, dest);
}

async function ensurePortableNodeWindows() {
  if (process.platform !== 'win32') {
    console.warn('prepare-windows-bundle: not win32 — skipping portable Node download.');
    console.warn('  Place Windows node.exe under src-tauri/resources/nodejs/ when building the Windows installer.');
    return;
  }
  const nodeExe = join(NODE_DEST, 'node.exe');
  if (existsSync(nodeExe) && process.env.NEOXTEN_FORCE_NODE_FETCH !== '1') {
    console.log('prepare-windows-bundle: portable Node already present:', nodeExe);
    return;
  }
  mkdirSync(NODE_DEST, { recursive: true });
  const zipPath = join(RES, '.cache', 'node-win-x64.zip');
  console.log('prepare-windows-bundle: downloading', NODE_WIN_X64_ZIP);
  await downloadToFile(NODE_WIN_X64_ZIP, zipPath);
  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  const nodeEntry = entries.find((e) => /(^|\/)node\.exe$/i.test(e.entryName));
  if (!nodeEntry) {
    throw new Error('prepare-windows-bundle: node.exe not found inside zip');
  }
  const prefix = nodeEntry.entryName.replace(/[/\\]node\.exe$/i, '');
  for (const e of entries) {
    if (!e.entryName.startsWith(prefix + '/') && !e.entryName.startsWith(prefix + '\\')) {
      continue;
    }
    const rel = e.entryName.slice(prefix.length + 1);
    if (!rel) continue;
    const target = join(NODE_DEST, rel.replace(/\\/g, '/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, e.getData());
  }
  if (!existsSync(join(NODE_DEST, 'node.exe'))) {
    throw new Error('prepare-windows-bundle: node.exe missing after zip extract');
  }
  console.log('prepare-windows-bundle: portable Node ->', join(NODE_DEST, 'node.exe'));
}

function stageNeoxtenRuntime() {
  const cliJs = join(__root, 'dist', 'cli', 'index.js');
  if (!existsSync(cliJs)) {
    throw new Error('prepare-windows-bundle: dist/cli/index.js missing — run `npm run build` at repo root first');
  }
  rmSync(RUNTIME_DEST, { recursive: true, force: true });
  mkdirSync(RUNTIME_DEST, { recursive: true });
  const copyRoots = ['dist', 'operator', 'suites', 'package.json', 'package-lock.json'];
  for (const name of copyRoots) {
    const src = join(__root, name);
    if (!existsSync(src)) {
      throw new Error(`prepare-windows-bundle: missing ${src}`);
    }
    cpSync(src, join(RUNTIME_DEST, name), { recursive: true });
  }
  const env = {
    ...process.env,
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
  };
  if (process.env.NEOXTEN_SKIP_NPM_CI === '1' && existsSync(join(RUNTIME_DEST, 'node_modules'))) {
    console.log('prepare-windows-bundle: NEOXTEN_SKIP_NPM_CI=1 and node_modules exists — skipping npm ci');
    return;
  }
  console.log('prepare-windows-bundle: npm ci --omit=dev in staging (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1)…');
  execSync('npm ci --omit=dev', { cwd: RUNTIME_DEST, stdio: 'inherit', env });
  const stagedCli = join(RUNTIME_DEST, 'dist', 'cli', 'index.js');
  if (!existsSync(stagedCli)) {
    throw new Error('prepare-windows-bundle: staged CLI missing after npm ci');
  }
  console.log('prepare-windows-bundle: neoxten-runtime ->', RUNTIME_DEST);
}

async function main() {
  mkdirSync(RES, { recursive: true });
  await ensurePortableNodeWindows();
  stageNeoxtenRuntime();
  console.log('prepare-windows-bundle: ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
