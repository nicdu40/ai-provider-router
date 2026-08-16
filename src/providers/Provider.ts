export interface ModelInfo {
  id: string;
  object: string;
  created?: number;
  owned_by?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | null | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
  tool_calls?: {
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }[];
  tool_call_id?: string;
}

export interface ChatRequest {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  stream?: boolean;
  tools?: {
    type: 'function';
    function: {
      name: string;
      description?: string;
      parameters: object;
    };
  }[];
  tool_choice?: 'auto' | 'none' | {
    type: 'function';
    function: {
      name: string;
    };
  };
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
  delta: {
    role?: 'system' | 'user' | 'assistant' | 'tool';
    content?: string | null;
    tool_calls?: {
      index: number;
      id?: string;
      type?: 'function';
      function?: { name?: string; arguments?: string };
    }[];
  };
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
