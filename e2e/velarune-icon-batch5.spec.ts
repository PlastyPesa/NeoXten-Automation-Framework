import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Velarune icon flagship — Batch 5 only: Buyer View parity + pack composer basics.
 * Served via playwright.velarune-batch5.config.ts webServer.
 */

async function prepareIconProjectWithExport(request: APIRequestContext): Promise<string> {
  const cr = await request.post('/api/projects', {
    data: { name: `Neo batch5 ${Date.now()}`, slice: 'icon_system' },
  });
  expect(cr.ok(), await cr.text()).toBeTruthy();
  const { project } = (await cr.json()) as {
    project: {
      id: string;
      iconCatalogGlyphs: Array<{
        id: string;
        chapterId: string;
        displayName: string;
        schemaVersion: number;
        tiers: Array<{
          tierPx: number;
          status: string;
          svgMarkup?: string;
          intentionalEmpty?: boolean;
        }>;
      }>;
    };
  };
  const id = project.id;

  const patchFlat = await request.patch(`/api/projects/${id}`, {
    data: { iconBundleProfile: 'flat_icons' },
  });
  expect(patchFlat.ok(), await patchFlat.text()).toBeTruthy();

  expect((await request.post(`/api/projects/${id}/dna/lock`, { data: { lockedBy: 'e2e-b5' } })).ok()).toBe(true);
  expect((await request.post(`/api/projects/${id}/tokens/pin`, { data: {} })).ok()).toBe(true);
  expect(
    (await request.post(`/api/projects/${id}/icon-spec/lock`, { data: { lockedBy: 'e2e-b5' } })).ok(),
  ).toBe(true);
  const comp = await request.post(`/api/projects/${id}/constraint/compile`, { data: {} });
  expect(comp.ok(), await comp.text()).toBeTruthy();

  const ex = await request.post(`/api/projects/${id}/export`, { data: {} });
  expect(ex.ok(), await ex.text()).toBeTruthy();

  return id;
}

test.describe('Velarune icon Batch 5 — buyer + pack', () => {
  test('sheet snapshot parity in iframe; bundle profile + integrator tree', async ({ page, request }) => {
    test.setTimeout(180_000);

    const id = await prepareIconProjectWithExport(request);

    await page.goto(`/project/${id}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await expect(page.getByTestId('icon-project-workspace')).toBeVisible({ timeout: 60_000 });

    const snap = await request.get(`/api/projects/${id}/icon/sheet-snapshot`);
    expect(snap.ok()).toBeTruthy();
    const snapBody = (await snap.json()) as { html: string };
    expect(snapBody.html).toContain('<title>Velarune icon sheet</title>');

    await page.getByTestId('icon-tab-buyer').click();
    await expect(page.getByTestId('icon-buyer-panel')).toBeVisible();
    const iframe = page.getByTestId('icon-buyer-sheet-iframe');
    await expect(iframe).toBeVisible();
    await expect(iframe).toHaveAttribute('data-batch5-buyer-html-loaded', 'true', { timeout: 30_000 });

    const srcdocFrame = page.frames().find((f) => f.url() === 'about:srcdoc');
    expect(srcdocFrame, 'buyer iframe srcdoc frame').toBeTruthy();
    const iframeRootOuter = await srcdocFrame!.evaluate(() => document.documentElement.outerHTML);
    expect(snapBody.html).toContain('<title>Velarune icon sheet</title>');
    expect(iframeRootOuter).toContain('Velarune icon sheet');
    expect(snapBody.html).toContain('Studio sheet');
    expect(iframeRootOuter).toContain('Studio sheet');
    expect(snapBody.html).toContain('data-buyer="false"');
    expect(iframeRootOuter).toContain('data-buyer="false"');

    await page.getByTestId('icon-tab-pack').click();
    await expect(page.getByTestId('icon-pack-composer')).toBeVisible();
    await expect(page.getByTestId('icon-bundle-profile')).toHaveValue('flat_icons');
    await expect(page.getByTestId('icon-pack-composer')).toHaveAttribute('data-batch5-bundle-profile', 'flat_icons');

    const tree = await request.get(`/api/projects/${id}/icon/export-tree`);
    expect(tree.ok()).toBeTruthy();
    const treeBody = (await tree.json()) as { paths: string[]; bundleProfile: string };
    expect(treeBody.bundleProfile).toBe('flat_icons');
    expect(treeBody.paths.some((p) => p.startsWith('icons/vr-') && p.endsWith('.svg'))).toBe(true);

    const rows = page.getByTestId('icon-export-tree-row');
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    await expect(rows.filter({ hasText: /^icons\/vr-.*\.svg$/ }).first()).toBeVisible();

    await page.getByTestId('icon-bundle-profile').selectOption('chapter_tree');
    await expect(page.getByTestId('icon-pack-composer')).toHaveAttribute(
      'data-batch5-bundle-profile',
      'chapter_tree',
    );
    await page.getByTestId('icon-export-run').click();
    await expect(page.getByText(/exported/i)).toBeVisible({ timeout: 120_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('icon-project-workspace')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('icon-tab-pack').click();

    const tree2 = await request.get(`/api/projects/${id}/icon/export-tree`);
    expect(tree2.ok()).toBeTruthy();
    const tree2Body = (await tree2.json()) as { paths: string[]; bundleProfile: string };
    expect(tree2Body.bundleProfile).toBe('chapter_tree');
    expect(tree2Body.paths.some((p) => p.includes('/navigation/'))).toBe(true);

    await expect(page.getByTestId('icon-bundle-profile')).toHaveValue('chapter_tree');
    await expect(
      page.getByTestId('icon-export-tree-row').filter({ hasText: /navigation/ }).first(),
    ).toBeVisible();
  });
});
