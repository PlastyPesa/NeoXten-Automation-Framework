#!/usr/bin/env node
/**
 * Phase 5 real-device proof for the localized legal surface.
 *
 * Walks the installed app in English and Romanian, opens Terms & Conditions,
 * captures screenshot/UI evidence, and restores English before exiting.
 */
import {
  adb,
  captureStepArtifacts,
  dumpUiHierarchy,
  findNodeByText,
  forceStopAndLaunchApp,
  getAdbDevice,
  getDisplaySize,
  parseUiNodes,
  pressKey,
  sleep,
  tapBounds,
  tapText,
  writeAdbReport,
} from './localization/adb-ui.mjs';

const PKG = 'com.app.plasty_pesa';
const report = {
  generatedAt: new Date().toISOString(),
  packageName: PKG,
  steps: [],
  artifacts: [],
  errors: [],
};

async function edgeSwipe(direction) {
  const size = getDisplaySize(report.deviceId);
  const x = Math.round(size.width * 0.95);
  const startY = Math.round(size.height * (direction === 'up' ? 0.8 : 0.3));
  const endY = Math.round(size.height * (direction === 'up' ? 0.3 : 0.8));
  adb(
    ['shell', 'input', 'swipe', `${x}`, `${startY}`, `${x}`, `${endY}`, '700'],
    { deviceId: report.deviceId },
  );
  await sleep(900);
}

async function tapWithScroll(candidates, direction = 'up', attempts = 7) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const dump = dumpUiHierarchy(
      report.deviceId,
      `phase5-${candidates[0].replace(/\W+/g, '-')}-${attempt}`,
    );
    const node = findNodeByText(parseUiNodes(dump.xml), candidates, {
      packageName: PKG,
    });
    if (node?.bounds) {
      tapBounds(node.bounds, { deviceId: report.deviceId });
      await sleep(700);
      return true;
    }
    await edgeSwipe(direction);
  }
  return false;
}

async function openProfile() {
  const tapped = await tapText(['Profile'], {
    deviceId: report.deviceId,
    timeoutMs: 7000,
    label: 'phase5-profile',
    packageName: PKG,
  });
  if (!tapped) throw new Error('Profile tab is not reachable.');
  await sleep(1800);
}

async function openTerms(candidates) {
  let tapped = await tapWithScroll(candidates, 'up');
  if (!tapped) tapped = await tapWithScroll(candidates, 'down');
  if (!tapped) throw new Error(`Terms row not reachable: ${candidates.join(', ')}`);
  await sleep(3500);
}

async function assertTerms(locale, titleCandidates, requiredBodyPattern) {
  const dump = dumpUiHierarchy(report.deviceId, `phase5-terms-${locale}`);
  const text = parseUiNodes(dump.xml)
    .map((node) => node.text || node.contentDesc || '')
    .filter(Boolean)
    .join('\n');
  const normalizedText = text.replaceAll('&amp;', '&').replaceAll('&#10;', '\n');
  const titlePresent = titleCandidates.some((title) => normalizedText.includes(title));
  const bodyEvidencePresent = requiredBodyPattern.test(normalizedText);
  const artifacts = await captureStepArtifacts(`phase5-terms-${locale}`);
  report.artifacts.push(artifacts);
  report.steps.push({
    locale,
    titlePresent,
    bodyEvidencePresent,
    dump: dump.localPath,
    visibleText: normalizedText.slice(0, 12000),
  });
  if (!titlePresent) report.errors.push(`${locale}: localized terms title is not visible.`);
  if (!bodyEvidencePresent) {
    report.errors.push(`${locale}: July 2026 legal body evidence is not exposed on device.`);
  }
}

async function switchLanguage(rowCandidates, languageCandidates) {
  await pressKey(4, { deviceId: report.deviceId, afterMs: 1200 });
  let tapped = await tapWithScroll(rowCandidates, 'up');
  if (!tapped) tapped = await tapWithScroll(rowCandidates, 'down');
  if (!tapped) throw new Error(`Language row not reachable: ${rowCandidates.join(', ')}`);
  await sleep(900);
  const selected = await tapWithScroll(languageCandidates, 'up', 5);
  if (!selected) throw new Error(`Language option not reachable: ${languageCandidates.join(', ')}`);
  await sleep(1800);
}

async function main() {
  report.deviceId = getAdbDevice();
  if (!report.deviceId) throw new Error('No authorized ADB device.');

  forceStopAndLaunchApp({ deviceId: report.deviceId, packageName: PKG });
  await sleep(9000);
  await openProfile();

  await openTerms(['Terms & Conditions', 'Terms &amp; Conditions']);
  await assertTerms('en', ['Terms & Conditions'], /12 July 2026|Last updated/i);

  await switchLanguage(['Language'], ['Română']);
  await openTerms(['Termeni și Condiții', 'Termeni şi Condiţii']);
  await assertTerms('ro', ['Termeni și Condiții', 'Termeni şi Condiţii'], /12 iulie 2026|Ultima actualizare/i);

  await switchLanguage(['Limbă', 'Limba'], ['English']);

  report.pass = report.errors.length === 0;
  writeAdbReport('phase5-mobile-legal-live', report);
  console.log(`[phase5-mobile-legal] ${report.pass ? 'PASS' : 'FAIL'}`);
  if (!report.pass) {
    for (const error of report.errors) console.error(`  - ${error}`);
    process.exit(1);
  }
}

main().catch((error) => {
  report.pass = false;
  report.errors.push(error.message);
  writeAdbReport('phase5-mobile-legal-live', report);
  console.error(`[phase5-mobile-legal] ${error.stack || error}`);
  process.exit(1);
});
