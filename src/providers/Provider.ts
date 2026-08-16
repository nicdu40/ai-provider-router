export interface ModelInfo {
  id: string;
  object: string;
  created?: number;
  owned_by?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string | null;
}

export interface ChatResponse {
  id: string;
  object: string;
  created: number;
  model?: string;
  choices: ChatCompletionChoice[];
  usage?: {
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    total_tokens?: number | null;
  };
}

export interface ProviderHealth {
  status: 'healthy' | 'degraded' | 'unavailable';
  provider: string;
  message?: string;
}

export interface Provider {
  name(): string;
  priority?: number;
  isAvailable(): Promise<boolean>;
  getModels(): Promise<ModelInfo[]>;
  chat(request: ChatRequest): Promise<ChatResponse>;
  getHealth(): Promise<ProviderHealth>;
}
