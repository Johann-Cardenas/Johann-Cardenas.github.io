import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Browser modules are never imported by the other tests, so a syntax error in one would ship unnoticed.
test('every browser module parses', () => {
  const root = fileURLToPath(new URL('../js/', import.meta.url));
  const files = ['', 'geo/', 'model/'].flatMap((d) => readdirSync(root + d).filter((f) => f.endsWith('.js')).map((f) => root + d + f));
  assert.ok(files.length > 10);
  for (const f of files) {
    try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
    catch (e) { assert.fail(`${f}\n${e.stderr}`); }
  }
});
