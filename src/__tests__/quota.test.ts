import assert from 'node:assert/strict';
import test from 'node:test';
import { QuotaManager } from '../quota/QuotaManager';

test('provider initially available', () => {
  const q = new QuotaManager({ defaultCooldownMs: 1000 });
  assert.equal(q.isAvailable('p1'), true);
});

test('recordRequest increases requestCount', () => {
  const q = new QuotaManager();
  q.recordRequest('p1');
  const s = q.getStatus('p1');
  assert.equal(s.requestCount, 1);
});

test('recordSuccess updates lastSuccessAt', () => {
  const q = new QuotaManager();
  q.recordSuccess('p1', 10);
  const s = q.getStatus('p1');
  assert.ok(typeof s.lastSuccessAt === 'number');
  assert.equal(s.tokenCount, 10);
});

test('recordError updates lastErrorAt', () => {
  const q = new QuotaManager();
  q.recordError('p1');
  const s = q.getStatus('p1');
  assert.ok(typeof s.lastErrorAt === 'number');
});

test('recordRateLimit creates cooldown', () => {
  const q = new QuotaManager({ defaultCooldownMs: 500 });
  q.recordRateLimit('p1');
  const s = q.getStatus('p1');
  assert.ok(typeof s.lastRateLimitAt === 'number');
  assert.ok(typeof s.cooldownUntil === 'number');
  assert.equal(q.isAvailable('p1'), false);
});

test('isAvailable true after cooldown expires', async () => {
  const q = new QuotaManager({ defaultCooldownMs: 200 });
  q.recordRateLimit('p2');
  assert.equal(q.isAvailable('p2'), false);
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(q.isAvailable('p2'), true);
});

test('getAllStatuses returns known providers', () => {
  const q = new QuotaManager();
  q.recordRequest('a');
  q.recordRequest('b');
  const all = q.getAllStatuses();
  const names = all.map(x => x.provider).sort();
  assert.deepEqual(names, ['a', 'b']);
});

test('multiple providers independent', () => {
  const q = new QuotaManager();
  q.recordRateLimit('a');
  assert.equal(q.isAvailable('a'), false);
  assert.equal(q.isAvailable('b'), true);
});

test('tokenCount unknown when not provided', () => {
  const q = new QuotaManager();
  const s = q.getStatus('x');
  assert.equal(s.tokenCount, null);
});

test('tokenCount recorded when provided', () => {
  const q = new QuotaManager();
  q.recordSuccess('t', 5);
  const s = q.getStatus('t');
  assert.equal(s.tokenCount, 5);
});
