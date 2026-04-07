import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { createHash } from 'crypto';
import type { Verdict } from '../../core/verdict.js';
import type { RunManifest, ArtifactEntry } from './schema.js';
import { RunManifestSchema } from './schema.js';
import type { ExploratoryMeta, Finding, RetestHint, ValidationClosureSummary } from '../findings/schema.js';

function classifyArtifact(rel: string): ArtifactEntry['kind'] {
  const lower = rel.replace(/\\/g, '/').toLowerCase();
  if (lower.endsWith('verdict.json')) return 'verdict';
  if (lower.endsWith('run-manifest.json')) return 'other';
  if (lower.endsWith('evidence-timeline.json')) return 'evidence_timeline';
  if (lower.endsWith('console.log') || lower.endsWith('.log')) return 'console_log';
  if (lower.includes('/screenshots/') && lower.endsWith('.png')) return 'screenshot';
  if (lower.endsWith('playwright-trace.zip')) return 'trace';
  if (lower.endsWith('.har')) return 'har';
  if (lower.endsWith('.webm') || lower.endsWith('.mp4')) return 'video';
  if (lower.endsWith('dom-snapshot.json') || lower.endsWith('dom_snapshot.json')) return 'dom_snapshot';
  if (lower.endsWith('a11y-report.json') || lower.endsWith('a11y_report.json')) return 'a11y_report';
  if (lower.includes('visual-diff') && lower.endsWith('.json')) return 'visual_diff';
  if (lower.endsWith('layout-metrics.json') || lower.endsWith('layout_metrics.json')) return 'layout_metrics';
  if (lower.endsWith('navigation-graph.json') || lower.endsWith('navigation_graph.json')) return 'navigation_graph';
  if (lower.endsWith('exploration-map.json') || lower.endsWith('exploration_map.json')) return 'exploration_map';
  if (lower.endsWith('ux-report.json') || lower.endsWith('ux_report.json')) return 'ux_report';
  if (lower.endsWith('design-token-diff.json') || lower.endsWith('design_token_diff.json')) return 'design_token_diff';
  return 'other';
}

function walkFiles(dir: string, base: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkFiles(full, base, out);
    else out.push(relative(base, full).replace(/\\/g, '/'));
  }
}

function sha256File(path: string): string | undefined {
  try {
    const buf = readFileSync(path);
    return createHash('sha256').update(buf).digest('hex');
  } catch {
    return undefined;
  }
}

export interface BuildRunManifestInput {
  runDir: string;
  verdict: Verdict;
  configPath: string;
  projectId?: string;
  suiteId?: string;
  evidenceTimeline?: unknown;
  findings?: Finding[];
  retestHints?: RetestHint[];
  exploratoryMeta?: ExploratoryMeta;
  validationClosure?: ValidationClosureSummary;
}

export function buildRunManifest(input: BuildRunManifestInput): RunManifest {
  const now = new Date().toISOString();
  const relPaths: string[] = [];
  walkFiles(input.runDir, input.runDir, relPaths);
  relPaths.sort();

  const artifacts: ArtifactEntry[] = [];
  for (const rel of relPaths) {
    const full = join(input.runDir, rel);
    let bytes: number | undefined;
    try {
      bytes = statSync(full).size;
    } catch {
      bytes = undefined;
    }
    const kind = classifyArtifact(rel);
    const sha256 =
      bytes !== undefined && bytes < 5_000_000 ? sha256File(full) : undefined;
    artifacts.push({ relativePath: rel, kind, bytes, sha256 });
  }

  const uses2026_2 =
    Boolean(
      input.findings?.length ||
        input.retestHints?.length ||
        input.exploratoryMeta ||
        input.validationClosure ||
        artifacts.some((a) =>
          [
            'dom_snapshot',
            'a11y_report',
            'visual_diff',
            'layout_metrics',
            'navigation_graph',
            'exploration_map',
            'ux_report',
            'design_token_diff',
          ].includes(a.kind),
        ),
    );

  const manifest: RunManifest = {
    schemaVersion: uses2026_2 ? '2026.2' : '2026.1',
    runId: input.verdict.runId,
    ingestedAt: now,
    completedAt: input.verdict.timestamp,
    configPath: input.configPath,
    projectId: input.projectId,
    suiteId: input.suiteId,
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
    },
    verdict: input.verdict,
    evidenceTimeline: input.evidenceTimeline,
    artifacts,
    reproducibleCommand: input.verdict.reproducibleCommand,
    findings: input.findings,
    retestHints: input.retestHints,
    exploratoryMeta: input.exploratoryMeta,
    validationClosure: input.validationClosure,
  };

  return RunManifestSchema.parse(manifest);
}

export function writeRunManifestToRunDir(input: BuildRunManifestInput): RunManifest {
  const timeline =
    input.evidenceTimeline ?? readEvidenceTimelineIfPresent(input.runDir);
  const manifest = buildRunManifest({ ...input, evidenceTimeline: timeline });
  writeFileSync(
    join(input.runDir, 'run-manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  );
  return manifest;
}

export function readEvidenceTimelineIfPresent(runDir: string): unknown | undefined {
  const p = join(runDir, 'evidence-timeline.json');
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as unknown;
  } catch {
    return undefined;
  }
}
