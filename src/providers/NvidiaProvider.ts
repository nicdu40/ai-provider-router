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

export class NvidiaProvider implements Provider {
    static readonly providerName = 'nvidia';
    // Priorité entre Gemini (100) et Groq (90)
    public readonly priority = 95;

    constructor(
        private readonly apiKey: string = process.env.NVIDIA_API_KEY ?? '',
        private readonly baseURL: string = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
        private readonly model: string = process.env.NVIDIA_MODEL || 'z-ai/glm-5.2'
    ) { }

    name(): string {
        return NvidiaProvider.providerName;
    }

    async isAvailable(): Promise<boolean> {
        // Le fournisseur est disponible si la clé API est configurée.
        return Boolean(this.apiKey && this.apiKey.trim().length > 0);
    }

    async getModels(): Promise<ModelInfo[]> {
        // Retourne le modèle configuré.
        return [{ id: this.model || 'nvidia/auto', object: 'model' }];
    }

    async getHealth(): Promise<ProviderHealth> {
        const available = await this.isAvailable();
        return {
            status: available ? 'healthy' : 'unavailable',
            provider: this.name(),
            message: available ? 'API key configured' : 'Missing NVIDIA_API_KEY',
        };
    }

    private getHeaders(): Record<string, string> {
        return {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
        };
    }

    async chat(request: ChatRequest): Promise<ChatResponse> {
        if (!(await this.isAvailable())) {
            throw new Error('Nvidia API key is missing');
        }

        const url = `${this.baseURL}/chat/completions`;
        const body = {
            ...request,
            model: this.model,
            stream: false,
        };

        let response: Response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(body),
            });
        } catch (error) {
            throw createProviderErrorFromException(error, this.name());
        }

        if (!response.ok) {
            throw await createProviderErrorFromResponse(response, this.name());
        }

        // L'API NVIDIA est compatible OpenAI, on peut donc retourner la réponse directement.
        return await response.json() as ChatResponse;
    }

    async *streamChat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatStreamChunk> {
        if (!(await this.isAvailable())) {
            throw new Error('Nvidia API key is missing');
        }

        const url = `${this.baseURL}/chat/completions`;
        const body = {
            ...request,
            model: this.model,
            stream: true,
        };

        let response: Response;
        try {
            response = await fetch(url, { method: 'POST', headers: this.getHeaders(), body: JSON.stringify(body), signal });
        } catch (error) {
            throw createProviderErrorFromException(error, this.name());
        }

        if (!response.ok) {
            throw await createProviderErrorFromResponse(response, this.name());
        }
        yield* parseOpenAiSse(response);
    }
}

export const nvidiaProvider = new NvidiaProvider();