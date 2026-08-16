import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';

import { createProviderErrorFromException } from '../errors/createProviderError';
import { ChatRequest, ChatResponse, ModelInfo, Provider, ProviderHealth } from '../providers/Provider';
import { ProviderError } from '../providers/ProviderError';
import { QuotaManager } from '../quota/QuotaManager';
import { createApp } from '../server/server';

class HttpProvider implements Provider {
  public calls = 0;

  constructor(
    private readonly providerName: string,
    public readonly priority: number,
    private readonly result: 'success' | 'rate-limit' | 'network' | 'auth' | 'forbidden' | 'unavailable',
    private readonly responseOptions: { usage?: number; rateLimitInfo?: ChatResponse['rateLimitInfo'] } = {}
  ) {}

  name(): string { return this.providerName; }
  async isAvailable(): Promise<boolean> { return this.result !== 'unavailable'; }
  async getModels(): Promise<ModelInfo[]> { return [{ id: `${this.providerName}-model`, object: 'model' }]; }
  async getHealth(): Promise<ProviderHealth> {
    return { status: this.result === 'unavailable' ? 'unavailable' : 'healthy', provider: this.providerName };
  }

  async chat(_request: ChatRequest): Promise<ChatResponse> {
    this.calls += 1;
    if (this.result === 'rate-limit') {
      throw new ProviderError('Rate limited', 429, this.providerName, 'RETRYABLE', true, {
        observedAt: Date.now(),
        retryAfterMs: 15_000
      });
    }
    if (this.result === 'network') {
      throw createProviderErrorFromException(new TypeError('fetch failed'), this.providerName);
    }
    if (this.result === 'auth' || this.result === 'forbidden') {
      const status = this.result === 'auth' ? 401 : 403;
      throw new ProviderError('Credentials rejected', status, this.providerName, 'FATAL', false);
    }

    return {
      id: `${this.providerName}-response`,
      object: 'chat.completion',
      created: 1,
      model: this.providerName,
      choices: [{ index: 0, message: { role: 'assistant', content: `${this.providerName} ok` }, finish_reason: 'stop' }],
      ...(this.responseOptions.usage !== undefined ? {
        usage: { prompt_tokens: 10, completion_tokens: this.responseOptions.usage - 10, total_tokens: this.responseOptions.usage }
      } : {}),
      ...(this.responseOptions.rateLimitInfo ? { rateLimitInfo: this.responseOptions.rateLimitInfo } : {})
    };
  }
}

const body = { model: 'router-auto', messages: [{ role: 'user', content: 'hello' }] };

test('HTTP smoke: highest-priority provider returns an OpenAI-compatible response and records usage', async () => {
  const quota = new QuotaManager();
  const primary = new HttpProvider('gemini', 100, 'success', { usage: 25 });
  const response = await request(createApp([primary], quota)).post('/v1/chat/completions').send(body).expect(200);

  assert.equal(response.body.id, 'gemini-response');
  assert.equal(response.body.object, 'chat.completion');
  assert.equal(response.body.created, 1);
  assert.equal(response.body.model, 'gemini');
  assert.deepEqual(response.body.choices, [{ index: 0, message: { role: 'assistant', content: 'gemini ok' }, finish_reason: 'stop' }]);
  assert.equal(response.body.usage.total_tokens, 25);
  assert.equal(response.body.rateLimitInfo, undefined);
  assert.equal(quota.getStatus('gemini').tokenCount, 25);
});

test('HTTP smoke: 429 applies Retry-After cooldown, falls back, and records Groq rate-limit headers', async () => {
  const quota = new QuotaManager({ defaultCooldownMs: 1_000 });
  const primary = new HttpProvider('gemini', 100, 'rate-limit');
  const groq = new HttpProvider('groq', 90, 'success', {
    rateLimitInfo: {
      observedAt: Date.now(),
      requests: { limit: 100, remaining: 42, resetAt: Date.now() + 60_000 }
    }
  });
  const before = Date.now();
  const response = await request(createApp([primary, groq], quota)).post('/v1/chat/completions').send(body).expect(200);

  assert.equal(response.body.model, 'groq');
  assert.equal(primary.calls, 1);
  assert.equal(groq.calls, 1);
  assert.ok((quota.getStatus('gemini').cooldownUntil ?? 0) >= before + 15_000);
  assert.deepEqual(quota.getStatus('groq').rateLimitInfo?.requests?.remaining, 42);
});

test('HTTP smoke: network errors use fallback without a retry loop', async () => {
  const failing = new HttpProvider('gemini', 100, 'network');
  const fallback = new HttpProvider('groq', 90, 'success');
  const response = await request(createApp([failing, fallback])).post('/v1/chat/completions').send(body).expect(200);

  assert.equal(response.body.model, 'groq');
  assert.equal(failing.calls, 1);
  assert.equal(fallback.calls, 1);
});

test('HTTP smoke: all unavailable providers return a structured OpenAI-style error', async () => {
  const unavailable = new HttpProvider('gemini', 100, 'unavailable');
  const response = await request(createApp([unavailable])).post('/v1/chat/completions').send(body).expect(503);

  assert.deepEqual(response.body.error, {
    message: 'No available provider remaining',
    type: 'server_error',
    code: 'provider_unavailable'
  });
  assert.equal(unavailable.calls, 0);
});

for (const [result, status] of [['auth', 401], ['forbidden', 403]] as const) {
  test(`HTTP smoke: ${status} aborts without calling fallback`, async () => {
    const failing = new HttpProvider('gemini', 100, result);
    const fallback = new HttpProvider('groq', 90, 'success');
    const response = await request(createApp([failing, fallback])).post('/v1/chat/completions').send(body).expect(503);

    assert.equal(response.body.error.code, 'provider_unavailable');
    assert.equal(failing.calls, 1);
    assert.equal(fallback.calls, 0);
  });
}
