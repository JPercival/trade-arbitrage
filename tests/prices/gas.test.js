/**
 * Tests for src/prices/gas.js — ARB-5
 *
 * All ethers.js RPC calls are fully mocked. No network requests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock ethers.js before importing the module under test ──────────────────────

const mockGetFeeData = vi.fn();
const mockProvider = { getFeeData: mockGetFeeData };

vi.mock('ethers', () => {
  class FetchRequest {
    constructor(url) {
      this.url = url;
      this.timeout = 0;
    }
  }
  class JsonRpcProvider {
    constructor() {}
    getFeeData() {
      return mockGetFeeData();
    }
  }
  return {
    ethers: {
      FetchRequest,
      JsonRpcProvider,
    },
  };
});

// Mock config
vi.mock('../../src/config.js', () => ({
  default: {
    chains: ['ethereum', 'arbitrum', 'base'],
    chainConfigs: {
      ethereum: { name: 'ethereum', rpc: 'https://eth.llamarpc.com', chainId: 1, tokens: {} },
      arbitrum: { name: 'arbitrum', rpc: 'https://arb1.arbitrum.io/rpc', chainId: 42161, tokens: {} },
      base: { name: 'base', rpc: 'https://mainnet.base.org', chainId: 8453, tokens: {} },
    },
  },
}));

// ── Import module under test ───────────────────────────────────────────────────

const { fetchGasPrice, fetchAllGasPrices, getProvider, clearProviderCache } = await import('../../src/prices/gas.js');

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('gas.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearProviderCache();
  });

  // ── getProvider ────────────────────────────────────────────────────────────

  describe('getProvider', () => {
    it('returns a provider for a configured chain', () => {
      const provider = getProvider('ethereum');
      expect(provider).toBeDefined();
    });

    it('caches providers across calls', () => {
      const p1 = getProvider('ethereum');
      const p2 = getProvider('ethereum');
      expect(p1).toBe(p2);
    });

    it('returns different providers for different chains', () => {
      const p1 = getProvider('ethereum');
      const p2 = getProvider('arbitrum');
      expect(p1).not.toBe(p2);
    });

    it('throws for unconfigured chain', () => {
      expect(() => getProvider('solana')).toThrow('No RPC configured for chain: solana');
    });
  });

  // ── clearProviderCache ─────────────────────────────────────────────────────

  describe('clearProviderCache', () => {
    it('clears the cache so next getProvider creates a new instance', () => {
      const p1 = getProvider('ethereum');
      clearProviderCache();
      const p2 = getProvider('ethereum');
      expect(p1).not.toBe(p2);
    });
  });

  // ── fetchGasPrice ──────────────────────────────────────────────────────────

  describe('fetchGasPrice', () => {
    it('returns gas price in gwei using maxFeePerGas (EIP-1559)', async () => {
      mockGetFeeData.mockResolvedValue({
        maxFeePerGas: 30_000_000_000n, // 30 gwei
        gasPrice: 25_000_000_000n,
      });

      const result = await fetchGasPrice('ethereum', { provider: mockProvider });

      expect(result).toEqual({
        chain: 'ethereum',
        gasPriceGwei: 30,
        gasEstimateUsd: null,
      });
    });

    it('falls back to gasPrice when maxFeePerGas is null', async () => {
      mockGetFeeData.mockResolvedValue({
        maxFeePerGas: null,
        gasPrice: 25_000_000_000n,
      });

      const result = await fetchGasPrice('ethereum', { provider: mockProvider });

      expect(result).toEqual({
        chain: 'ethereum',
        gasPriceGwei: 25,
        gasEstimateUsd: null,
      });
    });

    it('calculates gas estimate in USD when ethPriceUsd is provided', async () => {
      // 30 gwei gas price, ETH at $3000
      mockGetFeeData.mockResolvedValue({
        maxFeePerGas: 30_000_000_000n,
        gasPrice: null,
      });

      const result = await fetchGasPrice('ethereum', {
        provider: mockProvider,
        ethPriceUsd: 3000,
      });

      // Expected: 30 gwei × 200_000 gas = 6_000_000 gwei = 0.006 ETH × $3000 = $18
      expect(result.chain).toBe('ethereum');
      expect(result.gasPriceGwei).toBe(30);
      expect(result.gasEstimateUsd).toBeCloseTo(18, 6);
    });

    it('uses custom swapGasUnits when provided', async () => {
      mockGetFeeData.mockResolvedValue({
        maxFeePerGas: 10_000_000_000n, // 10 gwei
        gasPrice: null,
      });

      const result = await fetchGasPrice('ethereum', {
        provider: mockProvider,
        ethPriceUsd: 2000,
        swapGasUnits: 150_000n,
      });

      // 10 gwei × 150_000 = 1_500_000 gwei = 0.0015 ETH × $2000 = $3
      expect(result.gasEstimateUsd).toBeCloseTo(3, 6);
    });

    it('handles very low L2 gas prices correctly', async () => {
      // Arbitrum: 0.01 gwei
      mockGetFeeData.mockResolvedValue({
        maxFeePerGas: 10_000_000n, // 0.01 gwei
        gasPrice: null,
      });

      const result = await fetchGasPrice('arbitrum', {
        provider: mockProvider,
        ethPriceUsd: 3000,
      });

      expect(result.chain).toBe('arbitrum');
      expect(result.gasPriceGwei).toBeCloseTo(0.01, 6);
      // 0.01 gwei × 200_000 = 2000 gwei = 0.000002 ETH × $3000 = $0.006
      expect(result.gasEstimateUsd).toBeCloseTo(0.006, 6);
    });

    it('throws when feeData returns no gas price at all', async () => {
      mockGetFeeData.mockResolvedValue({
        maxFeePerGas: null,
        gasPrice: null,
      });

      await expect(fetchGasPrice('ethereum', { provider: mockProvider }))
        .rejects.toThrow('No gas price data returned for chain: ethereum');
    });

    it('propagates RPC errors', async () => {
      mockGetFeeData.mockRejectedValue(new Error('RPC connection timeout'));

      await expect(fetchGasPrice('ethereum', { provider: mockProvider }))
        .rejects.toThrow('RPC connection timeout');
    });

    it('returns null gasEstimateUsd when ethPriceUsd is not provided', async () => {
      mockGetFeeData.mockResolvedValue({
        maxFeePerGas: 30_000_000_000n,
        gasPrice: null,
      });

      const result = await fetchGasPrice('ethereum', { provider: mockProvider });
      expect(result.gasEstimateUsd).toBeNull();
    });

    it('handles zero gas price', async () => {
      mockGetFeeData.mockResolvedValue({
        maxFeePerGas: 0n,
        gasPrice: null,
      });

      const result = await fetchGasPrice('base', {
        provider: mockProvider,
        ethPriceUsd: 3000,
      });

      expect(result.gasPriceGwei).toBe(0);
      expect(result.gasEstimateUsd).toBe(0);
    });

    it('uses getProvider when no provider override is given', async () => {
      clearProviderCache();
      mockGetFeeData.mockResolvedValue({
        maxFeePerGas: 20_000_000_000n,
        gasPrice: null,
      });

      // No provider in options — falls through to getProvider()
      const result = await fetchGasPrice('ethereum', { ethPriceUsd: 2500 });

      expect(result.chain).toBe('ethereum');
      expect(result.gasPriceGwei).toBe(20);
      // 20 gwei × 200K = 4_000_000 gwei = 0.004 ETH × $2500 = $10
      expect(result.gasEstimateUsd).toBeCloseTo(10, 4);
    });
  });

  // ── fetchAllGasPrices ──────────────────────────────────────────────────────

  describe('fetchAllGasPrices', () => {
    it('fetches gas prices for all configured chains in parallel', async () => {
      const mockProviders = {
        ethereum: {
          getFeeData: vi.fn().mockResolvedValue({
            maxFeePerGas: 30_000_000_000n,
            gasPrice: null,
          }),
        },
        arbitrum: {
          getFeeData: vi.fn().mockResolvedValue({
            maxFeePerGas: 100_000_000n, // 0.1 gwei
            gasPrice: null,
          }),
        },
        base: {
          getFeeData: vi.fn().mockResolvedValue({
            maxFeePerGas: 50_000_000n, // 0.05 gwei
            gasPrice: null,
          }),
        },
      };

      const results = await fetchAllGasPrices({
        ethPriceUsd: 3000,
        getProviderForChain: (chain) => mockProviders[chain],
      });

      expect(results).toHaveLength(3);

      // Ethereum
      expect(results[0].chain).toBe('ethereum');
      expect(results[0].gasPriceGwei).toBe(30);
      expect(results[0].gasEstimateUsd).toBeCloseTo(18, 4);

      // Arbitrum
      expect(results[1].chain).toBe('arbitrum');
      expect(results[1].gasPriceGwei).toBeCloseTo(0.1, 6);
      expect(results[1].gasEstimateUsd).toBeCloseTo(0.06, 4);

      // Base
      expect(results[2].chain).toBe('base');
      expect(results[2].gasPriceGwei).toBeCloseTo(0.05, 6);
      expect(results[2].gasEstimateUsd).toBeCloseTo(0.03, 4);
    });

    it('handles individual chain failures gracefully', async () => {
      const mockProviders = {
        ethereum: {
          getFeeData: vi.fn().mockResolvedValue({
            maxFeePerGas: 30_000_000_000n,
            gasPrice: null,
          }),
        },
        arbitrum: {
          getFeeData: vi.fn().mockRejectedValue(new Error('RPC timeout')),
        },
        base: {
          getFeeData: vi.fn().mockResolvedValue({
            maxFeePerGas: 50_000_000n,
            gasPrice: null,
          }),
        },
      };

      const results = await fetchAllGasPrices({
        ethPriceUsd: 3000,
        getProviderForChain: (chain) => mockProviders[chain],
      });

      expect(results).toHaveLength(3);

      // Ethereum succeeded
      expect(results[0].chain).toBe('ethereum');
      expect(results[0].gasPriceGwei).toBe(30);
      expect(results[0].error).toBeUndefined();

      // Arbitrum failed gracefully
      expect(results[1].chain).toBe('arbitrum');
      expect(results[1].gasPriceGwei).toBeNull();
      expect(results[1].gasEstimateUsd).toBeNull();
      expect(results[1].error).toBe('RPC timeout');

      // Base succeeded
      expect(results[2].chain).toBe('base');
      expect(results[2].gasPriceGwei).toBeCloseTo(0.05, 6);
    });

    it('works without ethPriceUsd (returns null for USD estimates)', async () => {
      const mockProviders = {
        ethereum: {
          getFeeData: vi.fn().mockResolvedValue({
            maxFeePerGas: 30_000_000_000n,
            gasPrice: null,
          }),
        },
        arbitrum: {
          getFeeData: vi.fn().mockResolvedValue({
            maxFeePerGas: 100_000_000n,
            gasPrice: null,
          }),
        },
        base: {
          getFeeData: vi.fn().mockResolvedValue({
            maxFeePerGas: 50_000_000n,
            gasPrice: null,
          }),
        },
      };

      const results = await fetchAllGasPrices({
        getProviderForChain: (chain) => mockProviders[chain],
      });

      for (const result of results) {
        expect(result.gasEstimateUsd).toBeNull();
      }
    });

    it('handles all chains failing', async () => {
      const mockProviders = {
        ethereum: {
          getFeeData: vi.fn().mockRejectedValue(new Error('Network error')),
        },
        arbitrum: {
          getFeeData: vi.fn().mockRejectedValue(new Error('Timeout')),
        },
        base: {
          getFeeData: vi.fn().mockRejectedValue(new Error('Rate limited')),
        },
      };

      const results = await fetchAllGasPrices({
        ethPriceUsd: 3000,
        getProviderForChain: (chain) => mockProviders[chain],
      });

      expect(results).toHaveLength(3);
      expect(results[0].error).toBe('Network error');
      expect(results[1].error).toBe('Timeout');
      expect(results[2].error).toBe('Rate limited');

      for (const result of results) {
        expect(result.gasPriceGwei).toBeNull();
        expect(result.gasEstimateUsd).toBeNull();
      }
    });

    it('passes swapGasUnits to individual chain calls', async () => {
      const mockProviders = {
        ethereum: {
          getFeeData: vi.fn().mockResolvedValue({
            maxFeePerGas: 10_000_000_000n, // 10 gwei
            gasPrice: null,
          }),
        },
        arbitrum: {
          getFeeData: vi.fn().mockResolvedValue({
            maxFeePerGas: 10_000_000_000n,
            gasPrice: null,
          }),
        },
        base: {
          getFeeData: vi.fn().mockResolvedValue({
            maxFeePerGas: 10_000_000_000n,
            gasPrice: null,
          }),
        },
      };

      const results = await fetchAllGasPrices({
        ethPriceUsd: 2000,
        swapGasUnits: 100_000n,
        getProviderForChain: (chain) => mockProviders[chain],
      });

      // 10 gwei × 100K gas = 1_000_000 gwei = 0.001 ETH × $2000 = $2
      for (const result of results) {
        expect(result.gasEstimateUsd).toBeCloseTo(2, 4);
      }
    });

    it('uses getProvider (no getProviderForChain override)', async () => {
      clearProviderCache();
      mockGetFeeData.mockResolvedValue({
        maxFeePerGas: 15_000_000_000n,
        gasPrice: null,
      });

      const results = await fetchAllGasPrices({ ethPriceUsd: 2000 });

      expect(results).toHaveLength(3);
      for (const result of results) {
        expect(result.gasPriceGwei).toBe(15);
        // 15 gwei × 200K gas = 3_000_000 gwei = 0.003 ETH × $2000 = $6
        expect(result.gasEstimateUsd).toBeCloseTo(6, 4);
      }
    });

    it('handles error without message property', async () => {
      const mockProviders = {
        ethereum: {
          getFeeData: vi.fn().mockRejectedValue('string error'),
        },
        arbitrum: {
          getFeeData: vi.fn().mockResolvedValue({
            maxFeePerGas: 100_000_000n,
            gasPrice: null,
          }),
        },
        base: {
          getFeeData: vi.fn().mockResolvedValue({
            maxFeePerGas: 50_000_000n,
            gasPrice: null,
          }),
        },
      };

      const results = await fetchAllGasPrices({
        getProviderForChain: (chain) => mockProviders[chain],
      });

      expect(results[0].error).toBe('Unknown error');
      expect(results[1].error).toBeUndefined();
    });
  });
});
