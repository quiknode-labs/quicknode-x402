import {
  type CompleteSIWxInfo,
  createSIWxMessage,
  createSIWxPayload,
  type EVMSigner,
  getEVMAddress,
  getSolanaAddress,
  isEVMSigner,
  type SIWxSigner,
  type SolanaSigner,
} from '@x402/extensions/sign-in-with-x';
import type { AuthResult } from './types.js';

/** Generate a cryptographically random nonce (hex string). */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const DEFAULT_STATEMENT =
  'I accept the Quicknode Terms of Service: https://www.quicknode.com/terms';

/**
 * Authenticate via POST /auth with a SIWX message. Returns JWT and account info.
 *
 * Uses `createSIWxPayload()` from `@x402/extensions/sign-in-with-x` — the canonical
 * signing function that `createSIWxClientHook` itself uses internally. This ensures
 * preAuth signing stays in sync with hook-based signing.
 *
 * The /auth endpoint expects `{ message, signature, type }` where `message` is the
 * raw SIWE/SIWS plaintext. `createSIWxPayload` returns individual fields + signature
 * but not the raw message text, so we reconstruct it via `createSIWxMessage`.
 */
export async function preAuthenticate(
  baseUrl: string,
  network: string,
  siwxSigner: SIWxSigner,
  statement?: string,
): Promise<AuthResult> {
  // Determine signature type from network
  const signatureType: 'eip191' | 'ed25519' = network.startsWith('eip155:') ? 'eip191' : 'ed25519';

  const info: CompleteSIWxInfo = {
    domain: new URL(baseUrl).host,
    uri: baseUrl,
    statement: statement ?? DEFAULT_STATEMENT,
    version: '1',
    chainId: network,
    type: signatureType,
    nonce: generateNonce(),
    issuedAt: new Date().toISOString(),
  };

  // Use createSIWxPayload for canonical signing (same path as createSIWxClientHook)
  const payload = await createSIWxPayload(info, siwxSigner);

  // Reconstruct the raw message text for /auth POST body.
  // createSIWxPayload uses createSIWxMessage internally — we call it again with the
  // same info + address to get the identical message string.
  const address = isEVMSigner(siwxSigner)
    ? getEVMAddress(siwxSigner as EVMSigner)
    : getSolanaAddress(siwxSigner as SolanaSigner);
  const message = createSIWxMessage(info, address);

  const response = await globalThis.fetch(`${baseUrl}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      signature: payload.signature,
      type: 'siwx',
    }),
  });

  if (!response.ok) {
    let errorBody: string;
    try {
      errorBody = await response.text();
    } catch {
      errorBody = `HTTP ${response.status}`;
    }
    throw new Error(`preAuth failed (${response.status}): ${errorBody}`);
  }

  const result = (await response.json()) as AuthResult;
  return result;
}
