# PlastyPesa app health monitor — setup

**Command (agents + owner):**

```bash
cd C:\Users\Bobby\Documents\NeoXten-Automation-Framework
npm run monitor:plastypesa   # Play versionCode + crash/ANR vitals (+ upserts masters.play-live-version when Mongo set)
npm run play:install-stats   # Play install CSV from GCS (+ upserts masters.play-install-daily-summary)
npm run digest:plastypesa    # Daily ops digest (signups, queue, boost, banners, fair-play)
```

Daily digest JSON: `.neoxten/plastypesa-daily-digest-latest.json`  
Play monitor JSON: `.neoxten/plastypesa-monitor-latest.json`

Say **“daily check”** in Cursor chat — agent must run the **full** admin inbox report, not a thin digest summary:

1. `node scripts/plastypesa/print-daily-check-full.mjs` (or `.local-mongo-daily-check-report.mjs` if admin login rate-limited) — action inbox, sorts, claims, disputes, moderation, builds, Eco Guardian, Play
1b. Sort + daily quiz co-pilot per `plastypesa-admin-dashboard/DOCS/PLASTYPESA_OWNER_AGENT_COPILOT_OPS.md` — pull sorts (`.local-sort-review-mongo-pull.mjs` if 429), clear obvious cases (`PUT` approve/reject), escalate unsure with images; publish visually verified daily quiz (not dashboard AI auto-approve)
2. `npm run digest:plastypesa` + `npm run monitor:plastypesa` (+ `npm run play:install-stats` when installs panel is stale)
3. **Daily content:** approve a tip (Content Queue) after brand-safe check
4. **Daily quiz:** generate/approve only after **visual** Q↔image verify (download images; reject on mismatch). Catalog filenames alone are not proof.

### Daily digest — fair-play section (2026-07-24)

`digest:plastypesa` now includes an **integrity** block in `.neoxten/plastypesa-daily-digest-latest.json`:

- Weekly top 10 (points, approved sorts, referral %, account age)
- Top 3 activity mix (which transaction types drive their score)
- Last week's Kenya #1 vs current rank (leaderboard shift)
- Top sorters this week
- Signup watch: similar-email clusters, multi-account devices, registration cap hits
- Referral bursts (24h), farming signals, open fraud admin alerts

**Admin dashboard (wife):** sidebar → **Daily Check** (`/daily-check`) → **Refresh** for live production data (same engine as this digest, with sort/referral/quiz counts per row, **App build** column, and **Play Store & app builds** section).

### Per-user app build (2026-07-25)

Mobile app sends `appVersionCode`, `appVersionName`, `appPlatform`, and `installSource` on **login / register / device-token**. Daily Check shows them on the leaderboard and flags users behind the live Play build.

---

## What you must do manually (one-time)

### 1) Enable Play Developer Reporting API (GCP)

1. Open [Google Cloud Console](https://console.cloud.google.com/) → project **`plastypesa-f5274`**
2. **APIs & Services → Library**
3. Search **Google Play Developer Reporting API**
4. Click **Enable**

(Publisher / Android Publisher API should already be enabled from releases.)

### 2) Grant vitals permission in Play Console

1. [Play Console](https://play.google.com/console) → **Users and permissions**
2. Find / invite: `play-publisher@plastypesa-f5274.iam.gserviceaccount.com`
3. Ensure the account can at least:
   - **View app information and download bulk reports** (or full Admin)
   - Keep existing **Release to production** / manage releases
4. App access: **PlastyPesa** (`com.app.plasty_pesa`) included
5. Save

Without this, the monitor will show production version but **fail vitals** with a permission / API error.

### 3) Confirm Crashlytics in Firebase (already in the app)

1. [Firebase Console](https://console.firebase.google.com/) → PlastyPesa project
2. **Crashlytics** → confirm it receives data from release builds
3. After installs: filter by version **1.0.21** / versionCode **32**

No code change needed — `firebase_crashlytics` is already in the Flutter app.

### 4) Optional — product KPIs in the same report

Set for your shell / agent env (do **not** commit):

```powershell
$env:PLASTYPESA_MONGO_URI = "<your mongo uri>"
npm run monitor:plastypesa
```

Adds approx Kenya user counts, recent sorts, claim statuses.

### 5) Optional — override service-account path

```powershell
$env:PLASTYPESA_PLAY_SA_JSON = "C:\path\to\play-publisher-....json"
```

### 6) Play install CSV bucket (Daily Check aggregate installs)

Play Console exports install stats to a **Google Cloud Storage** bucket (not the same as Publisher API alone).

1. [Play Console](https://play.google.com/console) → **Download reports** → note the **Cloud Storage URI** bucket name (e.g. `pubsite_prod_8780730627387195469` — your developer account ID, not always `pubsite_prod_rev_*`).
2. In [Google Cloud Console](https://console.cloud.google.com/) → **IAM** for project `plastypesa-f5274`:
   - Grant **`play-publisher@plastypesa-f5274.iam.gserviceaccount.com`** the role **Storage Object Viewer** on that bucket (or prefix `stats/installs/`).
3. Set env and run (persists in gitignored `.local/play-stats.env`):

```powershell
cd C:\Users\Bobby\Documents\NeoXten-Automation-Framework
.\scripts\plastypesa\setup-play-install-stats.ps1 -Bucket pubsite_prod_rev_XXXXXXXXX
# or: copy .local\play-stats.env.example → .local\play-stats.env and edit
npm run play:install-stats
```

Writes `.neoxten/plastypesa-play-install-stats.json` and upserts Mongo master **`play-install-daily-summary`** (shown on admin **Daily Check** after Refresh).

`npm run monitor:plastypesa` upserts Mongo master **`play-live-version`** when Mongo URI is available.

---

## Output

- Console summary (human-readable)
- JSON: `NeoXten-Automation-Framework/.neoxten/plastypesa-monitor-latest.json`

---

## Agent rule

Cursor rules tell agents to run `npm run monitor:plastypesa` after Play releases / when asked about crashes or live health.
