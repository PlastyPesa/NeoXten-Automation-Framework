#!/usr/bin/env node
/**
 * Neoxtemus: test everything, then build APK and AAB only if tests pass.
 *
 * 1. Runs the Neoxtemus gate (boot, nav, vault-test, cargo, artifact policy).
 * 2. If PASS, builds Android APK and AAB from neoxtemus-app.
 *
 * Prerequisite for UI tests: start the dev server in neoxtemus-app first so port 1420 is up:
 *   cd ../neoxtemus/neoxtemus-app && npm run dev
 * Then run this script from the framework root:
 *   node scripts/neoxtemus-test-then-build.js
 *
 * Outputs:
 *   - Gate report: .neoxten-out/gate/
 *   - APK: neoxtemus-app/src-tauri/gen/android/app/build/outputs/apk/universal/release/
 *   - AAB: neoxtemus-app/src-tauri/gen/android/app/build/outputs/bundle/universalRelease/
 */
import { spawn } from 'child_process';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const frameworkRoot = resolve(__dirname, '..');
const neoxtemusAppRoot = resolve(frameworkRoot, '../neoxtemus/neoxtemus-app');

function run(cmd, args, cwd, description) {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(cmd, args, {
      cwd: cwd || frameworkRoot,
      stdio: 'inherit',
      shell: true,
    });
    proc.on('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${description} exited with ${code}`));
    });
    proc.on('error', (err) => reject(err));
  });
}

async function main() {
  console.log('\n  Neoxtemus: test then build (APK + AAB)\n');
  console.log('  Step 1: Running gate (neoxtemus preset)...\n');

  try {
    await run(
      'node',
      ['dist/cli/index.js', 'gate', '--preset', 'neoxtemus', '--out-dir', '.neoxten-out'],
      frameworkRoot,
      'Gate'
    );
  } catch (e) {
    console.error('\n  Gate FAILED. Not building. Fix tests first.\n');
    process.exit(1);
  }

  if (!existsSync(neoxtemusAppRoot)) {
    console.error(`\n  neoxtemus-app not found at ${neoxtemusAppRoot}\n`);
    process.exit(2);
  }

  console.log('\n  Step 2: Building Android APK...\n');
  try {
    await run('npm', ['run', 'tauri', 'android', 'build', '--', '--apk'], neoxtemusAppRoot, 'APK build');
  } catch (e) {
    console.error('\n  APK build failed.\n');
    process.exit(3);
  }

  console.log('\n  Step 3: Building Android AAB...\n');
  try {
    await run('npm', ['run', 'tauri', 'android', 'build', '--', '--aab'], neoxtemusAppRoot, 'AAB build');
  } catch (e) {
    console.error('\n  AAB build failed.\n');
    process.exit(4);
  }

  const apkDir = join(neoxtemusAppRoot, 'src-tauri/gen/android/app/build/outputs/apk/universal/release');
  const aabDir = join(neoxtemusAppRoot, 'src-tauri/gen/android/app/build/outputs/bundle/universalRelease');
  console.log('\n  -- All passed. Artifacts --');
  console.log('  Gate report: .neoxten-out/gate/');
  console.log('  APK:        ' + apkDir);
  console.log('  AAB:        ' + aabDir);
  console.log('');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(process.exitCode || 1);
});
