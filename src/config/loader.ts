import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import yaml from 'js-yaml';
import { NeoxtenConfigSchema, type NeoxtenConfig } from './schema.js';

export function loadConfig(configPath: string): NeoxtenConfig {
  const resolved = resolve(process.cwd(), configPath);
  if (!existsSync(resolved)) {
    throw new Error(`Config file not found: ${resolved}`);
  }
  const raw = readFileSync(resolved, 'utf-8');
  const parsed = yaml.load(raw) as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Config file is empty or invalid');
  }
  const result = NeoxtenConfigSchema.safeParse(parsed);
  if (!result.success) {
    const msg = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    throw new Error(`Invalid neoxten config: ${msg}`);
  }
  return result.data;
}
