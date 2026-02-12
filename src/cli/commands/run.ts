import { run } from '../../core/orchestrator.js';

export async function runCommand(opts: {
  config?: string;
  outDir?: string;
  loopUntilPass?: boolean;
  maxLoops?: string;
  retry?: boolean;
}) {
  const configPath = opts.config ?? './neoxten.yaml';
  const maxLoops = parseInt(opts.maxLoops ?? '1', 10);

  for (let loop = 0; loop < maxLoops; loop++) {
    try {
      const { verdict } = await run({
        configPath,
        outDir: opts.outDir,
        retryOnFailure: opts.retry,
      });

      const json = JSON.stringify(verdict, null, 0);
      console.log(json);

      if (opts.loopUntilPass && verdict.verdict === 'FAIL') {
        process.exit(verdict.exitCode);
      }

      process.exit(verdict.exitCode);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      const failVerdict = {
        verdict: 'FAIL',
        exitCode: 2,
        runId: 'unknown',
        timestamp: new Date().toISOString(),
        failingStage: 'launch',
        failingFlow: null,
        failingStep: 0,
        measured: {},
        thresholds: {},
        artifactPaths: {},
        logExcerpts: [err.message],
        sourceHints: [],
        reproducibleCommand: `neoxten run --config ${configPath}`,
        flaky: false,
      };
      console.log(JSON.stringify(failVerdict));
      process.exit(2);
    }
  }
}
