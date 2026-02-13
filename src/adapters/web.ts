import { PlaywrightWebDriver } from '../drivers/playwright-web.js';
import { resolveProjectRoot } from '../utils/config-paths.js';
import type { UIDriver } from '../drivers/base.js';
import type { NeoxtenConfig } from '../config/schema.js';
import type { ProjectAdapter } from './base.js';

export class WebAdapter implements ProjectAdapter {
  getProjectRoot(config: NeoxtenConfig, configPath: string): string {
    if (config.project.type !== 'web') throw new Error('Not a web project');
    return resolveProjectRoot(configPath, config.project.root);
  }

  createDriver(config: NeoxtenConfig, configPath: string): UIDriver {
    if (config.project.type !== 'web') throw new Error('Not a web project');
    const url = config.project.web?.url ?? 'https://example.com';
    return new PlaywrightWebDriver({ url, headless: true });
  }
}
