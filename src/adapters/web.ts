import { resolve } from 'path';
import { PlaywrightWebDriver } from '../drivers/playwright-web.js';
import type { UIDriver } from '../drivers/base.js';
import type { NeoxtenConfig } from '../config/schema.js';
import type { ProjectAdapter } from './base.js';

export class WebAdapter implements ProjectAdapter {
  getProjectRoot(config: NeoxtenConfig): string {
    if (config.project.type !== 'web') throw new Error('Not a web project');
    return resolve(process.cwd(), config.project.root);
  }

  createDriver(config: NeoxtenConfig): UIDriver {
    if (config.project.type !== 'web') throw new Error('Not a web project');
    const url = config.project.web?.url ?? 'https://example.com';
    return new PlaywrightWebDriver({ url, headless: true });
  }
}
