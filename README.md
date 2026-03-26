# @quicknode/x402

Multi-chain payment client for Quicknode's x402 RPC proxy. Supports three payment models: **per-request** ($0.001/request, no auth), **credit drawdown** (SIWX auth + bulk credits), and **nanopayment** ($0.0001/request via Circle Gateway). Handles SIWX authentication, x402 stablecoin micropayments, JWT session management, and supports JSON-RPC, gRPC-Web, REST, and WebSocket protocols.

## Installation

```bash
npm install @quicknode/x402
```

## Quick Start

### Per-Request (Simplest — No Auth)

```typescript
import { createQuicknodeX402Client } from '@quicknode/x402';

const client = await createQuicknodeX402Client({
  baseUrl: 'https://x402.quicknode.com',
  network: 'eip155:84532', // Base Sepolia (payment network)
  evmPrivateKey: '0xYOUR_PRIVATE_KEY',
  paymentModel: 'pay-per-request',
});

// $0.001 per request — no auth, no credits, no session
const response = await client.fetch('https://x402.quicknode.com/ethereum-mainnet', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
});

const { result } = await response.json();
console.log('Block:', BigInt(result));
```

### Nanopayment (Sub-Cent via Circle Gateway)

```typescript
import { createQuicknodeX402Client } from '@quicknode/x402';

const client = await createQuicknodeX402Client({
  baseUrl: 'https://x402.quicknode.com',
  network: 'eip155:84532', // Base Sepolia
  evmPrivateKey: '0xYOUR_PRIVATE_KEY',
  paymentModel: 'nanopayment',
});

// $0.0001 per request — no auth, payments batched via Circle Gateway
const response = await client.fetch('https://x402.quicknode.com/base-sepolia', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
});

// Check Gateway Wallet balance
if (client.gatewayClient) {
  const balances = await client.gatewayClient.getBalances();
  console.log('Gateway available:', balances.gateway.formattedAvailable);
}
```

### Credit Drawdown (High-Volume with Auth)

```typescript
import { createQuicknodeX402Client } from '@quicknode/x402';

const client = await createQuicknodeX402Client({
  baseUrl: 'https://x402.quicknode.com',
  network: 'eip155:84532', // Base Sepolia
  evmPrivateKey: '0xYOUR_PRIVATE_KEY',
  preAuth: true, // SIWX auth during init
});

// Auth, payment, and session management handled automatically
const response = await client.fetch('https://x402.quicknode.com/base-sepolia', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
});

const { result } = await response.json();
console.log('Block:', BigInt(result));
console.log('Credits:', (await fetch('https://x402.quicknode.com/credits', {
  headers: { Authorization: `Bearer ${client.getToken()}` },
}).then(r => r.json())).credits);
```

### Solana (Devnet)

```typescript
import { createQuicknodeX402Client } from '@quicknode/x402';

const client = await createQuicknodeX402Client({
  baseUrl: 'https://x402.quicknode.com',
  network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', // Solana Devnet
  svmPrivateKey: 'YOUR_BASE58_SECRET_KEY',
  preAuth: true,
});

const response = await client.fetch('https://x402.quicknode.com/solana-devnet', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot', params: [] }),
});
```

## Features

- **Three Payment Models** — Per-request ($0.001, no auth), credit drawdown (SIWX auth + bulk credits), or nanopayment ($0.0001 via Circle Gateway)
- **SIWX Authentication** — Automatic Sign-In with X (EVM EIP-191 + Solana Ed25519) on 402 responses (credit drawdown)
- **x402 v2 Payments** — Automatic stablecoin micropayments when credits are exhausted
- **No Billing for Errors** — Per-request only settles payment after a successful upstream response
- **Session Management** — JWT caching, auto-extraction from settlement responses, expiry handling with 30s buffer
- **Payment-in-flight Mutex** — Prevents concurrent double-payments when multiple requests hit 402 simultaneously
- **gRPC-Web Transport** — Pre-configured Connect-RPC transport with x402 payment handling (credit drawdown only)
- **WebSocket** — Authenticated WebSocket connections with JWT query parameter (credit drawdown only)
- **Composable Extensions** — Standalone helpers for integrating with any x402 setup

## API

### `createQuicknodeX402Client(config): Promise<QuicknodeX402Client>`

Async factory that creates a fully-configured client. Async due to SVM key derivation and optional preAuth network call.

### Config

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `baseUrl` | `string` | Yes | Quicknode x402 proxy URL |
| `network` | `string` | Yes | CAIP-2 payment network (e.g., `'eip155:84532'`, `'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'`) |
| `evmPrivateKey` | `` `0x${string}` `` | * | Hex-encoded EVM private key. Creates both payment signer and SIWX signer. |
| `svmPrivateKey` | `string` | * | Base58-encoded Solana secret key (64 bytes). Creates both payment signer and SIWX signer. |
| `evmSigner` | `ClientEvmSigner` | | Custom EVM payment signer. Overrides `evmPrivateKey` for payments. |
| `svmSigner` | `ClientSvmSigner` | | Custom SVM payment signer. Overrides `svmPrivateKey` for payments. |
| `siwxSigner` | `SIWxSigner` | | Custom SIWX auth signer. Overrides the signer derived from private key. |
| `paymentModel` | `string` | | `'pay-per-request'` ($0.001/req), `'credit-drawdown'` (SIWX auth, bulk credits), or `'nanopayment'` ($0.0001/req, Circle Gateway). Default: `'credit-drawdown'`. |
| `gatewayChain` | `string` | | Circle Gateway chain name override (e.g., `'baseSepolia'`). Auto-detected from `network` for supported chains. Nanopayment mode only. |
| `preAuth` | `boolean` | | If true, authenticates via `POST /auth` during initialization (credit drawdown only). Default: `false`. |
| `statement` | `string` | | SIWX statement. Default: Quicknode ToS acceptance. |

\* Provide either `evmPrivateKey` or `svmPrivateKey` matching the network type. Alternatively, provide signer overrides. Per-request mode requires a payment signer but not a SIWX signer.

### Client Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `fetch(input, init?)` | `Promise<Response>` | x402-enabled fetch with Bearer auth, SIWX auto-sign, payment, and session extraction |
| `getToken()` | `string \| null` | Current cached session JWT |
| `getAccountId()` | `string \| null` | CAIP-10 account ID from JWT |
| `isTokenExpired()` | `boolean` | Whether cached JWT is expired (with 30s buffer) |
| `authenticate()` | `Promise<AuthResult>` | Manually authenticate via `POST /auth` |
| `createGrpcTransport(opts)` | `Transport` | Connect-RPC gRPC-Web transport using x402 fetch |
| `createWebSocket(network)` | `WebSocket` | Authenticated WebSocket with JWT in query param |
| `x402Client` | `x402Client` | Underlying x402 client (for advanced scheme registration) |
| `httpClient` | `x402HTTPClient` | Underlying HTTP client (for advanced hook registration) |
| `gatewayClient` | `GatewayClient \| undefined` | Circle Gateway client for deposit/balance management (nanopayment mode only) |

### gRPC-Web Transport

```typescript
import { createClient } from '@connectrpc/connect';
import { MyService } from './gen/my_service_pb.js';

const transport = client.createGrpcTransport({
  baseUrl: 'https://x402.quicknode.com/flow-mainnet',
});

const grpcClient = createClient(MyService, transport);
const result = await grpcClient.myMethod({ /* ... */ });
```

### WebSocket

```typescript
// Requires valid session (preAuth: true or prior x402 payment)
const ws = client.createWebSocket('base-mainnet');

ws.addEventListener('open', () => {
  ws.send(JSON.stringify({
    jsonrpc: '2.0',
    method: 'eth_subscribe',
    params: ['newHeads'],
    id: 1,
  }));
});
```

## Composable Extensions

For users integrating with existing x402 setups without using the full factory:

```typescript
import {
  // SIWX hook for x402HTTPClient
  createSIWxClientHook,
  // Extract quicknode-session JWT from any Response
  extractQuicknodeSession,
  // Wrap fetch with Bearer auth injection
  withBearerAuth,
  // Wrap fetch with session extraction callback
  withSessionExtraction,
  // JWT lifecycle manager
  SessionManager,
  // Signer factories
  createEvmSigners,
  createSvmSigners,
  detectNetworkType,
  // Gateway (nanopayment) helpers
  GatewayClient,
  CAIP2_TO_GATEWAY_CHAIN,
  isBatchPayment,
  supportsBatching,
} from '@quicknode/x402';
```

### Example: Custom x402HTTPClient Setup

```typescript
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm';
import {
  createSIWxClientHook,
  extractQuicknodeSession,
  createEvmSigners,
} from '@quicknode/x402';

const { paymentSigner, siwxSigner } = createEvmSigners('0xYOUR_KEY');

const client = new x402Client();
client.register('eip155:84532', new ExactEvmScheme(paymentSigner));

const httpClient = new x402HTTPClient(client)
  .onPaymentRequired(createSIWxClientHook(siwxSigner));

// Use httpClient with your own fetch wrapper, extracting sessions as needed
```

## Supported Networks

### Payment Networks (CAIP-2)

| Network | CAIP-2 ID | Environment |
|---------|-----------|-------------|
| Base Sepolia | `eip155:84532` | Testnet |
| Base Mainnet | `eip155:8453` | Mainnet |
| Polygon Amoy | `eip155:80002` | Testnet |
| Polygon Mainnet | `eip155:137` | Mainnet |
| Solana Devnet | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` | Testnet |
| XLayer Testnet | `eip155:1952` | Testnet |
| XLayer Mainnet | `eip155:196` | Mainnet |
| Arc Testnet | `eip155:5042002` | Testnet |
| Solana Mainnet | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | Mainnet |

### RPC Networks

140+ blockchain networks supported. See the [x402 proxy documentation](https://x402.quicknode.com/llms.txt) for the full list.

## Types

Key types are re-exported for convenience:

```typescript
import type {
  QuicknodeX402Config,
  QuicknodeX402Client,
  AuthResult,
  GrpcTransportOptions,
  ClientEvmSigner,
  ClientSvmSigner,
  SIWxSigner,
  EVMSigner,
  SolanaSigner,
  GatewayChainName,
  GatewayBalances,
  GatewayClientConfig,
  GatewayDepositResult,
} from '@quicknode/x402';
```

## Requirements

- Node.js 18+
- A wallet with USDC or USDG on a supported payment network

## License

MIT
