import { test, expect } from '@playwright/test';

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
});
