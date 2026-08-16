import { ModelInfo, ProviderHealth } from './Provider';
import { OpenAiCompatibleProvider } from './OpenAiCompatibleProvider';
import { parseRetryAfterRateLimitInfo, RateLimitInfo } from '../quota/RateLimitInfo';

export class NvidiaProvider extends OpenAiCompatibleProvider {
    static readonly providerName = 'nvidia';
    public readonly priority = 95;

    constructor(
        apiKey: string = process.env.NVIDIA_API_KEY ?? '',
        baseURL: string = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
        model: string = process.env.NVIDIA_MODEL || 'z-ai/glm-5.2'
    ) {
        super(apiKey, baseURL, model);
    }

    name(): string {
        return NvidiaProvider.providerName;
    }

    async getModels(): Promise<ModelInfo[]> {
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

    protected getHeaders(): Record<string, string> {
        return {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
        };
    }

    protected parseRateLimitInfo(headers: Headers): RateLimitInfo | undefined {
        // Attempt to parse the standard 'Retry-After' header, just in case.
        return parseRetryAfterRateLimitInfo(headers);
    }
}

export const nvidiaProvider = new NvidiaProvider();