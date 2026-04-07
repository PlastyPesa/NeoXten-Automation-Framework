import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Velarune icon flagship — Batch 7 only: locked spec glyph rejection + iconPackInvariants on compile.
 * API-only; served via playwright.velarune-batch7.config.ts webServer.
 */

async function prepareLockedIconProject(request: APIRequestContext): Promise<string> {
  const cr = await request.post('/api/projects', {
    data: { name: `Neo batch7 ${Date.now()}`, slice: 'icon_system' },
  });
  expect(cr.ok(), await cr.text()).toBeTruthy();
  const { project } = (await cr.json()) as { project: { id: string } };
  const id = project.id;

  expect((await request.post(`/api/projects/${id}/dna/lock`, { data: { lockedBy: 'e2e-b7' } })).ok()).toBe(true);
  expect((await request.post(`/api/projects/${id}/tokens/pin`, { data: {} })).ok()).toBe(true);
  expect(
    (await request.post(`/api/projects/${id}/icon-spec/lock`, { data: { lockedBy: 'e2e-b7' } })).ok(),
  ).toBe(true);

  const comp = await request.post(`/api/projects/${id}/constraint/compile`, { data: {} });
  expect(comp.ok(), await comp.text()).toBeTruthy();

  return id;
}

test.describe('Velarune icon Batch 7 — locked spec + invariants', () => {
  test('reject catalog PATCH violating locked grid/viewBox; compile exposes iconPackInvariants', async ({
    request,
  }) => {
    test.setTimeout(120_000);

    const id = await prepareLockedIconProject(request);

    const pr = await request.get(`/api/projects/${id}`);
    expect(pr.ok()).toBeTruthy();
    const full = (await pr.json()) as {
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
    const badText = await badPatch.text();
    expect(badText.toLowerCase()).toMatch(/viewbox|grid|multiple/i);

    const constraint = await request.post(`/api/projects/${id}/constraint/compile`, { data: {} });
    expect(constraint.ok()).toBeTruthy();
    const cj = (await constraint.json()) as {
      constraint?: { technicalTargets?: { iconPackInvariants?: unknown } };
    };
    expect(cj.constraint?.technicalTargets?.iconPackInvariants).toBeTruthy();
  });
});
