import { resolve } from 'path';
import { openOperatorDb } from '../../operator/db/client.js';
import { getOperatorHome } from '../../operator/paths.js';
import {
  ingestRunManifest,
  parseManifestFromPath,
} from '../../operator/ingest/service.js';
import { startOperatorApi } from '../../operator/api/server.js';
import { loadAppConfig } from '../../runtime/app-config.js';
import { resolveOperatorPort } from '../../runtime/port-resolver.js';

export async function operatorIngestCommand(opts: {
  runDir: string;
  home?: string;
  archive?: boolean;
  project?: string;
}) {
  const operatorHome = opts.home ? resolve(opts.home) : getOperatorHome();
  const { db } = openOperatorDb(operatorHome);
  const runDir = resolve(opts.runDir);
  const manifest = parseManifestFromPath(runDir);
  const result = ingestRunManifest(db, manifest, runDir, {
    operatorHome,
    archiveBlobs: Boolean(opts.archive),
    projectSlug: opts.project,
  });
  console.log(
    JSON.stringify({
      ok: true,
      runDbId: result.runDbId,
      issueId: result.issueId ?? null,
      neoxtenRunId: manifest.runId,
    }),
  );
}

export async function operatorServeCommand(opts: {
  port?: string;
  host?: string;
  home?: string;
  noLock?: boolean;
}) {
  const operatorHome = opts.home ? resolve(opts.home) : getOperatorHome();
  const host = opts.host ?? process.env.NEOXTEN_OPERATOR_HOST ?? '127.0.0.1';

  const explicit = opts.port ?? process.env.NEOXTEN_OPERATOR_PORT;
  let port: number;
  if (explicit !== undefined && String(explicit).trim() !== '') {
    port = parseInt(String(explicit), 10);
    if (!Number.isFinite(port)) {
      throw new Error(`Invalid port: ${explicit}`);
    }
  } else {
    const cfg = loadAppConfig();
    const r = await resolveOperatorPort(cfg);
    port = r.port;
  }

  await startOperatorApi({
    operatorHome,
    host,
    port,
    manageServiceLock: !opts.noLock,
  });
}
