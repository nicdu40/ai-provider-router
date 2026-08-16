import { ChatResponse, ChatStreamChunk } from './Provider';
import { RateLimitInfo } from '../quota/RateLimitInfo';

export async function* parseOpenAiSse(response: Response, rateLimitInfo?: RateLimitInfo): AsyncIterable<ChatStreamChunk> {
  let includeRateLimitInfo = rateLimitInfo;
  for await (const data of readSseData(response)) {
    if (data === '[DONE]') return;
    const payload = parseJson(data);
    if (!payload) continue;
    const choice = payload.choices?.[0];
    if (!choice && !payload.usage) continue;
    yield {
      id: typeof payload.id === 'string' ? payload.id : undefined,
      created: typeof payload.created === 'number' ? payload.created : undefined,
      model: typeof payload.model === 'string' ? payload.model : undefined,
      delta: {
        ...(typeof choice?.delta?.role === 'string' ? { role: choice.delta.role } : {}),
        ...(typeof choice?.delta?.content === 'string' ? { content: choice.delta.content } : {}),
        ...(choice?.delta?.tool_calls ? { tool_calls: choice.delta.tool_calls } : {})
      },
      ...(choice?.finish_reason !== undefined ? { finish_reason: choice.finish_reason } : {}),
      ...(payload.usage ? { usage: payload.usage as ChatResponse['usage'] } : {}),
      ...(includeRateLimitInfo ? { rateLimitInfo: includeRateLimitInfo } : {})
    };
    includeRateLimitInfo = undefined;
  }
}

export async function* parseGeminiSse(response: Response): AsyncIterable<ChatStreamChunk> {
  for await (const data of readSseData(response)) {
    const payload = parseJson(data);
    if (!payload) continue;
    const candidate = payload.candidates?.[0];
    const content = candidate?.content?.parts?.map((part: any) => typeof part?.text === 'string' ? part.text : '').join('');
    const usageMetadata = payload.usageMetadata;
    const usage = typeof usageMetadata?.totalTokenCount === 'number'
      ? { prompt_tokens: typeof usageMetadata.promptTokenCount === 'number' ? usageMetadata.promptTokenCount : null, completion_tokens: typeof usageMetadata.candidatesTokenCount === 'number' ? usageMetadata.candidatesTokenCount : null, total_tokens: usageMetadata.totalTokenCount }
      : undefined;
    if (content === undefined && !usage && candidate?.finishReason === undefined) continue;
    yield { delta: typeof content === 'string' ? { content } : {}, ...(candidate?.finishReason !== undefined ? { finish_reason: candidate.finishReason } : {}), ...(usage ? { usage } : {}) };
  }
}

async function* readSseData(response: Response): AsyncIterable<string> {
  if (!response.body) throw new Error('Provider returned an empty stream body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? '';
      for (const event of events) {
        const data = event.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
        if (data) yield data;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseJson(value: string): any | undefined {
  try { return JSON.parse(value); } catch { return undefined; }
}
