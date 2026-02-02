import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import config from './config.js';

// ── Schema ─────────────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS prices (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp       INTEGER NOT NULL,
    chain           TEXT    NOT NULL,
    pair            TEXT    NOT NULL,
    price           REAL    NOT NULL,
    liquidity_usd   REAL,
    gas_price_gwei  REAL
  );

  CREATE TABLE IF NOT EXISTS spreads (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    detected_at       INTEGER NOT NULL,
    closed_at         INTEGER,
    pair              TEXT    NOT NULL,
    buy_chain         TEXT    NOT NULL,
    sell_chain        TEXT    NOT NULL,
    buy_price         REAL    NOT NULL,
    sell_price        REAL    NOT NULL,
    gross_spread_pct  REAL    NOT NULL,
    net_spread_pct    REAL,
    duration_seconds  INTEGER
  );

  CREATE TABLE IF NOT EXISTS sim_trades (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    spread_id       INTEGER NOT NULL REFERENCES spreads(id),
    timestamp       INTEGER NOT NULL,
    pair            TEXT    NOT NULL,
    buy_chain       TEXT    NOT NULL,
    sell_chain      TEXT    NOT NULL,
    trade_size_usd  REAL    NOT NULL,
    tokens_bought   REAL    NOT NULL,
    usd_received    REAL    NOT NULL,
    gas_cost_buy    REAL    NOT NULL,
    gas_cost_sell   REAL    NOT NULL,
    net_profit_usd  REAL    NOT NULL,
    profit_pct      REAL    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS daily_stats (
    date              TEXT PRIMARY KEY,
    total_spreads     INTEGER NOT NULL DEFAULT 0,
    actionable_spreads INTEGER NOT NULL DEFAULT 0,
    sim_trades        INTEGER NOT NULL DEFAULT 0,
    total_sim_profit  REAL    NOT NULL DEFAULT 0,
    avg_spread_pct    REAL    NOT NULL DEFAULT 0,
    best_spread_pct   REAL    NOT NULL DEFAULT 0,
    most_active_pair  TEXT,
    most_active_route TEXT
  );
`;

const INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_prices_chain_pair_ts
    ON prices(chain, pair, timestamp);

  CREATE INDEX IF NOT EXISTS idx_spreads_pair_detected
    ON spreads(pair, detected_at);

  CREATE INDEX IF NOT EXISTS idx_sim_trades_spread
    ON sim_trades(spread_id);
`;

// ── Database class ─────────────────────────────────────────────────────────────

class AppDatabase {
  constructor(dbPath) {
    // Ensure data directory exists
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this._initSchema();
  }

  _initSchema() {
    this.db.exec(SCHEMA_SQL);
    this.db.exec(INDEX_SQL);
  }

  // ── Insert helpers ─────────────────────────────────────────────────────────

  insertPrice({ timestamp, chain, pair, price, liquidity_usd = null, gas_price_gwei = null }) {
    const stmt = this.db.prepare(`
      INSERT INTO prices (timestamp, chain, pair, price, liquidity_usd, gas_price_gwei)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(timestamp, chain, pair, price, liquidity_usd, gas_price_gwei);
  }

  insertSpread({
    detected_at,
    closed_at = null,
    pair,
    buy_chain,
    sell_chain,
    buy_price,
    sell_price,
    gross_spread_pct,
    net_spread_pct = null,
    duration_seconds = null,
  }) {
    const stmt = this.db.prepare(`
      INSERT INTO spreads (detected_at, closed_at, pair, buy_chain, sell_chain,
                           buy_price, sell_price, gross_spread_pct, net_spread_pct, duration_seconds)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      detected_at, closed_at, pair, buy_chain, sell_chain,
      buy_price, sell_price, gross_spread_pct, net_spread_pct, duration_seconds,
    );
  }

  insertSimTrade({
    spread_id,
    timestamp,
    pair,
    buy_chain,
    sell_chain,
    trade_size_usd,
    tokens_bought,
    usd_received,
    gas_cost_buy,
    gas_cost_sell,
    net_profit_usd,
    profit_pct,
  }) {
    const stmt = this.db.prepare(`
      INSERT INTO sim_trades (spread_id, timestamp, pair, buy_chain, sell_chain,
                              trade_size_usd, tokens_bought, usd_received,
                              gas_cost_buy, gas_cost_sell, net_profit_usd, profit_pct)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      spread_id, timestamp, pair, buy_chain, sell_chain,
      trade_size_usd, tokens_bought, usd_received,
      gas_cost_buy, gas_cost_sell, net_profit_usd, profit_pct,
    );
  }

  upsertDailyStats({
    date,
    total_spreads,
    actionable_spreads,
    sim_trades,
    total_sim_profit,
    avg_spread_pct,
    best_spread_pct,
    most_active_pair = null,
    most_active_route = null,
  }) {
    const stmt = this.db.prepare(`
      INSERT INTO daily_stats (date, total_spreads, actionable_spreads, sim_trades,
                               total_sim_profit, avg_spread_pct, best_spread_pct,
                               most_active_pair, most_active_route)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        total_spreads     = excluded.total_spreads,
        actionable_spreads = excluded.actionable_spreads,
        sim_trades        = excluded.sim_trades,
        total_sim_profit  = excluded.total_sim_profit,
        avg_spread_pct    = excluded.avg_spread_pct,
        best_spread_pct   = excluded.best_spread_pct,
        most_active_pair  = excluded.most_active_pair,
        most_active_route = excluded.most_active_route
    `);
    return stmt.run(
      date, total_spreads, actionable_spreads, sim_trades,
      total_sim_profit, avg_spread_pct, best_spread_pct,
      most_active_pair, most_active_route,
    );
  }

  // ── Query helpers ──────────────────────────────────────────────────────────

  getLatestPrices(pair) {
    // Returns the most recent price row for each chain for a given pair
    const stmt = this.db.prepare(`
      SELECT p.* FROM prices p
      INNER JOIN (
        SELECT chain, MAX(timestamp) as max_ts
        FROM prices
        WHERE pair = ?
        GROUP BY chain
      ) latest ON p.chain = latest.chain AND p.timestamp = latest.max_ts AND p.pair = ?
      ORDER BY p.chain
    `);
    return stmt.all(pair, pair);
  }

  getOpenSpreads() {
    const stmt = this.db.prepare(`
      SELECT * FROM spreads WHERE closed_at IS NULL ORDER BY detected_at DESC
    `);
    return stmt.all();
  }

  getRecentSpreads(pair, limit = 50) {
    const stmt = this.db.prepare(`
      SELECT * FROM spreads WHERE pair = ? ORDER BY detected_at DESC LIMIT ?
    `);
    return stmt.all(pair, limit);
  }

  getTradeHistory({ pair = null, from = null, to = null, limit = 100 } = {}) {
    let sql = 'SELECT * FROM sim_trades WHERE 1=1';
    const params = [];

    if (pair) {
      sql += ' AND pair = ?';
      params.push(pair);
    }
    if (from) {
      sql += ' AND timestamp >= ?';
      params.push(from);
    }
    if (to) {
      sql += ' AND timestamp <= ?';
      params.push(to);
    }
    sql += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    return this.db.prepare(sql).all(...params);
  }

  getDailyStats(days = 30) {
    const stmt = this.db.prepare(`
      SELECT * FROM daily_stats ORDER BY date DESC LIMIT ?
    `);
    return stmt.all(days);
  }

  // ── Data retention pruning ─────────────────────────────────────────────────

  pruneOldPrices(retentionDays = config.priceHistoryDays) {
    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const stmt = this.db.prepare('DELETE FROM prices WHERE timestamp < ?');
    return stmt.run(cutoffMs);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  close() {
    this.db.close();
  }
}

export default AppDatabase;
export { SCHEMA_SQL, INDEX_SQL };
