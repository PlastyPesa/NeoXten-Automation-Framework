import type { UIDriver } from '../drivers/base.js';
import type { NeoxtenConfig } from '../config/schema.js';

export interface ProjectAdapter {
  createDriver(config: NeoxtenConfig, configPath: string): UIDriver;
  getProjectRoot(config: NeoxtenConfig, configPath: string): string;
}

export interface AdapterFactory {
  (config: NeoxtenConfig): ProjectAdapter;
}
