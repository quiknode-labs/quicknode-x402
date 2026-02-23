import { decodePaymentResponseHeader } from '@x402/core/http';
import { extractSessionFromSettle } from './session.js';

// Re-export createSIWxClientHook so consumers can register SIWX on their own
// x402HTTPClient without installing @x402/extensions directly.
export { createSIWxClientHook } from '@x402/extensions/sign-in-with-x';

/**
 * Extract quicknode-session JWT from a fetch Response's PAYMENT-RESPONSE header.
 *
 * Composable — works with any x402 setup, not just our factory.
 * Uses decodePaymentResponseHeader from @x402/core/http internally (no x402HTTPClient needed).
 *
 * @example
 * ```typescript
 * const response = await myFetch(url);
 * const session = extractQuicknodeSession(response);
 * if (session) { cachedToken = session.token; }
 * ```
 */
export function extractQuicknodeSession(
  response: Response,
): { token: string; expiresAt: string } | null {
  const paymentResponseHeader =
    response.headers.get('PAYMENT-RESPONSE') ?? response.headers.get('X-PAYMENT-RESPONSE');
  if (!paymentResponseHeader) return null;

  try {
    const settle = decodePaymentResponseHeader(paymentResponseHeader);
    return extractSessionFromSettle(settle);
  } catch {
    // Malformed header — ignore
  }
  return null;
}

/**
 * Wrap any fetch to automatically extract quicknode-session JWTs from settlement responses.
 * Calls onToken when a new JWT is found.
 *
 * @example
 * ```typescript
 * const sessionFetch = withSessionExtraction(myFetch, (token, expiresAt) => { cache(token); });
 * ```
 */
export function withSessionExtraction(
  baseFetch: typeof globalThis.fetch,
  onToken: (token: string, expiresAt: string) => void,
): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await baseFetch(input, init);
    const session = extractQuicknodeSession(response);
    if (session) {
      onToken(session.token, session.expiresAt);
    }
    return response;
  };
}

/**
 * Wrap any fetch to inject Authorization: Bearer when a token is available and not expired.
 *
 * @param isExpired - Optional callback returning true if token is expired. When provided,
 *   expired tokens are skipped (no Bearer header injected). Default: always treat as valid.
 *
 * @example
 * ```typescript
 * const bearerFetch = withBearerAuth(fetch, () => cachedToken, () => isTokenExpired());
 * ```
 */
export function withBearerAuth(
  baseFetch: typeof globalThis.fetch,
  getToken: () => string | null,
  isExpired?: () => boolean,
): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const token = getToken();
    if (token && !(isExpired?.() ?? false)) {
      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${token}`);
      return baseFetch(input, { ...init, headers });
    }
    return baseFetch(input, init);
  };
}
