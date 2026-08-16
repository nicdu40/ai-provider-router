import { ChatRequest, ChatResponse, ChatStreamChunk, ModelInfo, Provider } from '../providers/Provider';
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

      // Log which provider was selected for this attempt (covers streaming and non-streaming)
      logger.router('selected', { provider: provider.name() });
      attemptedProviders.add(provider.name());
      try {
        // record request
        this.quotaManager.recordRequest(provider.name());

        const resp = await provider.chat(request);
        const { rateLimitInfo, ...response } = resp;
        if (rateLimitInfo) {
          this.quotaManager.recordRateLimitInfo(provider.name(), rateLimitInfo);
        }

        const tokenCount = responseTokenCount(response);
        this.quotaManager.recordSuccess(provider.name(), tokenCount);
        return response;
      } catch (error) {
        const providerError = error instanceof ProviderError
          ? error
          : new ProviderError('Provider request failed', undefined, provider.name(), 'NETWORK_ERROR', true);
        const { status, category, retryable } = providerError;
        const msg = providerError.message;
        if (providerError.rateLimitInfo) {
          this.quotaManager.recordRateLimitInfo(provider.name(), providerError.rateLimitInfo);
        }

        // If the provider reports its configured model is unavailable, put it in cooldown
        if (providerError.category === 'MODEL_UNAVAILABLE') {
          logger.warn(`${provider.name()} reported model unavailable (${status}) — disabling until restart`);
          this.quotaManager.recordModelUnavailable(provider.name());
          continue; // try next provider
        }

        if (category === 'FATAL' || category === 'BAD_REQUEST') {
          logger.error(`${provider.name()} returned ${status} — aborting`);
          this.quotaManager.recordError(provider.name());
          throw providerError;
        }

        const retryAfterMs = providerError.rateLimitInfo?.retryAfterMs;
        if (retryAfterMs !== undefined) {
          logger.warn(`${provider.name()} returned ${status} — applying Retry-After cooldown`);
          this.quotaManager.recordRateLimit(provider.name(), retryAfterMs);
        } else if (retryable && status === 429) { // Correctly access the config value
          logger.warn(`${provider.name()} returned ${status} — placing in cooldown for ${config.router.cooldownSeconds}s`);
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

  async *routeStream(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatStreamChunk> {
    const attemptedProviders = new Set<string>();

    while (!signal?.aborted) {
      const provider = await this.selector.select(attemptedProviders);
      if (!provider) throw new Error('No available provider remaining');
      attemptedProviders.add(provider.name());
      let streamStarted = false;
      let tokenCount: number | undefined;

      try {
        if (!provider.streamChat) {
          throw new ProviderError('Provider does not support streaming', undefined, provider.name(), 'BAD_REQUEST', false);
        }
        this.quotaManager.recordRequest(provider.name());
        for await (const chunk of provider.streamChat(request, signal)) {
          if (signal?.aborted) return;
          // On first real chunk, record that this provider actually started streaming
          if (!streamStarted) {
            logger.router('selected', { provider: provider.name(), stream: true });
          }
          streamStarted = true;
          if (chunk.rateLimitInfo) this.quotaManager.recordRateLimitInfo(provider.name(), chunk.rateLimitInfo);
          const chunkTokens = chunk.usage?.total_tokens;
          if (typeof chunkTokens === 'number') tokenCount = chunkTokens;
          yield chunk;
        }
        if (!signal?.aborted) this.quotaManager.recordSuccess(provider.name(), tokenCount);
        return;
      } catch (error) {
        if (signal?.aborted) return;
        const providerError = error instanceof ProviderError
          ? error
          : new ProviderError('Provider stream failed', undefined, provider.name(), 'NETWORK_ERROR', true);
        if (providerError.rateLimitInfo) this.quotaManager.recordRateLimitInfo(provider.name(), providerError.rateLimitInfo);

        // Ensure we always log pre-stream failures so callers can see the failing provider/status
        const status = providerError.status ?? 'unknown';
        if (!streamStarted) {
          logger.router('failed', { provider: provider.name(), status, message: providerError.message });
        }
        // If the provider reports its model is unavailable, cool it down and try the next provider
        if (providerError.category === 'MODEL_UNAVAILABLE') {
          logger.warn(`${provider.name()} reported model unavailable (${status}) — disabling until restart`);
          this.quotaManager.recordModelUnavailable(provider.name());
          continue;
        }
        // Logging for stream errors and pre-start failures
        if (streamStarted) {
          logger.router('error', { provider: provider.name(), message: providerError.message, status });
          this.quotaManager.recordError(provider.name());
          throw providerError;
        }
        if (providerError.category === 'FATAL' || providerError.category === 'BAD_REQUEST') {
          logger.error(`${provider.name()} returned ${status} — aborting`, { provider: provider.name(), status });
          this.quotaManager.recordError(provider.name());
          throw providerError;
        }

        // (if the stream had already started we logged and handle above)
        const retryAfterMs = providerError.rateLimitInfo?.retryAfterMs;
        if (retryAfterMs !== undefined) {
          logger.warn(`${provider.name()} returned ${status} — applying Retry-After cooldown`);
          this.quotaManager.recordRateLimit(provider.name(), retryAfterMs);
        } else if (providerError.retryable && providerError.status === 429) { // Correctly access the config value
          logger.warn(`${provider.name()} returned ${status} — placing in cooldown for ${config.router.cooldownSeconds}s`);
          this.quotaManager.recordRateLimit(provider.name());
        } else {
          logger.warn(`${provider.name()} returned ${providerError.category ?? 'retryable error'} — trying fallback`);
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
