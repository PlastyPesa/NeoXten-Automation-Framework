import { test, expect } from '@playwright/test';

/**
 * Final readiness: usable entry surface — Dashboard → Icon system project → workspace.
 * Not a batch regression; proves normal operator path (not deep link / API-only prep).
 * Served via playwright.velarune-entry.config.ts webServer.
 */

test.describe('Velarune Studio — dashboard entry path (icon flagship)', () => {
  test('load /, create Icon system from dashboard, land in icon workspace', async ({ page }) => {
    test.setTimeout(120_000);

    const projectName = `Dashboard entry ${Date.now()}`;

    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 });

    await expect(page.getByTestId('velarune-studio-app')).toBeVisible();
    await expect(page.getByTestId('dashboard-projects')).toBeVisible();
    await expect(page.getByTestId('studio-nav-dashboard')).toBeVisible();

    await page.getByTestId('dashboard-slice-select').selectOption('icon_system');
    await expect(page.getByTestId('dashboard-slice-select')).toHaveValue('icon_system');

    await page.getByTestId('dashboard-project-name').fill(projectName);
    await page.getByTestId('dashboard-create-project').click();

    const card = page
      .getByTestId('dashboard-project-card')
      .filter({ hasText: projectName })
      .filter('[data-project-slice="icon_system"]');
    await expect(card).toBeVisible({ timeout: 30_000 });

    await card.first().click();

    await expect(page).toHaveURL(/\/project\/[0-9a-f-]{36}/i);
    await expect(page.getByTestId('icon-project-workspace')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('icon-flagship-pill')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(projectName);
  });
});
