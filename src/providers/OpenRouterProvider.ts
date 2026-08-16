import { ChatRequest, ChatResponse, ModelInfo, Provider, ProviderHealth } from './Provider';
import { createProviderErrorFromException, createProviderErrorFromResponse } from '../errors/createProviderError';
import { parseRetryAfterRateLimitInfo } from '../quota/RateLimitInfo';
import { parseOpenAiSse } from './streaming';

export class OpenRouterProvider implements Provider {
  public readonly priority = 80;

  constructor(private readonly apiKey: string = process.env.OPENROUTER_API_KEY ?? '') { }

  name(): string {
    return 'openrouter';
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async getModels(): Promise<ModelInfo[]> {
    return [{ id: 'openrouter/auto', object: 'model' }];
  }

  async getHealth(): Promise<ProviderHealth> {
    return {
      status: await this.isAvailable() ? 'healthy' : 'unavailable',
      provider: 'openrouter',
      message: await this.isAvailable() ? 'API key configured' : 'Missing OpenRouter API key'
    };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (!(await this.isAvailable())) {
      throw new Error('OpenRouter API key is missing');
    }

    let response: Response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3040',
          'X-Title': 'AI Provider Router'
        },
        body: JSON.stringify({
          ...request,
          model: 'openai/gpt-4o-mini',
          stream: false,
        })
      });
    } catch (error) {
      throw createProviderErrorFromException(error, this.name());
    }

    const rateLimitInfo = parseRetryAfterRateLimitInfo(response.headers);
    if (!response.ok) {
      throw await createProviderErrorFromResponse(response, this.name(), rateLimitInfo);
    }

    const payload = await response.json() as ChatResponse;
    payload.rateLimitInfo = rateLimitInfo;
    return payload;
  }

  async *streamChat(request: ChatRequest, signal?: AbortSignal) {
    if (!(await this.isAvailable())) throw new Error('OpenRouter API key is missing');
    let response: Response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', signal,
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'http://localhost:3040', 'X-Title': 'AI Provider Router' },
        body: JSON.stringify({ ...request, model: 'openai/gpt-4o-mini', stream: true })
      });
    } catch (error) {
      throw createProviderErrorFromException(error, this.name());
    }
    const rateLimitInfo = parseRetryAfterRateLimitInfo(response.headers);
    if (!response.ok) throw await createProviderErrorFromResponse(response, this.name(), rateLimitInfo);
    yield* parseOpenAiSse(response, rateLimitInfo);
  }
}
