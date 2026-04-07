import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Velarune icon flagship — Batch 2 only: keylined sheet stage behavior (NeoXten).
 * Served via playwright.velarune-batch2.config.ts webServer.
 */

async function prepareIconProjectForSheet(request: APIRequestContext): Promise<string> {
  const cr = await request.post('/api/projects', {
    data: { name: `Neo batch2 ${Date.now()}`, slice: 'icon_system' },
  });
  expect(cr.ok(), await cr.text()).toBeTruthy();
  const { project } = (await cr.json()) as { project: { id: string } };
  return project.id;
}

test.describe('Velarune icon Batch 2 — keylined sheet', () => {
  test('sheet stage: tier grammar, zoom, guides, forbidden-scale demo', async ({ page, request }) => {
    test.setTimeout(120_000);

    const id = await prepareIconProjectForSheet(request);

    await page.goto(`/project/${id}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await expect(page.getByTestId('icon-project-workspace')).toBeVisible({ timeout: 60_000 });

    await page.getByTestId('icon-tab-sheet').click();
    await expect(page.getByTestId('icon-keylined-sheet')).toBeVisible();
    await expect(page.getByTestId('icon-keylined-stage')).toBeVisible();
    await expect(page.getByTestId('icon-tier-grammar')).toBeVisible();
    await expect(page.getByTestId('icon-tier-grammar')).toContainText(/Active optical tier/i);

    const zoom = page.getByTestId('icon-sheet-zoom');
    await zoom.fill('150');
    await expect(zoom).toHaveValue('150');
    const scale = page.getByTestId('icon-keylined-stage-scale');
    await expect(scale).toHaveAttribute('data-stage-zoom', '150');

    await page.getByTestId('icon-sheet-guides-toggle').uncheck();
    await expect(page.getByTestId('icon-optical-guides-layer')).toHaveCount(0);
    await page.getByTestId('icon-sheet-guides-toggle').check();
    await expect(page.getByTestId('icon-optical-guides-layer').first()).toBeVisible();

    await page.getByTestId('icon-forbidden-transform-demo').check();
    await expect(page.getByTestId('icon-transform-warning')).toBeVisible();
    await expect(page.getByTestId('icon-cell-home').locator('[data-batch2-forbidden-active="true"]')).toBeVisible();
    await page.getByTestId('icon-forbidden-transform-demo').uncheck();
    await expect(page.getByTestId('icon-transform-warning')).toHaveCount(0);
    await expect(page.getByTestId('icon-cell-home').locator('[data-batch2-forbidden-active="false"]')).toBeVisible();
  });
});
