/**
 * Trade Simulator — ARB-8
 *
 * When an actionable spread is detected, simulates trades at all configured
 * SIM_TRADE_SIZES. Gets ParaSwap quotes for both legs, calculates net profit
 * including gas, and stores sim_trade records in the database.
 */

import config from '../config.js';
import { fetchQuote, calculateEffectivePrice } from '../prices/paraswap.js';

/**
 * Simulate trades for a detected spread at all configured sizes.
 *
 * @param {object} params
 * @param {object} params.db - AppDatabase instance
 * @param {object} params.spread - Spread record with id, pair, buyChain, sellChain, etc.
 * @param {number[]} [params.tradeSizes] - Trade sizes in USD (default from config)
 * @param {typeof globalThis.fetch} [params.fetchFn] - Fetch implementation (for testing)
 * @param {number} [params.nowMs] - Current time in ms (for testing)
 * @returns {Promise<Array<{success: boolean, size: number, trade?: object, error?: string}>>}
 */
export async function simulateTrades(params) {
  const {
    db,
    spread,
    tradeSizes = config.simTradeSizes,
    fetchFn = globalThis.fetch,
    nowMs = Date.now(),
  } = params;

  const results = [];

  for (const size of tradeSizes) {
    try {
      const trade = await simulateSingleTrade({
        db,
        spread,
        tradeSize: size,
        fetchFn,
        nowMs,
      });
      results.push({ success: true, size, trade });
    } catch (err) {
      // Handle quote failures gracefully per-size
      results.push({ success: false, size, error: err.message });
    }
  }

  return results;
}

/**
 * Simulate a single trade at a given size.
 *
 * @param {object} params
 * @param {object} params.db - AppDatabase instance
 * @param {object} params.spread - Spread record
 * @param {number} params.tradeSize - Trade size in USD
 * @param {typeof globalThis.fetch} params.fetchFn - Fetch implementation
 * @param {number} params.nowMs - Current time in ms
 * @returns {Promise<object>} The sim_trade record
 */
export async function simulateSingleTrade(params) {
  const { db, spread, tradeSize, fetchFn, nowMs } = params;

  const [baseToken, quoteToken] = spread.pair.split('/');

  // Leg 1: Buy — USDC → TOKEN on buy chain
  const buyQuote = await fetchQuote({
    chain: spread.buyChain,
    srcToken: quoteToken,
    destToken: baseToken,
    amount: tradeSize,
    fetchFn,
  });

  const tokensBought = Number(buyQuote.destAmount) / 10 ** buyQuote.destDecimals;
  const gasCostBuy = parseFloat(buyQuote.gasCostUSD);

  // Leg 2: Sell — TOKEN → USDC on sell chain
  const sellQuote = await fetchQuote({
    chain: spread.sellChain,
    srcToken: baseToken,
    destToken: quoteToken,
    amount: tokensBought,
    fetchFn,
  });

  const usdReceived = Number(sellQuote.destAmount) / 10 ** sellQuote.destDecimals;
  const gasCostSell = parseFloat(sellQuote.gasCostUSD);

  // Calculate net profit: usd_received - trade_size - gas_buy - gas_sell
  const netProfitUsd = usdReceived - tradeSize - gasCostBuy - gasCostSell;
  const profitPct = tradeSize > 0 ? (netProfitUsd / tradeSize) * 100 : 0;

  const tradeRecord = {
    spread_id: spread.id,
    timestamp: nowMs,
    pair: spread.pair,
    buy_chain: spread.buyChain,
    sell_chain: spread.sellChain,
    trade_size_usd: tradeSize,
    tokens_bought: tokensBought,
    usd_received: usdReceived,
    gas_cost_buy: gasCostBuy,
    gas_cost_sell: gasCostSell,
    net_profit_usd: netProfitUsd,
    profit_pct: profitPct,
  };

  db.insertSimTrade(tradeRecord);

  return tradeRecord;
}
