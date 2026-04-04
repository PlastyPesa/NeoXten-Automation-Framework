import { test, expect } from '@playwright/test';

/**
 * Control API smoke (HTTP). Browser dashboard is covered manually / via `npm run dev` + proxy;
 * UI bundle under `vite preview` has shown main-thread issues under Playwright Chromium in this repo.
 */
test.describe('Operator Control API', () => {
  test('GET /api/health', async ({ request }) => {
    const r = await request.get('/api/health');
    expect(r.ok()).toBeTruthy();
    const j = (await r.json()) as { ok?: boolean; service?: string };
    expect(j.ok).toBe(true);
    expect(j.service).toBe('neoxten-operator');
  });

  test('GET /api/suites lists YAML presets', async ({ request }) => {
    const r = await request.get('/api/suites');
    expect(r.ok()).toBeTruthy();
    const j = (await r.json()) as { suites?: string[] };
    expect(Array.isArray(j.suites)).toBe(true);
    expect(j.suites?.length).toBeGreaterThan(0);
  });

  test('GET /api/explain/failed_step', async ({ request }) => {
    const r = await request.get('/api/explain/failed_step');
    expect(r.ok()).toBeTruthy();
    const j = (await r.json()) as { slug?: string };
    expect(j.slug).toBe('failed_step');
  });

  test('GET /api/projects', async ({ request }) => {
    const r = await request.get('/api/projects');
    expect(r.ok()).toBeTruthy();
    const j = (await r.json()) as { projects?: unknown[] };
    expect(Array.isArray(j.projects)).toBe(true);
  });
});
