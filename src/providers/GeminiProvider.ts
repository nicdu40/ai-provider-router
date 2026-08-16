import { ChatRequest, ChatResponse, ModelInfo, Provider, ProviderHealth } from './Provider';
import { createProviderErrorFromException, createProviderErrorFromResponse } from '../errors/createProviderError';

export class GeminiProvider implements Provider {
  public readonly priority = 100;

  constructor(private readonly apiKey: string = process.env.GEMINI_API_KEY ?? '') {}

  name(): string {
    return 'gemini';
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async getModels(): Promise<ModelInfo[]> {
    return [{ id: 'gemini-2.5-flash', object: 'model' }];
  }

  async getHealth(): Promise<ProviderHealth> {
    return {
      status: await this.isAvailable() ? 'healthy' : 'unavailable',
      provider: 'gemini',
      message: await this.isAvailable() ? 'API key configured' : 'Missing Gemini API key'
    };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (!(await this.isAvailable())) {
      throw new Error('Gemini API key is missing');
    }

    let response: Response;
    try {
      response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: request.messages.map((message) => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: message.content }]
          })),
          generationConfig: {
            temperature: request.temperature ?? 0.7
          }
        })
      }
      );
    } catch (error) {
      throw createProviderErrorFromException(error, this.name());
    }

    if (!response.ok) {
      throw await createProviderErrorFromResponse(response, this.name());
    }

    const payload = await response.json() as any;
    const text = payload?.candidates?.[0]?.content?.parts
      ?.map((part: any) => part.text ?? '')
      .join('') ?? 'No response returned by Gemini';

    const usageMetadata = payload?.usageMetadata;
    const usage = typeof usageMetadata?.totalTokenCount === 'number'
      ? {
          prompt_tokens: typeof usageMetadata.promptTokenCount === 'number' ? usageMetadata.promptTokenCount : null,
          completion_tokens: typeof usageMetadata.candidatesTokenCount === 'number' ? usageMetadata.candidatesTokenCount : null,
          total_tokens: usageMetadata.totalTokenCount
        }
      : undefined;

    return {
      id: `gemini-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: request.model ?? 'gemini-2.5-flash',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: 'stop'
        }
      ],
      ...(usage ? { usage } : {})
    };
  }
}
