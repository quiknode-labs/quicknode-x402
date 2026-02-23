import type { Transport } from '@connectrpc/connect';
import { createGrpcWebTransport } from '@connectrpc/connect-web';
import type { GrpcTransportOptions } from './types.js';

/**
 * Create a gRPC-Web transport pre-configured with Quicknode x402 fetch.
 *
 * Must use `@connectrpc/connect-web` (not `connect-node`) because `connect-node`
 * doesn't accept a custom `fetch` function. The x402 fetch handles payments
 * transparently — gRPC-Web requests that trigger 402 will auto-pay and retry.
 */
export function createGrpcTransport(
  x402Fetch: typeof globalThis.fetch,
  options: GrpcTransportOptions,
): Transport {
  return createGrpcWebTransport({
    baseUrl: options.baseUrl,
    useBinaryFormat: options.useBinaryFormat ?? true,
    fetch: x402Fetch,
    interceptors: options.interceptors ?? [],
  });
}
