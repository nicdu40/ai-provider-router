export interface ProviderUsage {
  provider: string;
  requestCount: number;
  tokenCount: number | null;
  lastRequestAt?: number;
  lastSuccessAt?: number;
  lastErrorAt?: number;
  lastRateLimitAt?: number;
  cooldownUntil?: number;
  disabledUntilRestart?: boolean;
  available: boolean;
  rateLimitInfo?: RateLimitInfo;
}

export default ProviderUsage;
import type { RateLimitInfo } from './RateLimitInfo';
