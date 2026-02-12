import { randomUUID } from 'node:crypto';

export function generateRunId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12);
}
