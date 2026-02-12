import { mkdirSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface ArtifactPaths {
  runDir: string;
  verdict: string;
  logs: string;
  screenshots: string;
  trace: string;
  assistantMetrics: string;
  performance: string;
  consoleLog: string;
  backendLog: string;
}

export function createArtifactDirs(baseDir: string, runId: string): ArtifactPaths {
  const runDir = join(baseDir, runId);
  const logs = join(runDir, 'logs');
  const screenshots = join(runDir, 'screenshots');

  [runDir, logs, screenshots].forEach((p) => {
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  });

  return {
    runDir,
    verdict: join(runDir, 'verdict.json'),
    logs,
    screenshots,
    trace: join(runDir, 'playwright-trace.zip'),
    assistantMetrics: join(runDir, 'assistant-metrics.json'),
    performance: join(runDir, 'performance.json'),
    consoleLog: join(runDir, 'console.log'),
    backendLog: join(runDir, 'backend.log'),
  };
}

export function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

export function appendLog(path: string, line: string): void {
  appendFileSync(path, line + '\n', 'utf-8');
}
