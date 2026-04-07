import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Velarune icon flagship — Batch 6 only: optical lint board + GET /validation-report.
 * Served via playwright.velarune-batch6.config.ts webServer.
 */

async function prepareIconProjectWithExport(request: APIRequestContext): Promise<string> {
  const cr = await request.post('/api/projects', {
    data: { name: `Neo batch6 ${Date.now()}`, slice: 'icon_system' },
  });
  expect(cr.ok(), await cr.text()).toBeTruthy();
  const { project } = (await cr.json()) as { project: { id: string } };
  const id = project.id;

  const patchFlat = await request.patch(`/api/projects/${id}`, {
    data: { iconBundleProfile: 'flat_icons' },
  });
  expect(patchFlat.ok(), await patchFlat.text()).toBeTruthy();

  expect((await request.post(`/api/projects/${id}/dna/lock`, { data: { lockedBy: 'e2e-b6' } })).ok()).toBe(true);
  expect((await request.post(`/api/projects/${id}/tokens/pin`, { data: {} })).ok()).toBe(true);
  expect(
    (await request.post(`/api/projects/${id}/icon-spec/lock`, { data: { lockedBy: 'e2e-b6' } })).ok(),
  ).toBe(true);
  const comp = await request.post(`/api/projects/${id}/constraint/compile`, { data: {} });
  expect(comp.ok(), await comp.text()).toBeTruthy();

  const ex = await request.post(`/api/projects/${id}/export`, { data: {} });
  expect(ex.ok(), await ex.text()).toBeTruthy();

  return id;
}

test.describe('Velarune icon Batch 6 — lint + validation-report', () => {
  test('API validation-report; optical lint board reflects last evaluation', async ({ page, request }) => {
    test.setTimeout(180_000);

    const id = await prepareIconProjectWithExport(request);

    const vr = await request.get(`/api/projects/${id}/validation-report`);
    expect(vr.ok()).toBeTruthy();
    const report = (await vr.json()) as {
      rubricScores?: Record<string, number>;
      exportValidation?: { passed: boolean; errors?: string[] };
      lintFindings?: Array<{ code: string; severity: string; message: string }>;
    };
    expect(report.rubricScores && Object.keys(report.rubricScores).length > 0).toBe(true);
    expect(report.exportValidation?.passed).toBe(true);
    expect(Array.isArray(report.lintFindings)).toBe(true);

    await page.goto(`/project/${id}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await expect(page.getByTestId('icon-project-workspace')).toBeVisible({ timeout: 60_000 });

    await page.getByTestId('icon-tab-lint').click();
    await expect(page.getByTestId('icon-optical-lint')).toBeVisible();
    await expect(page.getByTestId('icon-optical-lint')).toHaveAttribute('data-batch6-eval-loaded', 'true');

    const grid = page.getByTestId('icon-lint-rubric-grid');
    await expect(grid).toBeVisible();
    const rubricKeys = Object.keys(report.rubricScores ?? {});
    for (const key of rubricKeys) {
      const stat = page.locator(`[data-testid="icon-lint-rubric-stat"][data-rubric-key="${key}"]`);
      await expect(stat).toBeVisible();
      await expect(stat).toContainText(String(report.rubricScores![key]));
    }

    const findingsUl = page.getByTestId('icon-lint-findings');
    await expect(findingsUl).toBeAttached();
    const findingRows = page.getByTestId('icon-lint-finding-row');
    await expect(findingRows).toHaveCount(report.lintFindings!.length);
  });
});
