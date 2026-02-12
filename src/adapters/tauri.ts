import { resolve } from 'path';
import { PlaywrightWebDriver } from '../drivers/playwright-web.js';
import { TauriCDPDriver } from '../drivers/tauri-cdp.js';
import { TauriHarnessDriver } from '../drivers/tauri-harness.js';
import type { UIDriver } from '../drivers/base.js';
import type { NeoxtenConfig } from '../config/schema.js';
import type { ProjectAdapter } from './base.js';

export class TauriAdapter implements ProjectAdapter {
  getProjectRoot(config: NeoxtenConfig): string {
    if (config.project.type !== 'tauri') throw new Error('Not a Tauri project');
    return resolve(process.cwd(), config.project.root);
  }

  createDriver(config: NeoxtenConfig): UIDriver {
    if (config.project.type !== 'tauri') throw new Error('Not a Tauri project');
    const root = this.getProjectRoot(config);
    const tauri = config.project.tauri ?? { strategy: 'harness' as const, devUrl: 'http://localhost:1420', devCommand: 'npm run tauri:dev', cdpPort: 9222 };

    const strategy = tauri.strategy ?? 'harness';
    const devUrl = tauri.devUrl ?? 'http://localhost:1420';
    const devCommand = tauri.devCommand ?? 'npm run tauri:dev';
    const devCwd = tauri.devCwd ? resolve(root, tauri.devCwd) : undefined;

    if (strategy === 'harness') {
      return new TauriHarnessDriver({
        projectRoot: root,
        devCommand,
        devCwd: devCwd ?? undefined,
        devUrl,
      });
    }

    if (strategy === 'cdp') {
      return new TauriCDPDriver({
        projectRoot: root,
        devCommand,
        devCwd: devCwd ?? resolve(root, 'ui'),
        devUrl,
        cdpPort: tauri.cdpPort ?? 9222,
      });
    }

    throw new Error(`Unsupported Tauri strategy: ${strategy}. Use harness or cdp.`);
  }
}
