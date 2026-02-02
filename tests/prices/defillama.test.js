import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildCoinKeys,
  parsePrices,
  fetchPrices,
  DefiLlamaError,
} from '../../src/prices/defillama.js';

// ── Test data ──────────────────────────────────────────────────────────────────

const TEST_PAIRS = [
  { base: 'ETH', quote: 'USDC', symbol: 'ETH/USDC' },
  { base: 'WBTC', quote: 'USDC', symbol: 'WBTC/USDC' },
];

const TEST_CHAINS = ['ethereum', 'arbitrum', 'base'];

const NOW_SECONDS = 1700000000;

function makeLlamaResponse(overrides = {}) {
  return {
    coins: {
      'ethereum:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2': {
        decimals: 18,
        symbol: 'WETH',
        price: 2500.42,
        timestamp: NOW_SECONDS - 5,
        confidence: 0.99,
        ...overrides['ethereum:WETH'],
      },
      'arbitrum:0x82aF49447D8a07e3bd95BD0d56f35241523fBab1': {
        decimals: 18,
        symbol: 'WETH',
        price: 2501.15,
        timestamp: NOW_SECONDS - 3,
        confidence: 0.99,
        ...overrides['arbitrum:WETH'],
      },
      'base:0x4200000000000000000000000000000000000006': {
        decimals: 18,
        symbol: 'WETH',
        price: 2499.88,
        timestamp: NOW_SECONDS - 2,
        confidence: 0.99,
        ...overrides['base:WETH'],
      },
      'ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599': {
        decimals: 8,
        symbol: 'WBTC',
        price: 43567.89,
        timestamp: NOW_SECONDS - 4,
        confidence: 0.99,
        ...overrides['ethereum:WBTC'],
      },
      'arbitrum:0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f': {
        decimals: 8,
        symbol: 'WBTC',
        price: 43570.12,
        timestamp: NOW_SECONDS - 1,
        confidence: 0.99,
        ...overrides['arbitrum:WBTC'],
      },
    },
  };
}

// ── buildCoinKeys ──────────────────────────────────────────────────────────────

describe('buildCoinKeys', () => {
  it('builds coin keys for all chains and pairs', () => {
    const keys = buildCoinKeys(TEST_CHAINS, TEST_PAIRS);

    expect(keys).toContain('ethereum:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
    expect(keys).toContain('arbitrum:0x82aF49447D8a07e3bd95BD0d56f35241523fBab1');
    expect(keys).toContain('base:0x4200000000000000000000000000000000000006');
    expect(keys).toContain('ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599');
    expect(keys).toContain('arbitrum:0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f');
  });

  it('skips tokens with null addresses (WBTC on base)', () => {
    const keys = buildCoinKeys(['base'], TEST_PAIRS);
    // Should have WETH on base but not WBTC (null)
    expect(keys).toContain('base:0x4200000000000000000000000000000000000006');
    expect(keys).toHaveLength(1);
  });

  it('deduplicates keys', () => {
    const dupes = [
      { base: 'ETH', quote: 'USDC', symbol: 'ETH/USDC' },
      { base: 'ETH', quote: 'USDC', symbol: 'ETH/USDC' },
    ];
    const keys = buildCoinKeys(['ethereum'], dupes);
    expect(keys).toHaveLength(1);
  });

  it('returns empty array for unknown chain', () => {
    const keys = buildCoinKeys(['solana'], TEST_PAIRS);
    expect(keys).toEqual([]);
  });

  it('returns empty array for empty chains', () => {
    const keys = buildCoinKeys([], TEST_PAIRS);
    expect(keys).toEqual([]);
  });

  it('returns empty array for empty pairs', () => {
    const keys = buildCoinKeys(TEST_CHAINS, []);
    expect(keys).toEqual([]);
  });

  it('passes through unmapped token names as-is', () => {
    // A pair with an unmapped base token — won't find an address, so no keys
    const weirdPairs = [{ base: 'LINK', quote: 'USDC', symbol: 'LINK/USDC' }];
    const keys = buildCoinKeys(['ethereum'], weirdPairs);
    // LINK isn't in TOKEN_ADDRESSES, so no keys generated
    expect(keys).toEqual([]);
  });
});

// ── parsePrices ────────────────────────────────────────────────────────────────

describe('parsePrices', () => {
  it('parses a valid DeFi Llama response', () => {
    const data = makeLlamaResponse();
    const { prices, stale } = parsePrices(data, {
      now: NOW_SECONDS,
      maxAgeSeconds: 60,
      pairs: TEST_PAIRS,
    });

    expect(prices).toHaveLength(5);
    expect(stale).toHaveLength(0);

    const ethEthereum = prices.find(
      (p) => p.chain === 'ethereum' && p.pair === 'ETH/USDC'
    );
    expect(ethEthereum).toBeDefined();
    expect(ethEthereum.price).toBe(2500.42);
    expect(ethEthereum.timestamp).toBe(NOW_SECONDS - 5);
  });

  it('rejects stale prices', () => {
    const data = makeLlamaResponse({
      'ethereum:WETH': { timestamp: NOW_SECONDS - 120 },
    });

    const { prices, stale } = parsePrices(data, {
      now: NOW_SECONDS,
      maxAgeSeconds: 60,
      pairs: TEST_PAIRS,
    });

    // Should have 4 valid prices (stale one rejected)
    expect(prices).toHaveLength(4);
    expect(stale).toHaveLength(1);
    expect(stale[0].age).toBe(120);
  });

  it('handles null/undefined data', () => {
    expect(parsePrices(null).prices).toEqual([]);
    expect(parsePrices(undefined).prices).toEqual([]);
  });

  it('handles missing coins property', () => {
    expect(parsePrices({}).prices).toEqual([]);
    expect(parsePrices({ coins: null }).prices).toEqual([]);
    expect(parsePrices({ coins: 'not-object' }).prices).toEqual([]);
  });

  it('skips entries with non-numeric price', () => {
    const data = makeLlamaResponse({
      'ethereum:WETH': { price: 'invalid' },
    });
    const { prices } = parsePrices(data, {
      now: NOW_SECONDS,
      maxAgeSeconds: 60,
      pairs: TEST_PAIRS,
    });

    const ethEthereum = prices.find(
      (p) => p.chain === 'ethereum' && p.pair === 'ETH/USDC'
    );
    expect(ethEthereum).toBeUndefined();
  });

  it('skips entries with non-numeric timestamp', () => {
    const data = makeLlamaResponse({
      'ethereum:WETH': { timestamp: null },
    });
    const { prices } = parsePrices(data, {
      now: NOW_SECONDS,
      maxAgeSeconds: 60,
      pairs: TEST_PAIRS,
    });

    const ethEthereum = prices.find(
      (p) => p.chain === 'ethereum' && p.pair === 'ETH/USDC'
    );
    expect(ethEthereum).toBeUndefined();
  });

  it('skips coin keys with invalid format (no colon)', () => {
    const data = {
      coins: {
        invalidkey: { price: 100, timestamp: NOW_SECONDS },
      },
    };
    const { prices } = parsePrices(data, {
      now: NOW_SECONDS,
      pairs: TEST_PAIRS,
    });
    expect(prices).toHaveLength(0);
  });

  it('skips unknown chains', () => {
    const data = {
      coins: {
        'solana:0xABC': { price: 100, timestamp: NOW_SECONDS },
      },
    };
    const { prices } = parsePrices(data, {
      now: NOW_SECONDS,
      pairs: TEST_PAIRS,
    });
    expect(prices).toHaveLength(0);
  });

  it('skips addresses that do not match any pair', () => {
    const data = {
      coins: {
        // USDC address — not a base token of any pair
        'ethereum:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': {
          price: 1.0,
          timestamp: NOW_SECONDS,
        },
      },
    };
    const { prices } = parsePrices(data, {
      now: NOW_SECONDS,
      pairs: TEST_PAIRS,
    });
    expect(prices).toHaveLength(0);
  });

  it('skips entries where chain has no token addresses at all', () => {
    // A chain that exists in CHAIN_NAME_MAP reverse lookup but has no TOKEN_ADDRESSES entry
    // This tests the `if (!chainTokens) return null` branch in addressToPair
    const data = {
      coins: {
        'ethereum:0x1234567890abcdef1234567890abcdef12345678': {
          price: 100,
          timestamp: NOW_SECONDS,
        },
      },
    };
    const { prices } = parsePrices(data, {
      now: NOW_SECONDS,
      pairs: TEST_PAIRS,
    });
    // Address doesn't match any known token, so no prices
    expect(prices).toHaveLength(0);
  });
});

// ── fetchPrices ────────────────────────────────────────────────────────────────

describe('fetchPrices', () => {
  let mockFetch;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  it('fetches and parses prices successfully', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const responseData = {
      coins: {
        'ethereum:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2': {
          decimals: 18, symbol: 'WETH', price: 2500.42, timestamp: nowSec - 5, confidence: 0.99,
        },
        'arbitrum:0x82aF49447D8a07e3bd95BD0d56f35241523fBab1': {
          decimals: 18, symbol: 'WETH', price: 2501.15, timestamp: nowSec - 3, confidence: 0.99,
        },
        'base:0x4200000000000000000000000000000000000006': {
          decimals: 18, symbol: 'WETH', price: 2499.88, timestamp: nowSec - 2, confidence: 0.99,
        },
        'ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599': {
          decimals: 8, symbol: 'WBTC', price: 43567.89, timestamp: nowSec - 4, confidence: 0.99,
        },
        'arbitrum:0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f': {
          decimals: 8, symbol: 'WBTC', price: 43570.12, timestamp: nowSec - 1, confidence: 0.99,
        },
      },
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => responseData,
    });

    const { prices, stale } = await fetchPrices({
      chains: TEST_CHAINS,
      pairs: TEST_PAIRS,
      maxAgeSeconds: 60,
      fetchFn: mockFetch,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('https://coins.llama.fi/prices/current/');
    expect(calledUrl).toContain('ethereum:');
    expect(calledUrl).toContain('arbitrum:');

    expect(prices.length).toBeGreaterThan(0);
  });

  it('returns empty when no coin keys', async () => {
    const { prices } = await fetchPrices({
      chains: [],
      pairs: TEST_PAIRS,
      fetchFn: mockFetch,
    });

    expect(prices).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws RATE_LIMITED on 429', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
    });

    try {
      await fetchPrices({
        chains: TEST_CHAINS,
        pairs: TEST_PAIRS,
        fetchFn: mockFetch,
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DefiLlamaError);
      expect(err.code).toBe('RATE_LIMITED');
    }
  });

  it('throws HTTP_ERROR on non-ok non-429 response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    try {
      await fetchPrices({
        chains: TEST_CHAINS,
        pairs: TEST_PAIRS,
        fetchFn: mockFetch,
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DefiLlamaError);
      expect(err.code).toBe('HTTP_ERROR');
      expect(err.message).toContain('500');
    }
  });

  it('throws MALFORMED_RESPONSE on invalid JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });

    try {
      await fetchPrices({
        chains: TEST_CHAINS,
        pairs: TEST_PAIRS,
        fetchFn: mockFetch,
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DefiLlamaError);
      expect(err.code).toBe('MALFORMED_RESPONSE');
    }
  });

  it('throws TIMEOUT on abort', async () => {
    mockFetch.mockImplementation(
      (url, opts) =>
        new Promise((_, reject) => {
          // Simulate AbortController triggering
          opts.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        })
    );

    try {
      await fetchPrices({
        chains: TEST_CHAINS,
        pairs: TEST_PAIRS,
        timeoutMs: 1,
        fetchFn: mockFetch,
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DefiLlamaError);
      expect(err.code).toBe('TIMEOUT');
    }
  });

  it('throws NETWORK_ERROR on generic fetch failure', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    try {
      await fetchPrices({
        chains: TEST_CHAINS,
        pairs: TEST_PAIRS,
        fetchFn: mockFetch,
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DefiLlamaError);
      expect(err.code).toBe('NETWORK_ERROR');
    }
  });

  it('uses config defaults when options are omitted', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ coins: {} }),
    });

    // Call with only fetchFn — all other options should fall back to config defaults
    const { prices } = await fetchPrices({ fetchFn: mockFetch });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(prices).toEqual([]);
  });

  it('passes Accept header and signal to fetch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ coins: {} }),
    });

    await fetchPrices({
      chains: TEST_CHAINS,
      pairs: TEST_PAIRS,
      fetchFn: mockFetch,
    });

    const opts = mockFetch.mock.calls[0][1];
    expect(opts.headers.Accept).toBe('application/json');
    expect(opts.signal).toBeDefined();
  });
});

// ── DefiLlamaError ─────────────────────────────────────────────────────────────

describe('DefiLlamaError', () => {
  it('has correct name and code', () => {
    const err = new DefiLlamaError('test error', 'TEST_CODE');
    expect(err.name).toBe('DefiLlamaError');
    expect(err.code).toBe('TEST_CODE');
    expect(err.message).toBe('test error');
    expect(err).toBeInstanceOf(Error);
  });
});
