import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import AppDatabase from '../../src/db.js';
import { simulateTrades, simulateSingleTrade } from '../../src/engine/simulator.js';

// ── Test DB helper ─────────────────────────────────────────────────────────────

function freshDb() {
  const dbPath = join(tmpdir(), `trade-arb-test-sim-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  return new AppDatabase(dbPath);
}

// ── Mock helpers ───────────────────────────────────────────────────────────────

function makeBuyResponse(destAmount = '4000000000000000000', gasCostUSD = '0.50') {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      priceRoute: {
        srcToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        destToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        srcAmount: '10000000000', // 10,000 USDC
        destAmount,
        srcDecimals: 6,
        destDecimals: 18,
        gasCostUSD,
        bestRoute: [],
      },
    }),
  };
}

function makeSellResponse(destAmount = '10050000000', gasCostUSD = '0.10') {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      priceRoute: {
        srcToken: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
        destToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        srcAmount: '4000000000000000000', // 4 WETH
        destAmount,
        srcDecimals: 18,
        destDecimals: 6,
        gasCostUSD,
        bestRoute: [],
      },
    }),
  };
}

function makeSpread(db) {
  const result = db.insertSpread({
    detected_at: 1700000000000,
    pair: 'ETH/USDC',
    buy_chain: 'arbitrum',
    sell_chain: 'base',
    buy_price: 2000,
    sell_price: 2010,
    gross_spread_pct: 0.5,
    net_spread_pct: 0.45,
  });
  return {
    id: Number(result.lastInsertRowid),
    pair: 'ETH/USDC',
    buyChain: 'arbitrum',
    sellChain: 'base',
    buyPrice: 2000,
    sellPrice: 2010,
    grossSpreadPct: 0.5,
    netSpreadPct: 0.45,
  };
}

// ── simulateSingleTrade ────────────────────────────────────────────────────────

describe('simulateSingleTrade', () => {
  let db;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('simulates a trade and stores it in DB', async () => {
    const spread = makeSpread(db);
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeBuyResponse())
      .mockResolvedValueOnce(makeSellResponse());

    const trade = await simulateSingleTrade({
      db,
      spread,
      tradeSize: 10000,
      fetchFn: mockFetch,
      nowMs: 1700000001000,
    });

    expect(trade.spread_id).toBe(spread.id);
    expect(trade.pair).toBe('ETH/USDC');
    expect(trade.buy_chain).toBe('arbitrum');
    expect(trade.sell_chain).toBe('base');
    expect(trade.trade_size_usd).toBe(10000);
    expect(trade.tokens_bought).toBe(4); // 4e18 / 1e18
    expect(trade.usd_received).toBe(10050); // 10050e6 / 1e6
    expect(trade.gas_cost_buy).toBe(0.5);
    expect(trade.gas_cost_sell).toBe(0.1);
    // net = 10050 - 10000 - 0.5 - 0.1 = 49.4
    expect(trade.net_profit_usd).toBeCloseTo(49.4, 2);
    expect(trade.profit_pct).toBeCloseTo(0.494, 3);

    // Verify stored in DB
    const trades = db.getTradeHistory({ pair: 'ETH/USDC' });
    expect(trades).toHaveLength(1);
    expect(trades[0].net_profit_usd).toBeCloseTo(49.4, 2);
  });

  it('fetches buy quote then sell quote in order', async () => {
    const spread = makeSpread(db);
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeBuyResponse())
      .mockResolvedValueOnce(makeSellResponse());

    await simulateSingleTrade({
      db,
      spread,
      tradeSize: 10000,
      fetchFn: mockFetch,
      nowMs: 1700000001000,
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);

    // First call: buy leg (USDC → ETH on arbitrum)
    const buyUrl = mockFetch.mock.calls[0][0];
    expect(buyUrl).toContain('network=42161'); // arbitrum

    // Second call: sell leg (ETH → USDC on base)
    const sellUrl = mockFetch.mock.calls[1][0];
    expect(sellUrl).toContain('network=8453'); // base
  });

  it('handles negative profit correctly', async () => {
    const spread = makeSpread(db);
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeBuyResponse('4000000000000000000', '5.00'))
      .mockResolvedValueOnce(makeSellResponse('9980000000', '5.00'));

    const trade = await simulateSingleTrade({
      db,
      spread,
      tradeSize: 10000,
      fetchFn: mockFetch,
      nowMs: 1700000001000,
    });

    // net = 9980 - 10000 - 5 - 5 = -30
    expect(trade.net_profit_usd).toBeCloseTo(-30, 2);
    expect(trade.profit_pct).toBeLessThan(0);
  });

  it('propagates fetch errors', async () => {
    const spread = makeSpread(db);
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      });

    await expect(simulateSingleTrade({
      db,
      spread,
      tradeSize: 10000,
      fetchFn: mockFetch,
      nowMs: 1700000001000,
    })).rejects.toThrow();
  });

  it('propagates errors from sell leg', async () => {
    const spread = makeSpread(db);
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeBuyResponse())
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

    await expect(simulateSingleTrade({
      db,
      spread,
      tradeSize: 10000,
      fetchFn: mockFetch,
      nowMs: 1700000001000,
    })).rejects.toThrow();
  });
});

// ── simulateTrades ─────────────────────────────────────────────────────────────

describe('simulateTrades', () => {
  let db;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('simulates trades at all configured sizes', async () => {
    const spread = makeSpread(db);
    const mockFetch = vi.fn();

    // 3 sizes × 2 legs = 6 calls
    for (let i = 0; i < 6; i++) {
      if (i % 2 === 0) {
        mockFetch.mockResolvedValueOnce(makeBuyResponse());
      } else {
        mockFetch.mockResolvedValueOnce(makeSellResponse());
      }
    }

    const results = await simulateTrades({
      db,
      spread,
      tradeSizes: [5000, 10000, 20000],
      fetchFn: mockFetch,
      nowMs: 1700000001000,
    });

    expect(results).toHaveLength(3);
    expect(results[0].success).toBe(true);
    expect(results[0].size).toBe(5000);
    expect(results[1].success).toBe(true);
    expect(results[1].size).toBe(10000);
    expect(results[2].success).toBe(true);
    expect(results[2].size).toBe(20000);

    // All should have trade records
    for (const r of results) {
      expect(r.trade).toBeDefined();
      expect(r.trade.spread_id).toBe(spread.id);
    }

    // Verify 3 trades in DB
    const trades = db.getTradeHistory();
    expect(trades).toHaveLength(3);
  });

  it('handles quote failures gracefully per-size', async () => {
    const spread = makeSpread(db);
    const mockFetch = vi.fn()
      // Size 5000: succeeds
      .mockResolvedValueOnce(makeBuyResponse())
      .mockResolvedValueOnce(makeSellResponse())
      // Size 10000: fails on buy leg
      .mockResolvedValueOnce({
        ok: false, status: 429, statusText: 'Rate Limited',
      })
      // Size 20000: succeeds
      .mockResolvedValueOnce(makeBuyResponse())
      .mockResolvedValueOnce(makeSellResponse());

    const results = await simulateTrades({
      db,
      spread,
      tradeSizes: [5000, 10000, 20000],
      fetchFn: mockFetch,
      nowMs: 1700000001000,
    });

    expect(results).toHaveLength(3);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[1].error).toBeDefined();
    expect(results[2].success).toBe(true);

    // Only 2 trades in DB (failed one not stored)
    const trades = db.getTradeHistory();
    expect(trades).toHaveLength(2);
  });

  it('handles all sizes failing', async () => {
    const spread = makeSpread(db);
    const mockFetch = vi.fn()
      .mockResolvedValue({
        ok: false, status: 500, statusText: 'Server Error',
      });

    const results = await simulateTrades({
      db,
      spread,
      tradeSizes: [5000, 10000],
      fetchFn: mockFetch,
      nowMs: 1700000001000,
    });

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(false);
    expect(results[1].success).toBe(false);

    const trades = db.getTradeHistory();
    expect(trades).toHaveLength(0);
  });

  it('uses config defaults for tradeSizes when not specified', async () => {
    const spread = makeSpread(db);
    const mockFetch = vi.fn();

    // Config default: [5000, 10000, 20000, 50000] = 4 sizes × 2 legs = 8 calls
    for (let i = 0; i < 8; i++) {
      if (i % 2 === 0) {
        mockFetch.mockResolvedValueOnce(makeBuyResponse());
      } else {
        mockFetch.mockResolvedValueOnce(makeSellResponse());
      }
    }

    const results = await simulateTrades({
      db,
      spread,
      fetchFn: mockFetch,
      nowMs: 1700000001000,
    });

    // Default config has 4 sizes
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.success)).toBe(true);
  });

  it('returns results in order matching tradeSizes', async () => {
    const spread = makeSpread(db);
    const mockFetch = vi.fn();

    for (let i = 0; i < 4; i++) {
      if (i % 2 === 0) {
        mockFetch.mockResolvedValueOnce(makeBuyResponse());
      } else {
        mockFetch.mockResolvedValueOnce(makeSellResponse());
      }
    }

    const results = await simulateTrades({
      db,
      spread,
      tradeSizes: [1000, 50000],
      fetchFn: mockFetch,
      nowMs: 1700000001000,
    });

    expect(results[0].size).toBe(1000);
    expect(results[1].size).toBe(50000);
  });
});
