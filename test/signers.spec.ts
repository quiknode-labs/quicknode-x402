import { describe, expect, it } from 'vitest';
import { createEvmSigners, createSvmSigners, detectNetworkType } from '../src/signers.js';

describe('createEvmSigners', () => {
  // Well-known test private key (never use with real funds)
  const testKey =
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as `0x${string}`;

  it('creates signers from a private key', () => {
    const { paymentSigner, siwxSigner, address } = createEvmSigners(testKey);

    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(paymentSigner).toBeDefined();
    expect(paymentSigner.address).toBe(address);
    expect(typeof paymentSigner.signTypedData).toBe('function');

    expect(siwxSigner).toBeDefined();
    expect(typeof siwxSigner.signMessage).toBe('function');
    expect((siwxSigner as any).account.address).toBe(address);
  });

  it('derives a deterministic address', () => {
    const result1 = createEvmSigners(testKey);
    const result2 = createEvmSigners(testKey);
    expect(result1.address).toBe(result2.address);
  });
});

describe('createSvmSigners', () => {
  it('creates signers from a Base58 private key', async () => {
    // Generate a valid Ed25519 keypair first, then encode as Base58
    const { generateKeyPairSigner } = await import('@solana/signers');
    const { getBase58Decoder } = await import('@solana/codecs');

    // Generate a proper keypair
    const validSigner = await generateKeyPairSigner();

    // Verify that a proper signer was generated (used below for keypair extraction)
    expect(validSigner.address).toBeDefined();

    // For the actual test, we need a Base58-encoded secret key.
    // We'll use the existing example pattern — create a nacl keypair and encode.
    // Use Ed25519 key generation via Web Crypto
    const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    const privateKeyRaw = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
    const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);

    // Ed25519 PKCS8 has a 16-byte header, then 34 bytes (2-byte wrapper + 32 bytes key)
    const pkcs8Bytes = new Uint8Array(privateKeyRaw);
    const privKeyBytes = pkcs8Bytes.slice(16, 48); // 32-byte Ed25519 seed
    const pubKeyBytes = new Uint8Array(publicKeyRaw); // 32-byte public key

    // Combine into 64-byte secret key (seed + public) as expected by @solana/signers
    const secretKey64 = new Uint8Array(64);
    secretKey64.set(privKeyBytes, 0);
    secretKey64.set(pubKeyBytes, 32);

    const testKey = getBase58Decoder().decode(secretKey64);

    const { paymentSigner, siwxSigner, address } = await createSvmSigners(testKey);

    expect(address).toBeDefined();
    expect(typeof address).toBe('string');
    expect(address.length).toBeGreaterThan(0);
    expect(paymentSigner).toBeDefined();
    expect(siwxSigner).toBeDefined();
  });
});

describe('detectNetworkType', () => {
  it('returns evm for eip155 networks', () => {
    expect(detectNetworkType('eip155:84532')).toBe('evm');
    expect(detectNetworkType('eip155:1')).toBe('evm');
    expect(detectNetworkType('eip155:8453')).toBe('evm');
  });

  it('returns svm for solana networks', () => {
    expect(detectNetworkType('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')).toBe('svm');
    expect(detectNetworkType('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1')).toBe('svm');
  });

  it('throws for unknown network formats', () => {
    expect(() => detectNetworkType('bitcoin:mainnet')).toThrow('Unrecognized network format');
    expect(() => detectNetworkType('cosmos:cosmoshub-4')).toThrow('Unrecognized network format');
    expect(() => detectNetworkType('')).toThrow('Unrecognized network format');
  });
});
