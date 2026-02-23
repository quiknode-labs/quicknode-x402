import type { x402HTTPClient } from '@x402/core/client';

/** Expiry buffer in milliseconds — prevents using a JWT that will expire mid-request. */
const EXPIRY_BUFFER_MS = 30_000;

/**
 * Shape of an x402 settlement response with Quicknode extensions.
 * The x402 core types don't include `extensions`, so we define it locally.
 */
export interface SettlementWithExtensions {
  success?: boolean;
  extensions?: {
    'quicknode-session'?: {
      info?: { token: string; expiresAt: string };
    };
  };
}

/**
 * Extract quicknode-session JWT from a decoded settlement object.
 * Shared logic used by both `extractSessionFromResponse` and `extractQuicknodeSession`.
 */
export function extractSessionFromSettle(
  settle: unknown,
): { token: string; expiresAt: string } | null {
  const sessionInfo = (settle as SettlementWithExtensions)?.extensions?.['quicknode-session']?.info;
  if (sessionInfo?.token) {
    return { token: sessionInfo.token, expiresAt: sessionInfo.expiresAt };
  }
  return null;
}

/**
 * Manages JWT session lifecycle: caching, expiry checking, and accountId extraction.
 */
export class SessionManager {
  private token: string | null = null;
  private expiresAt: number | null = null; // unix ms
  private accountId: string | null = null;

  getToken(): string | null {
    return this.token;
  }

  setToken(token: string, expiresAt?: string): void {
    this.token = token;
    this.expiresAt = expiresAt ? new Date(expiresAt).getTime() : null;

    // Parse accountId from JWT sub claim (CAIP-10 format)
    // JWT is base64url-encoded: header.payload.signature
    try {
      const payloadSegment = token.split('.')[1];
      if (payloadSegment) {
        const decoded = JSON.parse(atob(payloadSegment.replace(/-/g, '+').replace(/_/g, '/')));
        this.accountId = decoded.sub ?? null;
      }
    } catch {
      this.accountId = null;
    }
  }

  clearToken(): void {
    this.token = null;
    this.expiresAt = null;
    this.accountId = null;
  }

  getAccountId(): string | null {
    return this.accountId;
  }

  isExpired(): boolean {
    if (!this.token) return true;
    if (!this.expiresAt) return true; // No expiry info — treat as expired (fail-safe)
    return Date.now() >= this.expiresAt - EXPIRY_BUFFER_MS;
  }
}

/**
 * Extract quicknode-session JWT from a settlement response.
 * Uses httpClient.getPaymentSettleResponse() to decode the PAYMENT-RESPONSE header.
 * Returns null if header missing or quicknode-session extension not present.
 */
export function extractSessionFromResponse(
  response: Response,
  httpClient: x402HTTPClient,
): { token: string; expiresAt: string } | null {
  // Check both casings — HTTP/1.1 may preserve case, HTTP/2 lowercases.
  // Fetch API Headers.get() is case-insensitive per spec, but be explicit.
  const paymentResponseHeader =
    response.headers.get('PAYMENT-RESPONSE') ?? response.headers.get('X-PAYMENT-RESPONSE');
  if (!paymentResponseHeader) return null;

  try {
    const settle = httpClient.getPaymentSettleResponse((name) => response.headers.get(name));
    return extractSessionFromSettle(settle);
  } catch {
    // Malformed header — ignore
  }
  return null;
}
