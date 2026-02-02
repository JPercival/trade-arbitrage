import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '..', '.env') });

// ── Helpers ────────────────────────────────────────────────────────────────────

function envList(key, fallback = '') {
  const raw = process.env[key];
  const value = raw === undefined || raw === '' ? fallback : raw;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function envInt(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return n;
}

function envFloat(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return fallback;
  return n;
}

// ── Token Address Registry ─────────────────────────────────────────────────────
// Hardcoded from ARCHITECTURE.md — native addresses per chain.

const TOKEN_ADDRESSES = {
  ethereum: {
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  },
  arbitrum: {
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    WBTC: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
  },
  base: {
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    WBTC: null, // TBD — verify liquidity per ARCHITECTURE.md
  },
};

// ── Chain Configs ──────────────────────────────────────────────────────────────

const DEFAULT_RPCS = {
  ethereum: 'https://eth.llamarpc.com',
  arbitrum: 'https://arb1.arbitrum.io/rpc',
  base: 'https://mainnet.base.org',
};

const CHAIN_IDS = {
  ethereum: 1,
  arbitrum: 42161,
  base: 8453,
};

function buildChainConfigs(chains) {
  const configs = {};
  for (const chain of chains) {
    const rpcEnvKey = `RPC_${chain.toUpperCase()}`;
    configs[chain] = {
      name: chain,
      rpc: process.env[rpcEnvKey] || DEFAULT_RPCS[chain] || null,
      chainId: CHAIN_IDS[chain] || null,
      tokens: TOKEN_ADDRESSES[chain] || {},
    };
  }
  return configs;
}

// ── Pairs ──────────────────────────────────────────────────────────────────────

function parsePairs(pairList) {
  return pairList.map((p) => {
    const [base, quote] = p.split('/');
    return { base, quote, symbol: p };
  });
}

// ── Build Config Object ────────────────────────────────────────────────────────

function loadConfig() {
  const chains = envList('CHAINS', 'ethereum,arbitrum,base');
  const pairStrings = envList('PAIRS', 'ETH/USDC,WBTC/USDC');

  return {
    // Chains
    chains,
    chainConfigs: buildChainConfigs(chains),

    // Token addresses
    tokenAddresses: TOKEN_ADDRESSES,

    // Pairs
    pairs: parsePairs(pairStrings),

    // Monitoring
    pollIntervalMs: envInt('POLL_INTERVAL_MS', 15000),
    priceHistoryDays: envInt('PRICE_HISTORY_DAYS', 30),

    // Detection thresholds
    minGrossSpreadPct: envFloat('MIN_GROSS_SPREAD_PCT', 0.05),
    minNetSpreadPct: envFloat('MIN_NET_SPREAD_PCT', 0.02),

    // Simulation
    simTradeSizes: envList('SIM_TRADE_SIZES', '5000,10000,20000,50000').map(Number),
    simSlippageTolerancePct: envFloat('SIM_SLIPPAGE_TOLERANCE_PCT', 0.5),

    // Alerts (Telegram) — deferred but parsed
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
    alertMinSpreadPct: envFloat('ALERT_MIN_SPREAD_PCT', 0.15),
    alertCooldownSeconds: envInt('ALERT_COOLDOWN_SECONDS', 300),

    // Web dashboard
    port: envInt('PORT', 3000),
  };
}

const config = loadConfig();

export default config;
export { loadConfig, TOKEN_ADDRESSES, DEFAULT_RPCS, CHAIN_IDS };
