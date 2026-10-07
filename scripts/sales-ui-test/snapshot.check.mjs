import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { collectLocalSources, voiceEntries } from './snapshot.mjs';

const root = resolve(import.meta.dirname, '../..');
test('contains every real Voice entry and the dynamic staff auth dependency, not unrelated app routes', () => {
  const sources = collectLocalSources(root).map(path => path.replaceAll('\\', '/'));
  for (const entry of [...voiceEntries, 'app/globals.css', 'lib/supabase.js', 'components/sales/CustomerVoicePublic.tsx',
    'components/sales/CustomerVoicesWorkspace.tsx', 'lib/sales/customerVoicesContracts.ts']) assert.ok(sources.includes(entry), entry);
  assert.ok(!sources.includes('app/page.tsx'));
  assert.ok(!sources.some(path => /\.env|__tests__|node_modules|\.sql$/.test(path)));
  assert.equal(sources.length, new Set(sources).size);
});
test('refuses environment files and traversal before reading them', () => {
  for (const entry of ['.env.local', '../AGENTS.md', 'node_modules/next/package.json']) {
    assert.throws(() => collectLocalSources(root, [entry]), /unsafe source path/);
  }
});
test('fixture config preserves real headers and type checks while limiting compilation', () => {
  const config = readFileSync(resolve(root, 'scripts/sales-ui-test/next.config.fixture.txt'), 'utf8');
  assert.match(config, /\.\.\.original,/);
  assert.match(config, /ignoreBuildErrors: false/);
  assert.match(config, /cpus: 1/);
  assert.match(config, /result\.cache = false/);
  assert.doesNotMatch(config, /headers\s*\(/);
});
