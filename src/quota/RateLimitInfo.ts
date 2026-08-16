export interface RateLimitWindow {
  limit?: number;
  remaining?: number;
  resetAt?: number;
}

export interface RateLimitInfo {
  observedAt: number;
  retryAfterMs?: number;
  requests?: RateLimitWindow;
  tokens?: RateLimitWindow;
}

export function parseRetryAfterMs(value: string | null, observedAt: number): number | undefined {
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  if (!/GMT$/i.test(value.trim())) return undefined;
  const retryAt = Date.parse(value);
  return Number.isFinite(retryAt) && retryAt >= observedAt ? retryAt - observedAt : undefined;
}

export function parseGroqRateLimitInfo(headers: Headers, observedAt = Date.now()): RateLimitInfo {
  const requests = parseWindow(
    headers.get('x-ratelimit-limit-requests'),
    headers.get('x-ratelimit-remaining-requests'),
    headers.get('x-ratelimit-reset-requests'),
    observedAt
  );
  const tokens = parseWindow(
    headers.get('x-ratelimit-limit-tokens'),
    headers.get('x-ratelimit-remaining-tokens'),
    headers.get('x-ratelimit-reset-tokens'),
    observedAt
  );
  const retryAfterMs = parseRetryAfterMs(headers.get('retry-after'), observedAt);

  return {
    observedAt,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    ...(requests ? { requests } : {}),
    ...(tokens ? { tokens } : {})
  };
}

export function parseRetryAfterRateLimitInfo(headers: Headers, observedAt = Date.now()): RateLimitInfo | undefined {
  const retryAfterMs = parseRetryAfterMs(headers.get('retry-after'), observedAt);
  return retryAfterMs === undefined ? undefined : { observedAt, retryAfterMs };
}

function parseWindow(
  limitValue: string | null,
  remainingValue: string | null,
  resetValue: string | null,
  observedAt: number
): RateLimitWindow | undefined {
  const limit = parseNonNegativeNumber(limitValue);
  const remaining = parseNonNegativeNumber(remainingValue);
  const resetMs = parseGroqDurationMs(resetValue);
  const resetAt = resetMs === undefined ? undefined : observedAt + resetMs;

  if (limit === undefined && remaining === undefined && resetAt === undefined) {
    return undefined;
  }

  return {
    ...(limit !== undefined ? { limit } : {}),
    ...(remaining !== undefined ? { remaining } : {}),
    ...(resetAt !== undefined ? { resetAt } : {})
  };
}

function parseNonNegativeNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseGroqDurationMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/);
  if (!match || (!match[1] && !match[2] && !match[3])) return undefined;

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return (hours * 3_600 + minutes * 60 + seconds) * 1000;
}
