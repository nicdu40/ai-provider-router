import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const providers = ['GeminiProvider.ts', 'GroqProvider.ts', 'OpenRouterProvider.ts'];

test('Providers use createProviderError factory', () => {
  const base = path.join(__dirname, '..', 'providers');
  for (const p of providers) {
    const content = fs.readFileSync(path.join(base, p), 'utf8');
    assert.ok(content.includes('createProviderErrorFromResponse'), `Provider ${p} should call createProviderErrorFromResponse`);
  }
});
