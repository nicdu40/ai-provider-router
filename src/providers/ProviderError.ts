export type ErrorCategory =
  | 'FATAL'
  | 'RETRYABLE'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'UNKNOWN'
  | 'BAD_REQUEST';

export class ProviderError extends Error {
  public readonly status?: number;
  public readonly provider?: string;
  public readonly category?: ErrorCategory;
  public readonly retryable?: boolean;

  constructor(
    message: string,
    status?: number,
    provider?: string,
    category?: ErrorCategory,
    retryable?: boolean
  ) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.provider = provider;
    this.category = category;
    this.retryable = retryable;
    Error.captureStackTrace?.(this, ProviderError);
  }
}

export default ProviderError;
