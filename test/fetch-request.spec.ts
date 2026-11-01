import { createServer, type Server } from 'node:http';
import type { x402HTTPClient } from '@x402/core/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQuicknodeFetch } from '../src/fetch.js';
import { SessionManager } from '../src/session.js';

interface SeenRequest {
  body: string;
  authorization: string | undefined;
  context: string | undefined;
  paid: boolean;
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections();
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

async function merchant(options: { free?: boolean; always402?: boolean } = {}) {
  const seen: SeenRequest[] = [];
  let onTwoRequests: (() => void) | undefined;
  const twoRequests = new Promise<void>((resolve) => {
    onTwoRequests = resolve;
  });
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const paid = Boolean(request.headers['payment-signature']);
    const authorized = Boolean(request.headers.authorization?.startsWith('Bearer session-token'));
    seen.push({
      body: Buffer.concat(chunks).toString(),
      authorization: request.headers.authorization,
      context: request.headers['x-context']?.toString(),
      paid,
    });
    if (seen.length >= 2) onTwoRequests?.();
    const status = options.free || (!options.always402 && (paid || authorized)) ? 200 : 402;
    response.writeHead(status, paid ? { 'PAYMENT-RESPONSE': 'local-session' } : {});
    response.end('local merchant');
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing loopback address');
  return { url: `http://127.0.0.1:${address.port}/rpc`, seen, twoRequests };
}

function client(
  session: SessionManager,
  paymentModel?: 'credit-drawdown' | 'pay-per-request' | 'nanopayment',
) {
  const createPaymentPayload = vi.fn(async () => ({}));
  // Only payment authorization is a boundary double; fetch remains native.
  const httpClient = {
    getPaymentRequiredResponse: () => ({ accepts: [] }),
    handlePaymentRequired: async () => ({}),
    createPaymentPayload,
    encodePaymentSignatureHeader: () => ({ 'PAYMENT-SIGNATURE': 'local-test' }),
    getPaymentSettleResponse: () => ({
      extensions: {
        'quicknode-session': {
          info: {
            token: 'session-token',
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          },
        },
      },
    }),
  };
  return {
    fetch: createQuicknodeFetch({
      httpClient: httpClient as unknown as x402HTTPClient,
      session,
      paymentModel,
    }),
    createPaymentPayload,
  };
}

describe.each([
  'credit-drawdown',
  'pay-per-request',
  'nanopayment',
] as const)('native Request preservation (%s)', (mode) => {
  it('inherits Request headers before a non-402 response', async () => {
    const api = await merchant({ free: true });
    const payment = client(new SessionManager(), mode);
    await payment.fetch(
      new Request(api.url, { headers: { 'x-context': 'request', Authorization: 'caller' } }),
    );
    expect(api.seen).toMatchObject([{ context: 'request', authorization: 'caller' }]);
    expect(payment.createPaymentPayload).not.toHaveBeenCalled();
  });

  it('replays a Request-owned POST body with its headers after 402', async () => {
    const api = await merchant();
    const payment = client(new SessionManager(), mode);
    const response = await payment.fetch(
      new Request(api.url, {
        method: 'POST',
        body: '{"operation":"read"}',
        headers: { 'x-context': 'request' },
      }),
    );
    expect(response.status).toBe(200);
    expect(api.seen).toMatchObject([
      { body: '{"operation":"read"}', context: 'request', paid: false },
      { body: '{"operation":"read"}', context: 'request', paid: true },
    ]);
  });

  it('retains explicit init.headers replacement and buffered init.body', async () => {
    const api = await merchant();
    const payment = client(new SessionManager(), mode);
    await payment.fetch(new Request(api.url, { headers: { 'x-context': 'old' } }), {
      method: 'POST',
      body: 'buffered',
      headers: new Headers({ 'x-context': 'new' }),
    });
    expect(api.seen).toMatchObject([
      { context: 'new', body: 'buffered' },
      { context: 'new', body: 'buffered' },
    ]);
  });
});

it('replays both Request bodies when a credit caller waits for a session', async () => {
  const api = await merchant();
  const payment = client(new SessionManager(), 'credit-drawdown');
  payment.createPaymentPayload.mockImplementation(async () => {
    await api.twoRequests;
    return {};
  });
  const makeRequest = (body: string) =>
    new Request(api.url, {
      method: 'POST',
      body,
      headers: { 'x-context': body },
    });
  const responses = await Promise.all([
    payment.fetch(makeRequest('first')),
    payment.fetch(makeRequest('second')),
  ]);
  expect(responses.map((response) => response.status)).toEqual([200, 200]);
  expect(api.seen).toHaveLength(4);
  expect(api.seen.filter((request) => request.body === 'first')).toHaveLength(2);
  expect(api.seen.filter((request) => request.body === 'second')).toHaveLength(2);
  expect(api.seen.every((request) => request.context === request.body)).toBe(true);
  expect(payment.createPaymentPayload).toHaveBeenCalledTimes(1);
});

it('preserves Request cancellation on the paid retry', async () => {
  const api = await merchant();
  const controller = new AbortController();
  const payment = client(new SessionManager(), 'pay-per-request');
  payment.createPaymentPayload.mockImplementation(async () => {
    controller.abort();
    return {};
  });
  await expect(
    payment.fetch(new Request(api.url, { signal: controller.signal })),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(api.seen).toHaveLength(1);
});

it('rejects payment errors and allows a later call to pay', async () => {
  const api = await merchant();
  const payment = client(new SessionManager(), 'credit-drawdown');
  const error = new Error('payment unavailable');
  payment.createPaymentPayload.mockRejectedValueOnce(error);
  await expect(payment.fetch(api.url)).rejects.toBe(error);
  await expect(payment.fetch(api.url)).resolves.toHaveProperty('status', 200);
});

it('returns the second 402 instead of signing another payment', async () => {
  const api = await merchant({ always402: true });
  const payment = client(new SessionManager(), 'pay-per-request');
  await expect(payment.fetch(api.url)).resolves.toHaveProperty('status', 402);
  expect(api.seen).toHaveLength(2);
  expect(payment.createPaymentPayload).toHaveBeenCalledTimes(1);
});
