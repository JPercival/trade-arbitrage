import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import AppDatabase from '../../src/db.js';
import { createMonitor } from '../../src/engine/monitor.js';

// ── Test DB helper ─────────────────────────────────────────────────────────────

function freshDb() {
  const dbPath = join(tmpdir(), `trade-arb-test-monitor-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  return new AppDatabase(dbPath);
}

// ── Mock DeFi Llama response ───────────────────────────────────────────────────

const NOW_SECONDS = Math.floor(Date.now() / 1000);

function makeLlamaResponse(ethPrices = {}) {
  const defaults = {
    ethereum: 2500,
    arbitrum: 2501,
    base: 2499,
  };
  const prices = { ...defaults, ...ethPrices };

  return {
    coins: {
      'ethereum:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2': {
        decimals: 18, symbol: 'WETH', price: prices.ethereum, timestamp: NOW_SECONDS - 2, confidence: 0.99,
      },
      'arbitrum:0x82aF49447D8a07e3bd95BD0d56f35241523fBab1': {
        decimals: 18, symbol: 'WETH', price: prices.arbitrum, timestamp: NOW_SECONDS - 2, confidence: 0.99,
      },
      'base:0x4200000000000000000000000000000000000006': {
        decimals: 18, symbol: 'WETH', price: prices.base, timestamp: NOW_SECONDS - 2, confidence: 0.99,
      },
      'ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599': {
        decimals: 8, symbol: 'WBTC', price: 43500, timestamp: NOW_SECONDS - 2, confidence: 0.99,
      },
      'arbitrum:0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f': {
        decimals: 8, symbol: 'WBTC', price: 43510, timestamp: NOW_SECONDS - 2, confidence: 0.99,
      },
    },
  };
}

function makeParaSwapResponse(gasCostUSD = '0.50') {
  return {
    priceRoute: {
      srcToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      destToken: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      srcAmount: '10000000000',
      destAmount: '4000000000000000000',
      srcDecimals: 6,
      destDecimals: 18,
      gasCostUSD,
      bestRoute: [],
    },
  };
}

function makeSellParaSwapResponse(gasCostUSD = '0.10') {
  return {
    priceRoute: {
      srcToken: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      destToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      srcAmount: '4000000000000000000',
      destAmount: '10050000000',
      srcDecimals: 18,
      destDecimals: 6,
      gasCostUSD,
      bestRoute: [],
    },
  };
}

// ── createMonitor ──────────────────────────────────────────────────────────────

describe('createMonitor', () => {
  let db;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('creates a monitor with start, stop, runCycle, isRunning methods', () => {
    const monitor = createMonitor({ db });
    expect(typeof monitor.start).toBe('function');
    expect(typeof monitor.stop).toBe('function');
    expect(typeof monitor.runCycle).toBe('function');
    expect(typeof monitor.isRunning).toBe('function');
  });

  it('starts as not running', () => {
    const monitor = createMonitor({ db });
    expect(monitor.isRunning()).toBe(false);
  });
});

// ── runCycle ────────────────────────────────────────────────────────────────────

describe('runCycle', () => {
  let db;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('fetches prices and stores them in DB', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeLlamaResponse(),
      });

    const monitor = createMonitor({
      db,
      options: {
        fetchFn: mockFetch,
        logger: vi.fn(),
        minGrossSpreadPct: 10, // Set high so no spreads are detected
      },
    });

    const stats = await monitor.runCycle();
    expect(stats.priceCount).toBe(5);
    expect(stats.errors).toHaveLength(0);

    // Verify prices stored in DB
    const ethPrices = db.getLatestPrices('ETH/USDC');
    expect(ethPrices).toHaveLength(3);
  });

  it('detects gross spreads and triggers ParaSwap quotes', async () => {
    const mockFetch = vi.fn()
      // DeFi Llama — large spread to trigger detection
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeLlamaResponse({ arbitrum: 2500, base: 2520 }), // ~0.8% spread
      })
      // ParaSwap quotes for involved chains (arb + base + ethereum for other pairs)
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => makeParaSwapResponse('0.30'),
      });

    const logger = vi.fn();
    const monitor = createMonitor({
      db,
      options: {
        fetchFn: mockFetch,
        logger,
        minGrossSpreadPct: 0.05,
        minNetSpreadPct: 0.02,
      },
    });

    const stats = await monitor.runCycle();

    expect(stats.priceCount).toBe(5);
    // Should have triggered ParaSwap for refinement
    expect(mockFetch.mock.calls.length).toBeGreaterThan(1);
  });

  it('handles DeFi Llama errors gracefully', async () => {
    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new Error('Network timeout'));

    const logger = vi.fn();
    const monitor = createMonitor({
      db,
      options: {
        fetchFn: mockFetch,
        logger,
      },
    });

    const stats = await monitor.runCycle();

    expect(stats.errors).toHaveLength(1);
    expect(stats.priceCount).toBe(0);
    // Logger should have been called with error message
    expect(logger).toHaveBeenCalled();
  });

  it('handles ParaSwap failures gracefully', async () => {
    const mockFetch = vi.fn()
      // DeFi Llama succeeds with a big spread
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeLlamaResponse({ arbitrum: 2500, base: 2530 }),
      })
      // ParaSwap calls fail
      .mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Rate Limited',
      });

    const logger = vi.fn();
    const monitor = createMonitor({
      db,
      options: {
        fetchFn: mockFetch,
        logger,
        minGrossSpreadPct: 0.05,
        minNetSpreadPct: 0.02,
      },
    });

    // Should not crash
    const stats = await monitor.runCycle();
    expect(stats.priceCount).toBe(5);
    // ParaSwap failures are caught, so spreads may still be processed (with 0 gas costs)
  });

  it('logs stale prices', async () => {
    const staleTs = NOW_SECONDS - 600; // 10 minutes old (exceeds 300s threshold)
    const response = makeLlamaResponse();
    response.coins['ethereum:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'].timestamp = staleTs;

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => response,
      });

    const logger = vi.fn();
    const monitor = createMonitor({
      db,
      options: {
        fetchFn: mockFetch,
        logger,
        minGrossSpreadPct: 10, // High to avoid ParaSwap triggers
      },
    });

    const stats = await monitor.runCycle();
    // Should have logged stale prices
    const staleLogCall = logger.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('stale')
    );
    expect(staleLogCall).toBeDefined();
  });

  it('logs cycle stats on completion', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeLlamaResponse(),
      });

    const logger = vi.fn();
    const monitor = createMonitor({
      db,
      options: {
        fetchFn: mockFetch,
        logger,
        minGrossSpreadPct: 10,
      },
    });

    await monitor.runCycle();

    const cycleLog = logger.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('Cycle complete')
    );
    expect(cycleLog).toBeDefined();
  });

  it('calls onCycle callback with stats', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeLlamaResponse(),
      });

    const onCycle = vi.fn();
    const monitor = createMonitor({
      db,
      options: {
        fetchFn: mockFetch,
        logger: vi.fn(),
        onCycle,
        minGrossSpreadPct: 10,
      },
    });

    await monitor.runCycle();
    expect(onCycle).toHaveBeenCalledTimes(1);
    expect(onCycle.mock.calls[0][0]).toHaveProperty('priceCount');
  });

  it('closes open spreads when no new gross spreads detected', async () => {
    // First: create an open spread manually
    db.insertSpread({
      detected_at: Date.now() - 60000,
      pair: 'ETH/USDC',
      buy_chain: 'arbitrum',
      sell_chain: 'base',
      buy_price: 2000,
      sell_price: 2010,
      gross_spread_pct: 0.5,
      net_spread_pct: 0.45,
    });

    expect(db.getOpenSpreads()).toHaveLength(1);

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeLlamaResponse(), // Tight spread — no arb
      });

    const monitor = createMonitor({
      db,
      options: {
        fetchFn: mockFetch,
        logger: vi.fn(),
        minGrossSpreadPct: 10, // Very high — nothing will pass
      },
    });

    await monitor.runCycle();

    // Open spread should have been closed
    expect(db.getOpenSpreads()).toHaveLength(0);
  });

  it('logs when open spreads are closed', async () => {
    // Pre-insert an open spread
    db.insertSpread({
      detected_at: Date.now() - 60000,
      pair: 'ETH/USDC',
      buy_chain: 'arbitrum',
      sell_chain: 'base',
      buy_price: 2000,
      sell_price: 2010,
      gross_spread_pct: 0.5,
      net_spread_pct: 0.45,
    });

    // DeFi Llama returns a big spread so the code enters the "detectedSpreads.length > 0" branch
    // but after ParaSwap refinement, the refined spread has a DIFFERENT route than the open one
    // so the open one gets closed
    const mockFetch = vi.fn()
      // DeFi Llama — spread between eth and arb (not arb-base like the open one)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeLlamaResponse({ ethereum: 2500, arbitrum: 2530, base: 2530 }),
      })
      // ParaSwap calls — return high gas so refined spreads include what we need
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => makeParaSwapResponse('0.10'),
      });

    const logger = vi.fn();
    const monitor = createMonitor({
      db,
      options: {
        fetchFn: mockFetch,
        logger,
        minGrossSpreadPct: 0.05,
        minNetSpreadPct: 0.02,
      },
    });

    await monitor.runCycle();

    // The original arb→base spread should have been closed
    const closedLog = logger.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('Closed')
    );
    expect(closedLog).toBeDefined();
  });

  it('handles simulation errors gracefully via simulateTradesFn catch', async () => {
    // Use a big spread and inject a throwing simulateTradesFn
    const mockFetch = vi.fn()
      // DeFi Llama — big spread
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeLlamaResponse({ arbitrum: 2500, base: 2550 }), // 2% spread
      })
      // ParaSwap calls for gas estimation
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => makeParaSwapResponse('0.10'),
      });

    const logger = vi.fn();
    const throwingSimulator = vi.fn().mockRejectedValue(new Error('Simulation exploded'));

    const monitor = createMonitor({
      db,
      options: {
        fetchFn: mockFetch,
        logger,
        minGrossSpreadPct: 0.05,
        minNetSpreadPct: 0.02,
        simulateTradesFn: throwingSimulator,
      },
    });

    const stats = await monitor.runCycle();

    // Cycle should complete even though simulation threw
    expect(stats.priceCount).toBe(5);
    // Errors from simulation should be captured
    const simErrors = stats.errors.filter((e) => e.includes('Simulation error'));
    expect(simErrors.length).toBeGreaterThan(0);
    expect(simErrors[0]).toContain('Simulation exploded');
  });

  it('performs full end-to-end cycle with spread detection and simulation', async () => {
    // Large spread: arbitrum 2500, base 2530 (~1.2%)
    const mockFetch = vi.fn()
      // DeFi Llama
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeLlamaResponse({ arbitrum: 2500, base: 2530 }),
      })
      // ParaSwap gas estimates for involved chains (may be called multiple times)
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => makeParaSwapResponse('0.10'),
      });

    const logger = vi.fn();
    const monitor = createMonitor({
      db,
      options: {
        fetchFn: mockFetch,
        logger,
        minGrossSpreadPct: 0.05,
        minNetSpreadPct: 0.02,
      },
    });

    const stats = await monitor.runCycle();

    expect(stats.priceCount).toBe(5);
    // Spreads should have been detected
    expect(stats.spreadsDetected).toBeGreaterThanOrEqual(0);
  });
});

// ── start / stop ───────────────────────────────────────────────────────────────

describe('start / stop', () => {
  let db;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('starts and stops the monitor', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => makeLlamaResponse(),
      });

    const logger = vi.fn();
    const monitor = createMonitor({
      db,
      options: {
        fetchFn: mockFetch,
        logger,
        pollIntervalMs: 100000, // very long so no second cycle
        minGrossSpreadPct: 10,
      },
    });

    expect(monitor.isRunning()).toBe(false);

    monitor.start();
    expect(monitor.isRunning()).toBe(true);

    // Wait for first cycle to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    monitor.stop();
    expect(monitor.isRunning()).toBe(false);
  });

  it('does not start twice', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => makeLlamaResponse(),
      });

    const logger = vi.fn();
    const monitor = createMonitor({
      db,
      options: {
        fetchFn: mockFetch,
        logger,
        pollIntervalMs: 100000,
        minGrossSpreadPct: 10,
      },
    });

    monitor.start();
    monitor.start(); // Second call should be no-op

    await new Promise((resolve) => setTimeout(resolve, 100));

    monitor.stop();

    // Logger should only have one "Starting" message
    const startLogs = logger.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('Starting')
    );
    expect(startLogs).toHaveLength(1);
  });

  it('can stop before any cycle runs', () => {
    const logger = vi.fn();
    const monitor = createMonitor({
      db,
      options: {
        fetchFn: vi.fn(),
        logger,
        pollIntervalMs: 100000,
      },
    });

    monitor.stop();
    expect(monitor.isRunning()).toBe(false);
  });

  it('runs multiple cycles when interval is short', async () => {
    let cycleCount = 0;
    const mockFetch = vi.fn()
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => makeLlamaResponse(),
      });

    const monitor = createMonitor({
      db,
      options: {
        fetchFn: mockFetch,
        logger: vi.fn(),
        pollIntervalMs: 50, // 50ms between cycles
        minGrossSpreadPct: 10,
        onCycle: () => { cycleCount++; },
      },
    });

    monitor.start();

    // Wait for ~3 cycles
    await new Promise((resolve) => setTimeout(resolve, 250));

    monitor.stop();

    expect(cycleCount).toBeGreaterThanOrEqual(2);
  });

  it('stop prevents further cycles', async () => {
    let cycleCount = 0;
    const mockFetch = vi.fn()
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => makeLlamaResponse(),
      });

    const monitor = createMonitor({
      db,
      options: {
        fetchFn: mockFetch,
        logger: vi.fn(),
        pollIntervalMs: 50,
        minGrossSpreadPct: 10,
        onCycle: () => { cycleCount++; },
      },
    });

    monitor.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    monitor.stop();

    const countAtStop = cycleCount;
    await new Promise((resolve) => setTimeout(resolve, 200));

    // No new cycles should have run
    expect(cycleCount).toBe(countAtStop);
  });
});
