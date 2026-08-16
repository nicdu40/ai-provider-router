import config from '../config/config';

export type ErrorCategory = 'FATAL' | 'RETRYABLE' | 'TIMEOUT' | 'UNKNOWN' | 'BAD_REQUEST';

export function classifyStatus(status?: number): ErrorCategory {
  if (typeof status !== 'number' || Number.isNaN(status)) return 'UNKNOWN';

  const mapping = config.errorClassification ?? {};

  for (const [category, codes] of Object.entries(mapping)) {
    if (Array.isArray(codes) && (codes as number[]).includes(status)) {
      return category as ErrorCategory;
    }
  }

  return 'UNKNOWN';
}

export default classifyStatus;
