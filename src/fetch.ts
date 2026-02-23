import type { x402HTTPClient } from '@x402/core/client';
import type { PaymentRequired } from '@x402/core/types';
import { extractSessionFromResponse, type SessionManager } from './session.js';

/**
 * Single point of adaptation for handlePaymentRequired semantic repurposing.
 *
 * Runs SIWX hooks via handlePaymentRequired(), creates x402 payment, merges both
 * header sets onto the retry request.
 *
 * RISK NOTE: In the x402 design, handlePaymentRequired() returns headers meant as
 * an alternative to payment (i.e., "use these instead of paying"). We repurpose it
 * to return headers that supplement payment (SIWX + payment merged). This works
 * because our SIWX hook always returns headers (never null), and we always also pay.
 * If a future x402 version changes handlePaymentRequired() semantics, fix HERE only.
 */
async function resolvePaymentWithHooks(
  httpClient: x402HTTPClient,
  paymentRequired: PaymentRequired,
): Promise<Record<string, string>> {
  // Run onPaymentRequired hooks (SIWX) → supplemental headers
  const hookHeaders = await httpClient.handlePaymentRequired(paymentRequired);
  // Create x402 payment payload
  const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
  // Encode payment into HTTP headers
  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);
  // Merge: hook headers (SIWX) + payment headers (PAYMENT-SIGNATURE)
  return { ...(hookHeaders ?? {}), ...paymentHeaders };
}

/**
 * Create the Quicknode-aware fetch wrapper using x402HTTPClient for proper hook support.
 *
 * This is the core fetch wrapper that orchestrates:
 * 1. Bearer auth injection from cached JWT
 * 2. SIWX auto-sign on 402 via httpClient hooks
 * 3. x402 payment creation and header encoding
 * 4. Session JWT extraction from settlement responses
 *
 * NOTE: Requests with `ReadableStream` bodies are not retryable on 402 because the
 * stream is consumed by the first fetch. All our use cases (JSON-RPC, gRPC-Web) use
 * buffered bodies (string/ArrayBuffer).
 */
export function createQuicknodeFetch(options: {
  httpClient: x402HTTPClient;
  session: SessionManager;
}): typeof globalThis.fetch {
  const { httpClient, session } = options;

  // Payment-in-flight mutex: prevents concurrent double-payments.
  // When one request triggers a 402 payment, concurrent 402s wait for it
  // to complete (which caches a JWT), then retry with Bearer auth.
  let paymentInFlight: Promise<void> | null = null;

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // 1. Build request with Bearer JWT if available
    const headers = new Headers(init?.headers);
    const token = session.getToken();
    if (token && !session.isExpired()) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const request = new Request(input, { ...init, headers });
    const response = await globalThis.fetch(request);

    // 2. Non-402 → extract session JWT if present, return
    if (response.status !== 402) {
      const sessionData = extractSessionFromResponse(response, httpClient);
      if (sessionData) {
        session.setToken(sessionData.token, sessionData.expiresAt);
      }
      return response;
    }

    // 3. Concurrent payment guard: if another request is already paying, wait for it.
    //    On success → retry with newly-cached JWT. On failure → fall through to own payment.
    if (paymentInFlight) {
      try {
        await paymentInFlight;
      } catch {
        // First payment failed — fall through
      }
      // If the first payment succeeded, a JWT is now cached — retry with Bearer
      const freshToken = session.getToken();
      if (freshToken && !session.isExpired()) {
        const retryHeaders = new Headers(init?.headers);
        retryHeaders.set('Authorization', `Bearer ${freshToken}`);
        return globalThis.fetch(new Request(input, { ...init, headers: retryHeaders }));
      }
      // First payment failed or JWT expired — fall through to attempt our own payment.
    }

    // 4. Set payment-in-flight mutex (released in finally block)
    let resolvePayment!: () => void;
    let rejectPayment!: (err: unknown) => void;
    paymentInFlight = new Promise<void>((resolve, reject) => {
      resolvePayment = resolve;
      rejectPayment = reject;
    });

    try {
      // 5. Parse 402 response → PaymentRequired
      let paymentRequired: PaymentRequired;
      try {
        paymentRequired = httpClient.getPaymentRequiredResponse((name) =>
          response.headers.get(name),
        );
      } catch (error) {
        throw new Error(`Failed to parse payment requirements: ${error}`);
      }

      // 6. Resolve payment with SIWX hooks (single point of adaptation)
      const mergedHeaders = await resolvePaymentWithHooks(httpClient, paymentRequired);

      // 7. Build retry request with merged headers (hook + payment)
      const retryHeaders = new Headers(request.headers);
      for (const [key, value] of Object.entries(mergedHeaders)) {
        retryHeaders.set(key, value);
      }
      const retryRequest = new Request(request.url, {
        method: request.method,
        headers: retryHeaders,
        body: init?.body, // Use original init body (Request body may be consumed)
        redirect: request.redirect,
      });

      // 8. Retry with merged headers
      const retryResponse = await globalThis.fetch(retryRequest);

      // 9. Extract session JWT from settlement if present
      const sessionData = extractSessionFromResponse(retryResponse, httpClient);
      if (sessionData) {
        session.setToken(sessionData.token, sessionData.expiresAt);
      }

      resolvePayment();
      paymentInFlight = null;
      return retryResponse;
    } catch (err) {
      // Payment failed — reject mutex so waiters attempt their own payment
      rejectPayment(err);
      paymentInFlight = null;
      throw err;
    }
  };
}
