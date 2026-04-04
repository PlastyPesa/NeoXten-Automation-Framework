import net from 'node:net';
import { loadAppConfig, saveAppConfig, type AppConfig } from './app-config.js';

function tryListen(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, host, () => {
      s.close(() => resolve(true));
    });
  });
}

/**
 * Find a free TCP port starting at cfg.operatorPort, up to +range attempts.
 */
export async function resolveOperatorPort(
  cfg: AppConfig,
  range = 24,
): Promise<{ port: number; configUpdated: boolean }> {
  const host = cfg.operatorHost || '127.0.0.1';
  let configUpdated = false;
  let next = { ...cfg };

  for (let i = 0; i < range; i++) {
    const port = cfg.operatorPort + i;
    if (await tryListen(port, host)) {
      if (port !== cfg.operatorPort) {
        next = { ...cfg, operatorPort: port, lastBoundPort: port };
        saveAppConfig(next);
        configUpdated = true;
      }
      return { port, configUpdated };
    }
  }

  throw new Error(
    `No free operator port in range ${cfg.operatorPort}..${cfg.operatorPort + range - 1} on ${host}`,
  );
}

/** Re-export for CLI convenience */
export { loadAppConfig, saveAppConfig };
