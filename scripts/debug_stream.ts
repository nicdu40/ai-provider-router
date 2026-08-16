import request from 'supertest';
import { createApp } from '../src/server/server';
import { QuotaManager } from '../src/quota/QuotaManager';
import { ChatStreamChunk, Provider } from '../src/providers/Provider';
import { ProviderError } from '../src/providers/ProviderError';

class StreamProvider implements Provider {
  constructor(private readonly providerName: string, public readonly priority: number) {}
  name() { return this.providerName; }
  priority = 90;
  async isAvailable() { return true; }
  async getModels() { return []; }
  async getHealth() { return { status: 'healthy', provider: this.providerName }; }
  async chat() { return { id:'', object:'chat.completion', created:1, choices:[{index:0, message:{role:'assistant', content:'non-stream'}, finish_reason:'stop'}] } as any; }
  async *streamChat() {
    yield { id: '1', created: 1, model: this.providerName, delta: { role: 'assistant', content: 'Hello' } } as ChatStreamChunk;
    yield { id: '1', created: 1, model: this.providerName, delta: { content: ' world' }, finish_reason: 'stop', usage: { prompt_tokens:4, completion_tokens:2, total_tokens:6 } } as ChatStreamChunk;
  }
}

async function streamRequest(app: ReturnType<typeof createApp>, body: any) {
  return request(app)
    .post('/v1/chat/completions')
    .send(body)
    .buffer(true)
    .parse((res, callback) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => callback(null, text));
    })
    .expect(200);
}

(async () => {
  const provider = new StreamProvider('groq', 90);
  const app = createApp([provider], new QuotaManager());
  const resp = await streamRequest(app, { model: 'router-auto', stream: true, messages: [{ role: 'user', content: 'hi' }] });
  console.log('headers:', resp.headers);
  console.log('text:', JSON.stringify(resp.text));
})();
