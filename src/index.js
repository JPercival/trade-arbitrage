// Entry point — will start monitor + web server in future tasks.
// For now, just validate that config loads correctly.

import config from './config.js';

console.log(`trade-arbitrage starting...`);
console.log(`Chains: ${config.chains.join(', ')}`);
console.log(`Pairs: ${config.pairs.map((p) => p.symbol).join(', ')}`);
console.log(`Poll interval: ${config.pollIntervalMs}ms`);
console.log(`Dashboard port: ${config.port}`);
