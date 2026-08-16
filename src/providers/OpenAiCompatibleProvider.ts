import {
    Provider,
    type ModelInfo,
    type ProviderHealth,
    ChatRequest,
    ChatStreamChunk,
    ChatResponse
} from './Provider';
import { createProviderErrorFromException, createProviderErrorFromResponse } from '../errors/createProviderError';
import { parseOpenAiSse } from './streaming';
import { RateLimitInfo } from '../quota/RateLimitInfo';

export abstract class OpenAiCompatibleProvider implements Provider {
    abstract readonly priority: number;

    constructor(
        protected readonly apiKey: string,
        protected readonly baseURL: string,
        protected readonly model: string,
    ) { }

    abstract name(): string;
    abstract getModels(): Promise<ModelInfo[]>;
    abstract getHealth(): Promise<ProviderHealth>;
    protected abstract getHeaders(): Record<string, string>;
    protected abstract parseRateLimitInfo(headers: Headers): RateLimitInfo | undefined;

    async isAvailable(): Promise<boolean> {
        return Boolean(this.apiKey && this.apiKey.trim().length > 0);
    }

    async chat(request: ChatRequest): Promise<ChatResponse> {
        const response = await this.makeRequest({ ...request, stream: false });
        const rateLimitInfo = this.parseRateLimitInfo(response.headers);
        if (!response.ok) {
            throw await createProviderErrorFromResponse(response, this.name(), rateLimitInfo);
        }
        const payload = await response.json() as ChatResponse;
        payload.rateLimitInfo = rateLimitInfo;
        return payload;
    }

    async *streamChat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatStreamChunk> {
        const response = await this.makeRequest({ ...request, stream: true }, signal);
        const rateLimitInfo = this.parseRateLimitInfo(response.headers);
        if (!response.ok) {
            throw await createProviderErrorFromResponse(response, this.name(), rateLimitInfo);
        }
        yield* parseOpenAiSse(response, rateLimitInfo);
    }

    private async makeRequest(body: object, signal?: AbortSignal): Promise<Response> {
        const url = `${this.baseURL}/chat/completions`;
        try {
            return await fetch(url, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({ ...body, model: this.model }),
                signal,
            });
        } catch (error) {
            throw createProviderErrorFromException(error, this.name());
        }
    }
}