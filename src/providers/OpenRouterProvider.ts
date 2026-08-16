import { ModelInfo, ProviderHealth } from './Provider';
import { OpenAiCompatibleProvider } from './OpenAiCompatibleProvider';
import { parseRetryAfterRateLimitInfo, RateLimitInfo } from '../quota/RateLimitInfo';

export class OpenRouterProvider extends OpenAiCompatibleProvider {
  public readonly priority = 80;

  constructor(apiKey: string = process.env.OPENROUTER_API_KEY ?? '') {
    super(apiKey, 'https://openrouter.ai/api/v1', 'openai/gpt-4o-mini');
  }

  name(): string {
    return 'openrouter';
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

  protected getHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3040', // Recommended by OpenRouter
      'X-Title': 'AI Provider Router', // Recommended by OpenRouter
    };
  }

  protected parseRateLimitInfo(headers: Headers): RateLimitInfo | undefined {
    return parseRetryAfterRateLimitInfo(headers);
  }
}
