import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const base = 'https://alexasryan.github.io/mdrg/';
const expected = await readFile('dist/index.html', 'utf8');
let ready = false;
for (let attempt = 0; attempt < 36; attempt++) {
  try {
    const response = await fetch(base + '?build=' + Date.now(), { signal: AbortSignal.timeout(15000) });
    if (response.ok && await response.text() === expected) { ready = true; break; }
  } catch { /* Pages may still be deploying. */ }
  await new Promise(resolve => setTimeout(resolve, 5000));
}
assert.ok(ready, 'The tested build did not appear on GitHub Pages');
for (const [, path] of expected.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const url = new URL(path, base);
  if (url.origin !== new URL(base).origin) continue;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, url.href);
  if (url.pathname.endsWith('.js')) assert.match(response.headers.get('content-type') || '', /javascript/);
  console.log('200 ' + url.href);
}
console.log('Published HTML matches the tested build: ' + base);
