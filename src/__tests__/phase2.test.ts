import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';

import { app } from '../server/server';
import { MockProvider } from '../providers/MockProvider';
import { Provider } from '../providers/Provider';
import { ProviderSelector } from '../router/ProviderSelector';

test('MockProvider.name()', async () => {
  const provider = new MockProvider();
  assert.equal(provider.name(), 'mock');
});

test('MockProvider.isAvailable()', async () => {
  const provider = new MockProvider();
  assert.equal(await provider.isAvailable(), true);
});

test('MockProvider.getModels()', async () => {
  const provider = new MockProvider();
  const models = await provider.getModels();
  assert.deepEqual(models, [{ id: 'mock-model-1', object: 'model' }]);
});

test('MockProvider.chat()', async () => {
  const provider = new MockProvider();
  const result = await provider.chat({
    model: 'router-auto',
    messages: [{ role: 'user', content: 'Bonjour' }]
  });

  assert.equal(result.model, 'router-auto');
  assert.equal(result.choices[0].message.content, 'Mock provider response');
  assert.equal(result.object, 'chat.completion');
});

test('ProviderSelector selects an available provider', async () => {
  const selector = new ProviderSelector([new MockProvider()]);
  const provider = await selector.select();

  assert.ok(provider);
  assert.equal(provider?.name(), 'mock');
});

test('ProviderSelector does not select an unavailable provider', async () => {
  const unavailableProvider: Provider = {
    name: () => 'unavailable',
    isAvailable: async () => false,
    getModels: async () => [],
    chat: async () => {
      throw new Error('should not be called');
    },
    getHealth: async () => ({
      status: 'unavailable',
      provider: 'unavailable',
      message: 'down'
    })
  };

  const selector = new ProviderSelector([unavailableProvider, new MockProvider()]);
  const provider = await selector.select();

  assert.ok(provider);
  assert.equal(provider?.name(), 'mock');
});

test('POST /v1/chat/completions routes through Router and MockProvider', async () => {
  const response = await request(app)
    .post('/v1/chat/completions')
    .send({
      model: 'router-auto',
      messages: [{ role: 'user', content: 'Bonjour' }]
    })
    .expect(200);

  assert.equal(response.body.model, 'router-auto');
  assert.equal(response.body.choices[0].message.content, 'Mock provider response');
  assert.equal(response.body.object, 'chat.completion');
});
