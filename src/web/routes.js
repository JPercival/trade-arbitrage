/**
 * Web Routes — ARB-9
 *
 * Page routes (EJS) and API endpoints (JSON).
 * All DB queries happen here — no engine module imports.
 */

import { Router } from 'express';

function createRoutes(db) {
  const router = Router();

  // ── Helper ─────────────────────────────────────────────────────────────────

  function safeInt(val, fallback) {
    const n = parseInt(val, 10);
    return Number.isNaN(n) || n < 0 ? fallback : n;
  }

  // ── Page Routes ────────────────────────────────────────────────────────────

  router.get('/', (req, res) => {
    const prices = db.db.prepare(`
      SELECT p.* FROM prices p
      INNER JOIN (
        SELECT chain, pair, MAX(timestamp) as max_ts
        FROM prices GROUP BY chain, pair
      ) latest ON p.chain = latest.chain AND p.pair = latest.pair AND p.timestamp = latest.max_ts
      ORDER BY p.pair, p.chain
    `).all();

    const openSpreads = db.getOpenSpreads();

    const recentTrades = db.db.prepare(`
      SELECT * FROM sim_trades ORDER BY timestamp DESC LIMIT 10
    `).all();

    // Summary stats
    const summary = db.db.prepare(`
      SELECT
        COUNT(*) as total_trades,
        COALESCE(SUM(net_profit_usd), 0) as total_profit,
        COALESCE(AVG(profit_pct), 0) as avg_spread
      FROM sim_trades
    `).get();

    const bestPairRow = db.db.prepare(`
      SELECT pair, SUM(net_profit_usd) as total
      FROM sim_trades GROUP BY pair ORDER BY total DESC LIMIT 1
    `).get();

    res.render('dashboard', {
      title: 'Dashboard',
      prices,
      openSpreads,
      recentTrades,
      summary: {
        totalTrades: summary.total_trades,
        totalProfit: summary.total_profit,
        avgSpread: summary.avg_spread,
        bestPair: bestPairRow?.pair || 'N/A',
      },
      user: req.user || null,
    });
  });

  router.get('/trades', (req, res) => {
    const page = safeInt(req.query.page, 1) || 1;
    const limit = safeInt(req.query.limit, 25);
    const pair = req.query.pair || null;
    const chain = req.query.chain || null;
    const from = req.query.from || null;
    const to = req.query.to || null;

    let sql = 'SELECT * FROM sim_trades WHERE 1=1';
    let countSql = 'SELECT COUNT(*) as total FROM sim_trades WHERE 1=1';
    const params = [];
    const countParams = [];

    if (pair) {
      sql += ' AND pair = ?';
      countSql += ' AND pair = ?';
      params.push(pair);
      countParams.push(pair);
    }
    if (chain) {
      sql += ' AND (buy_chain = ? OR sell_chain = ?)';
      countSql += ' AND (buy_chain = ? OR sell_chain = ?)';
      params.push(chain, chain);
      countParams.push(chain, chain);
    }
    if (from) {
      const fromTs = new Date(from).getTime();
      if (!isNaN(fromTs)) {
        sql += ' AND timestamp >= ?';
        countSql += ' AND timestamp >= ?';
        params.push(fromTs);
        countParams.push(fromTs);
      }
    }
    if (to) {
      const toTs = new Date(to).getTime();
      if (!isNaN(toTs)) {
        sql += ' AND timestamp <= ?';
        countSql += ' AND timestamp <= ?';
        params.push(toTs);
        countParams.push(toTs);
      }
    }

    const total = db.db.prepare(countSql).get(...countParams).total;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;

    sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    const trades = db.db.prepare(sql).all(...params);

    // Get distinct pairs and chains for filter dropdowns
    const pairs = db.db.prepare('SELECT DISTINCT pair FROM sim_trades ORDER BY pair').all().map((r) => r.pair);
    const chains = db.db.prepare(
      'SELECT DISTINCT chain FROM (SELECT buy_chain as chain FROM sim_trades UNION SELECT sell_chain FROM sim_trades) ORDER BY chain',
    ).all().map((r) => r.chain);

    res.render('trades', {
      title: 'Trades',
      trades,
      page,
      limit,
      total,
      totalPages,
      pairs,
      chains,
      filters: { pair, chain, from, to },
      user: req.user || null,
    });
  });

  router.get('/analytics', (req, res) => {
    res.render('analytics', {
      title: 'Analytics',
      user: req.user || null,
    });
  });

  // ── API Routes ─────────────────────────────────────────────────────────────

  router.get('/api/prices/current', (req, res) => {
    const prices = db.db.prepare(`
      SELECT p.* FROM prices p
      INNER JOIN (
        SELECT chain, pair, MAX(timestamp) as max_ts
        FROM prices GROUP BY chain, pair
      ) latest ON p.chain = latest.chain AND p.pair = latest.pair AND p.timestamp = latest.max_ts
      ORDER BY p.pair, p.chain
    `).all();
    res.json(prices);
  });

  router.get('/api/spreads', (req, res) => {
    const status = req.query.status || null;
    const pair = req.query.pair || null;

    let sql = 'SELECT * FROM spreads WHERE 1=1';
    const params = [];

    if (status === 'open') {
      sql += ' AND closed_at IS NULL';
    } else if (status === 'closed') {
      sql += ' AND closed_at IS NOT NULL';
    }

    if (pair) {
      sql += ' AND pair = ?';
      params.push(pair);
    }

    sql += ' ORDER BY detected_at DESC LIMIT 100';
    const spreads = db.db.prepare(sql).all(...params);
    res.json(spreads);
  });

  router.get('/api/trades', (req, res) => {
    const page = safeInt(req.query.page, 1) || 1;
    const limit = Math.min(safeInt(req.query.limit, 25), 100);
    const pair = req.query.pair || null;
    const from = req.query.from || null;
    const to = req.query.to || null;

    let sql = 'SELECT * FROM sim_trades WHERE 1=1';
    let countSql = 'SELECT COUNT(*) as total FROM sim_trades WHERE 1=1';
    const params = [];
    const countParams = [];

    if (pair) {
      sql += ' AND pair = ?';
      countSql += ' AND pair = ?';
      params.push(pair);
      countParams.push(pair);
    }
    if (from) {
      const fromTs = new Date(from).getTime();
      if (!isNaN(fromTs)) {
        sql += ' AND timestamp >= ?';
        countSql += ' AND timestamp >= ?';
        params.push(fromTs);
        countParams.push(fromTs);
      }
    }
    if (to) {
      const toTs = new Date(to).getTime();
      if (!isNaN(toTs)) {
        sql += ' AND timestamp <= ?';
        countSql += ' AND timestamp <= ?';
        params.push(toTs);
        countParams.push(toTs);
      }
    }

    const total = db.db.prepare(countSql).get(...countParams).total;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;

    sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const trades = db.db.prepare(sql).all(...params);
    res.json({ trades, page, limit, total, totalPages });
  });

  router.get('/api/stats/daily', (req, res) => {
    const days = safeInt(req.query.days, 30);
    const stats = db.getDailyStats(days);
    res.json(stats);
  });

  router.get('/api/stats/summary', (req, res) => {
    const summary = db.db.prepare(`
      SELECT
        COUNT(*) as total_trades,
        COALESCE(SUM(net_profit_usd), 0) as total_profit,
        COALESCE(AVG(profit_pct), 0) as avg_spread_pct,
        COALESCE(MAX(profit_pct), 0) as best_spread_pct,
        COALESCE(MIN(timestamp), 0) as first_trade,
        COALESCE(MAX(timestamp), 0) as last_trade
      FROM sim_trades
    `).get();

    const totalSpreads = db.db.prepare('SELECT COUNT(*) as count FROM spreads').get().count;
    const openSpreads = db.db.prepare('SELECT COUNT(*) as count FROM spreads WHERE closed_at IS NULL').get().count;

    const bestPairRow = db.db.prepare(`
      SELECT pair, SUM(net_profit_usd) as total
      FROM sim_trades GROUP BY pair ORDER BY total DESC LIMIT 1
    `).get();

    const bestRouteRow = db.db.prepare(`
      SELECT buy_chain || '→' || sell_chain as route, SUM(net_profit_usd) as total
      FROM sim_trades GROUP BY route ORDER BY total DESC LIMIT 1
    `).get();

    res.json({
      totalTrades: summary.total_trades,
      totalProfit: summary.total_profit,
      avgSpreadPct: summary.avg_spread_pct,
      bestSpreadPct: summary.best_spread_pct,
      totalSpreads,
      openSpreads,
      bestPair: bestPairRow?.pair || null,
      bestRoute: bestRouteRow?.route || null,
      firstTrade: summary.first_trade || null,
      lastTrade: summary.last_trade || null,
    });
  });

  return router;
}

export default createRoutes;
export { createRoutes };
