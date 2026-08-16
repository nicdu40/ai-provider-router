import assert from 'node:assert/strict';
import test from 'node:test';

import { ChatRequest, ChatResponse, ModelInfo, Provider, ProviderHealth } from '../providers/Provider';
import { ProviderError } from '../providers/ProviderError';
import { QuotaManager } from '../quota/QuotaManager';
import { ProviderSelector } from '../router/ProviderSelector';
import { Router } from '../router/Router';

class CandidateProvider implements Provider {
  constructor(public readonly providerName: string, public readonly priority: number) {}

  name(): string { return this.providerName; }
  async isAvailable(): Promise<boolean> { return true; }
  async getModels(): Promise<ModelInfo[]> { return []; }
  async getHealth(): Promise<ProviderHealth> { return { status: 'healthy', provider: this.providerName }; }
  async chat(_request: ChatRequest): Promise<ChatResponse> {
    return {
      id: this.providerName,
      object: 'chat.completion',
      created: 1,
      model: this.providerName,
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]
    };
  }
}

const providers = () => [
  new CandidateProvider('gemini', 100),
  new CandidateProvider('groq', 90),
  new CandidateProvider('openrouter', 80)
];

test('all available providers select the configured highest priority', async () => {
  const selector = new ProviderSelector(providers(), new QuotaManager());
  assert.equal((await selector.select())?.name(), 'gemini');
});

test('a cooldown excludes the highest-priority provider', async () => {
  const quota = new QuotaManager();
  quota.recordRateLimit('gemini', 60_000);
  const selector = new ProviderSelector(providers(), quota);
  assert.equal((await selector.select())?.name(), 'groq');
});

test('observed zero remaining requests excludes a provider until reset', async () => {
  const quota = new QuotaManager();
  quota.recordRateLimitInfo('gemini', {
    observedAt: Date.now(),
    requests: { remaining: 0, resetAt: Date.now() + 60_000 }
  });
  const selector = new ProviderSelector(providers(), quota);
  assert.equal((await selector.select())?.name(), 'groq');
});

test('observed zero remaining tokens excludes a provider until reset', async () => {
  const quota = new QuotaManager();
  quota.recordRateLimitInfo('gemini', {
    observedAt: Date.now(),
    tokens: { remaining: 0, resetAt: Date.now() + 60_000 }
  });
  const selector = new ProviderSelector(providers(), quota);
  assert.equal((await selector.select())?.name(), 'groq');
});

test('unknown remaining does not exclude a provider', async () => {
  const quota = new QuotaManager();
  quota.recordRateLimitInfo('gemini', {
    observedAt: Date.now(),
    requests: { resetAt: Date.now() + 60_000 }
  });
  const selector = new ProviderSelector(providers(), quota);
  assert.equal((await selector.select())?.name(), 'gemini');
});

test('an exhausted observation no longer blocks after its reset timestamp', async () => {
  const quota = new QuotaManager();
  quota.recordRateLimitInfo('gemini', {
    observedAt: Date.now() - 10_000,
    requests: { remaining: 0, resetAt: Date.now() - 1 }
  });
  const selector = new ProviderSelector(providers(), quota);
  assert.equal((await selector.select())?.name(), 'gemini');
});

test('Gemini and OpenRouter remain selectable without reliable remaining headers', async () => {
  const quota = new QuotaManager();
  quota.recordRateLimitInfo('gemini', { observedAt: Date.now() });
  quota.recordRateLimitInfo('openrouter', { observedAt: Date.now() });
  const selector = new ProviderSelector(providers(), quota);

  assert.equal((await selector.select())?.name(), 'gemini');
  assert.equal((await selector.select(new Set(['gemini'])))?.name(), 'groq');
  assert.equal((await selector.select(new Set(['gemini', 'groq'])))?.name(), 'openrouter');
});

test('Retry-After overrides the default cooldown duration', async () => {
  const quota = new QuotaManager({ defaultCooldownMs: 1_000 });
  const retryAfter = new CandidateProvider('gemini', 100);
  retryAfter.chat = async () => {
    throw new ProviderError('Rate limited', 429, 'gemini', 'RETRYABLE', true, {
      observedAt: Date.now(),
      retryAfterMs: 30_000
    });
  };
  const fallback = new CandidateProvider('groq', 90);
  const router = new Router([retryAfter, fallback], quota);
  const before = Date.now();

  await router.route({ messages: [{ role: 'user', content: 'hi' }] });
  assert.ok((quota.getStatus('gemini').cooldownUntil ?? 0) >= before + 30_000);
});

test('missing Retry-After retains the configured default cooldown', async () => {
  const quota = new QuotaManager({ defaultCooldownMs: 30_000 });
  const rateLimited = new CandidateProvider('gemini', 100);
  rateLimited.chat = async () => {
    throw new ProviderError('Rate limited', 429, 'gemini', 'RETRYABLE', true);
  };
  const router = new Router([rateLimited, new CandidateProvider('groq', 90)], quota);
  const before = Date.now();

  await router.route({ messages: [{ role: 'user', content: 'hi' }] });
  assert.ok((quota.getStatus('gemini').cooldownUntil ?? 0) >= before + 30_000);
});

test('all unavailable providers produce an explicit null selection', async () => {
  const quota = new QuotaManager();
  quota.recordRateLimit('gemini', 60_000);
  quota.recordRateLimit('groq', 60_000);
  quota.recordRateLimit('openrouter', 60_000);
  const selector = new ProviderSelector(providers(), quota);
  assert.equal(await selector.select(), null);
});
