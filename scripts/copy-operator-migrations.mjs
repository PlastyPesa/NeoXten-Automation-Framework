import { cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src', 'operator', 'db', 'migrations');
const dest = join(root, 'dist', 'operator', 'db', 'migrations');
if (!existsSync(src)) {
  console.warn('copy-operator-migrations: no src migrations dir');
  process.exit(0);
}
cpSync(src, dest, { recursive: true });
console.log('copy-operator-migrations: ok');
