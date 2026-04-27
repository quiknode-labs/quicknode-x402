import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverX402Origin } from '../src/discovery.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('discoverX402Origin', () => {
  it('discovers resources from /.well-known/x402', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          version: '1.0.0',
          x402Version: 2,
          enabled: true,
          seller: {
            origin: 'https://seller.example',
            wellKnown: 'https://seller.example/.well-known/x402',
            openapi: 'https://seller.example/openapi.json',
            catalog: 'https://seller.example/catalog.json',
            payTo: '0x2eDbF699657ae1A09D9C3833FD162A6b59344364',
          },
          facilitator: { url: 'https://api.cdp.coinbase.com/platform/v2/x402' },
          accepts: [
            {
              scheme: 'exact',
              network: 'eip155:84532',
              payTo: '0x2eDbF699657ae1A09D9C3833FD162A6b59344364',
            },
          ],
          resourcesDetailed: [
            {
              path: '/weather',
              url: 'https://seller.example/weather',
              method: 'GET',
              priceUsd: '$0.001',
              title: 'Minimal paid HTTP proof',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await discoverX402Origin('https://seller.example');

    expect(fetchSpy).toHaveBeenCalledWith('https://seller.example/.well-known/x402', {
      headers: { Accept: 'application/json' },
    });
    expect(result.source).toBe('well-known');
    expect(result.enabled).toBe(true);
    expect(result.version).toBe('1.0.0');
    expect(result.x402Version).toBe(2);
    expect(result.facilitatorUrl).toBe('https://api.cdp.coinbase.com/platform/v2/x402');
    expect(result.accepts[0]?.network).toBe('eip155:84532');
    expect(result.resources).toEqual([
      expect.objectContaining({
        url: 'https://seller.example/weather',
        path: '/weather',
        method: 'GET',
        priceUsd: '$0.001',
        title: 'Minimal paid HTTP proof',
      }),
    ]);
    expect(result.resources[0]?.accepts?.[0]?.scheme).toBe('exact');
  });

  it('falls back to OpenAPI x-payment-info metadata', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).endsWith('/.well-known/x402')) {
        return new Response('not found', { status: 404 });
      }

      return new Response(
        JSON.stringify({
          openapi: '3.1.0',
          info: {
            title: 'Paid API',
            description: 'OpenAPI discovery fixture',
            version: '0.1.0',
            'x-guidance': 'Call a paid route without payment to receive PAYMENT-REQUIRED.',
          },
          servers: [{ url: 'https://seller.example/v1' }],
          paths: {
            '/merchant-payout-plan': {
              get: {
                summary: 'Bitcoin merchant payout plan',
                description: 'Returns a payout plan.',
                operationId: 'getMerchantPayoutPlan',
                parameters: [{ name: 'batchSize', in: 'query' }],
                responses: {
                  200: {
                    content: {
                      'application/json': {
                        schema: { type: 'object', required: ['plan'] },
                      },
                    },
                  },
                  402: { description: 'Payment Required' },
                },
                'x-payment-info': {
                  price: { mode: 'fixed', currency: 'USD', amount: '0.003' },
                  protocols: [{ x402: {} }],
                },
                'x-agent-discovery': {
                  method: 'GET',
                  priceUsd: '$0.003',
                  title: 'Bitcoin merchant payout plan',
                  category: 'Data',
                },
              },
            },
          },
          'x-discovery': {
            wellKnownX402: 'https://seller.example/.well-known/x402',
            catalog: 'https://seller.example/catalog.json',
            ownershipProofs: ['0x2eDbF699657ae1A09D9C3833FD162A6b59344364'],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const result = await discoverX402Origin('https://seller.example');

    expect(result.source).toBe('openapi');
    expect(result.info?.title).toBe('Paid API');
    expect(result.info?.guidance).toContain('PAYMENT-REQUIRED');
    expect(result.ownershipProofs).toEqual(['0x2eDbF699657ae1A09D9C3833FD162A6b59344364']);
    expect(result.resources).toEqual([
      expect.objectContaining({
        url: 'https://seller.example/v1/merchant-payout-plan',
        path: '/merchant-payout-plan',
        method: 'GET',
        title: 'Bitcoin merchant payout plan',
        summary: 'Bitcoin merchant payout plan',
        price: '0.003 USD',
        priceUsd: '$0.003',
        category: 'Data',
        input: [{ name: 'batchSize', in: 'query' }],
        output: { type: 'object', required: ['plan'] },
      }),
    ]);
  });

  it('normalizes string resources from the well-known manifest', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          accepts: [{ scheme: 'exact', network: 'eip155:84532' }],
          resources: ['/weather'],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await discoverX402Origin('https://seller.example/docs');

    expect(result.origin).toBe('https://seller.example');
    expect(result.resources).toEqual([
      {
        url: 'https://seller.example/weather',
        path: '/weather',
        accepts: [{ scheme: 'exact', network: 'eip155:84532' }],
      },
    ]);
  });

  it('does not set origin-relative path for cross-origin resources', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          accepts: [{ scheme: 'exact', network: 'eip155:84532' }],
          resources: ['https://other.example/api'],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await discoverX402Origin('https://seller.example');

    expect(result.resources[0]?.url).toBe('https://other.example/api');
    expect(result.resources[0]?.path).toBeUndefined();
  });

  it('throws a clear error when neither discovery source has resources', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }));

    await expect(discoverX402Origin('https://seller.example')).rejects.toThrow(
      'Unable to discover x402 resources for https://seller.example',
    );
  });
});
