/**
 * Circle Gateway helpers for nanopayment support.
 *
 * Re-exports key types and utilities from @circle-fin/x402-batching/client
 * for buyer-side deposit/balance management.
 */

// Re-export batch detection helpers from the root module
export { isBatchPayment, supportsBatching } from '@circle-fin/x402-batching';
export {
  type Balances as GatewayBalances,
  CHAIN_CONFIGS as GATEWAY_CHAIN_CONFIGS,
  type DepositResult as GatewayDepositResult,
  GATEWAY_DOMAINS,
  GatewayClient,
  type GatewayClientConfig,
  type SupportedChainName as GatewayChainName,
} from '@circle-fin/x402-batching/client';

/** CAIP-2 network → Gateway chain name mapping for nanopayment-eligible chains. */
export const CAIP2_TO_GATEWAY_CHAIN: Record<string, string> = {
  'eip155:84532': 'baseSepolia',
  'eip155:80002': 'polygonAmoy',
  'eip155:5042002': 'arcTestnet',
};
