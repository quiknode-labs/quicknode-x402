import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionManager } from '../src/session.js';
import { createWebSocket } from '../src/websocket.js';

// Mock WebSocket constructor
const MockWebSocket = vi.fn();

describe('createWebSocket', () => {
  let session: SessionManager;

  // Stub global WebSocket for Node.js test environment
  vi.stubGlobal('WebSocket', MockWebSocket);

  afterEach(() => {
    vi.restoreAllMocks();
    MockWebSocket.mockClear();
  });

  it('throws when no session token is available', () => {
    session = new SessionManager();

    expect(() => createWebSocket('https://example.com', 'eth-mainnet', session)).toThrow(
      'No session token available',
    );
  });

  it('throws when session token is expired', () => {
    session = new SessionManager();
    session.setToken(
      `h.${btoa(JSON.stringify({ sub: 'test' }))}.s`,
      new Date(Date.now() - 60_000).toISOString(), // expired
    );

    expect(() => createWebSocket('https://example.com', 'eth-mainnet', session)).toThrow(
      'Session token expired',
    );
  });

  it('creates WebSocket with correct URL', () => {
    session = new SessionManager();
    session.setToken(
      `h.${btoa(JSON.stringify({ sub: 'test' }))}.s`,
      new Date(Date.now() + 3600_000).toISOString(),
    );

    createWebSocket('https://example.com', 'eth-mainnet', session);

    expect(MockWebSocket).toHaveBeenCalledWith(
      expect.stringContaining('wss://example.com/eth-mainnet/ws?token='),
    );
  });

  it('throws for invalid network slug with special characters', () => {
    session = new SessionManager();
    session.setToken(
      `h.${btoa(JSON.stringify({ sub: 'test' }))}.s`,
      new Date(Date.now() + 3600_000).toISOString(),
    );

    expect(() => createWebSocket('https://example.com', '../../../etc', session)).toThrow(
      'Invalid network slug',
    );
  });

  it('throws for network slug with spaces', () => {
    session = new SessionManager();
    session.setToken(
      `h.${btoa(JSON.stringify({ sub: 'test' }))}.s`,
      new Date(Date.now() + 3600_000).toISOString(),
    );

    expect(() => createWebSocket('https://example.com', 'some network', session)).toThrow(
      'Invalid network slug',
    );
  });

  it('accepts valid network slugs with hyphens and underscores', () => {
    session = new SessionManager();
    session.setToken(
      `h.${btoa(JSON.stringify({ sub: 'test' }))}.s`,
      new Date(Date.now() + 3600_000).toISOString(),
    );

    // Should not throw
    createWebSocket('https://example.com', 'flow-mainnet', session);
    createWebSocket('https://example.com', 'sol_devnet', session);

    expect(MockWebSocket).toHaveBeenCalledTimes(2);
  });
});
