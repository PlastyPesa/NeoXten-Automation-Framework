import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Velarune icon flagship — Batch 8 only: NeoXten pack-contract witness + package summary / manifest slice.
 * Served via playwright.velarune-batch8.config.ts webServer.
 */

const neoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

async function prepareExportedIconPack(request: APIRequestContext): Promise<string> {
  const cr = await request.post('/api/projects', {
    data: { name: `Neo batch8 ${Date.now()}`, slice: 'icon_system' },
  });
  expect(cr.ok(), await cr.text()).toBeTruthy();
  const { project } = (await cr.json()) as { project: { id: string } };
  const id = project.id;

  const patchFlat = await request.patch(`/api/projects/${id}`, {
    data: { iconBundleProfile: 'flat_icons' },
  });
  expect(patchFlat.ok(), await patchFlat.text()).toBeTruthy();

  expect((await request.post(`/api/projects/${id}/dna/lock`, { data: { lockedBy: 'e2e-b8' } })).ok()).toBe(true);
  expect((await request.post(`/api/projects/${id}/tokens/pin`, { data: {} })).ok()).toBe(true);
  expect(
    (await request.post(`/api/projects/${id}/icon-spec/lock`, { data: { lockedBy: 'e2e-b8' } })).ok(),
  ).toBe(true);
  const comp = await request.post(`/api/projects/${id}/constraint/compile`, { data: {} });
  expect(comp.ok(), await comp.text()).toBeTruthy();

  const ex = await request.post(`/api/projects/${id}/export`, { data: {} });
  expect(ex.ok(), await ex.text()).toBeTruthy();

  return id;
}

test.describe('Velarune icon Batch 8 — pack witness', () => {
  test('pack-contract parity script + package summary manifest alignment', async ({ request }) => {
    test.setTimeout(240_000);

    const subEnv = { ...process.env };
    delete subEnv.FORCE_COLOR;
    delete subEnv.NO_COLOR;
    execSync('node dist/__tests__/velarune-icon-pack-batch1.test.js', {
      cwd: neoRoot,
      stdio: 'inherit',
      env: subEnv,
    });

    const id = await prepareExportedIconPack(request);

    const summ = await request.get(`/api/projects/${id}/package/summary`);
    expect(summ.ok()).toBeTruthy();
    const sj = (await summ.json()) as {
      ok: boolean;
      error?: string;
      manifest?: { slice?: string; glyphCount?: number; fileCount?: number };
      identity?: { slice: string; packageId: string };
      structure?: { kind: string; glyphCount?: number; fileCount?: number };
      pathCheck?: { required: string[]; missing: string[] };
    };

    expect(sj.ok).toBe(true);
    expect(sj.identity?.slice).toBe('icon_family');
    expect(sj.manifest?.slice).toBe('icon_family');
    expect(sj.structure?.kind).toBe('icon_family');
    expect(sj.identity?.slice).toBe(sj.manifest?.slice);
    expect(sj.pathCheck?.missing ?? []).toEqual([]);
    expect((sj.structure?.glyphCount ?? 0) > 0).toBe(true);
    expect((sj.structure?.fileCount ?? 0) > 0).toBe(true);
  });
});
