import { writeFileSync, unlinkSync, readFileSync, existsSync } from 'fs';
import type { ProductPathSnapshot } from './product-paths.js';

export interface ServiceLock {
  port: number;
  host: string;
  pid: number;
  startedAt: string;
  operatorHome: string;
}

export function writeServiceLock(paths: ProductPathSnapshot, port: number, host: string): void {
  const lock: ServiceLock = {
    port,
    host,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    operatorHome: paths.operatorHome,
  };
  writeFileSync(paths.serviceLockPath, JSON.stringify(lock, null, 2), 'utf-8');
}

export function clearServiceLock(paths: ProductPathSnapshot): void {
  try {
    if (existsSync(paths.serviceLockPath)) {
      unlinkSync(paths.serviceLockPath);
    }
  } catch {
    /* ignore */
  }
}

export function readServiceLock(paths: ProductPathSnapshot): ServiceLock | null {
  if (!existsSync(paths.serviceLockPath)) return null;
  try {
    return JSON.parse(readFileSync(paths.serviceLockPath, 'utf-8')) as ServiceLock;
  } catch {
    return null;
  }
}
