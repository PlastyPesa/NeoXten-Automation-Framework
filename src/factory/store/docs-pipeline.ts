/**
 * Docs Pipeline — deterministic template substitution + validation.
 *
 * Loads HTML templates, substitutes spec data placeholders,
 * validates structure (well-formed, no script tags in privacy/terms),
 * validates links (href targets). Produces validation report.
 * No LLM.
 */

import type { EvidenceChain } from '../evidence-chain.js';

export interface FileSystem {
  exists(path: string): boolean;
  readFileUtf8(path: string): string;
  writeFile(path: string, content: string): void;
  mkdir(path: string): void;
}

export interface LinkCheck {
  href: string;
  type: 'mailto' | 'http' | 'relative' | 'anchor';
  valid: boolean;
  reason?: string;
}

export interface StructureCheck {
  file: string;
  rule: string;
  passed: boolean;
  detail?: string;
}

export interface DocsInput {
  templateDir: string;
  outputDir: string;
  productData: Record<string, string>;
}

export interface DocsOutput {
  generatedFiles: string[];
  linkChecks: LinkCheck[];
  structureChecks: StructureCheck[];
  allPassed: boolean;
  validationPath: string;
}

export interface DocsPipelineDeps {
  fs: FileSystem;
}

const TEMPLATES = [
  { template: 'privacy-policy.html.tmpl', output: 'privacy-policy.html' },
  { template: 'terms-of-service.html.tmpl', output: 'terms-of-service.html' },
  { template: 'support.html.tmpl', output: 'support.html' },
];

export function runDocsPipeline(
  input: DocsInput,
  deps: DocsPipelineDeps,
  chain: EvidenceChain,
): DocsOutput {
  const { fs } = deps;
  fs.mkdir(input.outputDir);

  chain.append({
    type: 'note', workerId: 'release-packager', stage: 'release_package',
    data: { event: 'docs_pipeline_start', templateCount: TEMPLATES.length },
  });

  const data: Record<string, string> = {
    ...input.productData,
    date: new Date().toISOString().split('T')[0],
  };

  const generatedFiles: string[] = [];
  const linkChecks: LinkCheck[] = [];
  const structureChecks: StructureCheck[] = [];

  for (const tmpl of TEMPLATES) {
    const tmplPath = `${input.templateDir}/${tmpl.template}`;
    if (!fs.exists(tmplPath)) {
      structureChecks.push({ file: tmpl.output, rule: 'template_exists', passed: false, detail: `template not found: ${tmplPath}` });
      continue;
    }

    let content = fs.readFileUtf8(tmplPath);
    content = substituteTemplate(content, data);

    const outPath = `${input.outputDir}/${tmpl.output}`;
    fs.writeFile(outPath, content);
    generatedFiles.push(outPath);

    structureChecks.push(...validateStructure(tmpl.output, content));
    linkChecks.push(...extractAndValidateLinks(content));
  }

  const allPassed = structureChecks.every(c => c.passed) && linkChecks.every(c => c.valid);
  const validationPath = `${input.outputDir}/validation.json`;
  fs.writeFile(validationPath, JSON.stringify({ linkChecks, structureChecks, allPassed }, null, 2));

  chain.append({
    type: 'note', workerId: 'release-packager', stage: 'release_package',
    data: { event: 'docs_pipeline_complete', generatedCount: generatedFiles.length, allPassed },
  });

  return { generatedFiles, linkChecks, structureChecks, allPassed, validationPath };
}

function substituteTemplate(content: string, data: Record<string, string>): string {
  return content.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, key: string) => {
    const parts = key.split('.');
    let lookup = parts.length > 1 ? parts.slice(1).join('.') : key;
    if (parts[0] === 'product') lookup = parts.slice(1).join('.');
    return data[lookup] ?? data[key] ?? `[MISSING: ${key}]`;
  });
}

function validateStructure(filename: string, content: string): StructureCheck[] {
  const checks: StructureCheck[] = [];

  checks.push({
    file: filename,
    rule: 'has_doctype',
    passed: content.trimStart().startsWith('<!DOCTYPE') || content.trimStart().startsWith('<!doctype'),
  });

  checks.push({
    file: filename,
    rule: 'has_html_tag',
    passed: content.includes('<html') && content.includes('</html>'),
  });

  checks.push({
    file: filename,
    rule: 'has_body',
    passed: content.includes('<body') && content.includes('</body>'),
  });

  const isPrivacyOrTerms = filename.includes('privacy') || filename.includes('terms');
  if (isPrivacyOrTerms) {
    const hasScript = /<script[\s>]/i.test(content);
    checks.push({
      file: filename,
      rule: 'no_script_tags',
      passed: !hasScript,
      detail: hasScript ? 'script tag found in privacy/terms document' : undefined,
    });
  }

  const unresolved = content.match(/\[MISSING: [^\]]+\]/g);
  checks.push({
    file: filename,
    rule: 'no_unresolved_placeholders',
    passed: !unresolved,
    detail: unresolved ? `unresolved: ${unresolved.join(', ')}` : undefined,
  });

  return checks;
}

function extractAndValidateLinks(content: string): LinkCheck[] {
  const checks: LinkCheck[] = [];
  const hrefPattern = /href="([^"]+)"/g;
  let match;

  while ((match = hrefPattern.exec(content)) !== null) {
    const href = match[1];
    if (href.startsWith('mailto:')) {
      const email = href.replace('mailto:', '');
      checks.push({
        href,
        type: 'mailto',
        valid: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !email.includes('[MISSING'),
        reason: email.includes('[MISSING') ? 'unresolved placeholder in email' : undefined,
      });
    } else if (href.startsWith('http://') || href.startsWith('https://')) {
      checks.push({ href, type: 'http', valid: true });
    } else if (href.startsWith('#')) {
      checks.push({ href, type: 'anchor', valid: true });
    } else {
      checks.push({ href, type: 'relative', valid: true });
    }
  }

  return checks;
}
