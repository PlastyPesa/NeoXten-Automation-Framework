import type { UIDriver } from '../drivers/base.js';
import type { NeoxtenConfig } from '../config/schema.js';

export interface ProjectAdapter {
  createDriver(config: NeoxtenConfig): UIDriver;
  getProjectRoot(config: NeoxtenConfig): string;
}

export interface AdapterFactory {
  (config: NeoxtenConfig): ProjectAdapter;
}
