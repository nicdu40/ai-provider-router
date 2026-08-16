import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';

import { ChatRequest, ChatResponse, ChatStreamChunk, ModelInfo, Provider, ProviderHealth } from '../providers/Provider';
import { ProviderError } from '../providers/ProviderError';
import { QuotaManager } from '../quota/QuotaManager';
import { Router } from '../router/Router';
import { createApp } from '../server/server';

class StreamProvider implements Provider {
  public streamCalls = 0;
  public chatCalls = 0;

  constructor(
    private readonly providerName: string,
    public readonly priority: number,
    private readonly mode: 'success' | 'pre-rate-limit' | 'after-chunk-error' | 'auth' | 'unavailable',
    private readonly rateLimitInfo?: ChatStreamChunk['rateLimitInfo']
  ) {}

  name(): string { return this.providerName; }
  async isAvailable(): Promise<boolean> { return this.mode !== 'unavailable'; }
  async getModels(): Promise<ModelInfo[]> { return []; }
  async getHealth(): Promise<ProviderHealth> { return { status: 'healthy', provider: this.providerName }; }
  async chat(_request: ChatRequest): Promise<ChatResponse> {
    this.chatCalls += 1;
    return { id: this.providerName, object: 'chat.completion', created: 1, model: this.providerName, choices: [{ index: 0, message: { role: 'assistant', content: 'non-stream' }, finish_reason: 'stop' }] };
  }

  async *streamChat(_request: ChatRequest, _signal?: AbortSignal): AsyncIterable<ChatStreamChunk> {
    this.streamCalls += 1;
    if (this.mode === 'pre-rate-limit') {
      throw new ProviderError('Rate limited', 429, this.providerName, 'RETRYABLE', true, { observedAt: Date.now(), retryAfterMs: 12_000 });
    }
    if (this.mode === 'auth') throw new ProviderError('Unauthorized', 401, this.providerName, 'FATAL', false);
    yield { id: `${this.providerName}-stream`, created: 1, model: this.providerName, delta: { role: 'assistant', content: 'Hello' }, ...(this.rateLimitInfo ? { rateLimitInfo: this.rateLimitInfo } : {}) };
    if (this.mode === 'after-chunk-error') {
      throw new ProviderError('Stream interrupted', 503, this.providerName, 'RETRYABLE', true);
    }
    yield { id: `${this.providerName}-stream`, created: 1, model: this.providerName, delta: { content: ' world' }, finish_reason: 'stop', usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } };
  }
}

const streamBody = { model: 'router-auto', stream: true, messages: [{ role: 'user', content: 'hello' }] };

test('stream=true returns OpenAI SSE chunks, final usage, and [DONE]', async () => {
  const quota = new QuotaManager();
  const provider = new StreamProvider('groq', 90, 'success', { observedAt: Date.now(), requests: { remaining: 42 } });
  const response = await streamRequest(createApp([provider], quota), streamBody);

  assert.match(response.headers['content-type'] ?? '', /^text\/event-stream/);
  const text = typeof response.text === 'string' ? response.text : String(response.body ?? '');
  console.log('DEBUG stream response text:', text.slice(0, 200));
  assert.match(text, /data: .*"content":"Hello"/);
  assert.match(text, /data: .*"content":" world"/);
  assert.match(text, /"total_tokens":6/);
  assert.match(text, /data: \[DONE\]\n\n$/);
  assert.equal(quota.getStatus('groq').tokenCount, 6);
  assert.equal(quota.getStatus('groq').rateLimitInfo?.requests?.remaining, 42);
});

test('stream=false keeps the non-streaming HTTP behavior', async () => {
  const provider = new StreamProvider('gemini', 100, 'success');
  const response = await request(createApp([provider])).post('/v1/chat/completions').send({ ...streamBody, stream: false }).expect(200);

  assert.equal(response.headers['content-type']?.startsWith('application/json'), true);
  assert.equal(response.body.object, 'chat.completion');
  assert.equal(provider.chatCalls, 1);
  assert.equal(provider.streamCalls, 0);
});

test('a pre-stream 429 falls back and uses Retry-After cooldown', async () => {
  const quota = new QuotaManager({ defaultCooldownMs: 1_000 });
  const primary = new StreamProvider('gemini', 100, 'pre-rate-limit');
  const fallback = new StreamProvider('groq', 90, 'success');
  const before = Date.now();
  const response = await streamRequest(createApp([primary, fallback], quota), streamBody);
  const text = typeof response.text === 'string' ? response.text : String(response.body ?? '');

  assert.match(text, /"model":"groq"/);
  assert.equal(primary.streamCalls, 1);
  assert.equal(fallback.streamCalls, 1);
  assert.ok((quota.getStatus('gemini').cooldownUntil ?? 0) >= before + 12_000);
});

test('a post-chunk error terminates SSE without fallback', async () => {
  const primary = new StreamProvider('gemini', 100, 'after-chunk-error');
  const fallback = new StreamProvider('groq', 90, 'success');
  const response = await streamRequest(createApp([primary, fallback]), streamBody);
  const text = typeof response.text === 'string' ? response.text : String(response.body ?? '');

  assert.match(text, /"content":"Hello"/);
  assert.match(text, /"code":"stream_interrupted"/);
  assert.match(text, /data: \[DONE\]/);
  assert.equal(fallback.streamCalls, 0);
});

test('401 before streaming aborts with an OpenAI-compatible JSON error', async () => {
  const primary = new StreamProvider('gemini', 100, 'auth');
  const fallback = new StreamProvider('groq', 90, 'success');
  const response = await request(createApp([primary, fallback])).post('/v1/chat/completions').send(streamBody).expect(503);

  assert.equal(response.body.error.code, 'provider_unavailable');
  assert.equal(fallback.streamCalls, 0);
});

test('no available streaming provider returns an OpenAI-compatible JSON error', async () => {
  const response = await request(createApp([new StreamProvider('gemini', 100, 'unavailable')]))
    .post('/v1/chat/completions').send(streamBody).expect(503);
  assert.equal(response.body.error.code, 'provider_unavailable');
});

test('an aborted stream stops the provider and does not start a fallback', async () => {
  let aborted = false;
  const primary = new StreamProvider('gemini', 100, 'success');
  primary.streamChat = async function* (_request, signal) {
    this.streamCalls += 1;
    yield { delta: { content: 'first' } };
    await new Promise<void>((resolve) => signal?.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }));
  };
  const fallback = new StreamProvider('groq', 90, 'success');
  const controller = new AbortController();
  const iterator = new Router([primary, fallback]).routeStream({ messages: [{ role: 'user', content: 'hi' }], stream: true }, controller.signal)[Symbol.asyncIterator]();

  assert.equal((await iterator.next()).value?.delta.content, 'first');
  controller.abort();
  await iterator.next();
  assert.equal(aborted, true);
  assert.equal(fallback.streamCalls, 0);
});

async function streamRequest(app: ReturnType<typeof createApp>, body: any) {
  return request(app)
    .post('/v1/chat/completions')
    .send(body as any)
    .buffer(true)
    .parse((res, callback) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => callback(null, text));
    })
    .expect(200);
}
