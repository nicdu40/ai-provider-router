import assert from 'node:assert/strict';
import test from 'node:test';

import { Router } from '../router/Router';
import { Provider, ChatResponse, ProviderHealth } from '../providers/Provider';

import { ProviderError } from '../providers/ProviderError';

class Provider401 implements Provider {
  public readonly priority = 100;
  name(): string { return 'p401'; }
  async isAvailable(): Promise<boolean> { return true; }
  async getModels() { return [{ id: 'p401-model', object: 'model' }]; }
  async getHealth(): Promise<ProviderHealth> { return { status: 'unavailable', provider: 'p401' }; }
  async chat(): Promise<ChatResponse> {
    const category = (await import('../router/ErrorClassifier')).classifyStatus(401);
    throw new ProviderError('Unauthorized', 401, this.name(), category as any, false);
  }
}

class Provider403 implements Provider {
  public readonly priority = 100;
  name(): string { return 'p403'; }
  async isAvailable(): Promise<boolean> { return true; }
  async getModels() { return [{ id: 'p403-model', object: 'model' }]; }
  async getHealth(): Promise<ProviderHealth> { return { status: 'unavailable', provider: 'p403' }; }
  async chat(): Promise<ChatResponse> {
    const category = (await import('../router/ErrorClassifier')).classifyStatus(403);
    throw new ProviderError('Forbidden', 403, this.name(), category as any, false);
  }
}

class ProviderOK implements Provider {
  public readonly priority = 90;
  public called = false;
  name(): string { return 'pok'; }
  async isAvailable(): Promise<boolean> { return true; }
  async getModels() { return [{ id: 'pok-model', object: 'model' }]; }
  async getHealth(): Promise<ProviderHealth> { return { status: 'healthy', provider: 'pok' }; }
  async chat() : Promise<ChatResponse> {
    this.called = true;
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

test('Router aborts and does not fallback on 401', async () => {
  const ok = new ProviderOK();
  const router = new Router([new Provider401(), ok]);

  await assert.rejects(async () => {
    await router.route({ model: 'router-auto', messages: [{ role: 'user', content: 'hi' }] });
  }, (err: any) => {
    // expect ProviderError with status 401
    return err && err.status === 401;
  });

  assert.equal(ok.called, false, 'Fallback provider should not be called on 401');
});

test('Router aborts and does not fallback on 403', async () => {
  const ok = new ProviderOK();
  const router = new Router([new Provider403(), ok]);

  await assert.rejects(async () => {
    await router.route({ model: 'router-auto', messages: [{ role: 'user', content: 'hi' }] });
  }, (err: any) => {
    // expect ProviderError with status 403
    return err && err.status === 403;
  });

  assert.equal(ok.called, false, 'Fallback provider should not be called on 403');
});
