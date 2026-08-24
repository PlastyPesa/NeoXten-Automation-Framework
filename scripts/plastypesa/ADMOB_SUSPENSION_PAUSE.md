# AdMob suspension — NeoXten ad testing PAUSED (2026-07-24)

**Publisher:** `pub-8112542727970759`  
**Duration:** Google email **2026-07-24** · ~29 days. **LIFTED 2026-08-24 ~06:13 UK**, then **SUSPENDED AGAIN 2026-08-25 ~00:04 UK** — owner page *You can not use AdMob at this time* · invalid traffic · go to AdSense. Same publisher `pub-8112542727970759`. Last-7d before the second gate: **€0.07 / 79 requests / 49 impressions**. That is **app-wide**, not “two ads on one phone.” **Owner GO ~00:28 UK 25 Aug:** live **`appOpenEnabled: false`** (quiz/TV LevelPlay still on). IVT suspensions are **non-appealable** per Google Help. File: `plastypesa-admin-dashboard/DOCS/OWNER-LOCK-ADMOB-SUSPENDED-AGAIN-20260825.md`.  
**Effect (second pause):** AdMob app-open will not fill. Do **not** tap ads. No agent ADB on a Play release to “check ads.” Quiz/Desk/TV stay LevelPlay + Meta.

## Root cause (owner 2026-08-24 ~06:54 UK — this is the night)

Bobby: Cursor worked **a full night** on ads wiring (quiz, app-open, not only that). Ads were set to **show every 3 minutes** on screen. The phone **stayed open all night**. Ads **kept firing every 3 minutes**. That is how `pub-8112542727970759` got the invalid-traffic pause (email **24 Jul 2026**, ~€1.29).

The 26 Jul note (release APK + ADB navigation) is **part** of the same sitting. The firehose was the **3-minute timer + phone left open overnight**, not Kenya members tapping banners.

**Forever:** no wall-clock ad every 3/5 minutes. No overnight Cursor/ADB session on a Play release with production ads. Wiring proof = debug APK + test units, then **stop**. Play 82 has no 3-minute timer (searched `lib/` this sitting). Full-screens are **event** seats (open / quiz / Desk / TV), 60s apart, ceiling 8.

Canon: `plastypesa-admin-dashboard/DOCS/OWNER-LOCK-ADMOB-BAN-CAUSE-3MIN-OVERNIGHT-20260824.md`

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
