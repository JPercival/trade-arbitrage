/**
 * Spread Detection Engine — ARB-7
 *
 * Compares prices across all chain combinations for each token,
 * calculates gross and net spread percentages, tracks spread lifecycle
 * (open → close with duration), flags Ethereum-leg spreads as high-friction,
 * and updates daily_stats on each new spread.
 */

import config from '../config.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Get today's date string in YYYY-MM-DD format.
 * @param {number} [nowMs] - Current time in ms (for testing)
 * @returns {string}
 */
export function todayDateStr(nowMs = Date.now()) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * Generate all unique chain pairs from a list of chains.
 * @param {string[]} chains
 * @returns {Array<[string, string]>}
 */
export function generateChainPairs(chains) {
  const pairs = [];
  for (let i = 0; i < chains.length; i++) {
    for (let j = i + 1; j < chains.length; j++) {
      pairs.push([chains[i], chains[j]]);
    }
  }
  return pairs;
}

/**
 * Calculate gross spread percentage between two prices.
 * Spread = (high - low) / low * 100
 *
 * @param {number} priceA
 * @param {number} priceB
 * @returns {{ grossSpreadPct: number, buyChain: string, sellChain: string, buyPrice: number, sellPrice: number }}
 */
export function calculateGrossSpread(priceA, chainA, priceB, chainB) {
  const low = Math.min(priceA, priceB);
  const high = Math.max(priceA, priceB);

  if (low <= 0) return { grossSpreadPct: 0, buyChain: chainA, sellChain: chainB, buyPrice: priceA, sellPrice: priceB };

  const grossSpreadPct = ((high - low) / low) * 100;

  // Buy on the cheaper chain, sell on the expensive chain
  const buyChain = priceA <= priceB ? chainA : chainB;
  const sellChain = priceA <= priceB ? chainB : chainA;
  const buyPrice = Math.min(priceA, priceB);
  const sellPrice = Math.max(priceA, priceB);

  return { grossSpreadPct, buyChain, sellChain, buyPrice, sellPrice };
}

/**
 * Calculate net spread after gas and swap costs.
 *
 * @param {number} grossSpreadPct - The gross spread percentage
 * @param {number} buyGasCostUsd - Gas cost on buy chain (from ParaSwap gasCostUSD)
 * @param {number} sellGasCostUsd - Gas cost on sell chain
 * @param {number} tradeSize - Assumed trade size in USD for cost calculation
 * @returns {number} Net spread percentage
 */
export function calculateNetSpread(grossSpreadPct, buyGasCostUsd, sellGasCostUsd, tradeSize) {
  if (tradeSize <= 0) return 0;
  const totalGasCostPct = ((buyGasCostUsd + sellGasCostUsd) / tradeSize) * 100;
  return grossSpreadPct - totalGasCostPct;
}

/**
 * Check if a spread involves an Ethereum leg (high friction).
 * @param {string} buyChain
 * @param {string} sellChain
 * @returns {boolean}
 */
export function isHighFriction(buyChain, sellChain) {
  return buyChain === 'ethereum' || sellChain === 'ethereum';
}

// ── Core Spread Detection ──────────────────────────────────────────────────────

/**
 * Detect spreads from a set of prices across chains.
 *
 * @param {object} params
 * @param {Array<{chain: string, pair: string, price: number}>} params.prices - Latest prices
 * @param {object} params.gasCosts - Map of chain → gasCostUSD (e.g. from ParaSwap or gas estimates)
 * @param {number} [params.minGrossSpreadPct] - Minimum gross spread to consider
 * @param {number} [params.minNetSpreadPct] - Minimum net spread for actionable spread
 * @param {number} [params.referenceTradeSize] - Reference trade size for net cost calculation
 * @returns {Array<{pair: string, buyChain: string, sellChain: string, buyPrice: number, sellPrice: number, grossSpreadPct: number, netSpreadPct: number, highFriction: boolean}>}
 */
export function detectSpreads(params) {
  const {
    prices,
    gasCosts = {},
    minGrossSpreadPct = config.minGrossSpreadPct,
    minNetSpreadPct = config.minNetSpreadPct,
    referenceTradeSize = 10000,
  } = params;

  const spreads = [];

  // Group prices by pair
  const byPair = new Map();
  for (const p of prices) {
    if (!byPair.has(p.pair)) byPair.set(p.pair, []);
    byPair.get(p.pair).push(p);
  }

  // For each pair, compare all chain combinations
  for (const [pair, pairPrices] of byPair) {
    const chainPairs = generateChainPairs(pairPrices.map((p) => p.chain));

    for (const [chainA, chainB] of chainPairs) {
      const priceA = pairPrices.find((p) => p.chain === chainA);
      const priceB = pairPrices.find((p) => p.chain === chainB);
      if (!priceA || !priceB) continue;

      const { grossSpreadPct, buyChain, sellChain, buyPrice, sellPrice } =
        calculateGrossSpread(priceA.price, chainA, priceB.price, chainB);

      if (grossSpreadPct < minGrossSpreadPct) continue;

      // Calculate net spread using gas costs
      const buyGas = gasCosts[buyChain] ?? 0;
      const sellGas = gasCosts[sellChain] ?? 0;
      const netSpreadPct = calculateNetSpread(grossSpreadPct, buyGas, sellGas, referenceTradeSize);

      if (netSpreadPct < minNetSpreadPct) continue;

      spreads.push({
        pair,
        buyChain,
        sellChain,
        buyPrice,
        sellPrice,
        grossSpreadPct,
        netSpreadPct,
        highFriction: isHighFriction(buyChain, sellChain),
      });
    }
  }

  return spreads;
}

// ── Spread Lifecycle Management ────────────────────────────────────────────────

/**
 * Process detected spreads: record new ones, close stale ones, update daily stats.
 *
 * @param {object} params
 * @param {object} params.db - AppDatabase instance
 * @param {Array} params.detectedSpreads - Spreads from detectSpreads()
 * @param {number} [params.nowMs] - Current time in ms (for testing)
 * @returns {{ newSpreads: Array, closedSpreads: Array }}
 */
export function processSpreads(params) {
  const {
    db,
    detectedSpreads,
    nowMs = Date.now(),
  } = params;

  const newSpreads = [];
  const closedSpreads = [];

  // Get currently open spreads from DB
  const openSpreads = db.getOpenSpreads();

  // Build a set of current spread keys for matching
  const detectedKeys = new Set();
  for (const s of detectedSpreads) {
    detectedKeys.add(spreadKey(s));
  }

  // Close spreads that are no longer detected
  for (const open of openSpreads) {
    const key = spreadKey(open);
    if (!detectedKeys.has(key)) {
      const durationSeconds = Math.round((nowMs - open.detected_at) / 1000);
      db.db.prepare(
        'UPDATE spreads SET closed_at = ?, duration_seconds = ? WHERE id = ?'
      ).run(nowMs, durationSeconds, open.id);
      closedSpreads.push({ ...open, closed_at: nowMs, duration_seconds: durationSeconds });
    }
  }

  // Build a set of open spread keys for deduplication
  const openKeys = new Set();
  for (const open of openSpreads) {
    openKeys.add(spreadKey(open));
  }

  // Record new spreads that aren't already open
  for (const detected of detectedSpreads) {
    const key = spreadKey(detected);
    if (!openKeys.has(key)) {
      const result = db.insertSpread({
        detected_at: nowMs,
        pair: detected.pair,
        buy_chain: detected.buyChain,
        sell_chain: detected.sellChain,
        buy_price: detected.buyPrice,
        sell_price: detected.sellPrice,
        gross_spread_pct: detected.grossSpreadPct,
        net_spread_pct: detected.netSpreadPct,
      });

      const spreadRecord = {
        id: Number(result.lastInsertRowid),
        ...detected,
        detected_at: nowMs,
      };
      newSpreads.push(spreadRecord);

      // Update daily stats
      updateDailyStats(db, nowMs);
    }
  }

  return { newSpreads, closedSpreads };
}

/**
 * Generate a unique key for a spread (pair + buy_chain + sell_chain).
 * @param {object} spread
 * @returns {string}
 */
function spreadKey(spread) {
  const pair = spread.pair;
  const buy = spread.buyChain ?? spread.buy_chain;
  const sell = spread.sellChain ?? spread.sell_chain;
  return `${pair}:${buy}→${sell}`;
}

/**
 * Update daily_stats aggregates for today.
 * @param {object} db - AppDatabase instance
 * @param {number} [nowMs] - Current time in ms
 */
export function updateDailyStats(db, nowMs = Date.now()) {
  const date = todayDateStr(nowMs);

  // Count all spreads detected today
  const startOfDay = new Date(date + 'T00:00:00.000Z').getTime();
  const endOfDay = startOfDay + 24 * 60 * 60 * 1000;

  const totalRow = db.db.prepare(
    'SELECT COUNT(*) as count FROM spreads WHERE detected_at >= ? AND detected_at < ?'
  ).get(startOfDay, endOfDay);

  const actionableRow = db.db.prepare(
    'SELECT COUNT(*) as count FROM spreads WHERE detected_at >= ? AND detected_at < ? AND net_spread_pct IS NOT NULL'
  ).get(startOfDay, endOfDay);

  const simRow = db.db.prepare(
    'SELECT COUNT(*) as count, COALESCE(SUM(net_profit_usd), 0) as total_profit FROM sim_trades WHERE timestamp >= ? AND timestamp < ?'
  ).get(startOfDay, endOfDay);

  const spreadStats = db.db.prepare(
    'SELECT AVG(net_spread_pct) as avg_spread, MAX(net_spread_pct) as best_spread FROM spreads WHERE detected_at >= ? AND detected_at < ? AND net_spread_pct IS NOT NULL'
  ).get(startOfDay, endOfDay);

  // Most active pair
  const activePairRow = db.db.prepare(
    'SELECT pair, COUNT(*) as cnt FROM spreads WHERE detected_at >= ? AND detected_at < ? GROUP BY pair ORDER BY cnt DESC LIMIT 1'
  ).get(startOfDay, endOfDay);

  // Most active route
  const activeRouteRow = db.db.prepare(
    "SELECT buy_chain || '→' || sell_chain as route, COUNT(*) as cnt FROM spreads WHERE detected_at >= ? AND detected_at < ? GROUP BY route ORDER BY cnt DESC LIMIT 1"
  ).get(startOfDay, endOfDay);

  db.upsertDailyStats({
    date,
    total_spreads: totalRow.count,
    actionable_spreads: actionableRow.count,
    sim_trades: simRow.count,
    total_sim_profit: simRow.total_profit,
    avg_spread_pct: spreadStats.avg_spread ?? 0,
    best_spread_pct: spreadStats.best_spread ?? 0,
    most_active_pair: activePairRow?.pair ?? null,
    most_active_route: activeRouteRow?.route ?? null,
  });
}
