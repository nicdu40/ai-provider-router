import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyStatus } from '../router/ErrorClassifier';
import config from '../config/config';

test('Default classification maps 401/403 to FATAL', () => {
  assert.equal(classifyStatus(401), 'FATAL');
  assert.equal(classifyStatus(403), 'FATAL');
});

test('Default classification maps 429 to RETRYABLE', () => {
  assert.equal(classifyStatus(429), 'RETRYABLE');
});

test('Default classification maps 408/502/503/504 to TIMEOUT', () => {
  assert.equal(classifyStatus(408), 'TIMEOUT');
  assert.equal(classifyStatus(502), 'TIMEOUT');
  assert.equal(classifyStatus(503), 'TIMEOUT');
  assert.equal(classifyStatus(504), 'TIMEOUT');
});

test('Unknown status returns UNKNOWN', () => {
  assert.equal(classifyStatus(999), 'UNKNOWN');
});

test('Config can be updated at runtime (simulated)', () => {
  // simulate changing the config mapping (shallow mutation for test)
  const original = { ...config.errorClassification };
  (config as any).errorClassification = { FATAL: [418], RETRYABLE: [], TIMEOUT: [], UNKNOWN: [] };

  assert.equal(classifyStatus(418), 'FATAL');

  (config as any).errorClassification = original;
});
