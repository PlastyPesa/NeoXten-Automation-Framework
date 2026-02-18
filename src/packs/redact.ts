/**
 * Redact token patterns from pack content.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface RedactionRules {
  token_patterns: Array<{ pattern: string; replacement: string }>;
  network_strip: { query_params: string[]; headers: string[] };
}

let cachedRules: RedactionRules | null = null;

export function loadRedactionRules(specsDir?: string): RedactionRules {
  if (cachedRules) return cachedRules;
  const base = specsDir ?? path.resolve(process.cwd(), 'specs');
  const p = path.join(base, 'redaction.rules.json');
  if (!fs.existsSync(p)) {
    cachedRules = defaultRedactionRules();
    return cachedRules;
  }
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  cachedRules = raw as RedactionRules;
  return cachedRules;
}

function defaultRedactionRules(): RedactionRules {
  return {
    token_patterns: [
      { pattern: 'sk-[a-zA-Z0-9]{20,}', replacement: '[REDACTED_API_KEY]' },
      { pattern: 'Bearer\\s+[a-zA-Z0-9._-]+', replacement: 'Bearer [REDACTED]' },
      { pattern: 'password=["\']?\\s*[:=]\\s*["\']?[^"\'\\s]+', replacement: 'password=[REDACTED]' },
    ],
    network_strip: { query_params: ['token', 'key', 'api_key'], headers: ['authorization', 'x-api-key'] },
  };
}

export function redactString(text: string, rules: RedactionRules): string {
  let out = text;
  for (const { pattern, replacement } of rules.token_patterns) {
    const re = new RegExp(pattern, 'gi');
    out = out.replace(re, replacement);
  }
  return out;
}

export function redactNdjson(content: string, rules: RedactionRules): string {
  return content
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        const str = JSON.stringify(obj);
        return redactString(str, rules);
      } catch {
        return redactString(line, rules);
      }
    })
    .join('\n');
}

export function redactJson(content: string, rules: RedactionRules): string {
  return redactString(content, rules);
}
