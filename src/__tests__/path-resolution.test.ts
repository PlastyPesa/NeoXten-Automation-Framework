/**
 * Regression test: project.root resolved relative to config file (not cwd).
 * Config outside cwd => spawn cwd = configDir/project.root/devCwd.
 */
import { run } from '../core/orchestrator.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

async function testPathResolutionRelativeToConfig() {
  const configParent = mkdtempSync(join(tmpdir(), 'neoxten-path-test-'));
  mkdirSync(join(configParent, 'project-root'), { recursive: true });
  const configPath = join(configParent, 'project-root', 'neoxten.yaml');

  writeFileSync(
    configPath,
    `project:
  type: tauri
  root: .
  tauri:
    strategy: harness
    devCwd: nonexistent-spawn-cwd
    devUrl: http://localhost:1420

flows: []
assistant:
  enabled: false
`,
    'utf-8'
  );

  const outDir = join(configParent, 'out');
  const { verdict } = await run({
    configPath,
    outDir,
  });

  if (verdict.verdict !== 'FAIL' || verdict.exitCode !== 2) {
    throw new Error(`Expected FAIL exitCode 2, got ${verdict.verdict} ${verdict.exitCode}`);
  }

  const expectedCwd = join(configParent, 'project-root', 'nonexistent-spawn-cwd');
  const normalizedExpected = expectedCwd.replace(/\//g, '\\');
  const logJoined = verdict.logExcerpts.join(' ');

  const hasCorrectPath =
    logJoined.includes(expectedCwd) ||
    logJoined.includes(normalizedExpected) ||
    (logJoined.includes('project-root') && logJoined.includes('nonexistent-spawn-cwd'));

  const hasWrongPath = logJoined.includes('NeoXten-Automation-Framework') && logJoined.includes('ui');

  if (!hasCorrectPath) {
    throw new Error(
      `Expected ENOENT path to include config-relative path (project-root/nonexistent-spawn-cwd), got: ${JSON.stringify(verdict.logExcerpts)}`
    );
  }
  if (hasWrongPath) {
    throw new Error(
      `Expected spawn cwd NOT to be framework dir; logExcerpts contained framework path: ${JSON.stringify(verdict.logExcerpts)}`
    );
  }

  console.log('PASS: project.root resolved relative to config file');
}

testPathResolutionRelativeToConfig().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});
