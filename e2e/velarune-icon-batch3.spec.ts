import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Velarune icon flagship — Batch 3 only: family ops (preview diff + commit).
 * Served via playwright.velarune-batch3.config.ts webServer.
 */

async function prepareIconProjectWithLinecapDrift(request: APIRequestContext): Promise<string> {
  const cr = await request.post('/api/projects', {
    data: { name: `Neo batch3 ${Date.now()}`, slice: 'icon_system' },
  });
  expect(cr.ok(), await cr.text()).toBeTruthy();
  const { project } = (await cr.json()) as {
    project: {
      id: string;
      iconCatalogGlyphs: Array<{
        id: string;
        tiers: Array<{ tierPx: number; svgMarkup?: string; intentionalEmpty?: boolean; status: string }>;
      }>;
    };
  };
  const id = project.id;

  const glyphs = project.iconCatalogGlyphs.map((g, i) =>
    i === 0
      ? {
          ...g,
          tiers: g.tiers.map((t) => ({
            ...t,
            svgMarkup: (t.svgMarkup ?? '').replace(
              /stroke-linecap="round"/g,
              'stroke-linecap="butt"',
            ),
          })),
        }
      : g,
  );
  const patch = await request.patch(`/api/projects/${id}`, {
    data: { iconCatalogGlyphs: glyphs },
  });
  expect(patch.ok(), await patch.text()).toBeTruthy();

  return id;
}

test.describe('Velarune icon Batch 3 — family ops', () => {
  test('operation + scope, preview diff strip, then commit', async ({ page, request }) => {
    test.setTimeout(120_000);

    const id = await prepareIconProjectWithLinecapDrift(request);

    await page.goto(`/project/${id}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await expect(page.getByTestId('icon-project-workspace')).toBeVisible({ timeout: 60_000 });

    await page.getByTestId('icon-tab-family').click();
    await expect(page.getByTestId('icon-family-op-panel')).toBeVisible();
    await expect(page.getByTestId('icon-family-op-audit-empty')).toBeVisible();

    await page.getByTestId('icon-family-op-operation').selectOption('stroke_linecap_round');
    await expect(page.getByTestId('icon-family-op-operation')).toHaveValue('stroke_linecap_round');
    await page.getByTestId('icon-family-op-scope').selectOption('catalog');
    await expect(page.getByTestId('icon-family-op-scope')).toHaveValue('catalog');
    await page.getByTestId('icon-family-op-tier').selectOption('24');

    await page.getByTestId('icon-family-op-preview').click();
    const strip = page.getByTestId('icon-family-op-diff-strip');
    await expect(strip).toBeVisible({ timeout: 30_000 });
    await expect(strip).toHaveAttribute('data-batch3-family-preview', 'true');
    await expect(strip).toContainText(/---/);
    await expect(strip).toContainText(/\+\+\+/);

    await page.getByTestId('icon-family-op-commit').click();
    await expect(page.getByText(/Family op committed/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('icon-family-op-diff-strip')).toHaveCount(0);

    const entries = page.getByTestId('icon-family-op-audit-entry');
    await expect(entries).toHaveCount(1);
    await expect(entries.first()).toContainText(/stroke_linecap_round/);
  });
});
