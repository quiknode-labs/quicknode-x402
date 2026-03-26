import { describe, expect, it } from 'vitest';
import {
  CAIP2_TO_GATEWAY_CHAIN,
  GATEWAY_CHAIN_CONFIGS,
  GATEWAY_DOMAINS,
  GatewayClient,
  isBatchPayment,
  supportsBatching,
} from '../src/gateway.js';

describe('gateway module', () => {
  describe('CAIP2_TO_GATEWAY_CHAIN', () => {
    it('maps Base Sepolia', () => {
      expect(CAIP2_TO_GATEWAY_CHAIN['eip155:84532']).toBe('baseSepolia');
    });

    it('maps Polygon Amoy', () => {
      expect(CAIP2_TO_GATEWAY_CHAIN['eip155:80002']).toBe('polygonAmoy');
    });

    it('maps Arc Testnet', () => {
      expect(CAIP2_TO_GATEWAY_CHAIN['eip155:5042002']).toBe('arcTestnet');
    });
  });

  describe('re-exports', () => {
    it('exports GatewayClient class', () => {
      expect(GatewayClient).toBeDefined();
      expect(typeof GatewayClient).toBe('function');
    });

    it('exports GATEWAY_DOMAINS', () => {
      expect(GATEWAY_DOMAINS.baseSepolia).toBe(6);
      expect(GATEWAY_DOMAINS.arcTestnet).toBe(26);
      expect(GATEWAY_DOMAINS.polygonAmoy).toBe(7);
    });

    it('exports GATEWAY_CHAIN_CONFIGS with expected chains', () => {
      expect(GATEWAY_CHAIN_CONFIGS.baseSepolia).toBeDefined();
      expect(GATEWAY_CHAIN_CONFIGS.arcTestnet).toBeDefined();
      expect(GATEWAY_CHAIN_CONFIGS.polygonAmoy).toBeDefined();
    });
  });

  describe('isBatchPayment', () => {
    it('returns true for batch payment requirements', () => {
      const req = {
        scheme: 'exact',
        network: 'eip155:84532',
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        amount: '100',
        payTo: '0xrecipient',
        maxTimeoutSeconds: 345600,
        extra: {
          name: 'GatewayWalletBatched',
          version: '1',
          verifyingContract: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
        },
      };
      expect(isBatchPayment(req)).toBe(true);
    });

    it('returns false for regular exact payment requirements', () => {
      const req = {
        scheme: 'exact',
        network: 'eip155:84532',
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        amount: '1000',
        payTo: '0xrecipient',
        maxTimeoutSeconds: 60,
      };
      expect(isBatchPayment(req)).toBe(false);
    });
  });

  describe('supportsBatching', () => {
    it('returns true for a batch requirement', () => {
      const req = {
        scheme: 'exact',
        network: 'eip155:84532',
        amount: '100',
        extra: {
          name: 'GatewayWalletBatched',
          version: '1',
          verifyingContract: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
        },
      };
      expect(supportsBatching(req)).toBe(true);
    });

    it('returns false for a non-batch requirement', () => {
      const req = {
        scheme: 'exact',
        network: 'eip155:84532',
        amount: '1000',
      };
      expect(supportsBatching(req)).toBe(false);
    });

    it('can filter an array to find batch entries', () => {
      const reqs = [
        { scheme: 'exact', amount: '1000' },
        {
          scheme: 'exact',
          amount: '100',
          extra: {
            name: 'GatewayWalletBatched',
            version: '1',
            verifyingContract: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
          },
        },
      ];
      const batchEntries = reqs.filter((r) => supportsBatching(r));
      expect(batchEntries).toHaveLength(1);
      expect(batchEntries[0].amount).toBe('100');
    });
  });
});
