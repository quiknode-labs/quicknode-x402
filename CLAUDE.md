# @quicknode/x402

Public npm package providing a multi-chain payment client for Quicknode's x402 RPC proxy.

## Build & Test

```bash
npm run build       # tsup → ESM + CJS in dist/
npm run test        # vitest
npm run typecheck   # tsc --noEmit
```

## Key APIs

- `createQuicknodeX402Client(config)` — Async factory, returns `QuicknodeX402Client`
- `SessionManager` — JWT lifecycle (cache, expiry check with 30s buffer)
- `preAuthenticate(baseUrl, network, signer)` — Manual SIWX auth
- `createSIWxClientHook(signer)` — x402HTTPClient hook for SIWX
- `createEvmSigners(privateKey)` / `createSvmSigners(privateKey)` — Signer factories
- `createGrpcTransport(fetch, options)` — Connect-RPC gRPC-Web transport

## Rules

- **Public repo, MIT license** — no staging URLs, no internal references
- **Naming:** "Quicknode" (not "QuickNode")
- **URLs:** Always `x402.quicknode.com`
- Pin `@x402/evm` to `~2.2.0` (2.4.0 has breaking `toClientEvmSigner` change)

## Architecture

- `src/client.ts` — Main factory: validates config, creates signers, wires x402 pipeline
- `src/auth.ts` — SIWX message construction and `/auth` POST
- `src/session.ts` — JWT extraction from headers, expiry management
- `src/fetch.ts` — Wraps fetch with Bearer auth, SIWX hook, session extraction, payment mutex
- `src/signers.ts` — EVM (viem) and SVM (@solana/signers) signer creation
- `src/grpc.ts` — gRPC-Web transport via @connectrpc/connect-web
- `src/websocket.ts` — Authenticated WebSocket with JWT query param
- `src/extensions.ts` — Composable standalone helpers
- `src/types.ts` — All type definitions and re-exports
