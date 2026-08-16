export interface ProviderUsage {
  provider: string;
  requestCount: number;
  tokenCount: number | null;
  lastRequestAt?: number;
  lastSuccessAt?: number;
  lastErrorAt?: number;
  lastRateLimitAt?: number;
  cooldownUntil?: number;
  available: boolean;
}

export default ProviderUsage;
