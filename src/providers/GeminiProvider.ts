import { ChatMessage, ChatRequest, ChatResponse, ModelInfo, Provider, ProviderHealth } from './Provider';
import { createProviderErrorFromException, createProviderErrorFromResponse } from '../errors/createProviderError';
import { parseGeminiSse } from './streaming';

// Types pour l'API Gemini
interface GeminiContent {
  role: 'user' | 'model' | 'tool';
  parts: GeminiPart[];
}

interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
  function_call?: { name: string; args: object };
  function_response?: { name: string; response: object };
}

interface GeminiTool {
  function_declarations: {
    name: string;
    description?: string;
    parameters: object;
  }[];
}

/**
 * Recursively sanitizes a JSON Schema object to remove fields unsupported by the Gemini API.
 * @param schema The JSON Schema object.
 * @returns A new schema object with unsupported fields removed.
 */
function sanitizeSchema(schema: any): any {
  if (typeof schema !== 'object' || schema === null) {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map(sanitizeSchema);
  }

  const { exclusiveMinimum, exclusiveMaximum, additionalProperties, $schema, ...rest } = schema;

  return Object.fromEntries(Object.entries(rest).map(([key, value]) => [key, sanitizeSchema(value)]));
}

export class GeminiProvider implements Provider {
  public readonly priority = 100;

  constructor(private readonly apiKey: string = process.env.GEMINI_API_KEY ?? '') { }

  name(): string {
    return 'gemini';
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async getModels(): Promise<ModelInfo[]> {
    return [{ id: 'gemini-1.5-flash-latest', object: 'model' }];
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

    const tools: GeminiTool[] | undefined = request.tools
      ? [{
        function_declarations: request.tools.map(t => ({
          name: t.function.name,
          description: t.function.description,
          parameters: sanitizeSchema(t.function.parameters),
        }))
      }]
      : undefined;

    let response: Response;
    try {
      response = await fetch( // Use the latest flash model
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: toGeminiContents(request.messages),
            ...(tools ? { tools } : {}),
            generation_config: { temperature: request.temperature ?? 0.7 }
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
    const candidate = payload.candidates?.[0];
    const usageMetadata = payload?.usageMetadata;

    const message: ChatMessage = { role: 'assistant', content: null };
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.text) {
          message.content = (message.content || '') + part.text;
        }
        if (part.function_call) {
          message.tool_calls = message.tool_calls || [];
          message.tool_calls.push({
            id: part.function_call.name, // Gemini uses name as ID
            type: 'function',
            function: { name: part.function_call.name, arguments: JSON.stringify(part.function_call.args || {}) },
          });
        }
      }
    }


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
      model: 'gemini-1.5-flash-latest',
      choices: [{ index: 0, message, finish_reason: candidate?.finishReason ?? 'stop' }],
      ...(usage ? { usage } : {})
    };
  }

  async *streamChat(request: ChatRequest, signal?: AbortSignal) {
    if (!(await this.isAvailable())) throw new Error('Gemini API key is missing');
    let response: Response;

    const tools: GeminiTool[] | undefined = request.tools
      ? [{
        function_declarations: request.tools.map(t => ({
          name: t.function.name,
          description: t.function.description,
          parameters: sanitizeSchema(t.function.parameters),
        }))
      }]
      : undefined;

    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:streamGenerateContent?alt=sse&key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({
            contents: toGeminiContents(request.messages),
            ...(tools ? { tools } : {}),
            generation_config: { temperature: request.temperature ?? 0.7 }
          })
        }
      );
    } catch (error) {
      throw createProviderErrorFromException(error, this.name());
    }
    if (!response.ok) {
      throw await createProviderErrorFromResponse(response, this.name());
    }
    yield* parseGeminiSse(response);
  }
}

export function toGeminiContents(messages: ChatRequest['messages']): GeminiContent[] {
  const contents: GeminiContent[] = [];
  let systemMessage: string | null = null;

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemMessage = (systemMessage ? systemMessage + '\n' : '') + (msg.content || '');
      continue;
    }

    const role = msg.role === 'assistant' ? 'model' : msg.role;
    const parts: GeminiPart[] = [];

    let textContent = msg.content;
    if (role === 'user' && systemMessage) {
      textContent = `${systemMessage}\n\n${textContent || ''}`;
      systemMessage = null;
    }

    if (typeof textContent === 'string' && textContent.trim()) {
      parts.push({ text: textContent });
    }

    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const toolCall of msg.tool_calls) {
        try {
          parts.push({ function_call: { name: toolCall.function.name, args: JSON.parse(toolCall.function.arguments) } });
        } catch (e) { /* Ignore malformed arguments */ }
      }
    }

    if (msg.role === 'tool' && msg.tool_call_id) {
      parts.push({ function_response: { name: msg.tool_call_id, response: { content: msg.content } } });
    }

    if (parts.length > 0) {
      contents.push({ role, parts });
    }
  }
  return contents;
}
