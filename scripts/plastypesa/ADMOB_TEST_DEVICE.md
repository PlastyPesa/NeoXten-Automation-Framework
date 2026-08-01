# AdMob test device setup (Phase A — after suspension)

**Do not** hammer production ad units from NeoXten or your personal phone until AdMob reinstatement (~29 days from suspension email).

## What we changed in the app

`plastypesa-mobile-app/lib/core/utility.dart` uses **Google sample ad unit IDs** in non-release builds (`kReleaseMode == false`). Play Store release builds still use production units.

## Register your phone as a test device

1. Install a **debug** APK (not Play Store release):
   ```powershell
   cd C:\Users\Bobby\Documents\plastypesa-mobile-app
   flutter build apk --debug
   adb install -r build\app\outputs\flutter-apk\app-debug.apk
   ```
2. Launch the app and open a screen that loads ads (Home banner, quiz interstitial).
3. Capture device ID from logcat:
   ```powershell
   adb logcat -s Ads | findstr /i "Use RequestConfiguration"
   ```
   Or search logcat for: `setTestDeviceIds` / `Use RequestConfiguration.Builder().setTestDeviceIds`
4. In [AdMob](https://apps.admob.com/) → **Settings** → **Test devices** → add the hashed device ID.

## Safe testing rules

- **Play Store app (release):** OK for product QA (Home, sort, quiz, invites). Ads may stay empty during suspension — that is expected.
- **Debug APK:** Uses Google test units + your registered test device — safe for ad layout QA.
- **NeoXten ad proof:** still blocked unless `PLASTYPESA_AD_TESTING=1` — see `ADMOB_SUSPENSION_PAUSE.md`.

## Later: profile build (optional)

If you need near-release performance with test ads, use `flutter run --profile` or a profile APK — still non-release, so test units apply.
