import assert from 'node:assert/strict';
import test from 'node:test';

import { createProviderErrorFromResponse } from '../errors/createProviderError';
import { ProviderError } from '../providers/ProviderError';
import { ChatRequest, ChatResponse, Provider } from '../providers/Provider';
import { QuotaManager } from '../quota/QuotaManager';
import { Router } from '../router/Router';

const request: ChatRequest = { model: 'router-auto', messages: [{ role: 'user', content: 'hello' }] };

test('createProviderErrorFromResponse detects Gemini model-unavailable 404', async () => {
  const respLike = { status: 404, text: async () => 'This model models/gemini-2.5-flash is no longer available to new users' };
  const err = await createProviderErrorFromResponse(respLike, 'gemini');
  assert.equal(err.status, 404);
  assert.equal(err.category, 'MODEL_UNAVAILABLE');
  assert.equal(err.retryable, false);
});

class GeminiUnavailable implements Provider {
  public calls = 0;
  name(): string { return 'gemini'; }
  priority = 100;
  async isAvailable() { return true; }
  async getModels() { return []; }
  async getHealth() { return { status: 'unavailable', provider: 'gemini' }; }
  async chat(): Promise<ChatResponse> {
    this.calls += 1;
    throw new ProviderError('HTTP 404 - model unavailable', 404, 'gemini', 'MODEL_UNAVAILABLE', false);
  }
}

class GroqSuccess implements Provider {
  public calls = 0;
  name(): string { return 'groq'; }
  priority = 90;
  async isAvailable() { return true; }
  async getModels() { return []; }
  async getHealth() { return { status: 'healthy', provider: 'groq' }; }
  async chat(): Promise<ChatResponse> {
    this.calls += 1;
    return {
      id: 'groq-1', object: 'chat.completion', created: 1, model: 'groq',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]
    };
  }
}

test('Router falls back from Gemini MODEL_UNAVAILABLE, marks cooldown, and avoids retry on next request', async () => {
  const quota = new QuotaManager();
  const gem = new GeminiUnavailable();
  const groq = new GroqSuccess();
  const router = new Router([gem, groq], quota);

  const resp = await router.route(request);
  assert.equal(resp.model, 'groq');
  assert.equal(gem.calls, 1);
  assert.equal(groq.calls, 1);
  // Gemini should be marked unavailable (disabled)
  assert.equal(quota.isAvailable('gemini'), false);

  // Next request should not call gemini again, only groq, because it's disabled
  const resp2 = await router.route(request);
  assert.equal(resp2.model, 'groq');
  assert.equal(gem.calls, 1);
  assert.equal(groq.calls, 2);
});
