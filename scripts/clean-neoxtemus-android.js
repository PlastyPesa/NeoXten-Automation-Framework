/**
 * Clear Neoxtemus Android app data for deterministic test runs.
 * Run before neoxtemus-android automation to force onboarding flow.
 */
import { execSync } from 'child_process';

const PKG = 'com.neoxtemus.app';

try {
  execSync(`adb shell am force-stop ${PKG}`, { stdio: 'ignore', timeout: 5000 });
} catch {
  /* ignore */
}
execSync(`adb shell pm clear ${PKG}`, { stdio: 'inherit', timeout: 10000 });
