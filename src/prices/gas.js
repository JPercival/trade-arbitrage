/**
 * Gas Price Fetcher — ARB-5
 *
 * Fetches live gas prices from each configured chain via ethers.js,
 * converts to USD using ETH price, and estimates swap costs.
 *
 * For L2s (Arbitrum, Base), ethers getFeeData() accounts for L1 data costs.
 */

import { ethers } from 'ethers';
import config from '../config.js';

// ── Constants ──────────────────────────────────────────────────────────────────

/** Approximate gas units for a DEX swap */
const DEFAULT_SWAP_GAS_UNITS = 200_000n;

/** RPC timeout in milliseconds */
const RPC_TIMEOUT_MS = 10_000;

// ── Provider Cache ─────────────────────────────────────────────────────────────

const providerCache = new Map();

/**
 * Get or create a JsonRpcProvider for the given chain.
 * Uses FetchRequest with a timeout for resilience.
 */
export function getProvider(chain) {
  if (providerCache.has(chain)) {
    return providerCache.get(chain);
  }

  const chainConfig = config.chainConfigs[chain];
  if (!chainConfig?.rpc) {
    throw new Error(`No RPC configured for chain: ${chain}`);
  }

  const fetchReq = new ethers.FetchRequest(chainConfig.rpc);
  fetchReq.timeout = RPC_TIMEOUT_MS;

  const provider = new ethers.JsonRpcProvider(fetchReq, chainConfig.chainId, {
    staticNetwork: true,
  });

  providerCache.set(chain, provider);
  return provider;
}

/**
 * Clear the provider cache (useful for testing).
 */
export function clearProviderCache() {
  providerCache.clear();
}

// ── Core Functions ─────────────────────────────────────────────────────────────

/**
 * Fetch gas price data for a single chain.
 *
 * @param {string} chain - Chain name (e.g. 'ethereum', 'arbitrum', 'base')
 * @param {object} [options]
 * @param {number} [options.ethPriceUsd] - Current ETH price in USD. Required for USD estimates.
 * @param {bigint} [options.swapGasUnits] - Gas units to estimate for a swap (default: 200K)
 * @param {ethers.JsonRpcProvider} [options.provider] - Override provider (for testing)
 * @returns {Promise<{chain: string, gasPriceGwei: number, gasEstimateUsd: number|null}>}
 */
export async function fetchGasPrice(chain, options = {}) {
  const { ethPriceUsd = null, swapGasUnits = DEFAULT_SWAP_GAS_UNITS, provider: providerOverride } = options;

  const provider = providerOverride || getProvider(chain);

  const feeData = await provider.getFeeData();

  // Use maxFeePerGas (EIP-1559) if available, fall back to gasPrice (legacy)
  const gasPriceWei = feeData.maxFeePerGas ?? feeData.gasPrice;

  if (gasPriceWei == null) {
    throw new Error(`No gas price data returned for chain: ${chain}`);
  }

  // Convert wei → gwei (1 gwei = 1e9 wei)
  const gasPriceGwei = Number(gasPriceWei) / 1e9;

  // Estimate swap cost in USD if ETH price is provided
  let gasEstimateUsd = null;
  if (ethPriceUsd != null) {
    // cost = gas_price_wei × gas_units → wei total, convert to ETH then to USD
    const gasCostWei = gasPriceWei * swapGasUnits;
    const gasCostEth = Number(gasCostWei) / 1e18;
    gasEstimateUsd = gasCostEth * ethPriceUsd;
  }

  return {
    chain,
    gasPriceGwei,
    gasEstimateUsd,
  };
}

/**
 * Fetch gas prices for all configured chains.
 *
 * Calls each chain in parallel. If a chain's RPC fails, its entry includes
 * the error instead of crashing the entire batch.
 *
 * @param {object} [options]
 * @param {number} [options.ethPriceUsd] - Current ETH price in USD
 * @param {bigint} [options.swapGasUnits] - Gas units per swap (default: 200K)
 * @param {function} [options.getProviderForChain] - Override provider factory (for testing)
 * @returns {Promise<Array<{chain: string, gasPriceGwei: number, gasEstimateUsd: number|null, error?: string}>>}
 */
export async function fetchAllGasPrices(options = {}) {
  const { ethPriceUsd, swapGasUnits, getProviderForChain } = options;
  const chains = config.chains;

  const results = await Promise.allSettled(
    chains.map((chain) => {
      const perChainOpts = { ethPriceUsd, swapGasUnits };
      if (getProviderForChain) {
        perChainOpts.provider = getProviderForChain(chain);
      }
      return fetchGasPrice(chain, perChainOpts);
    })
  );

  return results.map((result, i) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    return {
      chain: chains[i],
      gasPriceGwei: null,
      gasEstimateUsd: null,
      error: result.reason?.message || 'Unknown error',
    };
  });
}
