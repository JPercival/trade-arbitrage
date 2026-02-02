import config, { TOKEN_ADDRESSES, CHAIN_IDS } from '../config.js';

const PARASWAP_BASE = 'https://api.paraswap.io/prices';
const FETCH_TIMEOUT_MS = 10_000;

// Token decimals (standard across all chains)
const TOKEN_DECIMALS = {
  WETH: 18,
  USDC: 6,
  WBTC: 8,
};

// Map pair token names to registry names (same as defillama)
const TOKEN_NAME_MAP = {
  ETH: 'WETH',
  BTC: 'WBTC',
  WETH: 'WETH',
  WBTC: 'WBTC',
  USDC: 'USDC',
};

/**
 * Get the registry name for a pair token.
 */
function registryName(token) {
  return TOKEN_NAME_MAP[token] || token;
}

/**
 * Build the query URL for a ParaSwap price quote.
 *
 * @param {object} params
 * @param {string} params.srcToken - Source token address
 * @param {string} params.destToken - Destination token address
 * @param {string} params.amount - Amount in smallest unit (wei, etc.)
 * @param {number} params.srcDecimals - Source token decimals
 * @param {number} params.destDecimals - Destination token decimals
 * @param {number} params.network - Chain ID
 * @returns {string} Full URL
 */
export function buildQuoteUrl(params) {
  const qs = new URLSearchParams({
    srcToken: params.srcToken,
    destToken: params.destToken,
    amount: params.amount,
    srcDecimals: String(params.srcDecimals),
    destDecimals: String(params.destDecimals),
    network: String(params.network),
    side: 'SELL',
  });
  return `${PARASWAP_BASE}?${qs.toString()}`;
}

/**
 * Parse a ParaSwap price response into a normalized quote object.
 *
 * @param {object} data - Raw ParaSwap API response
 * @returns {{ destAmount: string, gasCostUSD: string, srcToken: string, destToken: string, srcAmount: string, bestRoute: Array }} Parsed quote
 */
export function parseQuoteResponse(data) {
  if (!data || !data.priceRoute) {
    throw new ParaSwapError('Missing priceRoute in response', 'MALFORMED_RESPONSE');
  }

  const route = data.priceRoute;

  return {
    srcToken: route.srcToken,
    destToken: route.destToken,
    srcAmount: route.srcAmount,
    destAmount: route.destAmount,
    srcDecimals: route.srcDecimals,
    destDecimals: route.destDecimals,
    gasCostUSD: route.gasCostUSD ?? '0',
    bestRoute: route.bestRoute ?? [],
  };
}

/**
 * Calculate the effective price per token from a ParaSwap quote.
 *
 * For a buy leg (USDC → TOKEN): price = srcAmount_human / destAmount_human
 *   → i.e., how many USDC per 1 token
 *
 * For a sell leg (TOKEN → USDC): price = destAmount_human / srcAmount_human
 *   → i.e., how many USDC per 1 token
 *
 * @param {object} quote - Parsed quote from parseQuoteResponse
 * @param {'buy'|'sell'} side - Which leg of the arb
 * @returns {number} Effective price in quote currency (USDC) per token
 */
export function calculateEffectivePrice(quote, side) {
  const srcHuman = Number(quote.srcAmount) / 10 ** quote.srcDecimals;
  const destHuman = Number(quote.destAmount) / 10 ** quote.destDecimals;

  if (side === 'buy') {
    // USDC → TOKEN: price = USDC spent / tokens received
    if (destHuman === 0) return 0;
    return srcHuman / destHuman;
  } else {
    // TOKEN → USDC: price = USDC received / tokens sold
    if (srcHuman === 0) return 0;
    return destHuman / srcHuman;
  }
}

/**
 * Fetch a swap quote from ParaSwap.
 *
 * @param {object} params
 * @param {string} params.chain - Chain name (ethereum, arbitrum, base)
 * @param {string} params.srcToken - Source token registry name (e.g., "USDC", "WETH")
 * @param {string} params.destToken - Destination token registry name
 * @param {number} params.amount - Amount in human-readable units (e.g., 10000 for $10K USDC)
 * @param {number} params.timeoutMs - Fetch timeout (default 10000)
 * @param {typeof globalThis.fetch} params.fetchFn - Fetch implementation (for testing)
 * @returns {Promise<object>} Parsed and enriched quote
 */
export async function fetchQuote(params) {
  const {
    chain,
    srcToken,
    destToken,
    amount,
    timeoutMs = FETCH_TIMEOUT_MS,
    fetchFn = globalThis.fetch,
    _tokenAddresses = TOKEN_ADDRESSES,
    _chainIds = CHAIN_IDS,
    _tokenDecimals = TOKEN_DECIMALS,
  } = params;

  const chainId = _chainIds[chain];
  if (!chainId) {
    throw new ParaSwapError(`Unknown chain: ${chain}`, 'INVALID_CHAIN');
  }

  const chainTokens = _tokenAddresses[chain];
  if (!chainTokens) {
    throw new ParaSwapError(`No token addresses for chain: ${chain}`, 'INVALID_CHAIN');
  }

  const srcRegistryName = registryName(srcToken);
  const destRegistryName = registryName(destToken);

  const srcAddress = chainTokens[srcRegistryName];
  const destAddress = chainTokens[destRegistryName];

  if (!srcAddress) {
    throw new ParaSwapError(
      `Token ${srcToken} not found on ${chain}`,
      'INVALID_TOKEN'
    );
  }
  if (!destAddress) {
    throw new ParaSwapError(
      `Token ${destToken} not found on ${chain}`,
      'INVALID_TOKEN'
    );
  }

  const srcDecimals = _tokenDecimals[srcRegistryName];
  const destDecimals = _tokenDecimals[destRegistryName];

  if (srcDecimals === undefined || destDecimals === undefined) {
    throw new ParaSwapError(
      `Unknown decimals for ${srcToken} or ${destToken}`,
      'INVALID_TOKEN'
    );
  }

  // Convert human amount to smallest unit
  const amountSmallest = BigInt(Math.round(amount * 10 ** srcDecimals)).toString();

  const url = buildQuoteUrl({
    srcToken: srcAddress,
    destToken: destAddress,
    amount: amountSmallest,
    srcDecimals,
    destDecimals,
    network: chainId,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (response.status === 429) {
      throw new ParaSwapError('Rate limited (429)', 'RATE_LIMITED');
    }

    if (!response.ok) {
      throw new ParaSwapError(
        `HTTP ${response.status}: ${response.statusText}`,
        'HTTP_ERROR'
      );
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new ParaSwapError('Malformed JSON response', 'MALFORMED_RESPONSE');
    }

    const quote = parseQuoteResponse(data);
    return quote;
  } catch (err) {
    if (err instanceof ParaSwapError) throw err;

    if (err.name === 'AbortError') {
      throw new ParaSwapError(
        `Request timed out after ${timeoutMs}ms`,
        'TIMEOUT'
      );
    }

    throw new ParaSwapError(`Fetch failed: ${err.message}`, 'NETWORK_ERROR');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Get a full arb quote for a token pair on a given chain.
 * Fetches both legs: buy (USDC→TOKEN) and sell (TOKEN→USDC).
 *
 * @param {object} params
 * @param {string} params.chain - Chain name
 * @param {string} params.pair - Pair symbol (e.g., "ETH/USDC")
 * @param {number} params.tradeSize - Trade size in USDC
 * @param {number} params.timeoutMs - Timeout per request
 * @param {typeof globalThis.fetch} params.fetchFn - Fetch implementation
 * @returns {Promise<{ buy: object, sell: object, buyPrice: number, sellPrice: number, gasCostUSD: number }>}
 */
export async function fetchArbQuote(params) {
  const {
    chain,
    pair,
    tradeSize,
    timeoutMs = FETCH_TIMEOUT_MS,
    fetchFn = globalThis.fetch,
  } = params;

  const [baseToken, quoteToken] = pair.split('/');
  const baseRegistryName = registryName(baseToken);

  // Leg 1: Buy — USDC → TOKEN
  const buyQuote = await fetchQuote({
    chain,
    srcToken: quoteToken,
    destToken: baseToken,
    amount: tradeSize,
    timeoutMs,
    fetchFn,
  });

  const buyPrice = calculateEffectivePrice(buyQuote, 'buy');

  // Determine how many tokens we'd get from buy leg
  const tokensReceived =
    Number(buyQuote.destAmount) / 10 ** buyQuote.destDecimals;

  // Leg 2: Sell — TOKEN → USDC (selling the tokens we "bought")
  const sellQuote = await fetchQuote({
    chain,
    srcToken: baseToken,
    destToken: quoteToken,
    amount: tokensReceived,
    timeoutMs,
    fetchFn,
  });

  const sellPrice = calculateEffectivePrice(sellQuote, 'sell');

  const gasCostUSD =
    parseFloat(buyQuote.gasCostUSD) + parseFloat(sellQuote.gasCostUSD);

  return {
    buy: buyQuote,
    sell: sellQuote,
    buyPrice,
    sellPrice,
    gasCostUSD,
  };
}

/**
 * Custom error class for ParaSwap errors.
 */
export class ParaSwapError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ParaSwapError';
    this.code = code;
  }
}
