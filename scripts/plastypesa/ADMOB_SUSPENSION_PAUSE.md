# AdMob suspension — NeoXten ad testing PAUSED (2026-07-24)

**Publisher:** `pub-8112542727970759`  
**Duration:** 29 days from Google email date (one-time, non-appealable) — reinstatement ~**2026-08-22**  
**Effect:** Google will not serve ads; self-testing on production units risks permanent closure.

## Root cause (confirmed 2026-07-26)

Agent ADB testing sessions ran on a **release build with production ad units** installed on
the owner's device (`com.app.plasty_pesa`, no DEBUGGABLE flag). Automated/owner navigation
generated ad impressions (~€1.29 invalid earnings, now on payment hold). Google flagged it
as invalid traffic. This is a **temporary** suspension: per Google's policy page, serving
auto-resumes at the end of the period unless further invalid activity occurs. The held
balance will likely be deducted — do not count it as revenue.

**Never-again rule:** `.cursor/rules/real-device-testing.mdc` (all 4 PlastyPesa repos) now
has an **AdMob invalid-traffic safety** section — debug APK by default, no agent sessions
on release builds with prod ad units, device must be AdMob-registered before any
release-build ad verification.

## Blocked commands

| Command | Status |
|---------|--------|
| `npm run test:plastypesa-ad-phase1` | **HARD BLOCK** (exits immediately) |

## Use with caution during suspension

These open the app on ADB and may trigger **one** app-open ad on a **Play release** install:

- `npm run test:plastypesa-launch-mobile`
- `npm run test:plastypesa-device-shell-walk`
- `npm run test:plastypesa-localization` (device leg)

Prefer: test **logic only**, use **debug APK + test ad units** (mobile repo — post-reinstatement), do **not** hammer release builds.

## Reinstatement checklist

1. AdSense red banner gone (~email date + 29 days).
2. Merge mobile: debug test ad units + AdMob test device registration.
3. Remove or keep guard; only then set `PLASTYPESA_AD_TESTING=1` for one controlled proof run.

## Owner form-fill blocks

When helping the owner paste into external consoles, use **one bash block per field, value only** (no titles/comments). Canon: `plastypesa-admin-dashboard/DOCS/PLASTYPESA_OWNER_ACTIONS.md` → **Form-fill blocks** + **B0 AppLovin MAX**.
