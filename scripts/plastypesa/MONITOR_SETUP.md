# PlastyPesa app health monitor — setup

**Command (agents + owner):**

```bash
cd C:\Users\Bobby\Documents\NeoXten-Automation-Framework
npm run monitor:plastypesa
```

Uses the existing Play service account JSON (same key that published 1.0.21+32).

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

---

## Output

- Console summary (human-readable)
- JSON: `NeoXten-Automation-Framework/.neoxten/plastypesa-monitor-latest.json`

---

## Agent rule

Cursor rules tell agents to run `npm run monitor:plastypesa` after Play releases / when asked about crashes or live health.
