// Factory (primary API)

// Auth (for manual usage)
export { preAuthenticate } from './auth.js';
export { createQuicknodeX402Client } from './client.js';

// Composable utilities (for standalone usage, following payment-identifier pattern)
export {
  createSIWxClientHook, // re-exported from @x402/extensions
  extractQuicknodeSession,
  withBearerAuth,
  withSessionExtraction,
} from './extensions.js';
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
} from './types.js';
