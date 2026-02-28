import { resolve, dirname } from 'path';
import { AndroidCDPDriver } from '../drivers/android-cdp.js';
import type { UIDriver } from '../drivers/base.js';
import type { NeoxtenConfig } from '../config/schema.js';
import type { ProjectAdapter } from './base.js';

export class AndroidAdapter implements ProjectAdapter {
  getProjectRoot(config: NeoxtenConfig, configPath: string): string {
    if (config.project.type !== 'android') throw new Error('Not an Android project');
    return resolve(dirname(resolve(process.cwd(), configPath)), config.project.root);
  }

  createDriver(config: NeoxtenConfig, configPath: string): UIDriver {
    if (config.project.type !== 'android') throw new Error('Not an Android project');
    const android = config.project.android;
    const configDir = dirname(resolve(process.cwd(), configPath));
    const apkPath = resolve(configDir, android.apkPath);
    return new AndroidCDPDriver({
      apkPath,
      avd: android.avd,
      cdpPort: android.cdpPort,
      package: android.package,
      activity: android.activity,
      emulatorBootTimeoutMs: android.emulatorBootTimeoutMs,
    });
  }
}
