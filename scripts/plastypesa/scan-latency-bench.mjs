#!/usr/bin/env node
/**
 * P5 — Eco Scan latency bench.
 *
 * Hits `POST /api/eco-scan/hint` N times with a tiny stand-in JPEG, then
 * prints p50 / p95 / max / errors per run plus an aggregate envelope.
 * Used to track the Recognition v2 spec target: **p50 ≤ 2.5 s** end-to-end
 * (the Bin Buddy benchmark Opus calls out in the P5 plan).
 *
 * Honest-bench rules:
 *   - We DO NOT exercise the full Anthropic path by default. The script
 *     uses a 40-byte base64 stub which the controller currently still
 *     forwards to the service; the resulting latency is therefore an
 *     end-to-end *infrastructure* number (Lambda cold + warm, network,
 *     Mongo write) — NOT a model number. To measure the real classifier
 *     latency, set `PLASTYPESA_BENCH_REAL_IMAGE=path/to.jpg` and the
 *     script will base64-encode that file instead.
 *   - We DO NOT mutate global state on prod beyond what a normal scan
 *     would do (the `eco_scan_events` collection is append-only with a
 *     90-day TTL, so bench runs auto-expire).
 *   - We require an authenticated JWT just like every other scan call;
 *     when missing, the script bails with a clear message rather than
 *     silently measuring 401-fast-paths and reporting fake p50s.
 *
 * Env:
 *   PLASTYPESA_BENCH_RUNS              — number of requests (default 20)
 *   PLASTYPESA_BENCH_CONCURRENCY       — parallel in-flight (default 1)
 *   PLASTYPESA_BENCH_REAL_IMAGE        — optional path to a real JPEG
 *   PLASTYPESA_BENCH_OUT               — optional JSON report path
 *   PLASTYPESA_BENCH_INCLUDE_DEVICE_HINT=1 — include a fake on-device
 *       hint envelope in every request so we exercise the P5 path
 *   PLASTYPESA_USER_JWT / PLASTYPESA_TEST_EMAIL+PLASTYPESA_TEST_PASSWORD
 *       — same auth bootstrap as the main suite.
 *
 * Exit code:
 *   0 — bench finished (p50 reported, even if above target).
 *   1 — auth missing OR every request errored. We never fail the build
 *       solely because p50 is above target — that decision is owner's.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { bootstrapPlastyPesaEnv } from './env-bootstrap.mjs';
import { getConfig, url } from './config.mjs';
import { resolvePlastyPesaAuth } from './auth-bootstrap.mjs';

const TINY_JPEG_BASE64 = '/9j' + 'A'.repeat(40);

function quantile(sortedAscMs, q) {
  if (sortedAscMs.length === 0) return null;
  if (sortedAscMs.length === 1) return sortedAscMs[0];
  const idx = Math.min(
    sortedAscMs.length - 1,
    Math.floor(q * (sortedAscMs.length - 1)),
  );
  return sortedAscMs[idx];
}

async function loadImage() {
  const real = process.env.PLASTYPESA_BENCH_REAL_IMAGE;
  if (!real) return TINY_JPEG_BASE64;
  const buf = await readFile(real);
  return buf.toString('base64');
}

function buildBody({ imageBase64, includeDeviceHint }) {
  const body = { image: imageBase64, source: 'camera', lang: 'en' };
  if (includeDeviceHint) {
    body.deviceHint = {
      family: 'plastic',
      confidence: 0.7,
      latencyMs: 120,
    };
  }
  return body;
}

async function runOnce(cfg, body) {
  const start = Date.now();
  let status = 0;
  let error = null;
  try {
    const r = await fetch(url(cfg, '/eco-scan/hint'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cfg.authHeaders },
      body: JSON.stringify(body),
    });
    status = r.status;
    // Read body to time the full round-trip; ignore the parsed payload.
    await r.text();
  } catch (e) {
    error = e && e.message ? String(e.message) : 'fetch failed';
  }
  return { latencyMs: Date.now() - start, status, error };
}

async function runBench() {
  bootstrapPlastyPesaEnv();
  const baseCfg = getConfig();
  const auth = await resolvePlastyPesaAuth(baseCfg);
  if (!auth.authHeaders) {
    console.error(
      '\n[scan-latency-bench] FATAL: no JWT (PLASTYPESA_USER_JWT or email+password). Cannot measure scan latency anonymously.\n',
    );
    return 1;
  }
  const cfg = { ...baseCfg, authHeaders: auth.authHeaders };

  const runs = Math.max(
    1,
    Number(process.env.PLASTYPESA_BENCH_RUNS || 20) | 0,
  );
  const concurrency = Math.max(
    1,
    Number(process.env.PLASTYPESA_BENCH_CONCURRENCY || 1) | 0,
  );
  const includeDeviceHint =
    process.env.PLASTYPESA_BENCH_INCLUDE_DEVICE_HINT === '1';
  const imageBase64 = await loadImage();
  const body = buildBody({ imageBase64, includeDeviceHint });

  console.log('\n=== PlastyPesa Eco Scan Latency Bench ===\n');
  console.log(`API:           ${cfg.apiBase}`);
  console.log(`Auth:          ${auth.authSource}`);
  console.log(`Runs:          ${runs}`);
  console.log(`Concurrency:   ${concurrency}`);
  console.log(`Image bytes:   ${Math.floor(imageBase64.length * 0.75)} (b64 len ${imageBase64.length})`);
  console.log(`Device hint:   ${includeDeviceHint ? 'YES (P5 path)' : 'no'}`);
  console.log('');

  const results = [];
  let in_flight = 0;
  let issued = 0;
  let finished = 0;
  await new Promise((resolveAll) => {
    const launch = () => {
      while (in_flight < concurrency && issued < runs) {
        issued += 1;
        in_flight += 1;
        runOnce(cfg, body)
          .then((r) => {
            results.push(r);
            finished += 1;
            in_flight -= 1;
            const tag =
              r.status >= 200 && r.status < 300
                ? 'OK '
                : r.error
                  ? 'ERR'
                  : `${r.status}`;
            console.log(
              `  [${String(finished).padStart(3)}/${runs}] ${tag} ${String(r.latencyMs).padStart(5)} ms${r.error ? ` (${r.error})` : ''}`,
            );
            if (finished === runs) resolveAll();
            else launch();
          })
          .catch((e) => {
            results.push({
              latencyMs: 0,
              status: 0,
              error: e && e.message ? e.message : 'unknown',
            });
            finished += 1;
            in_flight -= 1;
            if (finished === runs) resolveAll();
            else launch();
          });
      }
    };
    launch();
  });

  const ok = results.filter(
    (r) => r.status >= 200 && r.status < 300 && !r.error,
  );
  const errors = results.length - ok.length;
  const sorted = ok.map((r) => r.latencyMs).sort((a, b) => a - b);
  const p50 = quantile(sorted, 0.5);
  const p95 = quantile(sorted, 0.95);
  const max = sorted.length ? sorted[sorted.length - 1] : null;
  const min = sorted.length ? sorted[0] : null;
  const meanFn = (xs) =>
    xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;

  const report = {
    apiBase: cfg.apiBase,
    runs,
    concurrency,
    deviceHint: includeDeviceHint,
    successCount: ok.length,
    errorCount: errors,
    p50,
    p95,
    max,
    min,
    mean: meanFn(sorted),
    p50TargetMs: 2500,
    p50WithinTarget: p50 !== null ? p50 <= 2500 : null,
  };

  console.log('\n=== Summary ===\n');
  console.log(`  successes:   ${report.successCount}/${runs}`);
  console.log(`  errors:      ${report.errorCount}`);
  console.log(`  p50:         ${report.p50} ms (target ≤ ${report.p50TargetMs} ms)`);
  console.log(`  p95:         ${report.p95} ms`);
  console.log(`  min/mean/max ${report.min}/${report.mean}/${report.max} ms`);
  console.log(
    `  within p50 target: ${report.p50WithinTarget === null ? 'n/a' : report.p50WithinTarget ? 'YES' : 'NO'}`,
  );

  const outPath = process.env.PLASTYPESA_BENCH_OUT;
  if (outPath) {
    await writeFile(outPath, JSON.stringify(report, null, 2));
    console.log(`\n  report saved → ${outPath}`);
  }

  // Bail only when nothing succeeded — see exit-code policy in header.
  if (ok.length === 0) return 1;
  return 0;
}

const isMain =
  process.argv[1] &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isMain) {
  const code = await runBench();
  process.exit(code);
}

export { runBench, quantile };
