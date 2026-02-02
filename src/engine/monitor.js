/**
 * Price Monitor Service — ARB-6
 *
 * Main polling loop orchestrating the two-tier price strategy:
 * 1. Every POLL_INTERVAL_MS: fetch DeFi Llama prices for all tokens/chains
 * 2. Store prices in DB
 * 3. Compare same token across chains → detect gross spreads
 * 4. When gross spread > threshold → trigger ParaSwap quotes
 * 5. Hand off detected spreads to the spread detection engine
 *
 * Resilient: catches per-cycle errors, logs, keeps running.
 * Startable and stoppable for tests and clean shutdown.
 */

import config from '../config.js';
import { fetchPrices } from '../prices/defillama.js';
import { fetchQuote } from '../prices/paraswap.js';
import { detectSpreads, processSpreads } from './spreads.js';
import { simulateTrades } from './simulator.js';

/**
 * Create a price monitor instance.
 *
 * @param {object} params
 * @param {object} params.db - AppDatabase instance
 * @param {object} [params.options]
 * @param {number} [params.options.pollIntervalMs] - Polling interval
 * @param {number} [params.options.minGrossSpreadPct] - Min gross spread threshold
 * @param {number} [params.options.minNetSpreadPct] - Min net spread threshold
 * @param {typeof globalThis.fetch} [params.options.fetchFn] - Fetch implementation (for testing)
 * @param {function} [params.options.onCycle] - Callback after each cycle (for testing)
 * @param {function} [params.options.logger] - Logger function (default: console.log)
 * @param {function} [params.options.simulateTradesFn] - Override simulateTrades (for testing)
 * @returns {{ start: function, stop: function, runCycle: function, isRunning: function }}
 */
export function createMonitor(params) {
  const { db, options = {} } = params;
  const {
    pollIntervalMs = config.pollIntervalMs,
    minGrossSpreadPct = config.minGrossSpreadPct,
    minNetSpreadPct = config.minNetSpreadPct,
    fetchFn = globalThis.fetch,
    onCycle = null,
    logger = console.log,
    simulateTradesFn = simulateTrades,
  } = options;

  let timer = null;
  let running = false;

  /**
   * Run a single monitoring cycle.
   * @returns {Promise<{priceCount: number, spreadsDetected: number, errors: string[]}>}
   */
  async function runCycle() {
    const cycleStats = { priceCount: 0, spreadsDetected: 0, simulated: 0, errors: [] };

    try {
      // Step 1: Fetch DeFi Llama prices (Tier 1)
      const { prices, stale } = await fetchPrices({ fetchFn });

      if (stale.length > 0) {
        logger(`[monitor] ${stale.length} stale price(s) discarded`);
      }

      // Step 2: Store prices in DB
      const nowMs = Date.now();
      for (const p of prices) {
        db.insertPrice({
          timestamp: nowMs,
          chain: p.chain,
          pair: p.pair,
          price: p.price,
        });
      }
      cycleStats.priceCount = prices.length;

      // Step 3: Detect gross spreads across chains
      // Use gas cost estimates for net spread calculation
      // For simplicity, we use a fixed reference trade size for screening
      const gasCosts = {};

      // Step 4: Detect spreads that exceed the gross threshold
      const detectedSpreads = detectSpreads({
        prices,
        gasCosts,
        minGrossSpreadPct,
        minNetSpreadPct,
        referenceTradeSize: 10000,
      });

      // Step 5: If we found gross spreads, get ParaSwap quotes for refinement
      if (detectedSpreads.length > 0) {
        // Fetch ParaSwap gas cost estimates for each involved chain
        const involvedChains = new Set();
        for (const s of detectedSpreads) {
          involvedChains.add(s.buyChain);
          involvedChains.add(s.sellChain);
        }

        for (const chain of involvedChains) {
          try {
            const pair = detectedSpreads[0].pair;
            const [baseToken, quoteToken] = pair.split('/');
            const quote = await fetchQuote({
              chain,
              srcToken: quoteToken,
              destToken: baseToken,
              amount: 10000,
              fetchFn,
            });
            gasCosts[chain] = parseFloat(quote.gasCostUSD);
          } catch {
            // If ParaSwap fails for a chain, use 0 (conservative — won't filter out)
            gasCosts[chain] = 0;
          }
        }

        // Re-detect spreads with actual gas costs
        const refinedSpreads = detectSpreads({
          prices,
          gasCosts,
          minGrossSpreadPct,
          minNetSpreadPct,
          referenceTradeSize: 10000,
        });

        // Step 6: Process spreads (record, lifecycle, daily stats)
        const { newSpreads, closedSpreads } = processSpreads({
          db,
          detectedSpreads: refinedSpreads,
          nowMs,
        });

        cycleStats.spreadsDetected = newSpreads.length;

        // Step 7: Simulate trades for new actionable spreads
        for (const spread of newSpreads) {
          try {
            const simResults = await simulateTradesFn({
              db,
              spread,
              fetchFn,
              nowMs,
            });
            const successCount = simResults.filter((r) => r.success).length;
            cycleStats.simulated += successCount;
          } catch (err) {
            cycleStats.errors.push(`Simulation error for ${spread.pair}: ${err.message}`);
          }
        }

        if (closedSpreads.length > 0) {
          logger(`[monitor] Closed ${closedSpreads.length} spread(s)`);
        }
      } else {
        // No gross spreads found — still close any open spreads
        processSpreads({ db, detectedSpreads: [], nowMs });
      }
    } catch (err) {
      cycleStats.errors.push(err.message);
      logger(`[monitor] Cycle error: ${err.message}`);
    }

    // Log cycle stats
    logger(
      `[monitor] Cycle complete: ${cycleStats.priceCount} prices, ` +
      `${cycleStats.spreadsDetected} new spreads, ` +
      `${cycleStats.simulated} simulations` +
      (cycleStats.errors.length > 0 ? `, ${cycleStats.errors.length} error(s)` : '')
    );

    if (onCycle) onCycle(cycleStats);

    return cycleStats;
  }

  /**
   * Start the monitor polling loop.
   */
  function start() {
    if (running) return;
    running = true;
    logger('[monitor] Starting price monitor');

    // Run first cycle immediately
    runCycle().then(() => {
      scheduleNext();
    });
  }

  /**
   * Schedule the next cycle.
   */
  function scheduleNext() {
    if (!running) return;
    timer = setTimeout(async () => {
      await runCycle();
      scheduleNext();
    }, pollIntervalMs);
  }

  /**
   * Stop the monitor.
   */
  function stop() {
    running = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    logger('[monitor] Stopped price monitor');
  }

  /**
   * Check if the monitor is running.
   * @returns {boolean}
   */
  function isRunning() {
    return running;
  }

  return { start, stop, runCycle, isRunning };
}
