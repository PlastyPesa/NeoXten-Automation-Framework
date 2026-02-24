/**
 * Neoxtemus UI Full Test
 * Tests the complete user journey through all views with screenshots
 */

import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import { join } from 'path';

const APP_URL = 'http://localhost:1420/?automation=1';
const SCREENSHOTS_DIR = '.neoxten-out/manual-test/screenshots';

async function main() {
  // Create screenshots directory
  await mkdir(SCREENSHOTS_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();

  console.log('🚀 Navigating to Neoxtemus Intelligence...');
  await page.goto(APP_URL);

  // Step 1: Wait for app to load fully
  console.log('⏳ Waiting for app to load...');
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 30000 });
  await page.waitForTimeout(3000); // Extra wait for boot sequence

  // Step 2: Take screenshot of Assistant view (should be default)
  console.log('📸 Step 1: Assistant welcome view');
  await page.waitForSelector('[data-testid="assistant-view"]', { timeout: 10000 });
  await page.screenshot({ path: join(SCREENSHOTS_DIR, '01-assistant-welcome.png'), fullPage: true });
  console.log('✅ Screenshot saved: 01-assistant-welcome.png');

  // Step 3: Click Vault navigation
  console.log('🔒 Step 2: Navigating to Vault...');
  await page.click('[data-testid="nav-vault"]');
  await page.waitForTimeout(1000);

  // Step 4: Take screenshot of Vault view
  console.log('📸 Step 2: Vault view');
  await page.screenshot({ path: join(SCREENSHOTS_DIR, '02-vault-view.png'), fullPage: true });
  console.log('✅ Screenshot saved: 02-vault-view.png');

  // Step 5: Click Memory navigation
  console.log('🧠 Step 3: Navigating to Memory...');
  await page.click('[data-testid="nav-memory"]');
  await page.waitForTimeout(1000);

  // Step 6: Take screenshot of Memory view
  console.log('📸 Step 3: Memory view (verify no manual Add Memory form)');
  await page.screenshot({ path: join(SCREENSHOTS_DIR, '03-memory-view.png'), fullPage: true });
  console.log('✅ Screenshot saved: 03-memory-view.png');

  // Step 7: Click Files navigation
  console.log('📁 Step 4: Navigating to Files...');
  await page.click('[data-testid="nav-files"]');
  await page.waitForTimeout(1000);

  // Step 8: Take screenshot of Files view
  console.log('📸 Step 4: Files view');
  await page.screenshot({ path: join(SCREENSHOTS_DIR, '04-files-view.png'), fullPage: true });
  console.log('✅ Screenshot saved: 04-files-view.png');

  // Step 9: Click back to Assistant
  console.log('💬 Step 5: Navigating back to Assistant...');
  await page.click('[data-testid="nav-assistant"]');
  await page.waitForTimeout(1000);

  // Step 10: Type in the input field
  console.log('⌨️  Step 5: Typing in input field...');
  await page.fill('[data-testid="assistant-input"]', 'Check my device health');
  await page.waitForTimeout(500);

  // Step 10b: Take screenshot showing typed text
  console.log('📸 Step 5: Assistant with typed input');
  await page.screenshot({ path: join(SCREENSHOTS_DIR, '05-assistant-typed-input.png'), fullPage: true });
  console.log('✅ Screenshot saved: 05-assistant-typed-input.png');

  // Step 11: Click settings gear icon
  console.log('⚙️  Step 6: Opening settings panel...');
  await page.click('[data-testid="topbar-settings"]');
  await page.waitForTimeout(1000);

  // Step 12: Take screenshot of settings panel
  console.log('📸 Step 6: Settings panel');
  await page.screenshot({ path: join(SCREENSHOTS_DIR, '06-settings-panel.png'), fullPage: true });
  console.log('✅ Screenshot saved: 06-settings-panel.png');

  console.log('\n✨ All tests completed successfully!');
  console.log(`📂 Screenshots saved to: ${SCREENSHOTS_DIR}`);

  // Keep browser open for 3 seconds to see final state
  await page.waitForTimeout(3000);

  await browser.close();
}

main().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
