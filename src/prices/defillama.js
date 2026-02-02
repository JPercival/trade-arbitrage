import config, { TOKEN_ADDRESSES } from '../config.js';

const DEFILLAMA_BASE = 'https://coins.llama.fi/prices/current';
const FETCH_TIMEOUT_MS = 10_000;

// DeFi Llama uses its own chain name mapping
const CHAIN_NAME_MAP = {
  ethereum: 'ethereum',
  arbitrum: 'arbitrum',
  base: 'base',
};

/**
 * Build the comma-separated coin key list for the DeFi Llama API.
 * Format: {chain}:{address},{chain}:{address},...
 *
 * @param {string[]} chains - Chain names to include
 * @param {Array<{base: string, quote: string}>} pairs - Trading pairs
 * @returns {string[]} Array of coin keys like "ethereum:0x..."
 */
export function buildCoinKeys(chains = config.chains, pairs = config.pairs) {
  const keys = new Set();

  for (const chain of chains) {
    const llamaChain = CHAIN_NAME_MAP[chain] || chain;
    const chainTokens = TOKEN_ADDRESSES[chain];
    if (!chainTokens) continue;

    for (const pair of pairs) {
      // Map pair base token names to token registry names
      // ETH -> WETH, BTC -> WBTC, etc.
      const tokenName = mapPairTokenToRegistry(pair.base);
      const address = chainTokens[tokenName];
      if (address) {
        keys.add(`${llamaChain}:${address}`);
      }
    }
  }

  return Array.from(keys);
}

/**
 * Map a pair token name (e.g., "ETH") to the token registry name (e.g., "WETH").
 */
function mapPairTokenToRegistry(token) {
  const MAP = {
    ETH: 'WETH',
    BTC: 'WBTC',
    WETH: 'WETH',
    WBTC: 'WBTC',
    USDC: 'USDC',
  };
  return MAP[token] || token;
}

/**
 * Reverse-map: given a chain and address, figure out which pair it belongs to.
 */
function addressToPair(chain, address, pairs = config.pairs) {
  const chainTokens = TOKEN_ADDRESSES[chain];
  if (!chainTokens) return null;

  const lowerAddr = address.toLowerCase();

  for (const [tokenName, tokenAddr] of Object.entries(chainTokens)) {
    if (tokenAddr && tokenAddr.toLowerCase() === lowerAddr) {
      // Find matching pair where this token is the base
      for (const pair of pairs) {
        const registryName = mapPairTokenToRegistry(pair.base);
        if (registryName === tokenName) {
          return pair.symbol; // e.g., "ETH/USDC"
        }
      }
    }
  }
  return null;
}

/**
 * Parse DeFi Llama response into normalized price objects.
 *
 * @param {object} data - Raw DeFi Llama response body
 * @param {object} options
 * @param {number} options.maxAgeSeconds - Reject prices older than this (default from config or 60s)
 * @param {number} options.now - Current timestamp in seconds (for testing)
 * @param {Array} options.pairs - Trading pairs (default from config)
 * @returns {{ prices: Array<{chain: string, pair: string, price: number, timestamp: number}>, stale: Array<{key: string, age: number}> }}
 */
export function parsePrices(data, options = {}) {
  const maxAgeSeconds = options.maxAgeSeconds ?? 60;
  const nowSeconds = options.now ?? Math.floor(Date.now() / 1000);
  const pairs = options.pairs ?? config.pairs;

  const prices = [];
  const stale = [];

  if (!data || !data.coins || typeof data.coins !== 'object') {
    return { prices, stale };
  }

  for (const [coinKey, coinData] of Object.entries(data.coins)) {
    const [llamaChain, address] = splitCoinKey(coinKey);
    if (!llamaChain || !address) continue;

    // Reverse-map chain name
    const chain = reverseChainName(llamaChain);
    if (!chain) continue;

    const pair = addressToPair(chain, address, pairs);
    if (!pair) continue;

    const price = coinData.price;
    const timestamp = coinData.timestamp;

    if (typeof price !== 'number' || typeof timestamp !== 'number') continue;

    // Check staleness
    const age = nowSeconds - timestamp;
    if (age > maxAgeSeconds) {
      stale.push({ key: coinKey, age });
      continue;
    }

    prices.push({
      chain,
      pair,
      price,
      timestamp,
    });
  }

  return { prices, stale };
}

/**
 * Split a coin key like "ethereum:0xABC..." into [chain, address].
 */
function splitCoinKey(coinKey) {
  const idx = coinKey.indexOf(':');
  if (idx === -1) return [null, null];
  return [coinKey.slice(0, idx), coinKey.slice(idx + 1)];
}

/**
 * Reverse-map DeFi Llama chain name to our internal chain name.
 */
function reverseChainName(llamaChain) {
  for (const [internal, external] of Object.entries(CHAIN_NAME_MAP)) {
    if (external === llamaChain) return internal;
  }
  return null;
}

/**
 * Fetch prices from DeFi Llama for all configured tokens/chains.
 *
 * @param {object} options
 * @param {string[]} options.chains - Chains to query (default from config)
 * @param {Array} options.pairs - Trading pairs (default from config)
 * @param {number} options.maxAgeSeconds - Stale price threshold in seconds (default 60)
 * @param {number} options.timeoutMs - Fetch timeout in ms (default 10000)
 * @param {typeof globalThis.fetch} options.fetchFn - Fetch implementation (for testing)
 * @returns {Promise<{ prices: Array<{chain: string, pair: string, price: number, timestamp: number}>, stale: Array }>}
 */
export async function fetchPrices(options = {}) {
  const chains = options.chains ?? config.chains;
  const pairs = options.pairs ?? config.pairs;
  const maxAgeSeconds = options.maxAgeSeconds ?? 60;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const fetchFn = options.fetchFn ?? globalThis.fetch;

  const coinKeys = buildCoinKeys(chains, pairs);
  if (coinKeys.length === 0) {
    return { prices: [], stale: [] };
  }

  const url = `${DEFILLAMA_BASE}/${coinKeys.join(',')}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (response.status === 429) {
      throw new DefiLlamaError('Rate limited (429)', 'RATE_LIMITED');
    }

    if (!response.ok) {
      throw new DefiLlamaError(
        `HTTP ${response.status}: ${response.statusText}`,
        'HTTP_ERROR'
      );
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new DefiLlamaError('Malformed JSON response', 'MALFORMED_RESPONSE');
    }

    return parsePrices(data, { maxAgeSeconds, pairs });
  } catch (err) {
    if (err instanceof DefiLlamaError) throw err;

    if (err.name === 'AbortError') {
      throw new DefiLlamaError(
        `Request timed out after ${timeoutMs}ms`,
        'TIMEOUT'
      );
    }

    throw new DefiLlamaError(`Fetch failed: ${err.message}`, 'NETWORK_ERROR');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Custom error class for DeFi Llama price fetcher errors.
 */
export class DefiLlamaError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'DefiLlamaError';
    this.code = code;
  }
}
