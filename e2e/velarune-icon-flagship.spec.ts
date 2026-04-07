import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Velarune icon flagship — Batches 2–8 observable checks (NeoXten).
 * Studio served via playwright.velarune.config.ts webServer.
 */

async function prepareExportableIconProject(request: APIRequestContext): Promise<string> {
  const cr = await request.post('/api/projects', {
    data: { name: `Neo icon ${Date.now()}`, slice: 'icon_system' },
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

  const patchFlat = await request.patch(`/api/projects/${id}`, {
    data: { iconBundleProfile: 'flat_icons' },
  });
  expect(patchFlat.ok(), await patchFlat.text()).toBeTruthy();

  expect((await request.post(`/api/projects/${id}/dna/lock`, { data: { lockedBy: 'e2e' } })).ok()).toBe(
    true,
  );
  expect((await request.post(`/api/projects/${id}/tokens/pin`, { data: {} })).ok()).toBe(true);
  expect(
    (await request.post(`/api/projects/${id}/icon-spec/lock`, { data: { lockedBy: 'e2e' } })).ok(),
  ).toBe(true);
  const comp = await request.post(`/api/projects/${id}/constraint/compile`, { data: {} });
  expect(comp.ok(), await comp.text()).toBeTruthy();

  const ex = await request.post(`/api/projects/${id}/export`, { data: {} });
  expect(ex.ok(), await ex.text()).toBeTruthy();

  return id;
}

test.describe('Velarune icon flagship (batches 2–8)', () => {
  test('sequential UI + API gates', async ({ page, request }) => {
    test.setTimeout(180_000);

    const id = await prepareExportableIconProject(request);

    await page.goto(`/project/${id}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await expect(page.getByTestId('icon-project-workspace')).toBeVisible({ timeout: 60_000 });

    // Batch 2 — Keylined sheet stage
    await page.getByTestId('icon-tab-sheet').click();
    await expect(page.getByTestId('icon-keylined-stage')).toBeVisible();
    await expect(page.getByTestId('icon-tier-grammar')).toBeVisible();
    await page.getByTestId('icon-sheet-zoom').evaluate((el: HTMLInputElement) => {
      el.value = '150';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.getByTestId('icon-forbidden-transform-demo').check();
    await expect(page.getByTestId('icon-transform-warning')).toBeVisible();

    // Batch 3 — Family ops + diff + commit
    await page.getByTestId('icon-tab-family').click();
    await expect(page.getByTestId('icon-family-op-panel')).toBeVisible();
    await page.getByTestId('icon-family-op-operation').selectOption('stroke_linecap_round');
    await page.getByTestId('icon-family-op-scope').selectOption('catalog');
    await page.getByTestId('icon-family-op-preview').click();
    await expect(page.getByTestId('icon-family-op-diff-strip')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('icon-family-op-commit').click();
    await expect(page.getByTestId('icon-family-op-panel')).toBeVisible();

    // Batch 4 — Compare (pick two cells then overlay)
    await page.getByTestId('icon-tab-sheet').click();
    await page.getByTestId('icon-compare-slot-a').click();
    await page.getByTestId('icon-cell-home').click();
    await page.getByTestId('icon-compare-slot-b').click();
    await page.getByTestId('icon-cell-search').click();
    await page.getByTestId('icon-tab-compare').click();
    await expect(page.getByTestId('icon-compare-overlay')).toBeVisible();

    await page.getByTestId('icon-compare-log').click();
    await expect(page.getByText(/Compare logged/i)).toBeVisible({ timeout: 10_000 });

    // Batch 5 — Buyer snapshot + bundle profile + export tree
    await page.getByTestId('icon-tab-buyer').click();
    await expect(page.getByTestId('icon-buyer-sheet-iframe')).toBeVisible();
    const snap = await request.get(`/api/projects/${id}/icon/sheet-snapshot`);
    expect(snap.ok()).toBeTruthy();
    const snapBody = (await snap.json()) as { html: string };
    expect(snapBody.html).toContain('Velarune icon sheet');

    await page.getByTestId('icon-tab-pack').click();
    await expect(page.getByTestId('icon-bundle-profile')).toHaveValue('flat_icons');

    const tree = await request.get(`/api/projects/${id}/icon/export-tree`);
    expect(tree.ok()).toBeTruthy();
    const treeBody = (await tree.json()) as { paths: string[]; bundleProfile: string };
    expect(treeBody.bundleProfile).toBe('flat_icons');
    expect(treeBody.paths.some((p) => p.startsWith('icons/vr-') && p.endsWith('.svg'))).toBe(true);

    await page.getByTestId('icon-bundle-profile').selectOption('chapter_tree');
    await page.getByTestId('icon-export-run').click();
    await expect(page.getByText(/exported/i)).toBeVisible({ timeout: 120_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });

    const tree2 = await request.get(`/api/projects/${id}/icon/export-tree`);
    expect(tree2.ok()).toBeTruthy();
    const tree2Body = (await tree2.json()) as { paths: string[]; bundleProfile: string };
    expect(tree2Body.bundleProfile).toBe('chapter_tree');
    expect(tree2Body.paths.some((p) => p.includes('/navigation/'))).toBe(true);

    // Batch 6 — Lint surface (post-export)
    await page.getByTestId('icon-tab-lint').click();
    await expect(page.getByTestId('icon-optical-lint')).toBeVisible();
    const vr = await request.get(`/api/projects/${id}/validation-report`);
    expect(vr.ok()).toBeTruthy();
    const vf = (await vr.json()) as {
      rubricScores?: Record<string, number>;
      exportValidation?: { passed: boolean };
    };
    expect(vf.rubricScores && Object.keys(vf.rubricScores).length > 0).toBe(true);
    expect(vf.exportValidation?.passed).toBe(true);

    // Batch 7 — Locked spec + glyph invariant (API)
    const pr2 = await request.get(`/api/projects/${id}`);
    const full = (await pr2.json()) as {
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
    const badGlyphs = full.iconCatalogGlyphs.map((g, i) =>
      i === 1
        ? {
            ...g,
            tiers: g.tiers.map((t) => ({
              ...t,
              svgMarkup: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`,
            })),
          }
        : g,
    );
    const badPatch = await request.patch(`/api/projects/${id}`, { data: { iconCatalogGlyphs: badGlyphs } });
    expect(badPatch.ok()).toBe(false);

    const constraint = await request.post(`/api/projects/${id}/constraint/compile`, { data: {} });
    expect(constraint.ok()).toBeTruthy();
    const cj = (await constraint.json()) as { constraint?: { technicalTargets?: { iconPackInvariants?: unknown } } };
    expect(cj.constraint?.technicalTargets?.iconPackInvariants).toBeTruthy();

    // Batch 8 — NeoXten witness: parity script still passes (pack contract)
    // (Executed via npm run test:velarune-icon-pack-batch1 in CI script; assert export manifest slice here.)
    const summ = await request.get(`/api/projects/${id}/package/summary`);
    expect(summ.ok()).toBeTruthy();
    const sj = (await summ.json()) as { ok: boolean; identity?: { slice: string } };
    expect(sj.ok).toBe(true);
    expect(sj.identity?.slice).toBe('icon_family');
  });
});
