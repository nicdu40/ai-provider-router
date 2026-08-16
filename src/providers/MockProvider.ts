import { ChatRequest, ChatResponse, ModelInfo, Provider, ProviderHealth } from './Provider';

export class MockProvider implements Provider {
  public readonly priority = 0;

  name(): string {
    return 'mock';
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async getModels(): Promise<ModelInfo[]> {
    return [
      { id: 'mock-model-1', object: 'model' }
    ];
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const now = Math.floor(Date.now() / 1000);
    const model = request.model || 'router-auto';

    return {
      id: `mock-${Date.now()}`,
      object: 'chat.completion',
      created: now,
      model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Mock provider response'
          },
          finish_reason: 'stop'
        }
      ],
    };
  }

  async getHealth(): Promise<ProviderHealth> {
    return {
      status: 'healthy',
      provider: 'mock',
      message: 'Mock provider is available and healthy'
    };
  }
}
