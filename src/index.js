/**
 * Entry Point — Cross-Chain Arbitrage Paper Trader
 *
 * 1. Initializes the database
 * 2. Starts the price monitor
 * 3. Logs startup info
 * 4. Handles SIGINT/SIGTERM for clean shutdown
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';
import AppDatabase from './db.js';
import { createMonitor } from './engine/monitor.js';
import { startServer } from './web/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = resolve(__dirname, '..', 'data', 'arbitrage.sqlite');

function main() {
  console.log('=== Cross-Chain Arbitrage Paper Trader ===');
  console.log(`Chains: ${config.chains.join(', ')}`);
  console.log(`Pairs: ${config.pairs.map((p) => p.symbol).join(', ')}`);
  console.log(`Poll interval: ${config.pollIntervalMs}ms`);
  console.log(`Min gross spread: ${config.minGrossSpreadPct}%`);
  console.log(`Min net spread: ${config.minNetSpreadPct}%`);
  console.log(`Sim trade sizes: $${config.simTradeSizes.join(', $')}`);
  console.log('');

  // Initialize database
  const db = new AppDatabase(DB_PATH);
  console.log(`Database initialized at ${DB_PATH}`);

  // Prune old prices on startup
  const pruned = db.pruneOldPrices();
  if (pruned.changes > 0) {
    console.log(`Pruned ${pruned.changes} old price records`);
  }

  // Start web server
  const server = startServer(db, config.port);

  // Create and start monitor
  const monitor = createMonitor({ db });
  monitor.start();

  // Clean shutdown handler
  function shutdown(signal) {
    console.log(`\nReceived ${signal}, shutting down...`);
    monitor.stop();
    server.close();
    db.close();
    console.log('Goodbye!');
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
