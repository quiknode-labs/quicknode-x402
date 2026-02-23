import type { SessionManager } from './session.js';

/**
 * Create an authenticated WebSocket connection to the Quicknode x402 proxy.
 *
 * WebSocket connections cannot trigger x402 payments (no HTTP 402 handshake).
 * The consumer must have a valid JWT before creating a WebSocket — either via
 * preAuth or from a prior x402 payment that issued a session JWT.
 */
export function createWebSocket(
  baseUrl: string,
  network: string,
  session: SessionManager,
): WebSocket {
  const token = session.getToken();
  if (!token) {
    throw new Error('No session token available. Call authenticate() or enable preAuth first.');
  }
  if (session.isExpired()) {
    throw new Error('Session token expired. Call authenticate() to refresh.');
  }
  // Validate network slug is alphanumeric with hyphens only (e.g., "eth-mainnet")
  if (!/^[\w-]+$/.test(network)) {
    throw new Error(
      `Invalid network slug for WebSocket: "${network}". Expected alphanumeric with hyphens.`,
    );
  }
  const wsUrl = `${baseUrl.replace('https', 'wss')}/${encodeURIComponent(network)}/ws?token=${token}`;
  return new WebSocket(wsUrl);
}
