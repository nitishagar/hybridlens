#!/usr/bin/env node
// scripts/sanitize-har.mjs — redact secrets from a DevTools HAR so the
// sanitized copy can be committed as docs/live-check.har (D3). The raw
// capture stays local (git-ignored). Usage:
//   node scripts/sanitize-har.mjs <raw.har> docs/live-check.har
import { readFileSync, writeFileSync } from 'node:fs';

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('usage: node scripts/sanitize-har.mjs <raw.har> <sanitized.har>');
  process.exit(2);
}

let text = readFileSync(input, 'utf8');
JSON.parse(text); // must be valid HAR JSON

const rules = [
  [/\bAIza[0-9A-Za-z_-]{20,}/g, 'API_KEY_REDACTED'],
  [/([?&]key=)[^&"'\s]+/g, '$1REDACTED'],
  [
    /("name"\s*:\s*"(?:X-Firebase-AppCheck|X-Firebase-Client|Authorization)"\s*,\s*"value"\s*:\s*")[^"]*/g,
    '$1REDACTED',
  ],
];
for (const [re, rep] of rules) text = text.replace(re, rep);
JSON.parse(text); // still valid JSON

if (/\bAIza[0-9A-Za-z_-]{20,}/.test(text)) {
  console.error('sanitize failed: secret pattern remains');
  process.exit(1);
}
writeFileSync(output, text);
console.log(`sanitized ${input} -> ${output}`);
