export type ErrorCategory =
  | 'FATAL'
  | 'RETRYABLE'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'UNKNOWN'
  | 'BAD_REQUEST'
  | 'MODEL_UNAVAILABLE'
  ;

export class ProviderError extends Error {
  public readonly status?: number;
  public readonly provider?: string;
  public readonly category?: ErrorCategory;
  public readonly retryable?: boolean;
  public readonly rateLimitInfo?: RateLimitInfo;
  public readonly providerCode?: string;

  constructor(
    message: string,
    status?: number,
    provider?: string,
    category?: ErrorCategory,
    retryable?: boolean,
    rateLimitInfo?: RateLimitInfo,
    providerCode?: string
  ) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.provider = provider;
    this.category = category;
    this.retryable = retryable;
    this.rateLimitInfo = rateLimitInfo;
    this.providerCode = providerCode;
    Error.captureStackTrace?.(this, ProviderError);
  }
}

export default ProviderError;
import type { RateLimitInfo } from '../quota/RateLimitInfo';
