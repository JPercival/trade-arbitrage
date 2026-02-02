import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// We need to test config.js which reads process.env at import time.
// We'll use dynamic imports and reset modules between tests.

describe('config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    // Clear all env vars that config reads, so tests are isolated
    delete process.env.CHAINS;
    delete process.env.PAIRS;
    delete process.env.POLL_INTERVAL_MS;
    delete process.env.PRICE_HISTORY_DAYS;
    delete process.env.MIN_GROSS_SPREAD_PCT;
    delete process.env.MIN_NET_SPREAD_PCT;
    delete process.env.SIM_TRADE_SIZES;
    delete process.env.SIM_SLIPPAGE_TOLERANCE_PCT;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    delete process.env.ALERT_MIN_SPREAD_PCT;
    delete process.env.ALERT_COOLDOWN_SECONDS;
    delete process.env.PORT;
    delete process.env.RPC_ETHEREUM;
    delete process.env.RPC_ARBITRUM;
    delete process.env.RPC_BASE;
  });

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it('exports default config with correct defaults', async () => {
    const { default: config } = await import('../src/config.js');

    // Chains
    expect(config.chains).toEqual(['ethereum', 'arbitrum', 'base']);

    // Pairs
    expect(config.pairs).toHaveLength(2);
    expect(config.pairs[0]).toEqual({ base: 'ETH', quote: 'USDC', symbol: 'ETH/USDC' });
    expect(config.pairs[1]).toEqual({ base: 'WBTC', quote: 'USDC', symbol: 'WBTC/USDC' });

    // Monitoring defaults
    expect(config.pollIntervalMs).toBe(15000);
    expect(config.priceHistoryDays).toBe(30);

    // Detection thresholds
    expect(config.minGrossSpreadPct).toBe(0.05);
    expect(config.minNetSpreadPct).toBe(0.02);

    // Simulation defaults
    expect(config.simTradeSizes).toEqual([5000, 10000, 20000, 50000]);
    expect(config.simSlippageTolerancePct).toBe(0.5);

    // Alerts defaults
    expect(config.telegramBotToken).toBe('');
    expect(config.telegramChatId).toBe('');
    expect(config.alertMinSpreadPct).toBe(0.15);
    expect(config.alertCooldownSeconds).toBe(300);

    // Web
    expect(config.port).toBe(3000);
  });

  it('exports TOKEN_ADDRESSES with correct chain addresses', async () => {
    const { TOKEN_ADDRESSES } = await import('../src/config.js');

    expect(TOKEN_ADDRESSES.ethereum.WETH).toBe('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
    expect(TOKEN_ADDRESSES.ethereum.USDC).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
    expect(TOKEN_ADDRESSES.ethereum.WBTC).toBe('0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599');

    expect(TOKEN_ADDRESSES.arbitrum.WETH).toBe('0x82aF49447D8a07e3bd95BD0d56f35241523fBab1');
    expect(TOKEN_ADDRESSES.arbitrum.USDC).toBe('0xaf88d065e77c8cC2239327C5EDb3A432268e5831');
    expect(TOKEN_ADDRESSES.arbitrum.WBTC).toBe('0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f');

    expect(TOKEN_ADDRESSES.base.WETH).toBe('0x4200000000000000000000000000000000000006');
    expect(TOKEN_ADDRESSES.base.USDC).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(TOKEN_ADDRESSES.base.WBTC).toBeNull(); // TBD
  });

  it('exports DEFAULT_RPCS and CHAIN_IDS', async () => {
    const { DEFAULT_RPCS, CHAIN_IDS } = await import('../src/config.js');

    expect(DEFAULT_RPCS.ethereum).toBe('https://eth.llamarpc.com');
    expect(DEFAULT_RPCS.arbitrum).toBe('https://arb1.arbitrum.io/rpc');
    expect(DEFAULT_RPCS.base).toBe('https://mainnet.base.org');

    expect(CHAIN_IDS.ethereum).toBe(1);
    expect(CHAIN_IDS.arbitrum).toBe(42161);
    expect(CHAIN_IDS.base).toBe(8453);
  });

  it('builds chainConfigs with default RPCs when env not set', async () => {
    const { default: config } = await import('../src/config.js');

    expect(config.chainConfigs.ethereum.name).toBe('ethereum');
    expect(config.chainConfigs.ethereum.rpc).toBe('https://eth.llamarpc.com');
    expect(config.chainConfigs.ethereum.chainId).toBe(1);
    expect(config.chainConfigs.ethereum.tokens.WETH).toBe('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');

    expect(config.chainConfigs.arbitrum.rpc).toBe('https://arb1.arbitrum.io/rpc');
    expect(config.chainConfigs.arbitrum.chainId).toBe(42161);

    expect(config.chainConfigs.base.rpc).toBe('https://mainnet.base.org');
    expect(config.chainConfigs.base.chainId).toBe(8453);
  });

  it('uses custom RPC from env when provided', async () => {
    process.env.RPC_ETHEREUM = 'https://custom-rpc.example.com';
    process.env.RPC_ARBITRUM = 'https://custom-arb.example.com';

    const { loadConfig } = await import('../src/config.js');
    const cfg = loadConfig();

    expect(cfg.chainConfigs.ethereum.rpc).toBe('https://custom-rpc.example.com');
    expect(cfg.chainConfigs.arbitrum.rpc).toBe('https://custom-arb.example.com');
    // base should still use default
    expect(cfg.chainConfigs.base.rpc).toBe('https://mainnet.base.org');
  });

  it('reads custom env values', async () => {
    process.env.CHAINS = 'arbitrum,base';
    process.env.PAIRS = 'ETH/USDC';
    process.env.POLL_INTERVAL_MS = '5000';
    process.env.PRICE_HISTORY_DAYS = '7';
    process.env.MIN_GROSS_SPREAD_PCT = '0.10';
    process.env.MIN_NET_SPREAD_PCT = '0.05';
    process.env.SIM_TRADE_SIZES = '1000,2000';
    process.env.SIM_SLIPPAGE_TOLERANCE_PCT = '1.0';
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_CHAT_ID = '12345';
    process.env.ALERT_MIN_SPREAD_PCT = '0.25';
    process.env.ALERT_COOLDOWN_SECONDS = '600';
    process.env.PORT = '4000';

    const { loadConfig } = await import('../src/config.js');
    const cfg = loadConfig();

    expect(cfg.chains).toEqual(['arbitrum', 'base']);
    expect(cfg.pairs).toEqual([{ base: 'ETH', quote: 'USDC', symbol: 'ETH/USDC' }]);
    expect(cfg.pollIntervalMs).toBe(5000);
    expect(cfg.priceHistoryDays).toBe(7);
    expect(cfg.minGrossSpreadPct).toBe(0.10);
    expect(cfg.minNetSpreadPct).toBe(0.05);
    expect(cfg.simTradeSizes).toEqual([1000, 2000]);
    expect(cfg.simSlippageTolerancePct).toBe(1.0);
    expect(cfg.telegramBotToken).toBe('test-token');
    expect(cfg.telegramChatId).toBe('12345');
    expect(cfg.alertMinSpreadPct).toBe(0.25);
    expect(cfg.alertCooldownSeconds).toBe(600);
    expect(cfg.port).toBe(4000);

    // Only 2 chains in chainConfigs
    expect(Object.keys(cfg.chainConfigs)).toEqual(['arbitrum', 'base']);
  });

  it('handles unknown chain gracefully', async () => {
    process.env.CHAINS = 'ethereum,polygon';

    const { loadConfig } = await import('../src/config.js');
    const cfg = loadConfig();

    expect(cfg.chains).toEqual(['ethereum', 'polygon']);
    expect(cfg.chainConfigs.polygon.name).toBe('polygon');
    expect(cfg.chainConfigs.polygon.rpc).toBeNull();
    expect(cfg.chainConfigs.polygon.chainId).toBeNull();
    expect(cfg.chainConfigs.polygon.tokens).toEqual({});
  });

  it('handles empty env vars by using defaults', async () => {
    process.env.CHAINS = '';
    process.env.PAIRS = '';
    process.env.POLL_INTERVAL_MS = '';
    process.env.MIN_GROSS_SPREAD_PCT = '';

    const { loadConfig } = await import('../src/config.js');
    const cfg = loadConfig();

    // Empty string → fallback to defaults
    expect(cfg.chains).toEqual(['ethereum', 'arbitrum', 'base']);
    expect(cfg.pairs).toHaveLength(2);
    expect(cfg.pollIntervalMs).toBe(15000);
    expect(cfg.minGrossSpreadPct).toBe(0.05);
  });

  it('handles non-numeric env vars by using defaults', async () => {
    process.env.POLL_INTERVAL_MS = 'abc';
    process.env.MIN_GROSS_SPREAD_PCT = 'notanumber';
    process.env.PORT = 'xyz';

    const { loadConfig } = await import('../src/config.js');
    const cfg = loadConfig();

    expect(cfg.pollIntervalMs).toBe(15000);
    expect(cfg.minGrossSpreadPct).toBe(0.05);
    expect(cfg.port).toBe(3000);
  });

  it('exports loadConfig as a named export', async () => {
    const mod = await import('../src/config.js');
    expect(typeof mod.loadConfig).toBe('function');
  });

  it('tokenAddresses on default config matches TOKEN_ADDRESSES', async () => {
    const { default: config, TOKEN_ADDRESSES } = await import('../src/config.js');
    expect(config.tokenAddresses).toBe(TOKEN_ADDRESSES);
  });
});
