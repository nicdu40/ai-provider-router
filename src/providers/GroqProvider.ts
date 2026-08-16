import { ChatRequest, ChatResponse, ModelInfo, Provider, ProviderHealth } from './Provider';
import { createProviderErrorFromException, createProviderErrorFromResponse } from '../errors/createProviderError';
import { parseGroqRateLimitInfo } from '../quota/RateLimitInfo';
import { parseOpenAiSse } from './streaming';

export class GroqProvider implements Provider {
  public readonly priority = 90;

  constructor(private readonly apiKey: string = process.env.GROQ_API_KEY ?? '') {}

  name(): string {
    return 'groq';
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async getModels(): Promise<ModelInfo[]> {
    return [{ id: 'llama-3.3-70b-versatile', object: 'model' }];
  }

  async getHealth(): Promise<ProviderHealth> {
    return {
      status: await this.isAvailable() ? 'healthy' : 'unavailable',
      provider: 'groq',
      message: await this.isAvailable() ? 'API key configured' : 'Missing Groq API key'
    };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (!(await this.isAvailable())) {
      throw new Error('Groq API key is missing');
    }

    let response: Response;
    try {
      response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: request.messages,
        temperature: request.temperature ?? 0.7
      })
      });
    } catch (error) {
      throw createProviderErrorFromException(error, this.name());
    }

    const rateLimitInfo = parseGroqRateLimitInfo(response.headers);
    if (!response.ok) {
      throw await createProviderErrorFromResponse(response, this.name(), rateLimitInfo);
    }

    const payload = await response.json() as any;
    const text = payload?.choices?.[0]?.message?.content ?? 'No response returned by Groq';

    return {
      id: payload?.id ?? `groq-${Date.now()}`,
      object: payload?.object ?? 'chat.completion',
      created: payload?.created ?? Math.floor(Date.now() / 1000),
      model: payload?.model ?? request.model ?? 'llama-3.3-70b-versatile',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: payload?.choices?.[0]?.finish_reason ?? 'stop'
        }
      ],
      ...(payload?.usage ? { usage: payload.usage } : {}),
      rateLimitInfo
    };
  }

  async *streamChat(request: ChatRequest, signal?: AbortSignal) {
    if (!(await this.isAvailable())) throw new Error('Groq API key is missing');
    let response: Response;
    try {
      response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', signal,
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: request.messages, temperature: request.temperature ?? 0.7, stream: true, stream_options: { include_usage: true } })
      });
    } catch (error) {
      throw createProviderErrorFromException(error, this.name());
    }
    const rateLimitInfo = parseGroqRateLimitInfo(response.headers);
    if (!response.ok) throw await createProviderErrorFromResponse(response, this.name(), rateLimitInfo);
    yield* parseOpenAiSse(response, rateLimitInfo);
  }
}
