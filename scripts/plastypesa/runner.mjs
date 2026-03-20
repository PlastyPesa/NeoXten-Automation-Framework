/**
 * Structured test runner: PASS / FAIL / SKIP with actionable summaries.
 */
export class SuiteRunner {
  constructor(suiteName) {
    this.suiteName = suiteName;
    this.results = [];
  }

  async test(name, fn) {
    try {
      await fn();
      this.results.push({ name, status: 'PASS' });
      console.log(`  PASS  [${this.suiteName}] ${name}`);
    } catch (err) {
      this.results.push({
        name,
        status: 'FAIL',
        error: err?.message || String(err),
      });
      console.log(
        `  FAIL  [${this.suiteName}] ${name} — ${err?.message || err}`,
      );
    }
  }

  skip(name, reason) {
    this.results.push({ name, status: 'SKIP', reason });
    console.log(`  SKIP  [${this.suiteName}] ${name} — ${reason}`);
  }

  summary() {
    const pass = this.results.filter((r) => r.status === 'PASS').length;
    const fail = this.results.filter((r) => r.status === 'FAIL').length;
    const skip = this.results.filter((r) => r.status === 'SKIP').length;
    return { pass, fail, skip, results: this.results };
  }
}

export function printFailureDetails(flatFailures) {
  if (!flatFailures.length) return;
  console.log('\n--- FAILED (actionable) ---');
  for (const r of flatFailures) {
    const label = r.suite ? `[${r.suite}] ` : '';
    console.log(`  • ${label}${r.name}`);
    console.log(`    ${r.error}`);
  }
}

export function exitCodeFromSummaries(summaries) {
  const fail = summaries.reduce((a, s) => a + s.fail, 0);
  return fail > 0 ? 1 : 0;
}
