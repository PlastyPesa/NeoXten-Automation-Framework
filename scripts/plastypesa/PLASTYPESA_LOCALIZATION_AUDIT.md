# PlastyPesa Localization Audit

Repeatable localization audit for the PlastyPesa landing site, legal/public pages, and Flutter app.

## What It Covers

- Surface map of all translation sources and high-risk user flows.
- Static checks for missing locale keys, hardcoded user-facing strings, mixed-language leakage, and outdated brand wording.
- Browser audit of landing and legal/public pages across all supported locales.
- Real-device Flutter audit via ADB and `integration_test`, with locale switching, navigation, screenshots, and deep-link style flow coverage.
- Real ADB/UIAutomator visible walkthrough with human-like taps and swipes on the physical device.
- Optional admin-dashboard to mobile-app reflection check using the real pinned in-app banner workflow.
- Optional ADB screenshot + UI hierarchy capture for native evidence.

## Entry Point

From the NeoXten repo root:

```bash
npm run test:plastypesa-localization
```

Outputs are written under:

```text
.neoxten-out/plastypesa-localization/
```

## Phase Outputs

- `surface-map.json` / `surface-map.md`
- `static-audit.json` / `static-audit.md`
- `web-audit.json` / `web-audit.md`
- `web-screenshots/*.png`
- `mobile-final-state.png` / `mobile-final-state.xml` when ADB capture is enabled
- `verdict-*.json` / `verdict-*.md`
- `mobile-adb-visible.json` / `mobile-adb-visible.md`
- `admin-app-reflection.json` / `admin-app-reflection.md` when admin reflection is enabled

## Environment Toggles

| Variable | Effect |
|----------|--------|
| `PLASTYPESA_LOCALIZATION_SKIP_SURFACE_MAP=1` | Skip surface inventory generation |
| `PLASTYPESA_LOCALIZATION_SKIP_STATIC=1` | Skip static localization scan |
| `PLASTYPESA_LOCALIZATION_SKIP_WEB=1` | Skip browser locale sweep |
| `PLASTYPESA_LOCALIZATION_SKIP_MOBILE=1` | Skip ADB-backed Flutter audit |
| `PLASTYPESA_LOCALIZATION_SKIP_MOBILE_ADB_VISIBLE=1` | Skip the extra real-tap ADB/UIAutomator visible walkthrough |
| `PLASTYPESA_LOCALIZATION_ENABLE_ADMIN_APP_REFLECTION=1` | Run the opt-in admin-dashboard to mobile-app reflection phase |
| `PLASTYPESA_LOCALIZATION_CAPTURE_FINAL_ADB=0` | Skip final ADB screenshot + XML dump |
| `PLASTYPESA_LOCALIZATION_MOBILE_VISIBLE=0` | Disable slowed visible on-device pacing and run the Flutter audit faster |
| `PLASTYPESA_LOCALIZATION_OUTDIR=/path/to/out` | Override audit output directory |
| `PLASTYPESA_ANDROID_DEVICE=<serial>` | Force a specific ADB device |
| `PLASTYPESA_ADMIN_BASE_URL=http://127.0.0.1:8080` | Override landing/admin frontend base URL |
| `PLASTYPESA_LOCALIZATION_WEBSERVER=0` | Do not auto-start the admin frontend |
| `PLASTYPESA_ADMIN_APP_REFLECTION_ALLOW_MUTATION=1` | Allow the reflection phase to create and later clear a live pinned in-app banner |

## Fix Order

1. Rewrite weak or outdated source English.
2. Remove hardcoded UI strings that bypass localization.
3. Align terminology across mobile and web using one glossary.
4. Fix per-language translation quality and consistency.
5. Re-run the full matrix and review screenshots before shipping.

## Glossary Priorities

- Use `reward`, `eco reward`, `digital voucher`, or `voucher`.
- Avoid `prize`, `prizes`, and `prize draw` in user-facing copy.
- Keep one consistent concept for sorting: either `grade` or `type`, then align all locales.
- Replace ambiguous learning copy like `Deep Learning` with education-focused terminology.

## Device Audit Notes

- The mobile audit uses a connected ADB device and the Flutter app's `integration_test` harness.
- It preserves the current session when possible and audits authenticated screens only when a valid session already exists on the device.
- Guest screens are still covered even without a logged-in session.
- By default the orchestrator enables a slower visible mode so you can watch taps and scrolls on the physical device; set `PLASTYPESA_LOCALIZATION_MOBILE_VISIBLE=0` if you want the faster version.
- The ADB visible walkthrough is separate from the Flutter audit: it uses `uiautomator dump` plus `adb shell input tap/swipe` so movements are watchable on the actual phone.
- When no authenticated session exists, the ADB visible walkthrough can use the locally stored mobile test account on the machine to sign in before traversing tabs and the language picker.
- The admin reflection phase is intentionally opt-in because it performs a real admin mutation, then clears it after the mobile verification pass.

## Why This Exists

Localization defects are coming from four different sources:

- weak source English,
- hardcoded UI strings,
- bad per-language translations,
- API-managed content that leaks English.

This audit is designed to catch all four in one loop instead of relying on manual spot checks.
