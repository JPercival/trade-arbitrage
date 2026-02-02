import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildQuoteUrl,
  parseQuoteResponse,
  calculateEffectivePrice,
  fetchQuote,
  fetchArbQuote,
  ParaSwapError,
} from '../../src/prices/paraswap.js';

// ── Test data ──────────────────────────────────────────────────────────────────

function makeBuyQuoteResponse(overrides = {}) {
  // USDC → WETH buy quote (buying ETH with $10,000 USDC)
  return {
    priceRoute: {
      srcToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      destToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      srcAmount: '10000000000', // 10,000 USDC (6 decimals)
      destAmount: '4000000000000000000', // 4 WETH (18 decimals)
      srcDecimals: 6,
      destDecimals: 18,
      gasCostUSD: '5.23',
      bestRoute: [
        {
          percent: 100,
          swaps: [
            {
              srcToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
              destToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
              exchanges: [{ exchange: 'UniswapV3', percent: 100 }],
            },
          ],
        },
      ],
      ...overrides,
    },
  };
}

function makeSellQuoteResponse(overrides = {}) {
  // WETH → USDC sell quote (selling 4 ETH for USDC)
  return {
    priceRoute: {
      srcToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      destToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      srcAmount: '4000000000000000000', // 4 WETH
      destAmount: '9980000000', // 9,980 USDC
      srcDecimals: 18,
      destDecimals: 6,
      gasCostUSD: '4.87',
      bestRoute: [
        {
          percent: 100,
          swaps: [
            {
              srcToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
              destToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
              exchanges: [{ exchange: 'UniswapV3', percent: 100 }],
            },
          ],
        },
      ],
      ...overrides,
    },
  };
}

// ── buildQuoteUrl ──────────────────────────────────────────────────────────────

describe('buildQuoteUrl', () => {
  it('builds correct URL with all parameters', () => {
    const url = buildQuoteUrl({
      srcToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      destToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      amount: '10000000000',
      srcDecimals: 6,
      destDecimals: 18,
      network: 1,
    });

    expect(url).toContain('https://api.paraswap.io/prices?');
    expect(url).toContain('srcToken=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
    expect(url).toContain('destToken=0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
    expect(url).toContain('amount=10000000000');
    expect(url).toContain('srcDecimals=6');
    expect(url).toContain('destDecimals=18');
    expect(url).toContain('network=1');
    expect(url).toContain('side=SELL');
  });
});

// ── parseQuoteResponse ─────────────────────────────────────────────────────────

describe('parseQuoteResponse', () => {
  it('parses a buy quote response', () => {
    const data = makeBuyQuoteResponse();
    const quote = parseQuoteResponse(data);

    expect(quote.srcAmount).toBe('10000000000');
    expect(quote.destAmount).toBe('4000000000000000000');
    expect(quote.srcDecimals).toBe(6);
    expect(quote.destDecimals).toBe(18);
    expect(quote.gasCostUSD).toBe('5.23');
    expect(quote.bestRoute).toHaveLength(1);
  });

  it('parses a sell quote response', () => {
    const data = makeSellQuoteResponse();
    const quote = parseQuoteResponse(data);

    expect(quote.srcAmount).toBe('4000000000000000000');
    expect(quote.destAmount).toBe('9980000000');
    expect(quote.gasCostUSD).toBe('4.87');
  });

  it('defaults gasCostUSD to "0" when missing', () => {
    const data = makeBuyQuoteResponse({ gasCostUSD: undefined });
    const quote = parseQuoteResponse(data);
    expect(quote.gasCostUSD).toBe('0');
  });

  it('defaults bestRoute to empty array when missing', () => {
    const data = makeBuyQuoteResponse({ bestRoute: undefined });
    const quote = parseQuoteResponse(data);
    expect(quote.bestRoute).toEqual([]);
  });

  it('throws MALFORMED_RESPONSE when data is null', () => {
    expect(() => parseQuoteResponse(null)).toThrow(ParaSwapError);
    try {
      parseQuoteResponse(null);
    } catch (err) {
      expect(err.code).toBe('MALFORMED_RESPONSE');
    }
  });

  it('throws MALFORMED_RESPONSE when priceRoute is missing', () => {
    expect(() => parseQuoteResponse({})).toThrow(ParaSwapError);
    try {
      parseQuoteResponse({});
    } catch (err) {
      expect(err.code).toBe('MALFORMED_RESPONSE');
    }
  });

  it('throws MALFORMED_RESPONSE when data is undefined', () => {
    expect(() => parseQuoteResponse(undefined)).toThrow(ParaSwapError);
  });
});

// ── calculateEffectivePrice ────────────────────────────────────────────────────

describe('calculateEffectivePrice', () => {
  it('calculates buy price (USDC→TOKEN)', () => {
    const quote = {
      srcAmount: '10000000000', // 10,000 USDC
      destAmount: '4000000000000000000', // 4 WETH
      srcDecimals: 6,
      destDecimals: 18,
    };

    const price = calculateEffectivePrice(quote, 'buy');
    expect(price).toBe(2500); // 10000 / 4 = 2500 per ETH
  });

  it('calculates sell price (TOKEN→USDC)', () => {
    const quote = {
      srcAmount: '4000000000000000000', // 4 WETH
      destAmount: '9980000000', // 9,980 USDC
      srcDecimals: 18,
      destDecimals: 6,
    };

    const price = calculateEffectivePrice(quote, 'sell');
    expect(price).toBe(2495); // 9980 / 4 = 2495 per ETH
  });

  it('returns 0 when destAmount is zero (buy side)', () => {
    const quote = {
      srcAmount: '10000000000',
      destAmount: '0',
      srcDecimals: 6,
      destDecimals: 18,
    };
    expect(calculateEffectivePrice(quote, 'buy')).toBe(0);
  });

  it('returns 0 when srcAmount is zero (sell side)', () => {
    const quote = {
      srcAmount: '0',
      destAmount: '10000000000',
      srcDecimals: 18,
      destDecimals: 6,
    };
    expect(calculateEffectivePrice(quote, 'sell')).toBe(0);
  });
});

// ── fetchQuote ─────────────────────────────────────────────────────────────────

describe('fetchQuote', () => {
  let mockFetch;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  it('fetches and parses a quote successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => makeBuyQuoteResponse(),
    });

    const quote = await fetchQuote({
      chain: 'ethereum',
      srcToken: 'USDC',
      destToken: 'ETH',
      amount: 10000,
      fetchFn: mockFetch,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('https://api.paraswap.io/prices?');
    expect(calledUrl).toContain('network=1');
    expect(calledUrl).toContain('srcDecimals=6');
    expect(calledUrl).toContain('destDecimals=18');

    expect(quote.srcAmount).toBeDefined();
    expect(quote.destAmount).toBeDefined();
    expect(quote.gasCostUSD).toBeDefined();
  });

  it('works with Arbitrum chain ID', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => makeBuyQuoteResponse(),
    });

    await fetchQuote({
      chain: 'arbitrum',
      srcToken: 'USDC',
      destToken: 'ETH',
      amount: 10000,
      fetchFn: mockFetch,
    });

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('network=42161');
  });

  it('works with Base chain ID', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => makeBuyQuoteResponse(),
    });

    await fetchQuote({
      chain: 'base',
      srcToken: 'USDC',
      destToken: 'ETH',
      amount: 10000,
      fetchFn: mockFetch,
    });

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('network=8453');
  });

  it('throws INVALID_CHAIN for unknown chain', async () => {
    try {
      await fetchQuote({
        chain: 'solana',
        srcToken: 'USDC',
        destToken: 'ETH',
        amount: 10000,
        fetchFn: mockFetch,
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ParaSwapError);
      expect(err.code).toBe('INVALID_CHAIN');
    }
  });

  it('throws INVALID_TOKEN for unknown source token', async () => {
    try {
      await fetchQuote({
        chain: 'ethereum',
        srcToken: 'DOGE',
        destToken: 'ETH',
        amount: 10000,
        fetchFn: mockFetch,
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ParaSwapError);
      expect(err.code).toBe('INVALID_TOKEN');
    }
  });

  it('throws INVALID_TOKEN for unknown dest token', async () => {
    try {
      await fetchQuote({
        chain: 'ethereum',
        srcToken: 'USDC',
        destToken: 'DOGE',
        amount: 10000,
        fetchFn: mockFetch,
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ParaSwapError);
      expect(err.code).toBe('INVALID_TOKEN');
    }
  });

  it('throws INVALID_TOKEN for null address (WBTC on base)', async () => {
    try {
      await fetchQuote({
        chain: 'base',
        srcToken: 'USDC',
        destToken: 'WBTC',
        amount: 10000,
        fetchFn: mockFetch,
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ParaSwapError);
      expect(err.code).toBe('INVALID_TOKEN');
    }
  });

  it('throws RATE_LIMITED on 429', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
    });

    try {
      await fetchQuote({
        chain: 'ethereum',
        srcToken: 'USDC',
        destToken: 'ETH',
        amount: 10000,
        fetchFn: mockFetch,
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ParaSwapError);
      expect(err.code).toBe('RATE_LIMITED');
    }
  });

  it('throws HTTP_ERROR on non-ok non-429', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    try {
      await fetchQuote({
        chain: 'ethereum',
        srcToken: 'USDC',
        destToken: 'ETH',
        amount: 10000,
        fetchFn: mockFetch,
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ParaSwapError);
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
      await fetchQuote({
        chain: 'ethereum',
        srcToken: 'USDC',
        destToken: 'ETH',
        amount: 10000,
        fetchFn: mockFetch,
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ParaSwapError);
      expect(err.code).toBe('MALFORMED_RESPONSE');
    }
  });

  it('throws TIMEOUT on abort', async () => {
    mockFetch.mockImplementation(
      (url, opts) =>
        new Promise((_, reject) => {
          opts.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        })
    );

    try {
      await fetchQuote({
        chain: 'ethereum',
        srcToken: 'USDC',
        destToken: 'ETH',
        amount: 10000,
        timeoutMs: 1,
        fetchFn: mockFetch,
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ParaSwapError);
      expect(err.code).toBe('TIMEOUT');
    }
  });

  it('throws NETWORK_ERROR on generic fetch failure', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    try {
      await fetchQuote({
        chain: 'ethereum',
        srcToken: 'USDC',
        destToken: 'ETH',
        amount: 10000,
        fetchFn: mockFetch,
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ParaSwapError);
      expect(err.code).toBe('NETWORK_ERROR');
    }
  });

  it('passes Accept header and signal to fetch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => makeBuyQuoteResponse(),
    });

    await fetchQuote({
      chain: 'ethereum',
      srcToken: 'USDC',
      destToken: 'ETH',
      amount: 10000,
      fetchFn: mockFetch,
    });

    const opts = mockFetch.mock.calls[0][1];
    expect(opts.headers.Accept).toBe('application/json');
    expect(opts.signal).toBeDefined();
  });
});

// ── fetchArbQuote ──────────────────────────────────────────────────────────────

describe('fetchArbQuote', () => {
  let mockFetch;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  it('fetches both buy and sell legs', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeBuyQuoteResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeSellQuoteResponse(),
      });

    const result = await fetchArbQuote({
      chain: 'ethereum',
      pair: 'ETH/USDC',
      tradeSize: 10000,
      fetchFn: mockFetch,
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Buy leg: USDC → WETH
    const buyUrl = mockFetch.mock.calls[0][0];
    expect(buyUrl).toContain(
      'srcToken=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    ); // USDC
    expect(buyUrl).toContain(
      'destToken=0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
    ); // WETH

    // Sell leg: WETH → USDC
    const sellUrl = mockFetch.mock.calls[1][0];
    expect(sellUrl).toContain(
      'srcToken=0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
    ); // WETH
    expect(sellUrl).toContain(
      'destToken=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    ); // USDC

    expect(result.buyPrice).toBe(2500); // 10000 / 4
    expect(result.sellPrice).toBe(2495); // 9980 / 4
    expect(result.gasCostUSD).toBeCloseTo(10.1); // 5.23 + 4.87
    expect(result.buy).toBeDefined();
    expect(result.sell).toBeDefined();
  });

  it('propagates errors from buy leg', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
    });

    await expect(
      fetchArbQuote({
        chain: 'ethereum',
        pair: 'ETH/USDC',
        tradeSize: 10000,
        fetchFn: mockFetch,
      })
    ).rejects.toThrow(ParaSwapError);
  });

  it('propagates errors from sell leg', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeBuyQuoteResponse(),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

    await expect(
      fetchArbQuote({
        chain: 'ethereum',
        pair: 'ETH/USDC',
        tradeSize: 10000,
        fetchFn: mockFetch,
      })
    ).rejects.toThrow(ParaSwapError);
  });

  it('uses correct token amounts for sell leg based on buy result', async () => {
    // Buy: 10000 USDC → 4 WETH
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeBuyQuoteResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeSellQuoteResponse(),
      });

    await fetchArbQuote({
      chain: 'ethereum',
      pair: 'ETH/USDC',
      tradeSize: 10000,
      fetchFn: mockFetch,
    });

    // The sell leg should use 4 tokens (the amount received from buy)
    const sellUrl = mockFetch.mock.calls[1][0];
    // 4 WETH = 4 * 10^18 = 4000000000000000000
    expect(sellUrl).toContain('amount=4000000000000000000');
  });
});

// ── ParaSwapError ──────────────────────────────────────────────────────────────

describe('ParaSwapError', () => {
  it('has correct name and code', () => {
    const err = new ParaSwapError('test', 'TEST_CODE');
    expect(err.name).toBe('ParaSwapError');
    expect(err.code).toBe('TEST_CODE');
    expect(err.message).toBe('test');
    expect(err).toBeInstanceOf(Error);
  });
});
