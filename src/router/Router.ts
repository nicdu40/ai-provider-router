import { ChatRequest, ChatResponse, ModelInfo, Provider } from '../providers/Provider';
import { QuotaManager } from '../quota/QuotaManager';
import { ProviderSelector } from './ProviderSelector';
import config from '../config/config';
import { logger } from '../logging/logger';
import { ProviderError } from '../providers/ProviderError';

export class Router {
  private readonly selector: ProviderSelector;
  private readonly quotaManager: QuotaManager;

  constructor(private readonly providers: Provider[], quotaManager?: QuotaManager) {
    this.quotaManager = quotaManager ?? new QuotaManager();
    this.selector = new ProviderSelector(providers, this.quotaManager);
  }

  async getModels(): Promise<ModelInfo[]> {
    const providerModels = await Promise.all(
      this.providers.map(async (provider) => provider.getModels())
    );

    return [
      { id: 'router-auto', object: 'model' },
      ...providerModels.flat()
    ];
  }

  async route(request: ChatRequest): Promise<ChatResponse> {
    const attemptedProviders = new Set<string>();

    while (true) {
      const provider = await this.selector.select(attemptedProviders);
      if (!provider) {
        throw new Error('No available provider remaining');
      }

      attemptedProviders.add(provider.name());
      try {
        // record request
        this.quotaManager.recordRequest(provider.name());

        const resp = await provider.chat(request);

        const tokenCount = responseTokenCount(resp);
        this.quotaManager.recordSuccess(provider.name(), tokenCount);
        return resp;
      } catch (error) {
        const providerError = error instanceof ProviderError
          ? error
          : new ProviderError('Provider request failed', undefined, provider.name(), 'NETWORK_ERROR', true);
        const { status, category, retryable } = providerError;
        const msg = providerError.message;

        if (category === 'FATAL' || category === 'BAD_REQUEST') {
          logger.error(`${provider.name()} returned ${status} — aborting`);
          this.quotaManager.recordError(provider.name());
          throw providerError;
        }

        if (retryable && status === 429) {
          logger.warn(`${provider.name()} returned ${status} — placing in cooldown for ${config.cooldownSeconds}s`);
          this.quotaManager.recordRateLimit(provider.name());
        } else if (retryable) {
          logger.warn(`${provider.name()} returned ${category ?? 'retryable error'} — trying fallback`);
          this.quotaManager.recordError(provider.name());
        } else {
          logger.warn(`${provider.name()} returned error: ${msg} — trying fallback`);
          this.quotaManager.recordError(provider.name());
        }

      }
    }
  }
}

function responseTokenCount(response: ChatResponse): number | undefined {
  const tokenCount = response.usage?.total_tokens;
  return typeof tokenCount === 'number' ? tokenCount : undefined;
}
