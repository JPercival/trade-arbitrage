import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// We import AppDatabase directly — it uses real better-sqlite3 (in-memory-friendly via tmp files)
import AppDatabase from '../src/db.js';

const TEST_DB_DIR = join(tmpdir(), 'trade-arb-test-' + process.pid);

function freshDb() {
  const dbPath = join(TEST_DB_DIR, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  return new AppDatabase(dbPath);
}

describe('AppDatabase', () => {
  let db;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    if (db) db.close();
  });

  // ── Schema ─────────────────────────────────────────────────────────────────

  describe('schema initialization', () => {
    it('creates all four tables', () => {
      const tables = db.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all()
        .map((r) => r.name);

      expect(tables).toContain('prices');
      expect(tables).toContain('spreads');
      expect(tables).toContain('sim_trades');
      expect(tables).toContain('daily_stats');
    });

    it('creates the required indexes', () => {
      const indexes = db.db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all()
        .map((r) => r.name);

      expect(indexes).toContain('idx_prices_chain_pair_ts');
      expect(indexes).toContain('idx_spreads_pair_detected');
      expect(indexes).toContain('idx_sim_trades_spread');
    });

    it('is idempotent — calling _initSchema again does not error', () => {
      expect(() => db._initSchema()).not.toThrow();
    });

    it('creates data directory if missing', () => {
      const path = join(TEST_DB_DIR, 'nested', 'deep', `test-${Date.now()}.sqlite`);
      const db2 = new AppDatabase(path);
      expect(existsSync(path)).toBe(true);
      db2.close();
    });
  });

  // ── Insert: prices ─────────────────────────────────────────────────────────

  describe('insertPrice', () => {
    it('inserts a price row and returns result with lastInsertRowid', () => {
      const result = db.insertPrice({
        timestamp: 1700000000000,
        chain: 'ethereum',
        pair: 'ETH/USDC',
        price: 2000.5,
        liquidity_usd: 1000000,
        gas_price_gwei: 25.3,
      });
      expect(result.changes).toBe(1);
      expect(['number', 'bigint']).toContain(typeof result.lastInsertRowid);
    });

    it('inserts with null optional fields', () => {
      const result = db.insertPrice({
        timestamp: 1700000000000,
        chain: 'arbitrum',
        pair: 'WBTC/USDC',
        price: 35000,
      });
      expect(result.changes).toBe(1);

      const row = db.db.prepare('SELECT * FROM prices WHERE id = ?').get(Number(result.lastInsertRowid));
      expect(row.liquidity_usd).toBeNull();
      expect(row.gas_price_gwei).toBeNull();
    });
  });

  // ── Insert: spreads ────────────────────────────────────────────────────────

  describe('insertSpread', () => {
    it('inserts a spread row with all fields', () => {
      const result = db.insertSpread({
        detected_at: 1700000000000,
        closed_at: 1700000060000,
        pair: 'ETH/USDC',
        buy_chain: 'arbitrum',
        sell_chain: 'base',
        buy_price: 1999.0,
        sell_price: 2003.0,
        gross_spread_pct: 0.20,
        net_spread_pct: 0.12,
        duration_seconds: 60,
      });
      expect(result.changes).toBe(1);
    });

    it('inserts an open spread (null closed_at, net_spread, duration)', () => {
      const result = db.insertSpread({
        detected_at: 1700000000000,
        pair: 'ETH/USDC',
        buy_chain: 'base',
        sell_chain: 'ethereum',
        buy_price: 1998.0,
        sell_price: 2005.0,
        gross_spread_pct: 0.35,
      });
      expect(result.changes).toBe(1);

      const row = db.db.prepare('SELECT * FROM spreads WHERE id = ?').get(Number(result.lastInsertRowid));
      expect(row.closed_at).toBeNull();
      expect(row.net_spread_pct).toBeNull();
      expect(row.duration_seconds).toBeNull();
    });
  });

  // ── Insert: sim_trades ─────────────────────────────────────────────────────

  describe('insertSimTrade', () => {
    it('inserts a simulated trade', () => {
      // First insert a spread to reference
      const spreadResult = db.insertSpread({
        detected_at: 1700000000000,
        pair: 'ETH/USDC',
        buy_chain: 'arbitrum',
        sell_chain: 'base',
        buy_price: 1999.0,
        sell_price: 2003.0,
        gross_spread_pct: 0.20,
      });

      const result = db.insertSimTrade({
        spread_id: Number(spreadResult.lastInsertRowid),
        timestamp: 1700000001000,
        pair: 'ETH/USDC',
        buy_chain: 'arbitrum',
        sell_chain: 'base',
        trade_size_usd: 10000,
        tokens_bought: 5.0025,
        usd_received: 10020.0,
        gas_cost_buy: 0.50,
        gas_cost_sell: 0.10,
        net_profit_usd: 19.40,
        profit_pct: 0.194,
      });

      expect(result.changes).toBe(1);
    });
  });

  // ── Upsert: daily_stats ────────────────────────────────────────────────────

  describe('upsertDailyStats', () => {
    it('inserts a new daily stats row', () => {
      const result = db.upsertDailyStats({
        date: '2024-01-15',
        total_spreads: 50,
        actionable_spreads: 12,
        sim_trades: 8,
        total_sim_profit: 156.78,
        avg_spread_pct: 0.12,
        best_spread_pct: 0.45,
        most_active_pair: 'ETH/USDC',
        most_active_route: 'arbitrum→base',
      });
      expect(result.changes).toBe(1);
    });

    it('updates existing daily stats on conflict', () => {
      db.upsertDailyStats({
        date: '2024-01-15',
        total_spreads: 50,
        actionable_spreads: 12,
        sim_trades: 8,
        total_sim_profit: 156.78,
        avg_spread_pct: 0.12,
        best_spread_pct: 0.45,
      });

      db.upsertDailyStats({
        date: '2024-01-15',
        total_spreads: 75,
        actionable_spreads: 20,
        sim_trades: 15,
        total_sim_profit: 250.0,
        avg_spread_pct: 0.15,
        best_spread_pct: 0.60,
        most_active_pair: 'WBTC/USDC',
        most_active_route: 'ethereum→arbitrum',
      });

      const row = db.db.prepare('SELECT * FROM daily_stats WHERE date = ?').get('2024-01-15');
      expect(row.total_spreads).toBe(75);
      expect(row.actionable_spreads).toBe(20);
      expect(row.sim_trades).toBe(15);
      expect(row.total_sim_profit).toBe(250.0);
      expect(row.most_active_pair).toBe('WBTC/USDC');
    });
  });

  // ── Query: getLatestPrices ─────────────────────────────────────────────────

  describe('getLatestPrices', () => {
    it('returns latest price per chain for a pair', () => {
      // Insert multiple prices for different chains at different times
      db.insertPrice({ timestamp: 1000, chain: 'ethereum', pair: 'ETH/USDC', price: 2000 });
      db.insertPrice({ timestamp: 2000, chain: 'ethereum', pair: 'ETH/USDC', price: 2010 });
      db.insertPrice({ timestamp: 1000, chain: 'arbitrum', pair: 'ETH/USDC', price: 1999 });
      db.insertPrice({ timestamp: 3000, chain: 'arbitrum', pair: 'ETH/USDC', price: 2005 });
      db.insertPrice({ timestamp: 1500, chain: 'base', pair: 'ETH/USDC', price: 2002 });

      // Also insert different pair to verify filtering
      db.insertPrice({ timestamp: 5000, chain: 'ethereum', pair: 'WBTC/USDC', price: 35000 });

      const results = db.getLatestPrices('ETH/USDC');
      expect(results).toHaveLength(3);

      const eth = results.find((r) => r.chain === 'ethereum');
      const arb = results.find((r) => r.chain === 'arbitrum');
      const base = results.find((r) => r.chain === 'base');

      expect(eth.price).toBe(2010);
      expect(eth.timestamp).toBe(2000);
      expect(arb.price).toBe(2005);
      expect(arb.timestamp).toBe(3000);
      expect(base.price).toBe(2002);
      expect(base.timestamp).toBe(1500);
    });

    it('returns empty array when no prices exist for pair', () => {
      const results = db.getLatestPrices('NONEXISTENT/PAIR');
      expect(results).toEqual([]);
    });
  });

  // ── Query: getOpenSpreads ──────────────────────────────────────────────────

  describe('getOpenSpreads', () => {
    it('returns only spreads where closed_at IS NULL', () => {
      db.insertSpread({
        detected_at: 1000,
        pair: 'ETH/USDC',
        buy_chain: 'arbitrum',
        sell_chain: 'base',
        buy_price: 1999,
        sell_price: 2003,
        gross_spread_pct: 0.2,
      });
      db.insertSpread({
        detected_at: 2000,
        closed_at: 3000,
        pair: 'ETH/USDC',
        buy_chain: 'base',
        sell_chain: 'ethereum',
        buy_price: 2000,
        sell_price: 2010,
        gross_spread_pct: 0.5,
        duration_seconds: 60,
      });
      db.insertSpread({
        detected_at: 3000,
        pair: 'WBTC/USDC',
        buy_chain: 'ethereum',
        sell_chain: 'arbitrum',
        buy_price: 34900,
        sell_price: 35000,
        gross_spread_pct: 0.29,
      });

      const open = db.getOpenSpreads();
      expect(open).toHaveLength(2);
      // Should be ordered DESC by detected_at
      expect(open[0].detected_at).toBe(3000);
      expect(open[1].detected_at).toBe(1000);
    });

    it('returns empty array when no open spreads exist', () => {
      expect(db.getOpenSpreads()).toEqual([]);
    });
  });

  // ── Query: getRecentSpreads ────────────────────────────────────────────────

  describe('getRecentSpreads', () => {
    it('returns recent spreads for a pair ordered by detected_at DESC', () => {
      for (let i = 0; i < 5; i++) {
        db.insertSpread({
          detected_at: i * 1000,
          pair: 'ETH/USDC',
          buy_chain: 'arbitrum',
          sell_chain: 'base',
          buy_price: 2000 + i,
          sell_price: 2005 + i,
          gross_spread_pct: 0.2 + i * 0.01,
        });
      }

      const results = db.getRecentSpreads('ETH/USDC', 3);
      expect(results).toHaveLength(3);
      expect(results[0].detected_at).toBe(4000);
      expect(results[1].detected_at).toBe(3000);
      expect(results[2].detected_at).toBe(2000);
    });

    it('uses default limit of 50', () => {
      for (let i = 0; i < 60; i++) {
        db.insertSpread({
          detected_at: i,
          pair: 'ETH/USDC',
          buy_chain: 'a',
          sell_chain: 'b',
          buy_price: 100,
          sell_price: 101,
          gross_spread_pct: 1.0,
        });
      }
      const results = db.getRecentSpreads('ETH/USDC');
      expect(results).toHaveLength(50);
    });
  });

  // ── Query: getTradeHistory ─────────────────────────────────────────────────

  describe('getTradeHistory', () => {
    function seedTrades() {
      const s1 = db.insertSpread({
        detected_at: 1000, pair: 'ETH/USDC',
        buy_chain: 'arbitrum', sell_chain: 'base',
        buy_price: 2000, sell_price: 2004, gross_spread_pct: 0.2,
      });
      const s2 = db.insertSpread({
        detected_at: 2000, pair: 'WBTC/USDC',
        buy_chain: 'ethereum', sell_chain: 'arbitrum',
        buy_price: 35000, sell_price: 35100, gross_spread_pct: 0.29,
      });

      const tradeBase = {
        tokens_bought: 5, usd_received: 10020,
        gas_cost_buy: 0.5, gas_cost_sell: 0.1,
        net_profit_usd: 19.4, profit_pct: 0.194,
      };

      db.insertSimTrade({
        spread_id: Number(s1.lastInsertRowid),
        timestamp: 1000, pair: 'ETH/USDC',
        buy_chain: 'arbitrum', sell_chain: 'base',
        trade_size_usd: 10000, ...tradeBase,
      });
      db.insertSimTrade({
        spread_id: Number(s1.lastInsertRowid),
        timestamp: 2000, pair: 'ETH/USDC',
        buy_chain: 'arbitrum', sell_chain: 'base',
        trade_size_usd: 20000, ...tradeBase,
      });
      db.insertSimTrade({
        spread_id: Number(s2.lastInsertRowid),
        timestamp: 3000, pair: 'WBTC/USDC',
        buy_chain: 'ethereum', sell_chain: 'arbitrum',
        trade_size_usd: 10000, ...tradeBase,
      });
    }

    it('returns all trades with no filters', () => {
      seedTrades();
      const results = db.getTradeHistory();
      expect(results).toHaveLength(3);
      // Ordered DESC
      expect(results[0].timestamp).toBe(3000);
    });

    it('filters by pair', () => {
      seedTrades();
      const results = db.getTradeHistory({ pair: 'WBTC/USDC' });
      expect(results).toHaveLength(1);
      expect(results[0].pair).toBe('WBTC/USDC');
    });

    it('filters by from timestamp', () => {
      seedTrades();
      const results = db.getTradeHistory({ from: 2000 });
      expect(results).toHaveLength(2);
    });

    it('filters by to timestamp', () => {
      seedTrades();
      const results = db.getTradeHistory({ to: 1500 });
      expect(results).toHaveLength(1);
      expect(results[0].timestamp).toBe(1000);
    });

    it('filters by pair + from + to combined', () => {
      seedTrades();
      const results = db.getTradeHistory({ pair: 'ETH/USDC', from: 500, to: 1500 });
      expect(results).toHaveLength(1);
      expect(results[0].timestamp).toBe(1000);
    });

    it('respects limit parameter', () => {
      seedTrades();
      const results = db.getTradeHistory({ limit: 1 });
      expect(results).toHaveLength(1);
    });

    it('uses default options when called with no args', () => {
      seedTrades();
      const results = db.getTradeHistory();
      expect(results).toHaveLength(3);
    });
  });

  // ── Query: getDailyStats ──────────────────────────────────────────────────

  describe('getDailyStats', () => {
    it('returns daily stats ordered by date DESC with limit', () => {
      for (let i = 1; i <= 5; i++) {
        db.upsertDailyStats({
          date: `2024-01-${String(i).padStart(2, '0')}`,
          total_spreads: i * 10,
          actionable_spreads: i,
          sim_trades: i,
          total_sim_profit: i * 50,
          avg_spread_pct: 0.1 * i,
          best_spread_pct: 0.5 * i,
        });
      }

      const results = db.getDailyStats(3);
      expect(results).toHaveLength(3);
      expect(results[0].date).toBe('2024-01-05');
      expect(results[2].date).toBe('2024-01-03');
    });

    it('uses default limit of 30', () => {
      for (let i = 1; i <= 35; i++) {
        db.upsertDailyStats({
          date: `2024-01-${String(i).padStart(2, '0')}`,
          total_spreads: 1, actionable_spreads: 0, sim_trades: 0,
          total_sim_profit: 0, avg_spread_pct: 0, best_spread_pct: 0,
        });
      }
      const results = db.getDailyStats();
      expect(results).toHaveLength(30);
    });
  });

  // ── Retention pruning ─────────────────────────────────────────────────────

  describe('pruneOldPrices', () => {
    it('deletes prices older than retention period', () => {
      const now = Date.now();
      const oldTs = now - 31 * 24 * 60 * 60 * 1000; // 31 days ago
      const recentTs = now - 1 * 24 * 60 * 60 * 1000; // 1 day ago

      db.insertPrice({ timestamp: oldTs, chain: 'ethereum', pair: 'ETH/USDC', price: 2000 });
      db.insertPrice({ timestamp: oldTs - 1000, chain: 'arbitrum', pair: 'ETH/USDC', price: 1999 });
      db.insertPrice({ timestamp: recentTs, chain: 'base', pair: 'ETH/USDC', price: 2001 });

      const result = db.pruneOldPrices(30);
      expect(result.changes).toBe(2);

      const remaining = db.db.prepare('SELECT COUNT(*) as count FROM prices').get();
      expect(remaining.count).toBe(1);
    });

    it('accepts custom retention days', () => {
      const now = Date.now();
      db.insertPrice({ timestamp: now - 8 * 24 * 60 * 60 * 1000, chain: 'ethereum', pair: 'ETH/USDC', price: 2000 });
      db.insertPrice({ timestamp: now - 3 * 24 * 60 * 60 * 1000, chain: 'ethereum', pair: 'ETH/USDC', price: 2010 });

      const result = db.pruneOldPrices(7);
      expect(result.changes).toBe(1);
    });

    it('uses config default when no argument provided', () => {
      const now = Date.now();
      db.insertPrice({ timestamp: now - 100 * 24 * 60 * 60 * 1000, chain: 'ethereum', pair: 'ETH/USDC', price: 2000 });
      db.insertPrice({ timestamp: now, chain: 'ethereum', pair: 'ETH/USDC', price: 2010 });

      // config.priceHistoryDays defaults to 30
      const result = db.pruneOldPrices();
      expect(result.changes).toBe(1);
    });
  });

  // ── close ──────────────────────────────────────────────────────────────────

  describe('close', () => {
    it('closes the database connection', () => {
      db.close();
      expect(() => db.db.prepare('SELECT 1')).toThrow();
      db = null; // prevent afterEach from double-closing
    });
  });
});

// ── Exports test ─────────────────────────────────────────────────────────────

describe('db module exports', () => {
  it('exports SCHEMA_SQL and INDEX_SQL', async () => {
    const { SCHEMA_SQL, INDEX_SQL } = await import('../src/db.js');
    expect(typeof SCHEMA_SQL).toBe('string');
    expect(SCHEMA_SQL).toContain('CREATE TABLE');
    expect(typeof INDEX_SQL).toBe('string');
    expect(INDEX_SQL).toContain('CREATE INDEX');
  });
});
