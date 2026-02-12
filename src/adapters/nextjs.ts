import { resolve } from 'path';
import { NextJsHarnessDriver } from '../drivers/nextjs-harness.js';
import type { UIDriver } from '../drivers/base.js';
import type { NeoxtenConfig } from '../config/schema.js';
import type { ProjectAdapter } from './base.js';

export class NextJsAdapter implements ProjectAdapter {
  getProjectRoot(config: NeoxtenConfig): string {
    if (config.project.type !== 'nextjs') throw new Error('Not a Next.js project');
    return resolve(process.cwd(), config.project.root);
  }

  createDriver(config: NeoxtenConfig): UIDriver {
    if (config.project.type !== 'nextjs') throw new Error('Not a Next.js project');
    const root = this.getProjectRoot(config);
    const nextjs = config.project.nextjs ?? { script: 'npm run dev', url: 'http://localhost:3000', cwd: undefined };
    const script = nextjs.script ?? 'npm run dev';
    const url = nextjs.url ?? 'http://localhost:3000';
    const cwd = nextjs.cwd ? resolve(root, nextjs.cwd) : root;

    return new NextJsHarnessDriver({
      projectRoot: root,
      devCommand: script,
      devCwd: cwd,
      devUrl: url,
    });
  }
}
