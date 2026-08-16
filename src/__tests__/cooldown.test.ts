import assert from 'node:assert/strict';
import test from 'node:test';

import { Router } from '../router/Router';
import { Provider, ChatResponse, ProviderHealth } from '../providers/Provider';

import { ProviderError } from '../providers/ProviderError';

class Provider429 implements Provider {
  public readonly priority = 100;
  private called = 0;
  name(): string { return 'p429'; }
  async isAvailable(): Promise<boolean> { return true; }
  async getModels() { return [{ id: 'p429-model', object: 'model' }]; }
  async getHealth(): Promise<ProviderHealth> { return { status: 'healthy', provider: 'p429' }; }
  async chat(): Promise<ChatResponse> {
    this.called += 1;
    const category = (await import('../router/ErrorClassifier')).classifyStatus(429);
    throw new ProviderError('Rate limited', 429, this.name(), category as any, true);
  }
}

class ProviderOK implements Provider {
  public readonly priority = 90;
  name(): string { return 'pok'; }
  async isAvailable(): Promise<boolean> { return true; }
  async getModels() { return [{ id: 'pok-model', object: 'model' }]; }
  async getHealth(): Promise<ProviderHealth> { return { status: 'healthy', provider: 'pok' }; }
  async chat() : Promise<ChatResponse> {
    return {
      id: 'pok-1',
      object: 'chat.completion',
      created: Math.floor(Date.now()/1000),
      model: 'pok-model',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok response' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    };
  }
}

test('Router falls back when first provider returns 429', async () => {
  const router = new Router([new Provider429(), new ProviderOK()]);

  const resp = await router.route({ model: 'router-auto', messages: [{ role: 'user', content: 'hi' }] });

  assert.equal(resp.choices[0].message.content, 'ok response');
});

