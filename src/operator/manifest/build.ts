import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { createHash } from 'crypto';
import type { Verdict } from '../../core/verdict.js';
import type { RunManifest, ArtifactEntry } from './schema.js';
import { RunManifestSchema } from './schema.js';

function classifyArtifact(rel: string): ArtifactEntry['kind'] {
  const lower = rel.replace(/\\/g, '/').toLowerCase();
  if (lower.endsWith('verdict.json')) return 'verdict';
  if (lower.endsWith('evidence-timeline.json')) return 'evidence_timeline';
  if (lower.endsWith('console.log') || lower.endsWith('.log')) return 'console_log';
  if (lower.includes('/screenshots/') && lower.endsWith('.png')) return 'screenshot';
  if (lower.endsWith('playwright-trace.zip')) return 'trace';
  if (lower.endsWith('.har')) return 'har';
  if (lower.endsWith('.webm') || lower.endsWith('.mp4')) return 'video';
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

  const manifest: RunManifest = {
    schemaVersion: '2026.1',
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
