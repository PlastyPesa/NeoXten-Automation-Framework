import { resolve, dirname } from 'path';

/**
 * Resolve project.root relative to the config file location (not cwd).
 * absConfigPath = resolve(process.cwd(), configPathArg)
 * configDir = dirname(absConfigPath)
 * projectRootAbs = resolve(configDir, project.root || '.')
 */
export function resolveProjectRoot(configPath: string, projectRootFromConfig: string = '.'): string {
  const absConfigPath = resolve(process.cwd(), configPath);
  const configDir = dirname(absConfigPath);
  return resolve(configDir, projectRootFromConfig || '.');
}
