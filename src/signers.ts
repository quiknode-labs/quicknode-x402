import { type ClientEvmSigner, toClientEvmSigner } from '@x402/evm';
import type { EVMSigner, SolanaSigner } from '@x402/extensions/sign-in-with-x';
import type { ClientSvmSigner } from '@x402/svm';
import { privateKeyToAccount } from 'viem/accounts';

/**
 * Create EVM signers for both x402 payments and SIWX auth from a private key.
 *
 * The signer split exists because x402 payment signing uses EIP-712 typed data
 * (via signTypedData) while SIWX uses EIP-191 personal messages (via signMessage).
 */
export function createEvmSigners(privateKey: `0x${string}`): {
  paymentSigner: ClientEvmSigner;
  siwxSigner: EVMSigner;
  address: `0x${string}`;
} {
  const account = privateKeyToAccount(privateKey);

  const paymentSigner = toClientEvmSigner({
    address: account.address,
    signTypedData: (params) => account.signTypedData(params as any),
  });

  const siwxSigner: EVMSigner = {
    signMessage: ({ message }: { message: string }) => account.signMessage({ message }),
    account: { address: account.address },
  };

  return { paymentSigner, siwxSigner, address: account.address };
}

/**
 * Create SVM signers for both x402 payments and SIWX auth from a Base58 private key.
 *
 * Uses @solana/codecs for Base58 decoding and @solana/signers for KeyPairSigner creation.
 * The KeyPairSigner from @solana/signers implements the full TransactionSigner interface
 * required by @x402/svm's ExactSvmScheme.
 */
export async function createSvmSigners(privateKey: string): Promise<{
  paymentSigner: ClientSvmSigner;
  siwxSigner: SolanaSigner;
  address: string;
}> {
  const { getBase58Encoder } = await import('@solana/codecs');
  const { createKeyPairSignerFromBytes } = await import('@solana/signers');

  // @solana/codecs naming: Encoder.encode(string) → Uint8Array (Base58 string → raw bytes)
  // This is the reverse of what most expect — "Encoder" means "encodes a value into bytes".
  const secretKey = getBase58Encoder().encode(privateKey);
  const keypairSigner = await createKeyPairSignerFromBytes(secretKey);

  // KeyPairSigner implements TransactionSigner (= ClientSvmSigner)
  const paymentSigner = keypairSigner as unknown as ClientSvmSigner;

  // Adapt KeyPairSigner to SolanaSigner for SIWX.
  // SolanaSigner can be WalletAdapterSigner (signMessage(Uint8Array) + publicKey)
  // or SolanaKitSigner (address + signMessages). KeyPairSigner is SolanaKitSigner-compatible.
  const siwxSigner = keypairSigner as unknown as SolanaSigner;

  return { paymentSigner, siwxSigner, address: keypairSigner.address as string };
}

/** Detect network type from CAIP-2 identifier. */
export function detectNetworkType(network: string): 'evm' | 'svm' {
  if (network.startsWith('eip155:')) return 'evm';
  if (network.startsWith('solana:')) return 'svm';
  throw new Error(
    `Unrecognized network format: "${network}". Expected CAIP-2 format (eip155:* or solana:*).`,
  );
}
