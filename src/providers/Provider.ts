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
  stream?: boolean;
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
  rateLimitInfo?: RateLimitInfo;
}

export interface ChatStreamChunk {
  id?: string;
  created?: number;
  model?: string;
  delta: Partial<ChatMessage>;
  finish_reason?: string | null;
  usage?: ChatResponse['usage'];
  rateLimitInfo?: RateLimitInfo;
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
  streamChat?(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatStreamChunk>;
  getHealth(): Promise<ProviderHealth>;
}
import type { RateLimitInfo } from '../quota/RateLimitInfo';
