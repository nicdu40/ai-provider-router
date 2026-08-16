import { Provider } from '../providers/Provider';
import { QuotaManager } from '../quota/QuotaManager';

export class ProviderSelector {
  constructor(
    private readonly providers: Provider[],
    private readonly quota?: QuotaManager
  ) { }

  async select(excludedProviders: ReadonlySet<string> = new Set()): Promise<Provider | null> {
    const availableProviders = await Promise.all(
      this.providers.map(async (provider) => ({
        provider,
        available: await provider.isAvailable()
      }))
    );

    const filtered = availableProviders.filter(({ provider, available }) => {
      if (!available) return false;
      if (excludedProviders.has(provider.name())) return false;
      if (this.quota && !this.quota.isAvailable(provider.name())) return false;
      return true;
    });

    const sorted = filtered.sort((a, b) => (b.provider.priority ?? 0) - (a.provider.priority ?? 0));

    return sorted[0]?.provider ?? null;
  }
}
