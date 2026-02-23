import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQuicknodeX402Client } from '../src/client.js';

afterEach(() => {
  vi.restoreAllMocks();
});

// Well-known test private key
const testEvmKey =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as `0x${string}`;

describe('createQuicknodeX402Client', () => {
  describe('validation', () => {
    it('throws when eip155 network has no EVM signer', async () => {
      await expect(
        createQuicknodeX402Client({
          baseUrl: 'https://example.com',
          network: 'eip155:84532',
        }),
      ).rejects.toThrow('evmPrivateKey or evmSigner');
    });

    it('throws when solana network has no SVM signer', async () => {
      await expect(
        createQuicknodeX402Client({
          baseUrl: 'https://example.com',
          network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
        }),
      ).rejects.toThrow('svmPrivateKey or svmSigner');
    });

    it('throws for unrecognized network format', async () => {
      await expect(
        createQuicknodeX402Client({
          baseUrl: 'https://example.com',
          network: 'bitcoin:mainnet',
          evmPrivateKey: testEvmKey,
        }),
      ).rejects.toThrow('Unrecognized network format');
    });

    it('throws when evmSigner provided without siwxSigner and no privateKey', async () => {
      const mockEvmSigner = {
        address: '0x1234' as `0x${string}`,
        signTypedData: vi.fn(),
      };

      await expect(
        createQuicknodeX402Client({
          baseUrl: 'https://example.com',
          network: 'eip155:84532',
          evmSigner: mockEvmSigner,
        }),
      ).rejects.toThrow('siwxSigner is also required');
    });
  });

  describe('EVM client creation', () => {
    it('creates client with EVM private key', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));

      const client = await createQuicknodeX402Client({
        baseUrl: 'https://x402.quicknode.com',
        network: 'eip155:84532',
        evmPrivateKey: testEvmKey,
      });

      expect(client.fetch).toBeDefined();
      expect(typeof client.fetch).toBe('function');
      expect(client.x402Client).toBeDefined();
      expect(client.httpClient).toBeDefined();
      expect(typeof client.getToken).toBe('function');
      expect(typeof client.getAccountId).toBe('function');
      expect(typeof client.isTokenExpired).toBe('function');
      expect(typeof client.authenticate).toBe('function');
      expect(typeof client.createGrpcTransport).toBe('function');
      expect(typeof client.createWebSocket).toBe('function');
    });

    it('starts with no token', async () => {
      const client = await createQuicknodeX402Client({
        baseUrl: 'https://x402.quicknode.com',
        network: 'eip155:84532',
        evmPrivateKey: testEvmKey,
      });

      expect(client.getToken()).toBeNull();
      expect(client.getAccountId()).toBeNull();
      expect(client.isTokenExpired()).toBe(true);
    });
  });

  describe('preAuth', () => {
    it('calls /auth during init when preAuth=true', async () => {
      let authCalled = false;

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof Request
              ? input.url
              : input.toString();
        if (url.includes('/auth')) {
          authCalled = true;
          return new Response(
            JSON.stringify({
              token: 'pre-auth-jwt',
              expiresAt: new Date(Date.now() + 3600_000).toISOString(),
              accountId: 'eip155:84532:0xtest',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('ok', { status: 200 });
      });

      const client = await createQuicknodeX402Client({
        baseUrl: 'https://x402.quicknode.com',
        network: 'eip155:84532',
        evmPrivateKey: testEvmKey,
        preAuth: true,
      });

      expect(authCalled).toBe(true);
      expect(client.getToken()).toBe('pre-auth-jwt');
    });

    it('does not call /auth when preAuth is false', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('ok', { status: 200 }));

      const client = await createQuicknodeX402Client({
        baseUrl: 'https://x402.quicknode.com',
        network: 'eip155:84532',
        evmPrivateKey: testEvmKey,
        preAuth: false,
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(client.getToken()).toBeNull();
    });
  });

  describe('signer override', () => {
    it('uses custom evmSigner and siwxSigner when provided', async () => {
      const mockEvmSigner = {
        address: '0xabc' as `0x${string}`,
        signTypedData: vi.fn(),
      };
      const mockSiwxSigner = {
        signMessage: vi.fn().mockResolvedValue('0xsig'),
        account: { address: '0xabc' },
      };

      const client = await createQuicknodeX402Client({
        baseUrl: 'https://x402.quicknode.com',
        network: 'eip155:84532',
        evmSigner: mockEvmSigner,
        siwxSigner: mockSiwxSigner,
      });

      expect(client.fetch).toBeDefined();
      expect(client.x402Client).toBeDefined();
    });
  });
});
