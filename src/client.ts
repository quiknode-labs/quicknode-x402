import { isBatchPayment } from '@circle-fin/x402-batching';
import type { GatewayClient } from '@circle-fin/x402-batching/client';
import { registerBatchScheme } from '@circle-fin/x402-batching/client';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import type { Network } from '@x402/core/types';
import { type ClientEvmSigner, ExactEvmScheme } from '@x402/evm';
import { createSIWxClientHook, type SIWxSigner } from '@x402/extensions/sign-in-with-x';
import { type ClientSvmSigner, ExactSvmScheme } from '@x402/svm';
import { preAuthenticate } from './auth.js';
import { createQuicknodeFetch } from './fetch.js';
import { CAIP2_TO_GATEWAY_CHAIN } from './gateway.js';
import { createGrpcTransport } from './grpc.js';
import { SessionManager } from './session.js';
import { createEvmSigners, createSvmSigners, detectNetworkType } from './signers.js';
import type { GrpcTransportOptions, QuicknodeX402Client, QuicknodeX402Config } from './types.js';
import { createWebSocket } from './websocket.js';

/**
 * Create a fully-configured Quicknode x402 client.
 *
 * Factory is async due to SVM signer creation (Ed25519 key derivation) and
 * optional preAuth network call.
 */
export async function createQuicknodeX402Client(
  config: QuicknodeX402Config,
): Promise<QuicknodeX402Client> {
  const networkType = detectNetworkType(config.network);
  const network = config.network as Network;
  const isPerRequest = config.paymentModel === 'pay-per-request';
  const isNanopayment = config.paymentModel === 'nanopayment';

  // Nanopayment is EVM-only
  if (isNanopayment && networkType !== 'evm') {
    throw new Error('Nanopayment model is only supported on EVM networks.');
  }

  // Validate config: ensure payment signer matches network type
  if (networkType === 'evm') {
    if (!config.evmPrivateKey && !config.evmSigner) {
      throw new Error('eip155 network requires evmPrivateKey or evmSigner. Got neither.');
    }
    if (config.svmPrivateKey && !config.evmPrivateKey && !config.evmSigner) {
      throw new Error(
        'eip155 network requires an EVM signer, but only svmPrivateKey was provided.',
      );
    }
  } else {
    if (!config.svmPrivateKey && !config.svmSigner) {
      throw new Error('solana network requires svmPrivateKey or svmSigner. Got neither.');
    }
    if (config.evmPrivateKey && !config.svmPrivateKey && !config.svmSigner) {
      throw new Error(
        'solana network requires an SVM signer, but only evmPrivateKey was provided.',
      );
    }
  }

  // Create signers — siwxSigner is optional for pay-per-request
  let paymentSigner: ClientEvmSigner | ClientSvmSigner;
  let siwxSigner: SIWxSigner | undefined;

  if (networkType === 'evm') {
    if (config.evmPrivateKey) {
      const derived = createEvmSigners(config.evmPrivateKey);
      paymentSigner = config.evmSigner ?? derived.paymentSigner;
      siwxSigner = config.siwxSigner ?? derived.siwxSigner;
    } else {
      paymentSigner = config.evmSigner!;
      if (!isPerRequest && !isNanopayment && !config.siwxSigner) {
        throw new Error(
          'When providing evmSigner without evmPrivateKey, siwxSigner is also required for credit-drawdown mode.',
        );
      }
      siwxSigner = config.siwxSigner;
    }
  } else {
    if (config.svmPrivateKey) {
      const derived = await createSvmSigners(config.svmPrivateKey);
      paymentSigner = config.svmSigner ?? derived.paymentSigner;
      siwxSigner = config.siwxSigner ?? derived.siwxSigner;
    } else {
      paymentSigner = config.svmSigner!;
      if (!isPerRequest && !config.siwxSigner) {
        throw new Error(
          'When providing svmSigner without svmPrivateKey, siwxSigner is also required for credit-drawdown mode.',
        );
      }
      siwxSigner = config.siwxSigner;
    }
  }

  // Create x402Client and register payment scheme
  // Cast is safe: networkType validation above guarantees the signer matches.
  const client = new x402Client();
  if (isNanopayment) {
    // Register CompositeEvmScheme: dispatches to BatchEvmScheme for Gateway payments,
    // falls back to ExactEvmScheme for standard exact payments.
    registerBatchScheme(client, {
      signer: paymentSigner as ClientEvmSigner,
      fallbackScheme: new ExactEvmScheme(paymentSigner as ClientEvmSigner),
    });
  } else if (networkType === 'evm') {
    client.register(network, new ExactEvmScheme(paymentSigner as ClientEvmSigner));
  } else {
    client.register(network, new ExactSvmScheme(paymentSigner as ClientSvmSigner));
  }

  // Register payment selection policy based on paymentModel
  // BigInt-safe comparator (avoids Number() precision loss for large amounts)
  const bigintAsc = (a: { amount: string }, b: { amount: string }) => {
    const diff = BigInt(a.amount) - BigInt(b.amount);
    return diff < 0n ? -1 : diff > 0n ? 1 : 0;
  };

  if (isNanopayment) {
    // Select batch (Gateway) entry for our network — lowest amount among batch entries
    client.registerPolicy((_version, requirements) => {
      const forNetwork = requirements.filter((r) => r.network === config.network);
      if (forNetwork.length === 0) return requirements;
      const batchEntries = forNetwork.filter((r) => isBatchPayment(r));
      if (batchEntries.length === 0) {
        forNetwork.sort(bigintAsc);
        return [forNetwork[0]];
      }
      batchEntries.sort(bigintAsc);
      return [batchEntries[0]];
    });
  } else if (isPerRequest) {
    // Select lowest-amount non-batch entry for our network (= per-request amount)
    client.registerPolicy((_version, requirements) => {
      const forNetwork = requirements.filter((r) => r.network === config.network);
      if (forNetwork.length === 0) return requirements;
      const exactEntries = forNetwork.filter((r) => !isBatchPayment(r));
      const candidates = exactEntries.length > 0 ? exactEntries : forNetwork;
      candidates.sort(bigintAsc);
      return [candidates[0]];
    });
  } else {
    // Select highest-amount non-batch entry for our network (= credit drawdown amount)
    client.registerPolicy((_version, requirements) => {
      const forNetwork = requirements.filter((r) => r.network === config.network);
      if (forNetwork.length === 0) return requirements;
      const exactEntries = forNetwork.filter((r) => !isBatchPayment(r));
      const candidates = exactEntries.length > 0 ? exactEntries : forNetwork;
      candidates.sort((a, b) => -bigintAsc(a, b));
      return [candidates[0]];
    });
  }

  // Create x402HTTPClient — SIWX hook only for credit drawdown
  const httpClient = new x402HTTPClient(client);
  if (!isPerRequest && !isNanopayment && siwxSigner) {
    httpClient.onPaymentRequired(createSIWxClientHook(siwxSigner));
  }

  // Create SessionManager and fetch wrapper
  const session = new SessionManager();
  const x402Fetch = createQuicknodeFetch({
    httpClient,
    session,
    paymentModel: config.paymentModel,
  });

  // Instantiate GatewayClient for nanopayment mode (if private key available)
  let gatewayClient: GatewayClient | undefined;
  if (isNanopayment && config.evmPrivateKey) {
    const { GatewayClient: GC } = await import('@circle-fin/x402-batching/client');
    const chainName = config.gatewayChain ?? CAIP2_TO_GATEWAY_CHAIN[config.network];
    if (!chainName) {
      throw new Error(
        `No Gateway chain mapping for network '${config.network}'. Provide gatewayChain explicitly.`,
      );
    }
    gatewayClient = new GC({
      chain: chainName as import('@circle-fin/x402-batching/client').SupportedChainName,
      privateKey: config.evmPrivateKey,
    });
  }

  // preAuth — authenticate via POST /auth before any paid requests (credit drawdown only)
  if (!isPerRequest && !isNanopayment && config.preAuth && siwxSigner) {
    const authResult = await preAuthenticate(
      config.baseUrl,
      config.network,
      siwxSigner,
      config.statement,
    );
    session.setToken(authResult.token, authResult.expiresAt);
  }

  return {
    fetch: x402Fetch,
    x402Client: client,
    httpClient,
    getToken: () => session.getToken(),
    getAccountId: () => session.getAccountId(),
    isTokenExpired: () => session.isExpired(),
    authenticate: async () => {
      if (isPerRequest || isNanopayment) {
        throw new Error(
          `authenticate() is not available in ${isNanopayment ? 'nanopayment' : 'pay-per-request'} mode.`,
        );
      }
      if (!siwxSigner) {
        throw new Error(
          'authenticate() requires a SIWX signer. Provide evmPrivateKey or siwxSigner.',
        );
      }
      const authResult = await preAuthenticate(
        config.baseUrl,
        config.network,
        siwxSigner,
        config.statement,
      );
      session.setToken(authResult.token, authResult.expiresAt);
      return authResult;
    },
    createGrpcTransport: (options: GrpcTransportOptions) => createGrpcTransport(x402Fetch, options),
    createWebSocket: (networkSlug: string) => createWebSocket(config.baseUrl, networkSlug, session),
    gatewayClient,
  };
}
