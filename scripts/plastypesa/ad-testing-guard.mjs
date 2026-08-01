/**
 * Hard stop for NeoXten flows that trigger production AdMob impressions/clicks.
 *
 * Paused 2026-07-24: AdSense pub-8112542727970759 — 29-day invalid-traffic suspension.
 * Do NOT run ad proof harnesses until reinstatement + test-ad-unit work is merged.
 *
 * Emergency override (owner only, reinstatement + test setup): set
 *   PLASTYPESA_AD_TESTING=1
 */
export function assertAdTestingAllowed(scriptName = 'ad test') {
  if (process.env.PLASTYPESA_AD_TESTING === '1') {
    console.warn(
      `[ad-guard] PLASTYPESA_AD_TESTING=1 — ${scriptName} allowed (owner override).`,
    );
    return;
  }
  console.error(`
[ad-guard] BLOCKED: ${scriptName}

AdMob/AdSense account is under a 29-day invalid-traffic suspension (pub-8112542727970759).
NeoXten ad harnesses are PAUSED until ~reinstatement + debug test-ad units.

Do not run:
  npm run test:plastypesa-ad-phase1

Other device walks (launch-mobile, localization) may still cold-start the app and
request ads — avoid hammering the Play release on your test phones during suspension.

To override after reinstatement and test-ad setup: PLASTYPESA_AD_TESTING=1
`);
  process.exit(78);
}
