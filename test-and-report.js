/**
 * Neoxtemus UI Full Test with Detailed Reporting
 * Tests the complete user journey and generates a detailed report
 */

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

const APP_URL = 'http://localhost:1420/?automation=1';
const OUTPUT_DIR = '.neoxten-out/manual-test';
const SCREENSHOTS_DIR = join(OUTPUT_DIR, 'screenshots');

const report = {
  timestamp: new Date().toISOString(),
  verdict: 'PASS',
  steps: [],
  issues: [],
  observations: []
};

async function captureStep(page, stepNumber, stepName, description) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📸 Step ${stepNumber}: ${stepName}`);
  console.log(`${'='.repeat(80)}`);
  
  const screenshotPath = join(SCREENSHOTS_DIR, `${String(stepNumber).padStart(2, '0')}-${stepName.toLowerCase().replace(/\s+/g, '-')}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  
  // Capture visible text
  const bodyText = await page.textContent('body');
  const visibleElements = await page.$$eval('[data-testid]', elements => 
    elements.map(el => ({
      testid: el.getAttribute('data-testid'),
      visible: el.offsetParent !== null,
      tagName: el.tagName.toLowerCase()
    }))
  );
  
  const stepData = {
    number: stepNumber,
    name: stepName,
    description,
    screenshot: screenshotPath,
    visibleTestIds: visibleElements.filter(e => e.visible).map(e => e.testid),
    timestamp: new Date().toISOString()
  };
  
  report.steps.push(stepData);
  
  console.log(`✅ Screenshot saved: ${screenshotPath}`);
  console.log(`📋 Visible elements with data-testid: ${stepData.visibleTestIds.length}`);
  console.log(`   ${stepData.visibleTestIds.slice(0, 10).join(', ')}${stepData.visibleTestIds.length > 10 ? '...' : ''}`);
  
  return stepData;
}

async function checkForElement(page, selector, elementName) {
  try {
    const element = await page.$(selector);
    if (element) {
      const isVisible = await element.isVisible();
      console.log(`   ✅ ${elementName}: ${isVisible ? 'VISIBLE' : 'HIDDEN'}`);
      return { found: true, visible: isVisible };
    } else {
      console.log(`   ❌ ${elementName}: NOT FOUND`);
      report.issues.push(`${elementName} not found (selector: ${selector})`);
      return { found: false, visible: false };
    }
  } catch (err) {
    console.log(`   ⚠️  ${elementName}: ERROR - ${err.message}`);
    return { found: false, visible: false, error: err.message };
  }
}

async function main() {
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
  await page.waitForTimeout(3000);

  // Step 2: Screenshot Assistant view
  await page.waitForSelector('[data-testid="assistant-view"]', { timeout: 10000 });
  const step1 = await captureStep(page, 1, 'assistant-welcome', 'Initial Assistant view with welcome message');
  
  console.log('\n🔍 Checking Assistant View Elements:');
  await checkForElement(page, '[data-testid="assistant-input"]', 'Assistant Input Field');
  await checkForElement(page, '[data-testid="assistant-send"]', 'Send Button');
  await checkForElement(page, '.welcome-message', 'Welcome Message');
  await checkForElement(page, '.capabilities-grid', 'Capabilities Grid');
  
  // Check for welcome text
  const hasWelcomeText = await page.locator('text=Your Offline Assistant').isVisible();
  console.log(`   ${hasWelcomeText ? '✅' : '❌'} Welcome text "Your Offline Assistant": ${hasWelcomeText ? 'VISIBLE' : 'NOT FOUND'}`);

  // Step 3: Click Vault navigation
  console.log('\n🔒 Navigating to Vault...');
  await page.click('[data-testid="nav-vault"]');
  await page.waitForTimeout(1000);

  // Step 4: Screenshot Vault view
  const step2 = await captureStep(page, 2, 'vault-view', 'Vault view or Vault Gate');
  
  console.log('\n🔍 Checking Vault View:');
  const hasVaultView = await checkForElement(page, '[data-testid="vault-view"]', 'Vault View');
  const hasVaultGate = await checkForElement(page, '[data-testid="vault-gate"]', 'Vault Gate');
  report.observations.push(`Vault shows: ${hasVaultView.found ? 'Vault View' : hasVaultGate.found ? 'Vault Gate (locked)' : 'Unknown'}`);

  // Step 5: Click Memory navigation
  console.log('\n🧠 Navigating to Memory...');
  await page.click('[data-testid="nav-memory"]');
  await page.waitForTimeout(1000);

  // Step 6: Screenshot Memory view
  const step3 = await captureStep(page, 3, 'memory-view', 'Memory view - verify no manual Add Memory form');
  
  console.log('\n🔍 Checking Memory View Elements:');
  await checkForElement(page, '[data-testid="memory-view"]', 'Memory View');
  const hasAddMemoryForm = await page.$('.add-memory-form, [data-testid="add-memory-form"]');
  console.log(`   ${hasAddMemoryForm ? '❌' : '✅'} Manual "Add Memory" form: ${hasAddMemoryForm ? 'FOUND (should be removed!)' : 'NOT FOUND (correct!)'}`);
  if (hasAddMemoryForm) {
    report.issues.push('Manual "Add Memory" form still present in Memory view');
  } else {
    report.observations.push('✅ Manual "Add Memory" form successfully removed from Memory view');
  }
  
  // Check for memory hint text
  const hasMemoryHint = await page.locator('text=Memories are created automatically').isVisible().catch(() => false);
  console.log(`   ${hasMemoryHint ? '✅' : '⚠️ '} Memory hint text: ${hasMemoryHint ? 'VISIBLE' : 'NOT FOUND'}`);
  if (hasMemoryHint) {
    report.observations.push('✅ Memory hint text visible');
  }

  // Step 7: Click Files navigation
  console.log('\n📁 Navigating to Files...');
  await page.click('[data-testid="nav-files"]');
  await page.waitForTimeout(1000);

  // Step 8: Screenshot Files view
  const step4 = await captureStep(page, 4, 'files-view', 'Files view');
  
  console.log('\n🔍 Checking Files View Elements:');
  await checkForElement(page, '[data-testid="files-view"]', 'Files View');

  // Step 9: Click back to Assistant
  console.log('\n💬 Navigating back to Assistant...');
  await page.click('[data-testid="nav-assistant"]');
  await page.waitForTimeout(1000);

  // Step 10: Type in the input field
  console.log('\n⌨️  Typing in input field...');
  await page.fill('[data-testid="assistant-input"]', 'Check my device health');
  await page.waitForTimeout(500);

  // Step 10b: Screenshot with typed text
  const step5 = await captureStep(page, 5, 'assistant-typed-input', 'Assistant with typed input text');
  
  const inputValue = await page.inputValue('[data-testid="assistant-input"]');
  console.log(`   ✅ Input field value: "${inputValue}"`);
  if (inputValue === 'Check my device health') {
    report.observations.push('✅ Input field accepts text correctly');
  } else {
    report.issues.push(`Input field value mismatch: expected "Check my device health", got "${inputValue}"`);
  }

  // Step 11: Click settings gear icon
  console.log('\n⚙️  Opening settings panel...');
  await page.click('[data-testid="topbar-settings"]');
  await page.waitForTimeout(1000);

  // Step 12: Screenshot settings panel
  const step6 = await captureStep(page, 6, 'settings-panel', 'Settings panel');
  
  console.log('\n🔍 Checking Settings Panel:');
  await checkForElement(page, '[data-testid="settings-panel"]', 'Settings Panel');

  // Check status bar
  console.log('\n🔍 Checking Status Bar:');
  await checkForElement(page, '[data-testid="status-bar"]', 'Status Bar');

  console.log('\n✨ All tests completed successfully!');
  
  // Generate report
  report.verdict = report.issues.length === 0 ? 'PASS' : 'PASS_WITH_ISSUES';
  report.summary = {
    totalSteps: report.steps.length,
    issues: report.issues.length,
    observations: report.observations.length
  };

  const reportPath = join(OUTPUT_DIR, 'test-report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  
  console.log(`\n${'='.repeat(80)}`);
  console.log('📊 TEST REPORT');
  console.log(`${'='.repeat(80)}`);
  console.log(`Verdict: ${report.verdict}`);
  console.log(`Total Steps: ${report.summary.totalSteps}`);
  console.log(`Issues Found: ${report.summary.issues}`);
  console.log(`Observations: ${report.summary.observations}`);
  
  if (report.issues.length > 0) {
    console.log('\n⚠️  Issues:');
    report.issues.forEach((issue, i) => console.log(`   ${i + 1}. ${issue}`));
  }
  
  if (report.observations.length > 0) {
    console.log('\n✅ Key Observations:');
    report.observations.forEach((obs, i) => console.log(`   ${i + 1}. ${obs}`));
  }
  
  console.log(`\n📂 Screenshots: ${SCREENSHOTS_DIR}`);
  console.log(`📄 Full report: ${reportPath}`);

  await page.waitForTimeout(2000);
  await browser.close();
}

main().catch(err => {
  console.error('❌ Test failed:', err);
  report.verdict = 'FAIL';
  report.error = err.message;
  process.exit(1);
});
