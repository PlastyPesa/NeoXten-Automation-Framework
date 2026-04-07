import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Velarune icon flagship — Batch 4 only: compare slots, overlay, decision log.
 * Served via playwright.velarune-batch4.config.ts webServer.
 */

async function prepareIconProject(request: APIRequestContext): Promise<string> {
  const cr = await request.post('/api/projects', {
    data: { name: `Neo batch4 ${Date.now()}`, slice: 'icon_system' },
  });
  expect(cr.ok(), await cr.text()).toBeTruthy();
  const { project } = (await cr.json()) as { project: { id: string } };
  return project.id;
}

test.describe('Velarune icon Batch 4 — compare', () => {
  test('slots A/B from sheet, overlay, log compare to decisions', async ({ page, request }) => {
    test.setTimeout(120_000);

    const id = await prepareIconProject(request);

    await page.goto(`/project/${id}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await expect(page.getByTestId('icon-project-workspace')).toBeVisible({ timeout: 60_000 });

    await page.getByTestId('icon-tab-sheet').click();
    await page.getByTestId('icon-compare-slot-a').click();
    await page.getByTestId('icon-cell-home').click();
    await page.getByTestId('icon-compare-slot-b').click();
    await page.getByTestId('icon-cell-search').click();

    await page.getByTestId('icon-tab-compare').click();
    await expect(page.getByTestId('icon-compare-panel')).toBeVisible();

    await expect(page.getByTestId('icon-compare-slot-card-a')).toHaveAttribute('data-batch4-assigned', 'true');
    await expect(page.getByTestId('icon-compare-slot-card-b')).toHaveAttribute('data-batch4-assigned', 'true');
    await expect(page.getByTestId('icon-compare-slot-label-a')).toContainText(/home/i);
    await expect(page.getByTestId('icon-compare-slot-label-b')).toContainText(/search/i);

    const overlay = page.getByTestId('icon-compare-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute('data-batch4-overlay-active', 'true');

    await page.getByTestId('icon-compare-log').click();
    await expect(page.getByText(/Compare logged/i)).toBeVisible({ timeout: 15_000 });
  });
});
