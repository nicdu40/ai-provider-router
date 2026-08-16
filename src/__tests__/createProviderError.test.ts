import assert from 'node:assert/strict';
import test from 'node:test';

import { createProviderErrorFromResponse } from '../errors/createProviderError';

function makeResp(status: number, body?: string) {
  return {
    status,
    text: async () => body ?? ''
  };
}

test('400 -> BAD_REQUEST non-retryable', async () => {
  const err = await createProviderErrorFromResponse(makeResp(400, 'bad'), 'p');
  assert.equal(err.status, 400);
  assert.equal(err.category, 'BAD_REQUEST');
  assert.equal(err.retryable, false);
  assert.equal(err.provider, 'p');
});

test('401 -> FATAL non-retryable', async () => {
  const err = await createProviderErrorFromResponse(makeResp(401, 'unauth'), 'p');
  assert.equal(err.status, 401);
  assert.equal(err.category, 'FATAL');
  assert.equal(err.retryable, false);
});

test('403 -> FATAL non-retryable', async () => {
  const err = await createProviderErrorFromResponse(makeResp(403, 'forbidden'), 'p');
  assert.equal(err.status, 403);
  assert.equal(err.category, 'FATAL');
  assert.equal(err.retryable, false);
});

test('408 -> TIMEOUT retryable', async () => {
  const err = await createProviderErrorFromResponse(makeResp(408, 'timeout'), 'p');
  assert.equal(err.status, 408);
  assert.equal(err.category, 'TIMEOUT');
  assert.equal(err.retryable, true);
});

test('429 -> RETRYABLE retryable', async () => {
  const err = await createProviderErrorFromResponse(makeResp(429, 'rate'), 'p');
  assert.equal(err.status, 429);
  assert.equal(err.category, 'RETRYABLE');
  assert.equal(err.retryable, true);
});

test('500 -> RETRYABLE retryable', async () => {
  const err = await createProviderErrorFromResponse(makeResp(500, 'srv'), 'p');
  assert.equal(err.status, 500);
  assert.equal(err.category, 'RETRYABLE');
  assert.equal(err.retryable, true);
});

test('503 -> RETRYABLE retryable', async () => {
  const err = await createProviderErrorFromResponse(makeResp(503, 'srv'), 'p');
  assert.equal(err.status, 503);
  assert.equal(err.category, 'RETRYABLE');
  assert.equal(err.retryable, true);
});

test('unknown -> follows classifier (UNKNOWN)', async () => {
  const err = await createProviderErrorFromResponse(makeResp(418, 'i am teapot'), 'p');
  assert.equal(err.status, 418);
  assert.equal(err.category, 'UNKNOWN');
});
