#!/usr/bin/env node
import { resolve } from 'node:path';
import { buildSurfaceInventory } from './surfaces.mjs';
import { getLocalizationOutDir, writeJson, writeText } from './config.mjs';

function toMarkdown(inventory) {
  const lines = [
    '# PlastyPesa Localization Surface Map',
    '',
    `Generated: ${inventory.generatedAt}`,
    '',
    '## Roots',
    ...Object.entries(inventory.roots).flatMap(([id, meta]) => [
      `- \`${id}\`: \`${meta.path}\``,
      `  Purpose: ${meta.purpose}`,
    ]),
    '',
    '## Web',
    `- Supported languages: ${inventory.web.supportedLanguages.join(', ')}`,
    ...inventory.web.translationSources.map((path) => `- Translation source: \`${path}\``),
    '- Public routes:',
    ...inventory.web.routes.map(
      (route) =>
        `  - \`${route.id}\` -> \`${route.path}\` (${route.localized ? 'localized' : 'default-only'}; ${route.coverage})`,
    ),
    '- Surfaces:',
    ...inventory.web.surfaces.flatMap((surface) => [
      `  - \`${surface.id}\` -> \`${surface.path}\``,
      `    Components: ${surface.components.join(', ')}`,
    ]),
    ...inventory.web.notes.map((note) => `- Note: ${note}`),
    '',
    '## Mobile',
    `- Supported locales: ${inventory.mobile.supportedLocales.join(', ')}`,
    ...inventory.mobile.translationSources.map((path) => `- Translation source: \`${path}\``),
    '- Shell screens:',
    ...inventory.mobile.shellScreens.map(
      (screen) => `  - \`${screen.id}\` -> \`${screen.path}\` (entry: ${screen.entry})`,
    ),
    '- High-risk detail screens:',
    ...inventory.mobile.highRiskDetailScreens.map((path) => `  - \`${path}\``),
    '- API-driven content:',
    ...inventory.mobile.apiDrivenContent.map(
      (item) => `  - \`${item.route}\`: ${item.note}`,
    ),
    ...inventory.mobile.notes.map((note) => `- Note: ${note}`),
    '',
    '## Recommended Fix Order',
    ...inventory.remediationOrder.map((step, index) => `${index + 1}. ${step}`),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

const inventory = buildSurfaceInventory();
const outDir = getLocalizationOutDir();

writeJson(resolve(outDir, 'surface-map.json'), inventory);
writeText(resolve(outDir, 'surface-map.md'), toMarkdown(inventory));

console.log(`[plastypesa-localization] Surface map written to ${outDir}`);
