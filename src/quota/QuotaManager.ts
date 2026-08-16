import ProviderUsage from './ProviderUsage';
import config from '../config/config';

export interface QuotaManagerOptions {
  defaultCooldownMs?: number;
}

export class QuotaManager {
  private usages: Map<string, ProviderUsage> = new Map();
  private defaultCooldownMs: number;

  constructor(options?: QuotaManagerOptions) {
    this.defaultCooldownMs = options?.defaultCooldownMs ?? (config.cooldownSeconds ?? 60) * 1000;
  }

  ensure(provider: string) {
    if (!this.usages.has(provider)) {
      this.usages.set(provider, {
        provider,
        requestCount: 0,
        tokenCount: null,
        lastRequestAt: undefined,
        lastSuccessAt: undefined,
        lastErrorAt: undefined,
        lastRateLimitAt: undefined,
        cooldownUntil: undefined,
        available: true
      });
    }
    return this.usages.get(provider)!;
  }

  isAvailable(provider: string): boolean {
    const u = this.ensure(provider);
    const now = Date.now();
    if (u.cooldownUntil && now < u.cooldownUntil) {
      return false;
    }

    // If cooldown expired, clear it and mark available
    if (u.cooldownUntil && now >= u.cooldownUntil) {
      u.cooldownUntil = undefined;
      u.available = true;
    }

    return u.available;
  }

  recordRequest(provider: string) {
    const u = this.ensure(provider);
    u.requestCount += 1;
    u.lastRequestAt = Date.now();
  }

  recordSuccess(provider: string, tokenCount?: number | null) {
    const u = this.ensure(provider);
    u.lastSuccessAt = Date.now();
    if (typeof tokenCount === 'number') {
      u.tokenCount = (u.tokenCount ?? 0) + tokenCount;
    }
    u.available = true;
  }

  recordError(provider: string) {
    const u = this.ensure(provider);
    u.lastErrorAt = Date.now();
  }

  recordRateLimit(provider: string, cooldownMs?: number) {
    const u = this.ensure(provider);
    const now = Date.now();
    u.lastRateLimitAt = now;
    const cd = cooldownMs ?? this.defaultCooldownMs;
    u.cooldownUntil = now + cd;
    u.available = false;
  }

  getStatus(provider: string): ProviderUsage {
    return { ...this.ensure(provider) };
  }

  getAllStatuses(): ProviderUsage[] {
    return Array.from(this.usages.values()).map(u => ({ ...u }));
  }
}

export default QuotaManager;
