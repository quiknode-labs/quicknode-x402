import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractSessionFromResponse, SessionManager } from '../src/session.js';

describe('SessionManager', () => {
  let session: SessionManager;

  beforeEach(() => {
    session = new SessionManager();
  });

  it('starts with no token', () => {
    expect(session.getToken()).toBeNull();
    expect(session.getAccountId()).toBeNull();
    expect(session.isExpired()).toBe(true);
  });

  it('setToken + getToken round-trip', () => {
    // Create a fake JWT with a sub claim
    const payload = { sub: 'eip155:84532:0x1234', iat: 1000, exp: 9999999999 };
    const fakeJwt = `header.${btoa(JSON.stringify(payload))}.signature`;
    const expiresAt = new Date(Date.now() + 3600_000).toISOString();

    session.setToken(fakeJwt, expiresAt);
    expect(session.getToken()).toBe(fakeJwt);
  });

  it('parses accountId from JWT sub claim', () => {
    const payload = { sub: 'eip155:84532:0xabcdef1234567890' };
    const fakeJwt = `h.${btoa(JSON.stringify(payload))}.s`;

    session.setToken(fakeJwt, new Date(Date.now() + 3600_000).toISOString());
    expect(session.getAccountId()).toBe('eip155:84532:0xabcdef1234567890');
  });

  it('isExpired returns false for valid token', () => {
    const payload = { sub: 'test' };
    const fakeJwt = `h.${btoa(JSON.stringify(payload))}.s`;
    const futureExpiry = new Date(Date.now() + 3600_000).toISOString();

    session.setToken(fakeJwt, futureExpiry);
    expect(session.isExpired()).toBe(false);
  });

  it('isExpired returns true after expiry (with 30s buffer)', () => {
    const payload = { sub: 'test' };
    const fakeJwt = `h.${btoa(JSON.stringify(payload))}.s`;
    // Set expiry to 20 seconds from now (within 30s buffer)
    const nearExpiry = new Date(Date.now() + 20_000).toISOString();

    session.setToken(fakeJwt, nearExpiry);
    expect(session.isExpired()).toBe(true);
  });

  it('isExpired returns true for past expiry', () => {
    const payload = { sub: 'test' };
    const fakeJwt = `h.${btoa(JSON.stringify(payload))}.s`;
    const pastExpiry = new Date(Date.now() - 60_000).toISOString();

    session.setToken(fakeJwt, pastExpiry);
    expect(session.isExpired()).toBe(true);
  });

  it('isExpired returns true when no expiry is set (fail-safe)', () => {
    const payload = { sub: 'test' };
    const fakeJwt = `h.${btoa(JSON.stringify(payload))}.s`;

    session.setToken(fakeJwt);
    expect(session.isExpired()).toBe(true);
  });

  it('clearToken resets state', () => {
    const payload = { sub: 'test' };
    const fakeJwt = `h.${btoa(JSON.stringify(payload))}.s`;

    session.setToken(fakeJwt, new Date(Date.now() + 3600_000).toISOString());
    expect(session.getToken()).toBe(fakeJwt);

    session.clearToken();
    expect(session.getToken()).toBeNull();
    expect(session.getAccountId()).toBeNull();
    expect(session.isExpired()).toBe(true);
  });

  it('handles malformed JWT gracefully', () => {
    session.setToken('not-a-jwt');
    expect(session.getToken()).toBe('not-a-jwt');
    expect(session.getAccountId()).toBeNull();
  });
});

describe('extractSessionFromResponse', () => {
  it('returns null when PAYMENT-RESPONSE header is missing', () => {
    const response = new Response('ok', { status: 200 });
    const mockHttpClient = {
      getPaymentSettleResponse: vi.fn(),
    } as any;

    const result = extractSessionFromResponse(response, mockHttpClient);
    expect(result).toBeNull();
    expect(mockHttpClient.getPaymentSettleResponse).not.toHaveBeenCalled();
  });

  it('extracts session from PAYMENT-RESPONSE header', () => {
    const sessionToken = 'jwt-token-from-settlement';
    const expiresAt = '2026-02-22T15:00:00.000Z';

    const response = new Response('ok', {
      status: 200,
      headers: { 'PAYMENT-RESPONSE': 'encoded-settle-data' },
    });

    const mockHttpClient = {
      getPaymentSettleResponse: vi.fn().mockReturnValue({
        success: true,
        extensions: {
          'quicknode-session': {
            info: { token: sessionToken, expiresAt },
          },
        },
      }),
    } as any;

    const result = extractSessionFromResponse(response, mockHttpClient);
    expect(result).toEqual({ token: sessionToken, expiresAt });
  });

  it('returns null when quicknode-session extension is not present', () => {
    const response = new Response('ok', {
      status: 200,
      headers: { 'PAYMENT-RESPONSE': 'encoded-settle-data' },
    });

    const mockHttpClient = {
      getPaymentSettleResponse: vi.fn().mockReturnValue({
        success: true,
        extensions: {},
      }),
    } as any;

    const result = extractSessionFromResponse(response, mockHttpClient);
    expect(result).toBeNull();
  });

  it('returns null when getPaymentSettleResponse throws', () => {
    const response = new Response('ok', {
      status: 200,
      headers: { 'PAYMENT-RESPONSE': 'malformed-data' },
    });

    const mockHttpClient = {
      getPaymentSettleResponse: vi.fn().mockImplementation(() => {
        throw new Error('decode error');
      }),
    } as any;

    const result = extractSessionFromResponse(response, mockHttpClient);
    expect(result).toBeNull();
  });

  it('works with lowercase header (HTTP/2 normalization)', () => {
    const response = new Response('ok', {
      status: 200,
      headers: { 'payment-response': 'encoded-settle-data' },
    });

    const mockHttpClient = {
      getPaymentSettleResponse: vi.fn().mockReturnValue({
        success: true,
        extensions: {
          'quicknode-session': {
            info: { token: 'jwt', expiresAt: '2026-01-01' },
          },
        },
      }),
    } as any;

    // Fetch API Headers.get() is case-insensitive, so this should work
    const result = extractSessionFromResponse(response, mockHttpClient);
    expect(result).toEqual({ token: 'jwt', expiresAt: '2026-01-01' });
  });
});
