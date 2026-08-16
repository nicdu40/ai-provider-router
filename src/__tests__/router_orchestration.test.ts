import assert from 'node:assert/strict';
import test from 'node:test';

import { createProviderErrorFromException } from '../errors/createProviderError';
import { ProviderError } from '../providers/ProviderError';
import { ChatRequest, ChatResponse, ModelInfo, Provider, ProviderHealth } from '../providers/Provider';
import { QuotaManager } from '../quota/QuotaManager';
import { Router } from '../router/Router';

class ScenarioProvider implements Provider {
  public calls = 0;

  constructor(
    private readonly providerName: string,
    public readonly priority: number,
    private readonly action: 'success' | 'rate-limit' | 'unknown-error',
    private readonly totalTokens?: number
  ) {}

  name(): string { return this.providerName; }
  async isAvailable(): Promise<boolean> { return true; }
  async getModels(): Promise<ModelInfo[]> { return []; }
  async getHealth(): Promise<ProviderHealth> { return { status: 'healthy', provider: this.providerName }; }

  async chat(_request: ChatRequest): Promise<ChatResponse> {
    this.calls += 1;
    if (this.action === 'rate-limit') {
      throw new ProviderError('Rate limited', 429, this.providerName, 'RETRYABLE', true);
    }
    if (this.action === 'unknown-error') {
      throw new ProviderError('Temporary unknown error', undefined, this.providerName, 'UNKNOWN', false);
    }

    return {
      id: this.providerName,
      object: 'chat.completion',
      created: 1,
      model: this.providerName,
      choices: [{ index: 0, message: { role: 'assistant', content: this.providerName }, finish_reason: 'stop' }],
      ...(typeof this.totalTokens === 'number' ? { usage: { total_tokens: this.totalTokens } } : {})
    };
  }
}

const request: ChatRequest = { model: 'router-auto', messages: [{ role: 'user', content: 'hi' }] };

test('429 cooldown makes the router select Groq through ProviderSelector', async () => {
  const quota = new QuotaManager();
  const gemini = new ScenarioProvider('gemini', 100, 'rate-limit');
  const groq = new ScenarioProvider('groq', 90, 'success');
  const router = new Router([gemini, groq], quota);

  const response = await router.route(request);

  assert.equal(response.model, 'groq');
  assert.equal(gemini.calls, 1);
  assert.equal(groq.calls, 1);
  assert.equal(quota.isAvailable('gemini'), false);
});

test('two rate limits fall back by priority from Gemini to Groq to OpenRouter', async () => {
  const gemini = new ScenarioProvider('gemini', 100, 'rate-limit');
  const groq = new ScenarioProvider('groq', 90, 'rate-limit');
  const openrouter = new ScenarioProvider('openrouter', 80, 'success');
  const router = new Router([openrouter, groq, gemini]);

  const response = await router.route(request);

  assert.equal(response.model, 'openrouter');
  assert.equal(gemini.calls, 1);
  assert.equal(groq.calls, 1);
  assert.equal(openrouter.calls, 1);
});

test('a provider already attempted in this request is not selected again', async () => {
  const first = new ScenarioProvider('first', 100, 'unknown-error');
  const second = new ScenarioProvider('second', 90, 'success');
  const router = new Router([first, second]);

  const response = await router.route(request);

  assert.equal(response.model, 'second');
  assert.equal(first.calls, 1);
});

test('router reports a clear error when no provider remains', async () => {
  const router = new Router([new ScenarioProvider('gemini', 100, 'rate-limit')]);

  await assert.rejects(() => router.route(request), /No available provider remaining/);
});

test('network failures are structured retryable ProviderErrors', () => {
  const error = createProviderErrorFromException(new TypeError('fetch failed'), 'gemini');

  assert.equal(error.provider, 'gemini');
  assert.equal(error.category, 'NETWORK_ERROR');
  assert.equal(error.retryable, true);
});

test('a retryable network error falls back to the next provider', async () => {
  const network = new ScenarioProvider('network', 100, 'success');
  network.chat = async () => {
    network.calls += 1;
    throw createProviderErrorFromException(new TypeError('fetch failed'), network.name());
  };
  const fallback = new ScenarioProvider('fallback', 90, 'success');
  const router = new Router([network, fallback]);

  assert.equal((await router.route(request)).model, 'fallback');
  assert.equal(network.calls, 1);
});

test('only real response usage is sent to QuotaManager', async () => {
  const quota = new QuotaManager();
  const provider = new ScenarioProvider('usage', 100, 'success', 37);
  const router = new Router([provider], quota);

  await router.route(request);
  assert.equal(quota.getStatus('usage').tokenCount, 37);
});

test('unknown response usage remains null in QuotaManager', async () => {
  const quota = new QuotaManager();
  const provider = new ScenarioProvider('unknown-usage', 100, 'success');
  const router = new Router([provider], quota);

  await router.route(request);
  assert.equal(quota.getStatus('unknown-usage').tokenCount, null);
});
