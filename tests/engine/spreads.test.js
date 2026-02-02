import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import AppDatabase from '../../src/db.js';
import {
  todayDateStr,
  generateChainPairs,
  calculateGrossSpread,
  calculateNetSpread,
  isHighFriction,
  detectSpreads,
  processSpreads,
  updateDailyStats,
} from '../../src/engine/spreads.js';

// ── Test DB helper ─────────────────────────────────────────────────────────────

function freshDb() {
  const dbPath = join(tmpdir(), `trade-arb-test-spreads-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  return new AppDatabase(dbPath);
}

// ── todayDateStr ───────────────────────────────────────────────────────────────

describe('todayDateStr', () => {
  it('returns date string in YYYY-MM-DD format', () => {
    // Jan 15, 2024 UTC
    const result = todayDateStr(1705276800000);
    expect(result).toBe('2024-01-15');
  });

  it('uses Date.now() when no argument given', () => {
    const result = todayDateStr();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ── generateChainPairs ─────────────────────────────────────────────────────────

describe('generateChainPairs', () => {
  it('generates all unique pairs from 3 chains', () => {
    const pairs = generateChainPairs(['ethereum', 'arbitrum', 'base']);
    expect(pairs).toEqual([
      ['ethereum', 'arbitrum'],
      ['ethereum', 'base'],
      ['arbitrum', 'base'],
    ]);
  });

  it('generates 1 pair from 2 chains', () => {
    const pairs = generateChainPairs(['arbitrum', 'base']);
    expect(pairs).toEqual([['arbitrum', 'base']]);
  });

  it('returns empty for 0 or 1 chains', () => {
    expect(generateChainPairs([])).toEqual([]);
    expect(generateChainPairs(['ethereum'])).toEqual([]);
  });

  it('generates 6 pairs from 4 chains', () => {
    const pairs = generateChainPairs(['a', 'b', 'c', 'd']);
    expect(pairs).toHaveLength(6);
  });
});

// ── calculateGrossSpread ───────────────────────────────────────────────────────

describe('calculateGrossSpread', () => {
  it('calculates spread correctly when priceA < priceB', () => {
    const result = calculateGrossSpread(2000, 'arbitrum', 2010, 'base');
    expect(result.grossSpreadPct).toBeCloseTo(0.5, 2);
    expect(result.buyChain).toBe('arbitrum');
    expect(result.sellChain).toBe('base');
    expect(result.buyPrice).toBe(2000);
    expect(result.sellPrice).toBe(2010);
  });

  it('calculates spread correctly when priceB < priceA', () => {
    const result = calculateGrossSpread(2010, 'ethereum', 2000, 'base');
    expect(result.grossSpreadPct).toBeCloseTo(0.5, 2);
    expect(result.buyChain).toBe('base');
    expect(result.sellChain).toBe('ethereum');
    expect(result.buyPrice).toBe(2000);
    expect(result.sellPrice).toBe(2010);
  });

  it('returns 0 spread when prices are equal', () => {
    const result = calculateGrossSpread(2000, 'a', 2000, 'b');
    expect(result.grossSpreadPct).toBe(0);
  });

  it('returns 0 spread when low price is 0', () => {
    const result = calculateGrossSpread(0, 'a', 100, 'b');
    expect(result.grossSpreadPct).toBe(0);
  });

  it('returns 0 spread when low price is negative', () => {
    const result = calculateGrossSpread(-10, 'a', 100, 'b');
    expect(result.grossSpreadPct).toBe(0);
  });
});

// ── calculateNetSpread ─────────────────────────────────────────────────────────

describe('calculateNetSpread', () => {
  it('subtracts gas costs from gross spread', () => {
    // 0.5% gross, $5 + $5 gas on $10000 trade = 0.1% gas → 0.4% net
    const result = calculateNetSpread(0.5, 5, 5, 10000);
    expect(result).toBeCloseTo(0.4, 4);
  });

  it('returns negative when gas exceeds spread', () => {
    // 0.1% gross, $20 + $20 gas on $10000 = 0.4% gas → -0.3% net
    const result = calculateNetSpread(0.1, 20, 20, 10000);
    expect(result).toBeCloseTo(-0.3, 4);
  });

  it('returns 0 when tradeSize is 0', () => {
    expect(calculateNetSpread(0.5, 5, 5, 0)).toBe(0);
  });

  it('returns 0 when tradeSize is negative', () => {
    expect(calculateNetSpread(0.5, 5, 5, -100)).toBe(0);
  });

  it('returns full gross when gas costs are 0', () => {
    expect(calculateNetSpread(0.5, 0, 0, 10000)).toBe(0.5);
  });
});

// ── isHighFriction ─────────────────────────────────────────────────────────────

describe('isHighFriction', () => {
  it('returns true when buy chain is ethereum', () => {
    expect(isHighFriction('ethereum', 'arbitrum')).toBe(true);
  });

  it('returns true when sell chain is ethereum', () => {
    expect(isHighFriction('arbitrum', 'ethereum')).toBe(true);
  });

  it('returns false for L2↔L2', () => {
    expect(isHighFriction('arbitrum', 'base')).toBe(false);
  });

  it('returns true when both chains are ethereum (edge case)', () => {
    expect(isHighFriction('ethereum', 'ethereum')).toBe(true);
  });
});

// ── detectSpreads ──────────────────────────────────────────────────────────────

describe('detectSpreads', () => {
  it('detects a spread above thresholds', () => {
    const prices = [
      { chain: 'arbitrum', pair: 'ETH/USDC', price: 2000 },
      { chain: 'base', pair: 'ETH/USDC', price: 2010 },
    ];

    const result = detectSpreads({
      prices,
      gasCosts: { arbitrum: 0.5, base: 0.1 },
      minGrossSpreadPct: 0.05,
      minNetSpreadPct: 0.02,
      referenceTradeSize: 10000,
    });

    expect(result).toHaveLength(1);
    expect(result[0].pair).toBe('ETH/USDC');
    expect(result[0].buyChain).toBe('arbitrum');
    expect(result[0].sellChain).toBe('base');
    expect(result[0].grossSpreadPct).toBeCloseTo(0.5, 2);
    expect(result[0].netSpreadPct).toBeGreaterThan(0);
    expect(result[0].highFriction).toBe(false);
  });

  it('filters out spreads below gross threshold', () => {
    const prices = [
      { chain: 'arbitrum', pair: 'ETH/USDC', price: 2000 },
      { chain: 'base', pair: 'ETH/USDC', price: 2000.5 }, // ~0.025%
    ];

    const result = detectSpreads({
      prices,
      minGrossSpreadPct: 0.05,
      minNetSpreadPct: 0.02,
    });

    expect(result).toHaveLength(0);
  });

  it('filters out spreads below net threshold', () => {
    const prices = [
      { chain: 'arbitrum', pair: 'ETH/USDC', price: 2000 },
      { chain: 'base', pair: 'ETH/USDC', price: 2002 }, // 0.1% gross
    ];

    const result = detectSpreads({
      prices,
      gasCosts: { arbitrum: 10, base: 10 }, // $20 gas on $10K = 0.2% — exceeds gross
      minGrossSpreadPct: 0.05,
      minNetSpreadPct: 0.02,
      referenceTradeSize: 10000,
    });

    expect(result).toHaveLength(0);
  });

  it('flags Ethereum-leg spreads as high friction', () => {
    const prices = [
      { chain: 'ethereum', pair: 'ETH/USDC', price: 2000 },
      { chain: 'arbitrum', pair: 'ETH/USDC', price: 2020 },
    ];

    const result = detectSpreads({
      prices,
      gasCosts: {},
      minGrossSpreadPct: 0.05,
      minNetSpreadPct: 0.02,
    });

    expect(result).toHaveLength(1);
    expect(result[0].highFriction).toBe(true);
  });

  it('compares all chain combinations for multiple tokens', () => {
    const prices = [
      { chain: 'ethereum', pair: 'ETH/USDC', price: 2000 },
      { chain: 'arbitrum', pair: 'ETH/USDC', price: 2020 },
      { chain: 'base', pair: 'ETH/USDC', price: 2030 },
      { chain: 'ethereum', pair: 'WBTC/USDC', price: 43000 },
      { chain: 'arbitrum', pair: 'WBTC/USDC', price: 43500 },
    ];

    const result = detectSpreads({
      prices,
      gasCosts: {},
      minGrossSpreadPct: 0.05,
      minNetSpreadPct: 0.02,
    });

    // ETH: eth↔arb (1%), eth↔base (1.5%), arb↔base (0.49%)
    // WBTC: eth↔arb (1.16%)
    // All above 0.05% gross
    expect(result.length).toBeGreaterThanOrEqual(3);
  });

  it('skips pairs with only one chain', () => {
    const prices = [
      { chain: 'arbitrum', pair: 'ETH/USDC', price: 2000 },
    ];

    const result = detectSpreads({
      prices,
      minGrossSpreadPct: 0.01,
      minNetSpreadPct: 0.01,
    });

    expect(result).toHaveLength(0);
  });

  it('returns empty when no prices provided', () => {
    const result = detectSpreads({ prices: [] });
    expect(result).toEqual([]);
  });

  it('uses config defaults when options not specified', () => {
    const prices = [
      { chain: 'arbitrum', pair: 'ETH/USDC', price: 2000 },
      { chain: 'base', pair: 'ETH/USDC', price: 2020 },
    ];

    // Should use config defaults for thresholds
    const result = detectSpreads({ prices });
    expect(result).toHaveLength(1);
  });
});

// ── processSpreads ─────────────────────────────────────────────────────────────

describe('processSpreads', () => {
  let db;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('records new spreads in the database', () => {
    const detected = [{
      pair: 'ETH/USDC',
      buyChain: 'arbitrum',
      sellChain: 'base',
      buyPrice: 2000,
      sellPrice: 2010,
      grossSpreadPct: 0.5,
      netSpreadPct: 0.45,
      highFriction: false,
    }];

    const { newSpreads, closedSpreads } = processSpreads({
      db,
      detectedSpreads: detected,
      nowMs: 1700000000000,
    });

    expect(newSpreads).toHaveLength(1);
    expect(newSpreads[0].pair).toBe('ETH/USDC');
    expect(newSpreads[0].id).toBeGreaterThan(0);
    expect(closedSpreads).toHaveLength(0);

    // Verify in DB
    const openSpreads = db.getOpenSpreads();
    expect(openSpreads).toHaveLength(1);
    expect(openSpreads[0].pair).toBe('ETH/USDC');
    expect(openSpreads[0].buy_chain).toBe('arbitrum');
    expect(openSpreads[0].sell_chain).toBe('base');
  });

  it('does not duplicate already-open spreads', () => {
    const detected = [{
      pair: 'ETH/USDC',
      buyChain: 'arbitrum',
      sellChain: 'base',
      buyPrice: 2000,
      sellPrice: 2010,
      grossSpreadPct: 0.5,
      netSpreadPct: 0.45,
      highFriction: false,
    }];

    // First cycle
    processSpreads({ db, detectedSpreads: detected, nowMs: 1700000000000 });
    // Second cycle — same spread still detected
    const { newSpreads } = processSpreads({ db, detectedSpreads: detected, nowMs: 1700000001000 });

    expect(newSpreads).toHaveLength(0);

    const openSpreads = db.getOpenSpreads();
    expect(openSpreads).toHaveLength(1);
  });

  it('closes spreads that are no longer detected', () => {
    const detected = [{
      pair: 'ETH/USDC',
      buyChain: 'arbitrum',
      sellChain: 'base',
      buyPrice: 2000,
      sellPrice: 2010,
      grossSpreadPct: 0.5,
      netSpreadPct: 0.45,
      highFriction: false,
    }];

    // First cycle — open spread
    processSpreads({ db, detectedSpreads: detected, nowMs: 1700000000000 });

    // Second cycle — spread gone
    const { newSpreads, closedSpreads } = processSpreads({
      db,
      detectedSpreads: [],
      nowMs: 1700000060000, // 60 seconds later
    });

    expect(newSpreads).toHaveLength(0);
    expect(closedSpreads).toHaveLength(1);
    expect(closedSpreads[0].duration_seconds).toBe(60);

    const openSpreads = db.getOpenSpreads();
    expect(openSpreads).toHaveLength(0);
  });

  it('handles multiple simultaneous spreads', () => {
    const detected = [
      {
        pair: 'ETH/USDC', buyChain: 'arbitrum', sellChain: 'base',
        buyPrice: 2000, sellPrice: 2010, grossSpreadPct: 0.5, netSpreadPct: 0.45, highFriction: false,
      },
      {
        pair: 'WBTC/USDC', buyChain: 'ethereum', sellChain: 'arbitrum',
        buyPrice: 43000, sellPrice: 43500, grossSpreadPct: 1.16, netSpreadPct: 1.0, highFriction: true,
      },
    ];

    const { newSpreads } = processSpreads({ db, detectedSpreads: detected, nowMs: 1700000000000 });
    expect(newSpreads).toHaveLength(2);

    const openSpreads = db.getOpenSpreads();
    expect(openSpreads).toHaveLength(2);
  });

  it('updates daily stats when recording new spreads', () => {
    const detected = [{
      pair: 'ETH/USDC',
      buyChain: 'arbitrum',
      sellChain: 'base',
      buyPrice: 2000,
      sellPrice: 2010,
      grossSpreadPct: 0.5,
      netSpreadPct: 0.45,
      highFriction: false,
    }];

    const nowMs = 1700000000000;
    processSpreads({ db, detectedSpreads: detected, nowMs });

    const stats = db.getDailyStats(1);
    expect(stats).toHaveLength(1);
    expect(stats[0].total_spreads).toBe(1);
    expect(stats[0].actionable_spreads).toBe(1);
  });
});

// ── updateDailyStats ───────────────────────────────────────────────────────────

describe('updateDailyStats', () => {
  let db;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('creates daily stats entry from spreads data', () => {
    const nowMs = 1700000000000;
    const date = todayDateStr(nowMs);
    const startOfDay = new Date(date + 'T00:00:00.000Z').getTime();

    // Insert a spread for today
    db.insertSpread({
      detected_at: startOfDay + 1000,
      pair: 'ETH/USDC',
      buy_chain: 'arbitrum',
      sell_chain: 'base',
      buy_price: 2000,
      sell_price: 2010,
      gross_spread_pct: 0.5,
      net_spread_pct: 0.45,
    });

    updateDailyStats(db, nowMs);

    const stats = db.getDailyStats(1);
    expect(stats).toHaveLength(1);
    expect(stats[0].date).toBe(date);
    expect(stats[0].total_spreads).toBe(1);
    expect(stats[0].actionable_spreads).toBe(1);
    expect(stats[0].most_active_pair).toBe('ETH/USDC');
    expect(stats[0].most_active_route).toBe('arbitrum→base');
  });

  it('handles empty data gracefully', () => {
    const nowMs = 1700000000000;
    updateDailyStats(db, nowMs);

    const stats = db.getDailyStats(1);
    expect(stats).toHaveLength(1);
    expect(stats[0].total_spreads).toBe(0);
    expect(stats[0].avg_spread_pct).toBe(0);
    expect(stats[0].best_spread_pct).toBe(0);
    expect(stats[0].most_active_pair).toBeNull();
    expect(stats[0].most_active_route).toBeNull();
  });

  it('includes sim_trades in stats', () => {
    const nowMs = 1700000000000;
    const date = todayDateStr(nowMs);
    const startOfDay = new Date(date + 'T00:00:00.000Z').getTime();

    const spreadResult = db.insertSpread({
      detected_at: startOfDay + 1000,
      pair: 'ETH/USDC',
      buy_chain: 'arbitrum',
      sell_chain: 'base',
      buy_price: 2000,
      sell_price: 2010,
      gross_spread_pct: 0.5,
      net_spread_pct: 0.45,
    });

    db.insertSimTrade({
      spread_id: Number(spreadResult.lastInsertRowid),
      timestamp: startOfDay + 2000,
      pair: 'ETH/USDC',
      buy_chain: 'arbitrum',
      sell_chain: 'base',
      trade_size_usd: 10000,
      tokens_bought: 5,
      usd_received: 10040,
      gas_cost_buy: 0.5,
      gas_cost_sell: 0.1,
      net_profit_usd: 39.4,
      profit_pct: 0.394,
    });

    updateDailyStats(db, nowMs);

    const stats = db.getDailyStats(1);
    expect(stats[0].sim_trades).toBe(1);
    expect(stats[0].total_sim_profit).toBeCloseTo(39.4, 1);
  });

  it('uses Date.now() as default', () => {
    // Just verify it doesn't throw
    updateDailyStats(db);
    const stats = db.getDailyStats(1);
    expect(stats).toHaveLength(1);
  });
});
