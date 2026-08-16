import assert from 'node:assert/strict';
import test from 'node:test';

import { GeminiProvider } from '../providers/GeminiProvider';
import { GroqProvider } from '../providers/GroqProvider';
import { OpenRouterProvider } from '../providers/OpenRouterProvider';
import { ProviderError } from '../providers/ProviderError';
import { QuotaManager } from '../quota/QuotaManager';
import { parseGroqRateLimitInfo } from '../quota/RateLimitInfo';

const observedAt = 1_000_000;

test('Groq parses all documented rate-limit headers', () => {
  const info = parseGroqRateLimitInfo(new Headers({
    'retry-after': '2',
    'x-ratelimit-limit-requests': '14400',
    'x-ratelimit-remaining-requests': '14370',
    'x-ratelimit-reset-requests': '2m59.56s',
    'x-ratelimit-limit-tokens': '18000',
    'x-ratelimit-remaining-tokens': '17997',
    'x-ratelimit-reset-tokens': '7.66s'
  }), observedAt);

  assert.deepEqual(info, {
    observedAt,
    retryAfterMs: 2_000,
    requests: { limit: 14400, remaining: 14370, resetAt: 1_179_560 },
    tokens: { limit: 18000, remaining: 17997, resetAt: 1_007_660 }
  });
});

test('Groq keeps requests-only headers without inventing token values', () => {
  const info = parseGroqRateLimitInfo(new Headers({
    'x-ratelimit-limit-requests': '100',
    'x-ratelimit-remaining-requests': '99'
  }), observedAt);

  assert.deepEqual(info, { observedAt, requests: { limit: 100, remaining: 99 } });
});

test('Groq keeps tokens-only headers without inventing request values', () => {
  const info = parseGroqRateLimitInfo(new Headers({
    'x-ratelimit-limit-tokens': '2000',
    'x-ratelimit-reset-tokens': '1m'
  }), observedAt);

  assert.deepEqual(info, { observedAt, tokens: { limit: 2000, resetAt: 1_060_000 } });
});

test('Groq parses Retry-After independently of other headers', () => {
  const info = parseGroqRateLimitInfo(new Headers({ 'retry-after': '3.5' }), observedAt);
  assert.deepEqual(info, { observedAt, retryAfterMs: 3_500 });
});

test('Groq leaves all rate-limit fields unknown when headers are absent', () => {
  assert.deepEqual(parseGroqRateLimitInfo(new Headers(), observedAt), { observedAt });
});

test('Groq ignores invalid header values instead of converting them to zero', () => {
  const info = parseGroqRateLimitInfo(new Headers({
    'retry-after': '-1',
    'x-ratelimit-limit-requests': 'unknown',
    'x-ratelimit-remaining-tokens': '-7',
    'x-ratelimit-reset-tokens': 'soon'
  }), observedAt);

  assert.deepEqual(info, { observedAt });
});

test('Groq reset durations are converted to absolute timestamps', () => {
  const info = parseGroqRateLimitInfo(new Headers({
    'x-ratelimit-reset-requests': '1h2m3.25s'
  }), observedAt);

  assert.equal(info.requests?.resetAt, 4_723_250);
});

test('Gemini retains usageMetadata token counts and has no invented rate-limit metadata', async () => {
  await withFetch(new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: 'ok' }] } }],
    usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7, totalTokenCount: 18 }
  })), async () => {
    const response = await new GeminiProvider('test-key').chat({ messages: [{ role: 'user', content: 'hi' }] });
    assert.deepEqual(response.usage, { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 });
    assert.equal(response.rateLimitInfo, undefined);
  });
});

test('Gemini 429 preserves its structured error code without rate-limit headers', async () => {
  await withFetch(new Response(JSON.stringify({ error: { code: 'quota_exceeded', message: 'Daily quota reached' } }), {
    status: 429,
    headers: { 'Content-Type': 'application/json' }
  }), async () => {
    await assert.rejects(
      () => new GeminiProvider('test-key').chat({ messages: [{ role: 'user', content: 'hi' }] }),
      (error: unknown) => error instanceof ProviderError
        && error.category === 'RETRYABLE'
        && error.providerCode === 'quota_exceeded'
        && error.rateLimitInfo === undefined
    );
  });
});

test('OpenRouter records Retry-After when provided', async () => {
  await withFetch(new Response(JSON.stringify({ error: { message: 'slow down' } }), {
    status: 429,
    headers: { 'Retry-After': '5', 'Content-Type': 'application/json' }
  }), async () => {
    await assert.rejects(
      () => new OpenRouterProvider('test-key').chat({ messages: [{ role: 'user', content: 'hi' }] }),
      (error: unknown) => error instanceof ProviderError && error.rateLimitInfo?.retryAfterMs === 5_000
    );
  });
});

test('OpenRouter leaves rate-limit information absent when Retry-After is absent', async () => {
  await withFetch(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })), async () => {
    const response = await new OpenRouterProvider('test-key').chat({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(response.rateLimitInfo, undefined);
  });
});

test('QuotaManager stores a rate-limit observation without filling unknown fields', () => {
  const quota = new QuotaManager();
  quota.recordRateLimitInfo('groq', {
    observedAt,
    requests: { remaining: 123 },
    tokens: { limit: 1000, resetAt: observedAt + 5_000 }
  });

  assert.deepEqual(quota.getStatus('groq').rateLimitInfo, {
    observedAt,
    requests: { remaining: 123 },
    tokens: { limit: 1000, resetAt: observedAt + 5_000 }
  });
});

test('QuotaManager keeps omitted rate-limit dimensions unknown', () => {
  const quota = new QuotaManager();
  quota.recordRateLimitInfo('gemini', { observedAt });

  const info = quota.getStatus('gemini').rateLimitInfo;
  assert.equal(info?.requests, undefined);
  assert.equal(info?.tokens, undefined);
  assert.equal(info?.retryAfterMs, undefined);
});

test('Groq provider attaches parsed headers to successful responses', async () => {
  await withFetch(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
    headers: { 'x-ratelimit-remaining-requests': '42' }
  }), async () => {
    const response = await new GroqProvider('test-key').chat({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(response.rateLimitInfo?.requests?.remaining, 42);
  });
});

async function withFetch(response: Response, run: () => Promise<void>): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => response) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}
