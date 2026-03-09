# Nemyo — Real Device / ADB Requirements

For full Nemyo automation including mobile app integration tests, the following are required.

## Integration Tests (Parent + Child Apps)

The gate runs `flutter test integration_test/app_test.dart` for both apps. This requires:

1. **Android device or emulator**
   - Physical device: USB connected, ADB enabled, USB debugging enabled
   - Emulator: Start an AVD before running the gate

2. **Single device**
   - When multiple devices are connected, `adb devices` will list them. Use `flutter devices` to see available targets. Flutter will pick the first device by default; to target a specific device, set `NEMYO_FLUTTER_DEVICE_ID` (see below).

3. **Flutter SDK**
   - `flutter` must be on PATH
   - Run `flutter doctor` to verify Android toolchain

## Running the Full Nemyo Gate

```bash
cd NeoXten-Automation-Framework
npm run gate

# Or with preset:
node dist/cli/index.js gate --preset nemyo
```

## Target a Specific Device

When multiple devices are connected:

```bash
# List devices
adb devices
flutter devices

# Set device ID for integration tests (optional)
# The gate uses this if set; otherwise Flutter picks first device
set NEMYO_FLUTTER_DEVICE_ID=emulator-5554
npm run gate
```

**Note:** The gate's `flutter_integration` step does not yet pass `-d` to `flutter test`. To add device targeting, extend the gate step with `deviceId` and use it in the command.

## Android CDP (WebView) Testing (Not Used for Nemyo)

The framework has an Android CDP driver for WebView-based apps (e.g. Neoxtemus). Nemyo's child and parent apps are Flutter; the child app uses WebView only for Explore screens. CDP is not used for Nemyo mobile flows.

## What Runs Where

| Component | Runner | Device Required |
|-----------|--------|-----------------|
| Web dashboard | Playwright (Next.js) | No |
| Extension | Playwright (Chromium + extension) | No |
| API endpoints | Playwright (fetch from page) | No |
| Child app widget tests | `flutter test` | No |
| Parent app widget tests | `flutter test` | No |
| Child app integration tests | `flutter test integration_test/` | Yes (device/emulator) |
| Parent app integration tests | `flutter test integration_test/` | Yes (device/emulator) |

## Skipping Integration Tests

If no device is available, use `--skip-integration` to skip the integration steps (they will be marked PASS/skip):

```bash
node dist/cli/index.js gate --preset nemyo --skip-integration
```

Or set `NEMYO_SKIP_INTEGRATION=1` (or `true`) before running.
