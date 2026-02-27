/**
 * gate command — single-command validation gate.
 *
 * Presets:
 *   nemyo       — Nemyo ecosystem (web, extension, API, Flutter)
 *   neoxtemus   — Neoxtemus AI desktop (boot, nav, assistant, cargo tests, artifact policy)
 *
 * Runs all automation configs + native tests in sequence.
 * Produces a consolidated markdown report and exits non-zero if anything fails.
 */
import { resolve } from 'path';
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { run } from '../../core/orchestrator.js';

interface GateStep {
  name: string;
  type: 'yaml' | 'flutter' | 'cargo' | 'policy';
  config?: string;
  outSubDir?: string;
  testPath?: string;
  cwd?: string;
  policyRoot?: string;
}

interface GateStepResult {
  name: string;
  verdict: 'PASS' | 'FAIL';
  runId: string | null;
  durationMs: number;
  flowCount: number;
  artifactDir: string | null;
  error: string | null;
}

const AVAILABLE_PRESETS = ['nemyo', 'neoxtemus'] as const;

const NEMYO_STEPS: GateStep[] = [
  {
    name: 'Nemyo Web Dashboard',
    type: 'yaml',
    config: 'nemyo-web.yaml',
    outSubDir: 'nemyo-web',
  },
  {
    name: 'Nemyo Subscription Flow',
    type: 'yaml',
    config: 'nemyo-subscription.yaml',
    outSubDir: 'nemyo-subscription',
  },
  {
    name: 'NeoXten Website',
    type: 'yaml',
    config: 'neoxten-website.yaml',
    outSubDir: 'neoxten-website',
  },
  {
    name: 'Nemyo Extension (MV3)',
    type: 'yaml',
    config: 'nemyo-extension.yaml',
    outSubDir: 'nemyo-extension',
  },
  {
    name: 'Nemyo API Endpoints',
    type: 'yaml',
    config: 'nemyo-api.yaml',
    outSubDir: 'nemyo-api',
  },
  {
    name: 'Child App Widget Tests',
    type: 'flutter',
    testPath: 'test/pairing_screen_test.dart',
    cwd: '../kidguard_child_app',
  },
  {
    name: 'Parent App Widget Tests',
    type: 'flutter',
    testPath: 'test/widget_test.dart',
    cwd: '../kidguard-mobile-app',
  },
];

const NEOXTEMUS_STEPS: GateStep[] = [
  {
    name: 'Neoxtemus Boot',
    type: 'yaml',
    config: 'neoxtemus-boot.yaml',
    outSubDir: 'neoxtemus-boot',
  },
  {
    name: 'Neoxtemus Navigation',
    type: 'yaml',
    config: 'neoxtemus-nav.yaml',
    outSubDir: 'neoxtemus-nav',
  },
  {
    name: 'Neoxtemus Vault Operations',
    type: 'yaml',
    config: 'neoxtemus-vault-test.yaml',
    outSubDir: 'neoxtemus-vault',
  },
  {
    name: 'Neoxtemus Rust Tests',
    type: 'cargo',
    cwd: '../neoxtemus/neoxtemus-app/src-tauri',
  },
  {
    name: 'Artifact Policy',
    type: 'policy',
    policyRoot: '../neoxtemus/neoxtemus-app',
  },
];

const PRESET_MAP: Record<string, { steps: GateStep[]; label: string }> = {
  nemyo: { steps: NEMYO_STEPS, label: 'Nemyo Gate' },
  neoxtemus: { steps: NEOXTEMUS_STEPS, label: 'Neoxtemus Gate' },
};

/**
 * Artifact policy: reject release binaries/installers in the repo
 * unless NEOXTEN_BUILD_NOW=1 is set.
 */
function runArtifactPolicy(root: string): { passed: boolean; violations: string[] } {
  if (process.env.NEOXTEN_BUILD_NOW === '1') {
    return { passed: true, violations: [] };
  }

  const DISALLOWED_EXTENSIONS = ['.msi', '.nsis', '.appimage', '.dmg'];
  const DISALLOWED_PATTERNS = ['-setup.exe', '-installer.exe'];
  const EXCLUDE_DIRS = new Set(['node_modules', '.git', 'target', 'bin', 'dist', '.neoxten-out']);

  const violations: string[] = [];

  function walk(dir: string, rel: string) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (EXCLUDE_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      const relPath = rel ? `${rel}/${entry}` : entry;
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full, relPath);
      } else {
        const lower = entry.toLowerCase();
        const isDisallowed =
          DISALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext)) ||
          DISALLOWED_PATTERNS.some((pat) => lower.includes(pat));
        if (isDisallowed) {
          violations.push(relPath);
        }
      }
    }
  }

  walk(root, '');
  return { passed: violations.length === 0, violations };
}

function generateReport(
  presetLabel: string,
  results: GateStepResult[],
  overallVerdict: 'PASS' | 'FAIL',
  totalMs: number,
): string {
  const now = new Date().toISOString();
  const passed = results.filter((r) => r.verdict === 'PASS').length;
  const failed = results.filter((r) => r.verdict === 'FAIL').length;

  let md = `# ${presetLabel} Report\n\n`;
  md += `**Verdict:** ${overallVerdict === 'PASS' ? 'PASS' : 'FAIL'}\n`;
  md += `**Timestamp:** ${now}\n`;
  md += `**Duration:** ${(totalMs / 1000).toFixed(1)}s\n`;
  md += `**Steps:** ${passed} passed, ${failed} failed, ${results.length} total\n\n`;
  md += `---\n\n`;
  md += `| # | Component | Verdict | Run ID | Duration | Flows | Artifacts |\n`;
  md += `|---|-----------|---------|--------|----------|-------|-----------|\n`;

  results.forEach((r, i) => {
    const verdict = r.verdict === 'PASS' ? 'PASS' : 'FAIL';
    const runId = r.runId ?? '—';
    const dur = `${(r.durationMs / 1000).toFixed(1)}s`;
    const flows = r.flowCount > 0 ? String(r.flowCount) : '—';
    const artifacts = r.artifactDir ?? '—';
    md += `| ${i + 1} | ${r.name} | ${verdict} | ${runId} | ${dur} | ${flows} | ${artifacts} |\n`;
  });

  if (failed > 0) {
    md += `\n---\n\n## Failures\n\n`;
    results
      .filter((r) => r.verdict === 'FAIL')
      .forEach((r) => {
        md += `### ${r.name}\n\n`;
        md += `\`\`\`\n${r.error ?? 'Unknown error'}\n\`\`\`\n\n`;
      });
  }

  md += `\n---\n\n`;
  md += `*Generated by NeoXten Automation Framework — ${presetLabel}*\n`;

  return md;
}

export async function gateCommand(opts: {
  preset?: string;
  outDir?: string;
}): Promise<void> {
  const preset = opts.preset ?? 'nemyo';
  const presetConfig = PRESET_MAP[preset];
  if (!presetConfig) {
    console.error(`Unknown preset: ${preset}. Available: ${AVAILABLE_PRESETS.join(', ')}`);
    process.exit(2);
  }

  const { steps, label } = presetConfig;
  const outDir = resolve(process.cwd(), opts.outDir ?? '.neoxten-out');
  const frameworkRoot = process.cwd();
  const results: GateStepResult[] = [];
  const gateStart = Date.now();

  console.log(`\n  ${label} — running ${steps.length} validation steps\n`);

  for (const step of steps) {
    const stepStart = Date.now();
    console.log(`  [${results.length + 1}/${steps.length}] ${step.name}...`);

    if (step.type === 'yaml' && step.config) {
      try {
        const configPath = resolve(frameworkRoot, step.config);
        const stepOutDir = resolve(outDir, step.outSubDir ?? step.name);
        const { verdict, artifacts } = await run({ configPath, outDir: stepOutDir });

        const flowCount = verdict.logExcerpts
          ? verdict.logExcerpts.filter((l: string) => l.startsWith('Executing flow:')).length
          : 0;

        results.push({
          name: step.name,
          verdict: verdict.verdict as 'PASS' | 'FAIL',
          runId: verdict.runId,
          durationMs: Date.now() - stepStart,
          flowCount,
          artifactDir: artifacts.runDir,
          error: verdict.verdict === 'FAIL'
            ? verdict.logExcerpts?.slice(-1)[0] ?? 'Flow failed'
            : null,
        });

        const tag = verdict.verdict === 'PASS' ? 'PASS' : 'FAIL';
        console.log(`           ${tag} (${verdict.runId}, ${flowCount} flows)`);
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        results.push({
          name: step.name,
          verdict: 'FAIL',
          runId: null,
          durationMs: Date.now() - stepStart,
          flowCount: 0,
          artifactDir: null,
          error: err,
        });
        console.log(`           FAIL (infrastructure: ${err.slice(0, 80)})`);
      }
    } else if (step.type === 'flutter') {
      try {
        const cwd = resolve(frameworkRoot, step.cwd ?? '.');
        const testPath = step.testPath ?? 'test/';
        const cmd = `flutter test ${testPath} --no-pub`;
        const output = execSync(cmd, {
          cwd,
          encoding: 'utf-8',
          timeout: 180000,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        const testCount = (output.match(/\+(\d+)/g) ?? []).length;

        results.push({
          name: step.name,
          verdict: 'PASS',
          runId: null,
          durationMs: Date.now() - stepStart,
          flowCount: testCount,
          artifactDir: null,
          error: null,
        });
        console.log(`           PASS`);
      } catch (e) {
        const err = e instanceof Error ? (e as { stderr?: string }).stderr ?? e.message : String(e);
        results.push({
          name: step.name,
          verdict: 'FAIL',
          runId: null,
          durationMs: Date.now() - stepStart,
          flowCount: 0,
          artifactDir: null,
          error: typeof err === 'string' ? err.slice(0, 500) : String(err),
        });
        console.log(`           FAIL`);
      }
    } else if (step.type === 'cargo') {
      try {
        const cwd = resolve(frameworkRoot, step.cwd ?? '.');
        const output = execSync('cargo test --workspace', {
          cwd,
          encoding: 'utf-8',
          timeout: 300000,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        const passMatches = output.match(/test result: ok\./g) ?? [];

        results.push({
          name: step.name,
          verdict: 'PASS',
          runId: null,
          durationMs: Date.now() - stepStart,
          flowCount: passMatches.length,
          artifactDir: null,
          error: null,
        });
        console.log(`           PASS (${passMatches.length} crate(s))`);
      } catch (e) {
        const err = e instanceof Error ? (e as { stdout?: string }).stdout ?? e.message : String(e);
        results.push({
          name: step.name,
          verdict: 'FAIL',
          runId: null,
          durationMs: Date.now() - stepStart,
          flowCount: 0,
          artifactDir: null,
          error: typeof err === 'string' ? err.slice(0, 1000) : String(err),
        });
        console.log(`           FAIL`);
      }
    } else if (step.type === 'policy') {
      const policyRoot = resolve(frameworkRoot, step.policyRoot ?? '.');
      const result = runArtifactPolicy(policyRoot);

      results.push({
        name: step.name,
        verdict: result.passed ? 'PASS' : 'FAIL',
        runId: null,
        durationMs: Date.now() - stepStart,
        flowCount: 0,
        artifactDir: null,
        error: result.passed
          ? null
          : `Disallowed release artifacts found:\n${result.violations.map((v) => `  - ${v}`).join('\n')}\nSet NEOXTEN_BUILD_NOW=1 to override.`,
      });
      console.log(`           ${result.passed ? 'PASS' : 'FAIL'}${result.violations.length > 0 ? ` (${result.violations.length} violations)` : ''}`);
    }
  }

  const totalMs = Date.now() - gateStart;
  const overallVerdict = results.every((r) => r.verdict === 'PASS') ? 'PASS' : 'FAIL';

  const reportDir = resolve(outDir, 'gate');
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });

  const reportSlug = preset.toLowerCase();
  const reportPath = resolve(reportDir, `${reportSlug}-gate-report.md`);
  const report = generateReport(label, results, overallVerdict, totalMs);
  writeFileSync(reportPath, report, 'utf-8');

  const verdictPath = resolve(reportDir, 'gate-verdict.json');
  writeFileSync(
    verdictPath,
    JSON.stringify(
      {
        preset,
        verdict: overallVerdict,
        timestamp: new Date().toISOString(),
        durationMs: totalMs,
        steps: results.map((r) => ({
          name: r.name,
          verdict: r.verdict,
          runId: r.runId,
          durationMs: r.durationMs,
        })),
      },
      null,
      2,
    ),
    'utf-8',
  );

  console.log(`\n  -- ${label}: ${overallVerdict} --`);
  console.log(`  Report: ${reportPath}`);
  console.log(`  Verdict: ${verdictPath}`);
  console.log(`  Duration: ${(totalMs / 1000).toFixed(1)}s\n`);

  process.exit(overallVerdict === 'PASS' ? 0 : 1);
}
