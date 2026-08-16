import { ProviderError, ErrorCategory } from '../providers/ProviderError';
import { classifyStatus } from '../router/ErrorClassifier';

const MAX_BODY_LENGTH = 200;

export async function createProviderErrorFromResponse(respOrStatus: any, providerName: string): Promise<ProviderError> {
  let status: number | undefined;
  let bodyText: string | undefined;

  // respOrStatus could be a Response-like object, or a number, or an object {status, body}
  if (typeof respOrStatus === 'number') {
    status = respOrStatus;
  } else if (respOrStatus && typeof respOrStatus.status === 'number') {
    status = respOrStatus.status;
    try {
      if (typeof respOrStatus.text === 'function') {
        bodyText = await respOrStatus.text();
      } else if (typeof respOrStatus.body === 'string') {
        bodyText = respOrStatus.body;
      }
    } catch (e) {
      bodyText = undefined;
    }
  }

  const statusNum = status ?? undefined;

  // Determine category according to explicit rules
  let category: ErrorCategory;
  let retryable: boolean;

  if (statusNum === 400) {
    category = 'BAD_REQUEST';
    retryable = false;
  } else if (statusNum === 401 || statusNum === 403) {
    category = 'FATAL';
    retryable = false;
  } else if (statusNum === 408) {
    category = 'TIMEOUT';
    retryable = true;
  } else if (statusNum === 429) {
    category = 'RETRYABLE';
    retryable = true;
  } else if (statusNum && statusNum >= 500 && statusNum <= 599) {
    category = 'RETRYABLE';
    retryable = true;
  } else {
    // fall back to classifier
    category = classifyStatus(statusNum) as ErrorCategory;
    retryable = category === 'RETRYABLE' || category === 'TIMEOUT';
  }

  // Prepare message safely (truncate)
  let snippet = '';
  if (bodyText) {
    snippet = bodyText.slice(0, MAX_BODY_LENGTH);
    if (bodyText.length > MAX_BODY_LENGTH) snippet += '...';
  }

  const message = `HTTP ${statusNum ?? 'unknown'} ${snippet ? '- ' + snippet : ''}`.trim();

  return new ProviderError(message, statusNum, providerName, category, retryable);
}

export function createProviderErrorFromException(error: unknown, providerName: string): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }

  const isTimeout =
    error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
  const category: ErrorCategory = isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR';
  const message = isTimeout ? 'Request timed out' : 'Network request failed';

  return new ProviderError(message, undefined, providerName, category, true);
}

export default createProviderErrorFromResponse;
