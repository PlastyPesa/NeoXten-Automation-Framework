# PlastyPesa end-to-end automation (orchestrated)

Single entry point with **one verdict JSON** under `.neoxten-out/plastypesa-e2e-verdict-*.json`.

## Architecture

| Phase | What runs | Stack |
|-------|-----------|--------|
| **api** (optional) | Existing PlastyPesa API suite | Node `fetch` (`scripts/plastypesa/index.mjs`) |
| **crossflow** | Same JWT as API → `GET /home/sort-proof/config`, `GET /user/my-profile` | Node |
| **admin** | Playwright against Vite admin (auto-starts `npm run dev` unless disabled) | Playwright |
| **mobile** | Flutter `integration_test` on **ADB device** (not WebView/CDP) | `flutter test` |

NeoXten’s **Android WebView CDP driver** is **not** used for PlastyPesa mobile (Flutter UI).

## Prerequisites

- NeoXten `.env` with `PLASTYPESA_API_BASE` and auth (`PLASTYPESA_USER_JWT` or email/password) when running **api** / **crossflow** phases.
- **Android:** If `INSTALL_FAILED_UPDATE_INCOMPATIBLE` appears, uninstall the store/release build from the device (debug APK signature differs), then re-run.
- **NDK:** `android/app/build.gradle.kts` uses NDK **28.2.13676358** for `integration_test` compatibility; install via Android SDK Manager if Gradle fails.
- Optional admin UI login: `PLASTYPESA_ADMIN_EMAIL`, `PLASTYPESA_ADMIN_PASSWORD` (skips dashboard assertion if unset — first Playwright test still runs).
- **Flutter** on PATH; **ADB** with device `device` (authorized).
- Admin deps: `cd plastypesa-admin-dashboard/lib/frontend && npm install && npx playwright install chromium`
- Mobile: `cd plastypesa-mobile-app && flutter pub get`

## Run

From **NeoXten** repo root:

```bash
npm run test:plastypesa-e2e
```

### Sort-proof visibility (focused cross-surface flow)

Admin toggles **Home sorting proof** → verifies `GET /home/sort-proof/config` → device Home (pull-to-refresh) → optional restore. See **`PLASTYPESA_SORT_PROOF_VISIBILITY_E2E.md`**.

```bash
npm run test:plastypesa-e2e:sort-proof-visibility
```

### Env toggles

| Variable | Effect |
|----------|--------|
| `PLASTYPESA_E2E_SKIP_API=1` | Skip API phase |
| `PLASTYPESA_E2E_API_MODE=smoke` | Default: `auth-baseline,regression-core` |
| `PLASTYPESA_E2E_API_MODE=release-pack` | Full release pack (`scripts/plastypesa-release-pack.mjs`) |
| `PLASTYPESA_E2E_API_SUITES=` | Override suites when mode is smoke |
| `PLASTYPESA_E2E_SKIP_CROSSFLOW=1` | Skip API cross-checks |
| `PLASTYPESA_E2E_SKIP_ADMIN=1` | Skip Playwright |
| `PLASTYPESA_E2E_SKIP_MOBILE=1` | Skip Flutter on device |
| `PLASTYPESA_E2E_CONTINUE_ON_FAIL=1` | Run later phases even if an earlier one failed |
| `PLASTYPESA_ADMIN_ROOT` | Path to admin `package.json` (default: sibling `plastypesa-admin-dashboard/lib/frontend`) |
| `PLASTYPESA_MOBILE_ROOT` | Path to Flutter app (default: sibling `plastypesa-mobile-app`) |
| `PLASTYPESA_ANDROID_DEVICE` | ADB serial (default: first `device`) |
| `PLASTYPESA_ADMIN_BASE_URL` | Admin base URL for Playwright (default `http://127.0.0.1:8080`) |
| `PLASTYPESA_ADMIN_WEBSERVER=0` | Do not start Vite from Playwright (use already-running dev server) |

## Manual pieces replaced

- Repeated “open admin → login → see dashboard” smoke.
- Repeated “app installs and launches on device” smoke.
- One place to see **API + API cross-check + admin + device** status after a change.
