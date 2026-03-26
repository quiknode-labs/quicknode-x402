import type { Interceptor, Transport } from '@connectrpc/connect';
import type { x402Client, x402HTTPClient } from '@x402/core/client';
import type { ClientEvmSigner } from '@x402/evm';
import type { SIWxSigner } from '@x402/extensions/sign-in-with-x';
import type { ClientSvmSigner } from '@x402/svm';

export interface QuicknodeX402Config {
  /** Base URL of the Quicknode x402 proxy (e.g., 'https://x402.quicknode.com') */
  baseUrl: string;
  /** CAIP-2 payment network (e.g., 'eip155:84532', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') */
  network: string;

  // Auth — provide EITHER a private key OR a signer override
  /** Hex-encoded EVM private key (0x-prefixed). Creates both x402 payment signer and SIWX signer. */
  evmPrivateKey?: `0x${string}`;
  /** Base58-encoded Solana private key (64-byte secret key). Creates both x402 payment signer and SIWX signer. */
  svmPrivateKey?: string;

  // Signer overrides — for security-conscious users who don't want to pass raw keys
  /** Custom EVM signer for x402 payment signing. Overrides evmPrivateKey for payments. */
  evmSigner?: ClientEvmSigner;
  /** Custom SVM signer for x402 payment signing (@solana/kit TransactionSigner). Overrides svmPrivateKey for payments. */
  svmSigner?: ClientSvmSigner;
  /** Custom SIWX signer for auth signing. Overrides the SIWX signer derived from private key. */
  siwxSigner?: SIWxSigner;

  // Options
  /** Payment model: 'credit-drawdown' (default) uses SIWX auth + JWT session.
   *  'pay-per-request' sends x402 payment on every request (no SIWX, no JWT).
   *  'nanopayment' uses Circle Gateway batch payments ($0.0001/request, EVM-only). */
  paymentModel?: 'credit-drawdown' | 'pay-per-request' | 'nanopayment';
  /** Circle Gateway chain name for nanopayment mode (e.g., 'arcTestnet', 'baseSepolia').
   *  Maps to the `chain` parameter in GatewayClient. Only used when paymentModel is 'nanopayment'. */
  gatewayChain?: import('@circle-fin/x402-batching/client').SupportedChainName;
  /** If true, calls /auth with SIWX message during initialization to obtain JWT before first request. Default: false. */
  preAuth?: boolean;
  /** SIWX statement included in auth messages. Default: Quicknode ToS acceptance. */
  statement?: string;
}

export interface QuicknodeX402Client {
  /** Pre-configured fetch with Bearer auth, SIWX auto-sign on 402, x402 payment, and session JWT extraction. */
  fetch: typeof globalThis.fetch;
  /** The underlying x402Client instance (for advanced usage / additional scheme registration). */
  x402Client: x402Client;
  /** The underlying x402HTTPClient instance (for advanced usage / additional hook registration). */
  httpClient: x402HTTPClient;
  /** Get the currently cached session JWT, or null if none. */
  getToken(): string | null;
  /** Get the CAIP-10 accountId from the cached JWT, or null. */
  getAccountId(): string | null;
  /** Check if the cached JWT is expired. */
  isTokenExpired(): boolean;
  /** Manually authenticate via POST /auth and cache the returned JWT. */
  authenticate(): Promise<AuthResult>;
  /** Create a gRPC-Web transport pre-configured with the x402 fetch. */
  createGrpcTransport(options: GrpcTransportOptions): Transport;
  /** Create an authenticated WebSocket connection. */
  createWebSocket(network: string): WebSocket;
  /** Circle Gateway client for nanopayment deposit/balance management. Only available when paymentModel is 'nanopayment'. */
  gatewayClient?: import('@circle-fin/x402-batching/client').GatewayClient;
}

export interface AuthResult {
  token: string;
  expiresAt: string;
  accountId: string;
}

export interface GrpcTransportOptions {
  /** Base URL for gRPC-Web requests (e.g., 'https://x402.quicknode.com/flow-mainnet'). */
  baseUrl: string;
  /** Use binary protobuf format. Default: true. */
  useBinaryFormat?: boolean;
  /** Connect-RPC interceptors. */
  interceptors?: Interceptor[];
}

// Re-export key types for consumer convenience
export type { ClientEvmSigner } from '@x402/evm';
export type { EVMSigner, SIWxSigner, SolanaSigner } from '@x402/extensions/sign-in-with-x';
export type { ClientSvmSigner } from '@x402/svm';
