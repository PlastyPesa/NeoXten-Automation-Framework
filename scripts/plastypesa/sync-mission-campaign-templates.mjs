#!/usr/bin/env node
/** Sync NeoXten mission-campaign-templates.mjs from admin TS source. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tsPath = path.join(
  here,
  '../../../plastypesa-admin-dashboard/lib/frontend/src/data/missionCampaignTemplates.ts',
);
const src = fs.readFileSync(tsPath, 'utf8');
const start = src.indexOf('export const MISSION_CAMPAIGN_TEMPLATES');
const eq = src.indexOf('= [', start);
if (eq < 0) throw new Error('Could not find template array start');
const arrStart = eq + 2;
let depth = 0;
let arrEnd = -1;
for (let i = arrStart; i < src.length; i += 1) {
  if (src[i] === '[') depth += 1;
  if (src[i] === ']') {
    depth -= 1;
    if (depth === 0) {
      arrEnd = i;
      break;
    }
  }
}
const raw = src.slice(arrStart + 1, arrEnd).replace(/\r\n/g, '\n');
const blockRe =
  /\{\s*\n\s*id:\s*"([^"]+)"[\s\S]*?category:\s*"([^"]+)"[\s\S]*?week:\s*(\d+)[\s\S]*?day:\s*(\d+)[\s\S]*?audience:\s*"([^"]+)"[\s\S]*?title:\s*"([^"]+)"[\s\S]*?message:\s*\n+\s*"([\s\S]*?)"\s*,?\s*\n\s*\}/g;
const items = [];
for (const m of raw.matchAll(blockRe)) {
  items.push({
    id: m[1],
    category: m[2],
    week: Number(m[3]),
    day: Number(m[4]),
    audience: m[5],
    title: m[6],
    message: m[7],
  });
}
if (items.length !== 35) {
  throw new Error(`Expected 35 templates, got ${items.length}`);
}
const body = items
  .map(
    (t) => `  ${JSON.stringify(t.id)}: {
    id: ${JSON.stringify(t.id)},
    category: ${JSON.stringify(t.category)},
    audience: ${JSON.stringify(t.audience)},
    title: ${JSON.stringify(t.title)},
    message: ${JSON.stringify(t.message)},
  },`,
  )
  .join('\n');
const out = `/**
 * Mission Campaign — pre-built announcement templates (Phase 6).
 * Auto-synced from admin missionCampaignTemplates.ts (${items.length} templates).
 */
export const MISSION_CAMPAIGN_TEMPLATES = {
${body}
};
`;
const outPath = path.join(here, 'mission-campaign-templates.mjs');
fs.writeFileSync(outPath, out, 'utf8');
console.log(`Synced ${items.length} templates → ${outPath}`);
