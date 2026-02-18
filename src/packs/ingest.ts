/**
 * Ingest Evidence Pack: validate, redact, create case, write outputs.
 */
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { v4 as uuidv4 } from 'uuid';
import {
  evidencePacksRoot,
  quarantineDir,
  casesDir,
  packsStatePath,
  ensureDir,
} from './paths.js';
import { validatePack, type PackMeta } from './validate.js';
import { loadRedactionRules, redactString, redactNdjson, redactJson } from './redact.js';

const REQUIRED = ['meta.json', 'events.ndjson', 'errors.json', 'logs.ndjson', 'network.ndjson', 'ui.json'] as const;
const SPECS_DIR = path.resolve(process.cwd(), 'specs');

export interface IngestResult {
  success: boolean;
  caseId?: string;
  casePath?: string;
  reason?: string;
  quarantinedPath?: string;
}

function shortId(): string {
  return uuidv4().slice(0, 8);
}

function readFromZip(zip: AdmZip, name: string): string | null {
  const entry = zip.getEntry(name);
  if (!entry || entry.isDirectory) return null;
  const buf = zip.readFile(entry);
  return buf ? buf.toString('utf8') : null;
}

function readFromFolder(dir: string, name: string): string | null {
  const p = path.join(dir, name);
  if (fs.existsSync(p) && fs.statSync(p).isFile()) {
    return fs.readFileSync(p, 'utf8');
  }
  return null;
}

function lastError(errors: unknown[]): string {
  if (!Array.isArray(errors) || errors.length === 0) return '';
  const last = errors[errors.length - 1];
  if (last && typeof last === 'object' && 'message' in last) return String((last as { message: unknown }).message);
  return String(last);
}

function topN<T>(arr: T[], n: number): T[] {
  return arr.slice(0, n);
}

function parseNdjson(content: string): unknown[] {
  return content
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (!t) return null;
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return null;
      }
    })
    .filter((x): x is unknown => x !== null);
}

export function ingestZip(zipPath: string, cwd: string = process.cwd()): IngestResult {
  const zip = new AdmZip(zipPath);
  const readFile = (name: string) => readFromZip(zip, name);
  const validation = validatePack(readFile);
  if (!validation.valid || !validation.meta) {
    const qDir = quarantineDir();
    ensureDir(qDir);
    const base = path.basename(zipPath, path.extname(zipPath)) + '_' + Date.now();
    const dest = path.join(qDir, base + '.zip');
    fs.copyFileSync(zipPath, dest);
    fs.writeFileSync(path.join(qDir, base + '_reason.txt'), validation.reason ?? 'Validation failed', 'utf8');
    return { success: false, reason: validation.reason, quarantinedPath: dest };
  }
  const meta = validation.meta;
  const rules = loadRedactionRules(SPECS_DIR);
  const now = new Date();
  const ts = now.toISOString().replace(/[-:]/g, '').slice(0, 15); // YYYYMMDDTHHMMSS
  const caseId = `BUG-${ts}-${meta.app_id}-${shortId()}`;
  const casePath = path.join(casesDir(cwd), caseId);
  ensureDir(casePath);
  const outputDir = path.join(casePath, 'output');
  ensureDir(outputDir);

  const raw = {
    meta: readFile('meta.json')!,
    events: readFile('events.ndjson')!,
    errors: readFile('errors.json')!,
    logs: readFile('logs.ndjson')!,
    network: readFile('network.ndjson')!,
    ui: readFile('ui.json')!,
  };

  const events = parseNdjson(raw.events);
  const logs = parseNdjson(raw.logs);
  const network = parseNdjson(raw.network);
  let errorsArr: unknown[] = [];
  try {
    errorsArr = JSON.parse(raw.errors) as unknown[];
    if (!Array.isArray(errorsArr)) errorsArr = [];
  } catch {
    errorsArr = [];
  }

  const redacted = {
    events: redactNdjson(raw.events, rules),
    logs: redactNdjson(raw.logs, rules),
    errors: redactJson(raw.errors, rules),
    network: redactNdjson(raw.network, rules),
  };

  const lastErr = lastError(errorsArr);
  const signals = {
    app_id: meta.app_id,
    pack_id: meta.pack_id,
    screen: meta.screen ?? '',
    last_error: lastErr,
    event_count: events.length,
    log_count: logs.length,
    network_count: network.length,
  };

  const eventsExcerpt = redacted.events.split('\n').filter((l) => l.trim()).slice(0, 10).join('\n');
  const logsExcerpt = redacted.logs.split('\n').filter((l) => l.trim()).slice(0, 10).join('\n');
  const networkExcerpt = redacted.network.split('\n').filter((l) => l.trim()).slice(0, 10).join('\n');
  const bugReportMd = [
    `# Bug Report: ${caseId}`,
    ``,
    `- **app_id:** ${meta.app_id}`,
    `- **screen:** ${meta.screen ?? '—'}`,
    `- **last_error:** ${lastErr || '—'}`,
    ``,
    `## Top 10 events`,
    '```ndjson',
    eventsExcerpt,
    '```',
    ``,
    `## Top 10 logs`,
    '```ndjson',
    logsExcerpt,
    '```',
    ``,
    `## Top 10 network`,
    '```ndjson',
    networkExcerpt,
    '```',
  ].join('\n');

  const agentPromptMd = [
    `# Mission: Reproduce evidence pack ${meta.pack_id}`,
    ``,
    `- **Case:** ${caseId}`,
    `- **App:** ${meta.app_id}`,
    `- **Screen:** ${meta.screen ?? 'unknown'}`,
    ``,
    `## Hints`,
    `1. Last error: ${lastErr || 'none'}`,
    `2. Inspect: output/signals.json, output/bug_report.md`,
    `3. Events/logs/network (redacted) are in bug_report.md.`,
  ].join('\n');

  fs.writeFileSync(path.join(outputDir, 'bug_report.md'), bugReportMd, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'agent_prompt.md'), agentPromptMd, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'signals.json'), JSON.stringify(signals, null, 2), 'utf8');
  fs.writeFileSync(path.join(outputDir, 'events_excerpt.ndjson'), redacted.events.split('\n').slice(0, 20).join('\n'), 'utf8');
  fs.writeFileSync(path.join(outputDir, 'logs_excerpt.ndjson'), redacted.logs.split('\n').slice(0, 20).join('\n'), 'utf8');

  const attachmentsInZip = zip.getEntries().filter((e: { isDirectory: boolean; entryName: string }) => !e.isDirectory && e.entryName.startsWith('attachments/'));
  if (attachmentsInZip.length > 0) {
    const outAttachments = path.join(outputDir, 'attachments');
    ensureDir(outAttachments);
    for (const entry of attachmentsInZip) {
      const name = entry.entryName.replace(/^attachments\//, '');
      if (!name) continue;
      const buf = zip.readFile(entry);
      if (buf) fs.writeFileSync(path.join(outAttachments, path.basename(name)), buf);
    }
  }

  const statePath = packsStatePath(cwd);
  ensureDir(path.dirname(statePath));
  let state: Record<string, string> = {};
  if (fs.existsSync(statePath)) {
    try {
      state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Record<string, string>;
    } catch {}
  }
  state[meta.pack_id!] = caseId;
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');

  return { success: true, caseId, casePath };
}

export function ingestFolder(folderPath: string, cwd: string = process.cwd()): IngestResult {
  const readFile = (name: string) => readFromFolder(folderPath, name);
  const validation = validatePack(readFile);
  if (!validation.valid || !validation.meta) {
    return { success: false, reason: validation.reason };
  }
  const meta = validation.meta;
  const rules = loadRedactionRules(SPECS_DIR);
  const ts = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const caseId = `BUG-${ts}-${meta.app_id}-${shortId()}`;
  const casePath = path.join(casesDir(cwd), caseId);
  ensureDir(casePath);
  const outputDir = path.join(casePath, 'output');
  ensureDir(outputDir);

  const raw = {
    meta: readFile('meta.json')!,
    events: readFile('events.ndjson')!,
    errors: readFile('errors.json')!,
    logs: readFile('logs.ndjson')!,
    network: readFile('network.ndjson')!,
    ui: readFile('ui.json')!,
  };

  const events = parseNdjson(raw.events);
  const logs = parseNdjson(raw.logs);
  const network = parseNdjson(raw.network);
  let errorsArr: unknown[] = [];
  try {
    errorsArr = JSON.parse(raw.errors) as unknown[];
    if (!Array.isArray(errorsArr)) errorsArr = [];
  } catch {
    errorsArr = [];
  }

  const redacted = {
    events: redactNdjson(raw.events, rules),
    logs: redactNdjson(raw.logs, rules),
    errors: redactJson(raw.errors, rules),
    network: redactNdjson(raw.network, rules),
  };

  const lastErr = lastError(errorsArr);
  const signals = {
    app_id: meta.app_id,
    pack_id: meta.pack_id,
    screen: meta.screen ?? '',
    last_error: lastErr,
    event_count: events.length,
    log_count: logs.length,
    network_count: network.length,
  };

  const eventsExcerptF = redacted.events.split('\n').filter((l) => l.trim()).slice(0, 10).join('\n');
  const logsExcerptF = redacted.logs.split('\n').filter((l) => l.trim()).slice(0, 10).join('\n');
  const networkExcerptF = redacted.network.split('\n').filter((l) => l.trim()).slice(0, 10).join('\n');
  const bugReportMd = [
    `# Bug Report: ${caseId}`,
    `- **app_id:** ${meta.app_id}`,
    `- **screen:** ${meta.screen ?? '—'}`,
    `- **last_error:** ${lastErr || '—'}`,
    `## Top 10 events`,
    eventsExcerptF,
    `## Top 10 logs`,
    logsExcerptF,
    `## Top 10 network`,
    networkExcerptF,
  ].join('\n\n');

  const agentPromptMd = [
    `# Mission: Reproduce ${meta.pack_id}`,
    `Case: ${caseId} | App: ${meta.app_id} | Screen: ${meta.screen ?? 'unknown'}`,
    `Last error: ${lastErr || 'none'}. Inspect output/signals.json, bug_report.md.`,
  ].join('\n\n');

  fs.writeFileSync(path.join(outputDir, 'bug_report.md'), bugReportMd, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'agent_prompt.md'), agentPromptMd, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'signals.json'), JSON.stringify(signals, null, 2), 'utf8');
  fs.writeFileSync(path.join(outputDir, 'events_excerpt.ndjson'), redacted.events.split('\n').slice(0, 20).join('\n'), 'utf8');
  fs.writeFileSync(path.join(outputDir, 'logs_excerpt.ndjson'), redacted.logs.split('\n').slice(0, 20).join('\n'), 'utf8');

  const attachSrc = path.join(folderPath, 'attachments');
  if (fs.existsSync(attachSrc) && fs.statSync(attachSrc).isDirectory()) {
    const outAttachments = path.join(outputDir, 'attachments');
    ensureDir(outAttachments);
    for (const name of fs.readdirSync(attachSrc)) {
      const src = path.join(attachSrc, name);
      if (fs.statSync(src).isFile()) {
        fs.copyFileSync(src, path.join(outAttachments, name));
      }
    }
  }

  const statePath = packsStatePath(cwd);
  ensureDir(path.dirname(statePath));
  let state: Record<string, string> = {};
  if (fs.existsSync(statePath)) {
    try {
      state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Record<string, string>;
    } catch {}
  }
  state[meta.pack_id!] = caseId;
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');

  return { success: true, caseId, casePath };
}
