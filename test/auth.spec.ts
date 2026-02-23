import { afterEach, describe, expect, it, vi } from 'vitest';
import { preAuthenticate } from '../src/auth.js';
import { createEvmSigners } from '../src/signers.js';

describe('preAuthenticate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Use a real derived signer so the address is properly checksummed
  const testKey =
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as `0x${string}`;
  const { siwxSigner: mockEvmSigner } = createEvmSigners(testKey);

  it('POSTs to correct URL with siwx type', async () => {
    let capturedUrl = '';
    let capturedBody: any = null;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init: any) => {
      capturedUrl = typeof input === 'string' ? input : input.toString();
      if (init?.body) capturedBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          token: 'jwt-token',
          expiresAt: '2026-02-22T15:00:00.000Z',
          accountId: 'eip155:84532:0xtest',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    await preAuthenticate('https://x402.quicknode.com', 'eip155:84532', mockEvmSigner);

    expect(capturedUrl).toBe('https://x402.quicknode.com/auth');
    expect(capturedBody.type).toBe('siwx');
    expect(capturedBody.message).toBeDefined();
    expect(capturedBody.signature).toBeDefined();
    expect(typeof capturedBody.message).toBe('string');
    expect(typeof capturedBody.signature).toBe('string');
  });

  it('returns AuthResult on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          token: 'jwt-result',
          expiresAt: '2026-02-22T16:00:00.000Z',
          accountId: 'eip155:84532:0xabc',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await preAuthenticate('https://example.com', 'eip155:84532', mockEvmSigner);

    expect(result.token).toBe('jwt-result');
    expect(result.expiresAt).toBe('2026-02-22T16:00:00.000Z');
    expect(result.accountId).toBe('eip155:84532:0xabc');
  });

  it('throws on non-200 with error details', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_signature' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(
      preAuthenticate('https://example.com', 'eip155:84532', mockEvmSigner),
    ).rejects.toThrow('preAuth failed (401)');
  });

  it('constructs SIWE message for EVM networks', async () => {
    let capturedBody: any = null;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input: any, init: any) => {
      if (init?.body) capturedBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ token: 't', expiresAt: 'e', accountId: 'a' }), {
        status: 200,
      });
    });

    await preAuthenticate('https://x402.quicknode.com', 'eip155:84532', mockEvmSigner);

    // SIWE messages start with "{domain} wants you to sign in with your Ethereum account:"
    expect(capturedBody.message).toContain('wants you to sign in with your Ethereum account:');
    expect(capturedBody.message).toContain('x402.quicknode.com');
  });

  it('uses custom statement when provided', async () => {
    let capturedBody: any = null;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input: any, init: any) => {
      if (init?.body) capturedBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ token: 't', expiresAt: 'e', accountId: 'a' }), {
        status: 200,
      });
    });

    await preAuthenticate(
      'https://x402.quicknode.com',
      'eip155:84532',
      mockEvmSigner,
      'Custom ToS statement',
    );

    expect(capturedBody.message).toContain('Custom ToS statement');
  });
});
