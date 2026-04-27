// Factory (primary API)

// Auth (for manual usage)
export { preAuthenticate } from './auth.js';
export { createQuicknodeX402Client } from './client.js';
// Discovery
export { discoverX402Origin } from './discovery.js';
// Composable utilities (for standalone usage, following payment-identifier pattern)
export {
  createSIWxClientHook, // re-exported from @x402/extensions
  extractQuicknodeSession,
  withBearerAuth,
  withSessionExtraction,
} from './extensions.js';
// Gateway (nanopayment deposit/balance helpers)
export {
  CAIP2_TO_GATEWAY_CHAIN,
  GATEWAY_CHAIN_CONFIGS,
  GATEWAY_DOMAINS,
  type GatewayBalances,
  type GatewayChainName,
  GatewayClient,
  type GatewayClientConfig,
  type GatewayDepositResult,
  isBatchPayment,
  supportsBatching,
} from './gateway.js';
export type { SettlementWithExtensions } from './session.js';
// Session manager (for advanced usage)
export { extractSessionFromResponse, extractSessionFromSettle, SessionManager } from './session.js';
// Signers (for custom setups)
export { createEvmSigners, createSvmSigners, detectNetworkType } from './signers.js';
// Types
// Re-export key types from x402 packages for consumer convenience
export type {
  AuthResult,
  ClientEvmSigner,
  ClientSvmSigner,
  EVMSigner,
  GrpcTransportOptions,
  QuicknodeX402Client,
  QuicknodeX402Config,
  SIWxSigner,
  SolanaSigner,
  X402DiscoveredResource,
  X402DiscoveryOptions,
  X402DiscoveryResult,
  X402DiscoverySource,
  X402PaymentAccept,
} from './types.js';
