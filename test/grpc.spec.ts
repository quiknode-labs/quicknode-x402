import { describe, expect, it, vi } from 'vitest';
import { createGrpcTransport } from '../src/grpc.js';

// Mock @connectrpc/connect-web
vi.mock('@connectrpc/connect-web', () => ({
  createGrpcWebTransport: vi.fn().mockReturnValue({ type: 'mock-transport' }),
}));

describe('createGrpcTransport', () => {
  it('creates transport with correct baseUrl and fetch', async () => {
    const { createGrpcWebTransport } = await import('@connectrpc/connect-web');
    const mockFetch = vi.fn() as unknown as typeof globalThis.fetch;

    const transport = createGrpcTransport(mockFetch, {
      baseUrl: 'https://x402.quicknode.com/flow-mainnet',
    });

    expect(transport).toEqual({ type: 'mock-transport' });
    expect(createGrpcWebTransport).toHaveBeenCalledWith({
      baseUrl: 'https://x402.quicknode.com/flow-mainnet',
      useBinaryFormat: true,
      fetch: mockFetch,
      interceptors: [],
    });
  });

  it('passes useBinaryFormat option', async () => {
    const { createGrpcWebTransport } = await import('@connectrpc/connect-web');
    const mockFetch = vi.fn() as unknown as typeof globalThis.fetch;

    createGrpcTransport(mockFetch, {
      baseUrl: 'https://example.com',
      useBinaryFormat: false,
    });

    expect(createGrpcWebTransport).toHaveBeenCalledWith(
      expect.objectContaining({ useBinaryFormat: false }),
    );
  });

  it('passes interceptors', async () => {
    const { createGrpcWebTransport } = await import('@connectrpc/connect-web');
    const mockFetch = vi.fn() as unknown as typeof globalThis.fetch;
    const interceptor = vi.fn();

    createGrpcTransport(mockFetch, {
      baseUrl: 'https://example.com',
      interceptors: [interceptor as any],
    });

    expect(createGrpcWebTransport).toHaveBeenCalledWith(
      expect.objectContaining({ interceptors: [interceptor] }),
    );
  });
});
