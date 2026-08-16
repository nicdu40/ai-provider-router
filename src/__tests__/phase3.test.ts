import assert from 'node:assert/strict';
import test from 'node:test';

import { MockProvider } from '../providers/MockProvider';
import { ChatResponse, Provider, ProviderHealth } from '../providers/Provider';
import { ProviderSelector } from '../router/ProviderSelector';
import { QuotaManager } from '../quota/QuotaManager';

class TestProvider implements Provider {
  constructor(
    private readonly providerName: string,
    public readonly priority: number,
    private readonly available: boolean
  ) {}

  name(): string {
    return this.providerName;
  }

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async getModels() {
    return [{ id: `${this.providerName}-model`, object: 'model' }];
  }

  async chat(): Promise<ChatResponse> {
    return {
      id: `${this.providerName}-response`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: this.providerName,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: `${this.providerName} response` },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2
      }
    };
  }

  async getHealth(): Promise<ProviderHealth> {
    return { status: this.available ? 'healthy' : 'unavailable', provider: this.providerName };
  }
}

test('ProviderSelector chooses the highest-priority available provider', async () => {
  const selector = new ProviderSelector([
    new TestProvider('slow', 10, true),
    new TestProvider('fast', 99, true),
    new TestProvider('disabled', 100, false)
  ]);

  const provider = await selector.select();

  assert.ok(provider);
  assert.equal(provider?.name(), 'fast');
});

test('ProviderSelector excludes cooldown providers and explicit exclusions', async () => {
  const quota = new QuotaManager();
  quota.recordRateLimit('gemini');
  const selector = new ProviderSelector([
    new TestProvider('gemini', 100, true),
    new TestProvider('groq', 90, true),
    new TestProvider('openrouter', 80, true)
  ], quota);

  assert.equal((await selector.select())?.name(), 'groq');
  assert.equal((await selector.select(new Set(['groq'])))?.name(), 'openrouter');
});

test('MockProvider remains available for router fallback path', async () => {
  const provider = new MockProvider();
  assert.equal(provider.name(), 'mock');
  assert.equal(await provider.isAvailable(), true);
});
