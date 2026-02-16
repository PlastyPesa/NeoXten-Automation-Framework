import { resolve } from 'path';
import { ExtensionDriver } from '../drivers/extension-driver.js';
import { resolveProjectRoot } from '../utils/config-paths.js';
import type { UIDriver } from '../drivers/base.js';
import type { NeoxtenConfig } from '../config/schema.js';
import type { ProjectAdapter } from './base.js';

export class ExtensionAdapter implements ProjectAdapter {
  getProjectRoot(config: NeoxtenConfig, configPath: string): string {
    if (config.project.type !== 'extension') throw new Error('Not an extension project');
    return resolveProjectRoot(configPath, config.project.root);
  }

  createDriver(config: NeoxtenConfig, configPath: string): UIDriver {
    if (config.project.type !== 'extension') throw new Error('Not an extension project');
    const root = this.getProjectRoot(config, configPath);
    const ext = config.project.extension;
    const extPath = ext?.path ? resolve(root, ext.path) : root;

    return new ExtensionDriver({
      extensionPath: extPath,
      headless: false, // Extensions require headed mode
    });
  }
}
