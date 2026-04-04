import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import * as schema from './schema.js';
import { workspaces, projects } from './schema.js';
import { getOperatorHome } from '../paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type OperatorDb = ReturnType<typeof drizzle<typeof schema>>;

let cached: { db: OperatorDb; sqlite: Database.Database } | null = null;

export function openOperatorDb(operatorHome?: string): {
  db: OperatorDb;
  sqlite: Database.Database;
} {
  const home = operatorHome ?? getOperatorHome();
  if (cached && operatorHome === undefined) {
    return cached;
  }

  mkdirSync(home, { recursive: true });
  const dbPath = join(home, 'operator.sqlite');
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  const db = drizzle(sqlite, { schema });

  migrate(db, { migrationsFolder: join(__dirname, 'migrations') });

  const ws = ensureDefaultWorkspace(db);
  seedDefaultProjectsIfEmpty(db, ws);

  if (operatorHome === undefined) {
    cached = { db, sqlite };
  }
  return { db, sqlite };
}

function ensureDefaultWorkspace(db: OperatorDb): string {
  const rows = db.select().from(workspaces).limit(1).all();
  if (rows.length > 0) {
    return rows[0]!.id;
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(workspaces)
    .values({ id, name: 'default', createdAt: now })
    .run();
  return id;
}

/** Placeholder registry rows — operator edits `repoRoot` in DB or via API later. */
function seedDefaultProjectsIfEmpty(db: OperatorDb, workspaceId: string): void {
  const n = db.select().from(projects).where(eq(projects.workspaceId, workspaceId)).all().length;
  if (n > 0) return;
  const now = new Date().toISOString();
  const seeds: Array<{ slug: string; displayName: string; repoRoot: string; adapters: string[] }> = [
    { slug: 'neoxtemus', displayName: 'Neoxtemus', repoRoot: '../neoxtemus', adapters: ['tauri'] },
    { slug: 'nemyo', displayName: 'Nemyo', repoRoot: '../kidguard-mobile-app', adapters: ['flutter', 'extension'] },
    { slug: 'plastypesa', displayName: 'PlastyPesa', repoRoot: '../plastypesa', adapters: ['web', 'api'] },
  ];
  for (const s of seeds) {
    db.insert(projects)
      .values({
        id: randomUUID(),
        workspaceId,
        slug: s.slug,
        displayName: s.displayName,
        repoRoot: s.repoRoot,
        adapterTypes: JSON.stringify(s.adapters),
        createdAt: now,
      })
      .run();
  }
}

export function getDefaultWorkspaceId(db: OperatorDb): string {
  const rows = db.select().from(workspaces).where(eq(workspaces.name, 'default')).limit(1).all();
  if (rows.length > 0) return rows[0]!.id;
  const anyWs = db.select().from(workspaces).limit(1).all();
  if (anyWs.length > 0) return anyWs[0]!.id;
  return ensureDefaultWorkspace(db);
}
