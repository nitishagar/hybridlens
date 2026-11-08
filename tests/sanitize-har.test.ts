import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('sanitizer redacts keys/tokens and keeps valid HAR JSON', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'har-')), 'clean.har');
  execFileSync(
    'node',
    [
      join(root, 'scripts/sanitize-har.mjs'),
      join(root, 'tests/fixtures/banned/dirty.har'),
      out,
    ],
    { stdio: 'pipe' },
  );
  const text = readFileSync(out, 'utf8');
  const har = JSON.parse(text); // still valid JSON
  expect(har.log.entries.length).toBe(1);
  expect(text).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
  expect(text).not.toContain('fake-appcheck-token-abc');
  expect(text).not.toContain('Bearer fake-auth');
  expect(text).toContain('API_KEY_REDACTED');
  expect(text).toContain('REDACTED');
  // the repo secret gate accepts the sanitized output
  execFileSync('bash', [join(root, 'scripts/check-banned.sh'), out], {
    stdio: 'pipe',
  });
});
