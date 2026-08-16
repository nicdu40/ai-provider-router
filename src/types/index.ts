import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ModelInfo,
  Provider,
  ProviderHealth
} from '../providers/Provider';

export type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ModelInfo,
  Provider,
  ProviderHealth
};

export interface ChatCompletionRequest {
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

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model?: string;
  choices: ChatCompletionChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}
