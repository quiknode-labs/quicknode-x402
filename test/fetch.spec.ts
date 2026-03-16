import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQuicknodeFetch } from '../src/fetch.js';
import { SessionManager } from '../src/session.js';

// Mock httpClient
function createMockHttpClient() {
  return {
    getPaymentRequiredResponse: vi.fn(),
    handlePaymentRequired: vi.fn(),
    createPaymentPayload: vi.fn(),
    encodePaymentSignatureHeader: vi.fn(),
    getPaymentSettleResponse: vi.fn(),
    onPaymentRequired: vi.fn().mockReturnThis(),
  } as any;
}

describe('createQuicknodeFetch', () => {
  let httpClient: ReturnType<typeof createMockHttpClient>;
  let session: SessionManager;
  let x402Fetch: typeof globalThis.fetch;

  beforeEach(() => {
    httpClient = createMockHttpClient();
    session = new SessionManager();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Bearer injection', () => {
    it('adds Authorization header when valid token present', async () => {
      const jwtPayload = { sub: 'test' };
      session.setToken(
        `h.${btoa(JSON.stringify(jwtPayload))}.s`,
        new Date(Date.now() + 3600_000).toISOString(),
      );

      let capturedHeaders: Headers | null = null;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (req: Request) => {
        capturedHeaders = req.headers;
        return new Response('ok', { status: 200 });
      });

      x402Fetch = createQuicknodeFetch({ httpClient, session });
      await x402Fetch('https://example.com/api');

      expect(capturedHeaders?.get('Authorization')).toBe(
        `Bearer h.${btoa(JSON.stringify(jwtPayload))}.s`,
      );
    });

    it('does not add Authorization when no token', async () => {
      let capturedHeaders: Headers | null = null;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (req: Request) => {
        capturedHeaders = req.headers;
        return new Response('ok', { status: 200 });
      });

      x402Fetch = createQuicknodeFetch({ httpClient, session });
      await x402Fetch('https://example.com/api');

      expect(capturedHeaders?.get('Authorization')).toBeNull();
    });

    it('does not add Authorization when token is expired', async () => {
      session.setToken(
        `h.${btoa(JSON.stringify({ sub: 'test' }))}.s`,
        new Date(Date.now() - 60_000).toISOString(), // expired
      );

      let capturedHeaders: Headers | null = null;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (req: Request) => {
        capturedHeaders = req.headers;
        return new Response('ok', { status: 200 });
      });

      x402Fetch = createQuicknodeFetch({ httpClient, session });
      await x402Fetch('https://example.com/api');

      expect(capturedHeaders?.get('Authorization')).toBeNull();
    });
  });

  describe('non-402 pass-through', () => {
    it('returns 200 response directly', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));

      x402Fetch = createQuicknodeFetch({ httpClient, session });
      const response = await x402Fetch('https://example.com/api');

      expect(response.status).toBe(200);
      expect(httpClient.getPaymentRequiredResponse).not.toHaveBeenCalled();
    });

    it('extracts session from non-402 response with PAYMENT-RESPONSE header', async () => {
      const settleResponse = {
        success: true,
        extensions: {
          'quicknode-session': {
            info: { token: 'new-jwt', expiresAt: '2026-12-31T00:00:00.000Z' },
          },
        },
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('ok', {
          status: 200,
          headers: { 'PAYMENT-RESPONSE': 'encoded-data' },
        }),
      );

      httpClient.getPaymentSettleResponse.mockReturnValue(settleResponse);

      x402Fetch = createQuicknodeFetch({ httpClient, session });
      await x402Fetch('https://example.com/api');

      expect(session.getToken()).toBe('new-jwt');
    });
  });

  describe('full 402 lifecycle', () => {
    it('handles 402 with SIWX hook + payment and merges headers', async () => {
      const paymentRequired = { accepts: [{ network: 'eip155:84532' }], extensions: {} };
      const hookHeaders = { 'sign-in-with-x': 'encoded-siwx' };
      const paymentPayload = { x402Version: 2, payload: 'test' };
      const paymentHeaders = { 'PAYMENT-SIGNATURE': 'encoded-payment' };

      let callCount = 0;
      let retryHeaders: Headers | null = null;

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (req: Request) => {
        callCount++;
        if (callCount === 1) {
          return new Response('payment required', {
            status: 402,
            headers: { 'PAYMENT-REQUIRED': 'encoded-pr' },
          });
        }
        retryHeaders = req.headers;
        return new Response('ok', { status: 200 });
      });

      httpClient.getPaymentRequiredResponse.mockReturnValue(paymentRequired);
      httpClient.handlePaymentRequired.mockResolvedValue(hookHeaders);
      httpClient.createPaymentPayload.mockResolvedValue(paymentPayload);
      httpClient.encodePaymentSignatureHeader.mockReturnValue(paymentHeaders);

      x402Fetch = createQuicknodeFetch({ httpClient, session });
      const response = await x402Fetch('https://example.com/api');

      expect(response.status).toBe(200);
      expect(callCount).toBe(2);

      // Verify retry has BOTH headers merged
      expect(retryHeaders?.get('sign-in-with-x')).toBe('encoded-siwx');
      expect(retryHeaders?.get('PAYMENT-SIGNATURE')).toBe('encoded-payment');
    });

    it('extracts session JWT from settlement response after payment', async () => {
      const paymentRequired = { accepts: [], extensions: {} };
      const settleResponse = {
        success: true,
        extensions: {
          'quicknode-session': {
            info: { token: 'settlement-jwt', expiresAt: '2026-12-31' },
          },
        },
      };

      let callCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return new Response('', {
            status: 402,
            headers: { 'PAYMENT-REQUIRED': 'pr' },
          });
        }
        return new Response('ok', {
          status: 200,
          headers: { 'PAYMENT-RESPONSE': 'settle-data' },
        });
      });

      httpClient.getPaymentRequiredResponse.mockReturnValue(paymentRequired);
      httpClient.handlePaymentRequired.mockResolvedValue({});
      httpClient.createPaymentPayload.mockResolvedValue({});
      httpClient.encodePaymentSignatureHeader.mockReturnValue({});
      httpClient.getPaymentSettleResponse.mockReturnValue(settleResponse);

      x402Fetch = createQuicknodeFetch({ httpClient, session });
      await x402Fetch('https://example.com/api');

      expect(session.getToken()).toBe('settlement-jwt');
    });
  });

  describe('concurrent request double-payment prevention', () => {
    it('only makes one payment when two requests receive 402 simultaneously', async () => {
      const paymentRequired = { accepts: [], extensions: {} };
      let paymentCount = 0;
      let fetchCallCount = 0;

      httpClient.getPaymentRequiredResponse.mockReturnValue(paymentRequired);
      httpClient.handlePaymentRequired.mockImplementation(async () => {
        paymentCount++;
        // Simulate some payment processing time
        await new Promise((r) => setTimeout(r, 50));
        return {};
      });
      httpClient.createPaymentPayload.mockResolvedValue({});
      httpClient.encodePaymentSignatureHeader.mockReturnValue({});
      httpClient.getPaymentSettleResponse.mockReturnValue({
        success: true,
        extensions: {
          'quicknode-session': {
            info: {
              token: 'shared-jwt',
              expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            },
          },
        },
      });

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_req: Request) => {
        fetchCallCount++;
        if (fetchCallCount <= 2) {
          // First two calls: both return 402
          return new Response('', {
            status: 402,
            headers: { 'PAYMENT-REQUIRED': 'pr' },
          });
        }
        // Subsequent calls (retries): return 200
        return new Response('ok', {
          status: 200,
          headers: { 'PAYMENT-RESPONSE': 'settle' },
        });
      });

      x402Fetch = createQuicknodeFetch({ httpClient, session });

      // Fire two requests concurrently
      const [r1, r2] = await Promise.all([
        x402Fetch('https://example.com/api/1'),
        x402Fetch('https://example.com/api/2'),
      ]);

      // Only one payment should have been made
      expect(paymentCount).toBe(1);
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
    });
  });

  describe('paymentModel: pay-per-request', () => {
    it('skips SIWX hook call on 402 response', async () => {
      const paymentRequired = { accepts: [{ network: 'eip155:84532' }], extensions: {} };
      const paymentPayload = { x402Version: 2, payload: 'test' };
      const paymentHeaders = { 'PAYMENT-SIGNATURE': 'encoded-payment' };

      let callCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return new Response('payment required', {
            status: 402,
            headers: { 'PAYMENT-REQUIRED': 'encoded-pr' },
          });
        }
        return new Response('ok', { status: 200 });
      });

      httpClient.getPaymentRequiredResponse.mockReturnValue(paymentRequired);
      // handlePaymentRequired should NOT be called for per-request
      httpClient.handlePaymentRequired.mockResolvedValue({ 'sign-in-with-x': 'should-not-appear' });
      httpClient.createPaymentPayload.mockResolvedValue(paymentPayload);
      httpClient.encodePaymentSignatureHeader.mockReturnValue(paymentHeaders);

      x402Fetch = createQuicknodeFetch({ httpClient, session, paymentModel: 'pay-per-request' });
      const response = await x402Fetch('https://example.com/api');

      expect(response.status).toBe(200);
      // handlePaymentRequired should NOT have been called (hooks skipped)
      expect(httpClient.handlePaymentRequired).not.toHaveBeenCalled();
      // But createPaymentPayload should still be called
      expect(httpClient.createPaymentPayload).toHaveBeenCalled();
    });

    it('retry request has PAYMENT-SIGNATURE but no SIWX headers', async () => {
      const paymentRequired = { accepts: [{ network: 'eip155:84532' }], extensions: {} };
      const paymentHeaders = { 'PAYMENT-SIGNATURE': 'encoded-payment' };

      let callCount = 0;
      let retryHeaders: Headers | null = null;

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (req: Request) => {
        callCount++;
        if (callCount === 1) {
          return new Response('', {
            status: 402,
            headers: { 'PAYMENT-REQUIRED': 'encoded-pr' },
          });
        }
        retryHeaders = req.headers;
        return new Response('ok', { status: 200 });
      });

      httpClient.getPaymentRequiredResponse.mockReturnValue(paymentRequired);
      httpClient.handlePaymentRequired.mockResolvedValue({});
      httpClient.createPaymentPayload.mockResolvedValue({});
      httpClient.encodePaymentSignatureHeader.mockReturnValue(paymentHeaders);

      x402Fetch = createQuicknodeFetch({ httpClient, session, paymentModel: 'pay-per-request' });
      await x402Fetch('https://example.com/api');

      // Should have PAYMENT-SIGNATURE
      expect(retryHeaders?.get('PAYMENT-SIGNATURE')).toBe('encoded-payment');
      // Should NOT have SIWX header
      expect(retryHeaders?.get('sign-in-with-x')).toBeNull();
    });

    it('does not inject Bearer token (no session in per-request mode)', async () => {
      let capturedHeaders: Headers | null = null;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (req: Request) => {
        capturedHeaders = req.headers;
        return new Response('ok', { status: 200 });
      });

      x402Fetch = createQuicknodeFetch({ httpClient, session, paymentModel: 'pay-per-request' });
      await x402Fetch('https://example.com/api');

      // No token set, so no Authorization header
      expect(capturedHeaders?.get('Authorization')).toBeNull();
    });

    it('does not inject Bearer token even when session has a token', async () => {
      session.setToken(
        `h.${btoa(JSON.stringify({ sub: 'test' }))}.s`,
        new Date(Date.now() + 3600_000).toISOString(),
      );

      let capturedHeaders: Headers | null = null;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (req: Request) => {
        capturedHeaders = req.headers;
        return new Response('ok', { status: 200 });
      });

      x402Fetch = createQuicknodeFetch({ httpClient, session, paymentModel: 'pay-per-request' });
      await x402Fetch('https://example.com/api');

      expect(capturedHeaders?.get('Authorization')).toBeNull();
    });

    it('does not cache session JWT from settlement response', async () => {
      const paymentRequired = { accepts: [], extensions: {} };
      const settleResponse = {
        success: true,
        extensions: {
          'quicknode-session': {
            info: { token: 'settlement-jwt', expiresAt: '2026-12-31' },
          },
        },
      };

      let callCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return new Response('', {
            status: 402,
            headers: { 'PAYMENT-REQUIRED': 'pr' },
          });
        }
        return new Response('ok', {
          status: 200,
          headers: { 'PAYMENT-RESPONSE': 'settle-data' },
        });
      });

      httpClient.getPaymentRequiredResponse.mockReturnValue(paymentRequired);
      httpClient.createPaymentPayload.mockResolvedValue({});
      httpClient.encodePaymentSignatureHeader.mockReturnValue({});
      httpClient.getPaymentSettleResponse.mockReturnValue(settleResponse);

      x402Fetch = createQuicknodeFetch({ httpClient, session, paymentModel: 'pay-per-request' });
      await x402Fetch('https://example.com/api');

      expect(session.getToken()).toBeNull();
    });
  });

  describe('mutex failure path', () => {
    it('second request falls through to own payment when first fails', async () => {
      const paymentRequired = { accepts: [], extensions: {} };
      let handlePaymentCallCount = 0;

      httpClient.getPaymentRequiredResponse.mockReturnValue(paymentRequired);
      httpClient.handlePaymentRequired.mockImplementation(async () => {
        handlePaymentCallCount++;
        if (handlePaymentCallCount === 1) {
          await new Promise((r) => setTimeout(r, 30));
          throw new Error('payment failed');
        }
        return {};
      });
      httpClient.createPaymentPayload.mockResolvedValue({});
      httpClient.encodePaymentSignatureHeader.mockReturnValue({});

      let fetchCallCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        fetchCallCount++;
        if (fetchCallCount <= 2) {
          return new Response('', {
            status: 402,
            headers: { 'PAYMENT-REQUIRED': 'pr' },
          });
        }
        return new Response('ok', { status: 200 });
      });

      x402Fetch = createQuicknodeFetch({ httpClient, session });

      // First will fail, second should retry its own payment
      const results = await Promise.allSettled([
        x402Fetch('https://example.com/api/1'),
        x402Fetch('https://example.com/api/2'),
      ]);

      // First request should fail
      expect(results[0].status).toBe('rejected');
      // Second request should eventually succeed (made its own payment)
      expect(results[1].status).toBe('fulfilled');
      if (results[1].status === 'fulfilled') {
        expect(results[1].value.status).toBe(200);
      }
      // Both attempted payment
      expect(handlePaymentCallCount).toBe(2);
    });
  });
});
