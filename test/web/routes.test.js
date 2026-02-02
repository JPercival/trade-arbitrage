/**
 * Tests for src/web/routes.js — ARB-9
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import AppDatabase from '../../src/db.js';
import { createRoutes } from '../../src/web/routes.js';

// Helper: create a mock req/res to call route handlers directly
function findHandler(router, method, path) {
  // Express Router stores routes in router.stack
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path) {
      const handlers = layer.route.methods[method.toLowerCase()]
        ? layer.route.stack.filter((s) => s.method === method.toLowerCase()).map((s) => s.handle)
        : [];
      if (handlers.length > 0) return handlers[handlers.length - 1];
    }
  }
  return null;
}

function mockRes() {
  const res = {
    _status: 200,
    _json: null,
    _rendered: null,
    _renderData: null,
    status(code) { res._status = code; return res; },
    json(data) { res._json = data; return res; },
    render(view, data) { res._rendered = view; res._renderData = data; return res; },
    redirect(url) { res._redirect = url; return res; },
  };
  return res;
}

describe('routes', () => {
  let db;
  let router;

  beforeEach(() => {
    db = new AppDatabase(':memory:');
    router = createRoutes(db);
  });

  afterEach(() => {
    db.close();
  });

  // Seed helper
  function seedData() {
    const now = Date.now();

    // Insert prices
    db.insertPrice({ timestamp: now, chain: 'ethereum', pair: 'ETH/USDC', price: 3000, liquidity_usd: 1000000, gas_price_gwei: 25 });
    db.insertPrice({ timestamp: now, chain: 'arbitrum', pair: 'ETH/USDC', price: 3001.5, liquidity_usd: 500000, gas_price_gwei: 0.1 });
    db.insertPrice({ timestamp: now - 60000, chain: 'ethereum', pair: 'ETH/USDC', price: 2999, liquidity_usd: 1000000, gas_price_gwei: 24 });

    // Insert spreads
    db.insertSpread({
      detected_at: now,
      pair: 'ETH/USDC',
      buy_chain: 'ethereum',
      sell_chain: 'arbitrum',
      buy_price: 3000,
      sell_price: 3001.5,
      gross_spread_pct: 0.05,
      net_spread_pct: 0.03,
    });
    db.insertSpread({
      detected_at: now - 100000,
      closed_at: now - 50000,
      pair: 'ETH/USDC',
      buy_chain: 'arbitrum',
      sell_chain: 'ethereum',
      buy_price: 2998,
      sell_price: 3003,
      gross_spread_pct: 0.167,
      net_spread_pct: 0.1,
      duration_seconds: 50,
    });

    // Insert sim trades
    db.insertSimTrade({
      spread_id: 1,
      timestamp: now,
      pair: 'ETH/USDC',
      buy_chain: 'ethereum',
      sell_chain: 'arbitrum',
      trade_size_usd: 10000,
      tokens_bought: 3.333,
      usd_received: 10005,
      gas_cost_buy: 10,
      gas_cost_sell: 0.5,
      net_profit_usd: -5.5,
      profit_pct: -0.055,
    });
    db.insertSimTrade({
      spread_id: 2,
      timestamp: now - 50000,
      pair: 'ETH/USDC',
      buy_chain: 'arbitrum',
      sell_chain: 'ethereum',
      trade_size_usd: 20000,
      tokens_bought: 6.67,
      usd_received: 20034,
      gas_cost_buy: 0.5,
      gas_cost_sell: 12,
      net_profit_usd: 21.5,
      profit_pct: 0.1075,
    });

    // Daily stats
    db.upsertDailyStats({
      date: '2025-02-01',
      total_spreads: 10,
      actionable_spreads: 3,
      sim_trades: 5,
      total_sim_profit: 25.50,
      avg_spread_pct: 0.08,
      best_spread_pct: 0.167,
      most_active_pair: 'ETH/USDC',
      most_active_route: 'arbitrum→ethereum',
    });
    db.upsertDailyStats({
      date: '2025-02-02',
      total_spreads: 8,
      actionable_spreads: 2,
      sim_trades: 3,
      total_sim_profit: -5.50,
      avg_spread_pct: 0.06,
      best_spread_pct: 0.10,
      most_active_pair: 'ETH/USDC',
      most_active_route: 'ethereum→arbitrum',
    });

    return now;
  }

  describe('GET / (dashboard page)', () => {
    it('renders dashboard with empty data', () => {
      const handler = findHandler(router, 'get', '/');
      const res = mockRes();
      handler({ query: {}, user: null }, res);
      expect(res._rendered).toBe('dashboard');
      expect(res._renderData.summary.totalTrades).toBe(0);
      expect(res._renderData.prices).toEqual([]);
      expect(res._renderData.openSpreads).toEqual([]);
      expect(res._renderData.recentTrades).toEqual([]);
    });

    it('renders dashboard with seeded data', () => {
      seedData();
      const handler = findHandler(router, 'get', '/');
      const res = mockRes();
      handler({ query: {}, user: { name: 'Test' } }, res);
      expect(res._rendered).toBe('dashboard');
      expect(res._renderData.prices.length).toBe(2); // latest per chain/pair
      expect(res._renderData.openSpreads.length).toBe(1);
      expect(res._renderData.recentTrades.length).toBe(2);
      expect(res._renderData.summary.totalTrades).toBe(2);
      expect(res._renderData.summary.bestPair).toBe('ETH/USDC');
      expect(res._renderData.user).toEqual({ name: 'Test' });
    });
  });

  describe('GET /trades (trades page)', () => {
    it('renders trades with empty data', () => {
      const handler = findHandler(router, 'get', '/trades');
      const res = mockRes();
      handler({ query: {}, user: null }, res);
      expect(res._rendered).toBe('trades');
      expect(res._renderData.trades).toEqual([]);
      expect(res._renderData.total).toBe(0);
      expect(res._renderData.page).toBe(1);
    });

    it('renders trades with filters', () => {
      seedData();
      const handler = findHandler(router, 'get', '/trades');
      const res = mockRes();
      handler({ query: { pair: 'ETH/USDC', page: '1', limit: '10' }, user: null }, res);
      expect(res._rendered).toBe('trades');
      expect(res._renderData.trades.length).toBe(2);
      expect(res._renderData.filters.pair).toBe('ETH/USDC');
    });

    it('filters by chain', () => {
      seedData();
      const handler = findHandler(router, 'get', '/trades');
      const res = mockRes();
      handler({ query: { chain: 'ethereum' }, user: null }, res);
      expect(res._rendered).toBe('trades');
      expect(res._renderData.trades.length).toBe(2); // both trades involve ethereum
    });

    it('filters by date range', () => {
      const now = seedData();
      const handler = findHandler(router, 'get', '/trades');
      const res = mockRes();
      // Use a future date for 'from' to get 0 trades
      const futureDate = new Date(now + 86400000).toISOString();
      handler({ query: { from: futureDate }, user: null }, res);
      expect(res._rendered).toBe('trades');
      // All trades should be before the future timestamp
      expect(res._renderData.trades.length).toBe(0);
    });

    it('filters by to date', () => {
      const now = seedData();
      const handler = findHandler(router, 'get', '/trades');
      const res = mockRes();
      // Use a past date for 'to' to get 0 trades
      const pastDate = new Date(now - 200000).toISOString();
      handler({ query: { to: pastDate }, user: null }, res);
      expect(res._rendered).toBe('trades');
      expect(res._renderData.trades.length).toBe(0);
    });

    it('handles invalid date gracefully', () => {
      seedData();
      const handler = findHandler(router, 'get', '/trades');
      const res = mockRes();
      handler({ query: { from: 'invalid-date', to: 'also-invalid' }, user: null }, res);
      expect(res._rendered).toBe('trades');
      // Invalid dates produce NaN timestamps, which are skipped
      expect(res._renderData.trades.length).toBe(2);
    });

    it('paginates correctly', () => {
      seedData();
      const handler = findHandler(router, 'get', '/trades');
      const res = mockRes();
      handler({ query: { page: '1', limit: '1' }, user: null }, res);
      expect(res._renderData.trades.length).toBe(1);
      expect(res._renderData.totalPages).toBe(2);
      expect(res._renderData.page).toBe(1);
    });

    it('handles page=0 as page=1', () => {
      seedData();
      const handler = findHandler(router, 'get', '/trades');
      const res = mockRes();
      handler({ query: { page: '0' }, user: null }, res);
      expect(res._renderData.page).toBe(1);
    });
  });

  describe('GET /analytics', () => {
    it('renders analytics page', () => {
      const handler = findHandler(router, 'get', '/analytics');
      const res = mockRes();
      handler({ query: {}, user: null }, res);
      expect(res._rendered).toBe('analytics');
      expect(res._renderData.title).toBe('Analytics');
    });
  });

  describe('GET /api/prices/current', () => {
    it('returns empty array when no prices', () => {
      const handler = findHandler(router, 'get', '/api/prices/current');
      const res = mockRes();
      handler({ query: {} }, res);
      expect(res._json).toEqual([]);
    });

    it('returns latest prices per chain/pair', () => {
      seedData();
      const handler = findHandler(router, 'get', '/api/prices/current');
      const res = mockRes();
      handler({ query: {} }, res);
      expect(res._json.length).toBe(2); // 2 chains with latest price
      expect(res._json[0].chain).toBe('arbitrum');
      expect(res._json[1].chain).toBe('ethereum');
      expect(res._json[1].price).toBe(3000); // latest ethereum price
    });
  });

  describe('GET /api/spreads', () => {
    it('returns all spreads by default', () => {
      seedData();
      const handler = findHandler(router, 'get', '/api/spreads');
      const res = mockRes();
      handler({ query: {} }, res);
      expect(res._json.length).toBe(2);
    });

    it('filters open spreads', () => {
      seedData();
      const handler = findHandler(router, 'get', '/api/spreads');
      const res = mockRes();
      handler({ query: { status: 'open' } }, res);
      expect(res._json.length).toBe(1);
      expect(res._json[0].closed_at).toBeNull();
    });

    it('filters closed spreads', () => {
      seedData();
      const handler = findHandler(router, 'get', '/api/spreads');
      const res = mockRes();
      handler({ query: { status: 'closed' } }, res);
      expect(res._json.length).toBe(1);
      expect(res._json[0].closed_at).not.toBeNull();
    });

    it('filters by pair', () => {
      seedData();
      const handler = findHandler(router, 'get', '/api/spreads');
      const res = mockRes();
      handler({ query: { pair: 'WBTC/USDC' } }, res);
      expect(res._json.length).toBe(0);
    });

    it('combines status and pair filters', () => {
      seedData();
      const handler = findHandler(router, 'get', '/api/spreads');
      const res = mockRes();
      handler({ query: { status: 'open', pair: 'ETH/USDC' } }, res);
      expect(res._json.length).toBe(1);
    });
  });

  describe('GET /api/trades', () => {
    it('returns trades with pagination', () => {
      seedData();
      const handler = findHandler(router, 'get', '/api/trades');
      const res = mockRes();
      handler({ query: { page: '1', limit: '1' } }, res);
      expect(res._json.trades.length).toBe(1);
      expect(res._json.total).toBe(2);
      expect(res._json.totalPages).toBe(2);
    });

    it('returns empty on no data', () => {
      const handler = findHandler(router, 'get', '/api/trades');
      const res = mockRes();
      handler({ query: {} }, res);
      expect(res._json.trades).toEqual([]);
      expect(res._json.total).toBe(0);
    });

    it('filters by pair', () => {
      seedData();
      const handler = findHandler(router, 'get', '/api/trades');
      const res = mockRes();
      handler({ query: { pair: 'WBTC/USDC' } }, res);
      expect(res._json.trades.length).toBe(0);
    });

    it('filters by date range', () => {
      const now = seedData();
      const handler = findHandler(router, 'get', '/api/trades');
      const res = mockRes();
      const from = new Date(now - 30000).toISOString();
      handler({ query: { from } }, res);
      expect(res._json.trades.length).toBe(1); // only the latest trade
    });

    it('filters by to date', () => {
      const now = seedData();
      const handler = findHandler(router, 'get', '/api/trades');
      const res = mockRes();
      const to = new Date(now - 30000).toISOString();
      handler({ query: { to } }, res);
      expect(res._json.trades.length).toBe(1); // only the older trade
    });

    it('caps limit at 100', () => {
      seedData();
      const handler = findHandler(router, 'get', '/api/trades');
      const res = mockRes();
      handler({ query: { limit: '500' } }, res);
      expect(res._json.limit).toBe(100);
    });

    it('handles invalid from/to gracefully', () => {
      seedData();
      const handler = findHandler(router, 'get', '/api/trades');
      const res = mockRes();
      handler({ query: { from: 'nope', to: 'nah' } }, res);
      expect(res._json.trades.length).toBe(2);
    });

    it('handles page 0 as page 1', () => {
      seedData();
      const handler = findHandler(router, 'get', '/api/trades');
      const res = mockRes();
      handler({ query: { page: '0' } }, res);
      expect(res._json.page).toBe(1);
    });
  });

  describe('GET /api/stats/daily', () => {
    it('returns daily stats', () => {
      seedData();
      const handler = findHandler(router, 'get', '/api/stats/daily');
      const res = mockRes();
      handler({ query: {} }, res);
      expect(res._json.length).toBe(2);
    });

    it('respects days parameter', () => {
      seedData();
      const handler = findHandler(router, 'get', '/api/stats/daily');
      const res = mockRes();
      handler({ query: { days: '1' } }, res);
      expect(res._json.length).toBe(1);
    });

    it('returns empty array when no stats', () => {
      const handler = findHandler(router, 'get', '/api/stats/daily');
      const res = mockRes();
      handler({ query: {} }, res);
      expect(res._json).toEqual([]);
    });
  });

  describe('GET /api/stats/summary', () => {
    it('returns summary with seeded data', () => {
      seedData();
      const handler = findHandler(router, 'get', '/api/stats/summary');
      const res = mockRes();
      handler({ query: {} }, res);
      expect(res._json.totalTrades).toBe(2);
      expect(res._json.totalProfit).toBeCloseTo(16.0, 1);
      expect(res._json.totalSpreads).toBe(2);
      expect(res._json.openSpreads).toBe(1);
      expect(res._json.bestPair).toBe('ETH/USDC');
      expect(res._json.bestRoute).toBeDefined();
    });

    it('returns defaults when no data', () => {
      const handler = findHandler(router, 'get', '/api/stats/summary');
      const res = mockRes();
      handler({ query: {} }, res);
      expect(res._json.totalTrades).toBe(0);
      expect(res._json.totalProfit).toBe(0);
      expect(res._json.bestPair).toBeNull();
      expect(res._json.bestRoute).toBeNull();
    });
  });
});
