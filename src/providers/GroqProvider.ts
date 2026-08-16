import { ModelInfo, ProviderHealth } from './Provider';
import { OpenAiCompatibleProvider } from './OpenAiCompatibleProvider';
import { parseGroqRateLimitInfo, RateLimitInfo } from '../quota/RateLimitInfo';

export class GroqProvider extends OpenAiCompatibleProvider {
  public readonly priority = 90;

  constructor(
    apiKey: string = process.env.GROQ_API_KEY ?? '',
  ) {
    super(apiKey, 'https://api.groq.com/openai/v1', 'llama-3.3-70b-versatile');
  }

  name(): string {
    return 'groq';
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

  protected getHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  protected parseRateLimitInfo(headers: Headers): RateLimitInfo | undefined {
    return parseGroqRateLimitInfo(headers);
  }
}
