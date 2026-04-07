import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test, expect, request } from '@playwright/test';
import { DASHBOARD_OPERATOR_API_ORIGIN } from './dashboard-constants';

test.describe('Operator dashboard (built UI)', () => {
  test.setTimeout(60_000);

  test('shell and Mission Control nav render', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForFunction(
      () => !!document.querySelector('[data-testid="app-shell"]'),
      { timeout: 30_000 },
    );
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await page.getByTestId('nav-op_mission').click();
    await expect(page.getByTestId('operator-mission')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Mission Control' })).toBeVisible();
    await expect(page.getByText('API unavailable')).not.toBeVisible();
  });

  test.describe('Human-style layer (RunDetail filters / Issues)', () => {
    let seededRunDbId = '';
    let seededRunId = '';
    let seedDesignTitle = '';

    test.beforeAll(async () => {
      const api = await request.newContext({ baseURL: DASHBOARD_OPERATOR_API_ORIGIN });
      const runDir = mkdtempSync(join(tmpdir(), 'neo-dash-hst-'));
      mkdirSync(join(runDir, 'screenshots'), { recursive: true });
      writeFileSync(join(runDir, 'screenshots', 'x.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

      seededRunId = randomUUID();
      const fDesign = randomUUID();
      const fB1 = randomUUID();
      const fA11y = randomUUID();
      const now = new Date().toISOString();
      seedDesignTitle = `Design e2e ${randomUUID().slice(0, 8)}`;

      const verdict = { verdict: 'PASS', runId: seededRunId, timestamp: now, exitCode: 0 };
      writeFileSync(join(runDir, 'verdict.json'), JSON.stringify(verdict), 'utf-8');

      const manifest = {
        schemaVersion: '2026.2' as const,
        runId: seededRunId,
        ingestedAt: now,
        completedAt: now,
        configPath: join(runDir, '..', 'neoxten.yaml'),
        verdict,
        artifacts: [{ relativePath: 'verdict.json', kind: 'verdict' as const }],
        findings: [
          {
            id: fDesign,
            kind: 'design_system' as const,
            title: seedDesignTitle,
            determinism: 'diff' as const,
            evidence_strength: 'proven' as const,
            confidence: 'medium' as const,
            oracle_id: 'neo.design.token',
            urls: ['https://example.test'],
          },
          {
            id: fB1,
            kind: 'visual' as const,
            title: 'B.1 overlap e2e',
            determinism: 'heuristic' as const,
            confidence: 'medium' as const,
            oracle_id: 'neo.b1.overlap.interactables',
            promotion_state: 'advisory' as const,
            urls: ['https://example.test'],
          },
          {
            id: fA11y,
            kind: 'a11y' as const,
            title: 'A11y other bucket e2e',
            determinism: 'rule' as const,
            confidence: 'high' as const,
            oracle_id: 'neo.a11y.contrast',
            urls: ['https://example.test'],
          },
        ],
        validationClosure: {
          verdict_ok: true,
          blocking_findings_count: 0,
          pending_required_retests: 0,
          open_promoted_issues_blockers: 0,
          high_confidence_suspicion_present: false,
          operator_review_satisfied: true,
          advisory_findings_count: 3,
          accepted_debt: false,
        },
      };

      const ing = await api.post('/api/runs/ingest', {
        data: { runDir, manifest },
      });
      expect(ing.ok(), await ing.text()).toBeTruthy();
      const body = (await ing.json()) as { runDbId: string };
      seededRunDbId = body.runDbId;

      const prom = await api.post(`/api/runs/${seededRunDbId}/findings/${fDesign}/promote`);
      expect(prom.ok(), await prom.text()).toBeTruthy();

      await api.dispose();
    });

    test('RunDetail finding filters and design chips; Issues design filter', async ({ page }) => {
      await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForFunction(
        () => !!document.querySelector('[data-testid="app-shell"]'),
        { timeout: 30_000 },
      );

      await page.getByTestId('nav-op_runs').click();
      await expect(page.getByTestId('operator-runs')).toBeVisible();
      await page.locator('tbody tr').filter({ hasText: seededRunId }).click();
      await expect(page.getByTestId('operator-run-detail')).toBeVisible();

      await page.getByRole('button', { name: /^findings$/i }).click();

      await page.getByRole('button', { name: 'Design system' }).click();
      await expect(page.getByText(seedDesignTitle)).toBeVisible();
      await expect(page.getByText('proven').first()).toBeVisible();

      await page.getByRole('button', { name: 'Layout / polish (B.1)' }).click();
      await expect(page.getByText('B.1 overlap e2e')).toBeVisible();
      await expect(page.getByText(seedDesignTitle)).not.toBeVisible();

      await page.getByRole('button', { name: 'Other' }).click();
      await expect(page.getByText('A11y other bucket e2e')).toBeVisible();
      await expect(page.getByText('B.1 overlap e2e')).not.toBeVisible();

      await page.getByRole('button', { name: 'All findings' }).click();
      await expect(page.getByText(seedDesignTitle)).toBeVisible();
      await expect(page.getByText('B.1 overlap e2e')).toBeVisible();

      await page.getByTestId('nav-op_issues').click();
      await expect(page.getByTestId('operator-issues')).toBeVisible();
      await page.getByRole('button', { name: 'Design quality' }).click();
      const designCard = page.locator('div.rounded-2xl').filter({ hasText: seedDesignTitle });
      await expect(designCard).toBeVisible();
      await expect(designCard.getByText('Design — promoted (manual)')).toBeVisible();
    });
  });
});
