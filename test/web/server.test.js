/**
 * Tests for src/web/server.js — ARB-9, ARB-13 integration
 *
 * Uses real Express app with in-memory DB and AUTH_BYPASS=true.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import AppDatabase from '../../src/db.js';

// Force AUTH_BYPASS for integration tests
process.env.AUTH_BYPASS = 'true';

import { createApp, startServer } from '../../src/web/server.js';

function request(app) {
  return {
    async get(path) {
      return new Promise((resolve, reject) => {
        const server = app.listen(0, () => {
          const port = server.address().port;
          fetch(`http://localhost:${port}${path}`)
            .then(async (res) => {
              const text = await res.text();
              let json = null;
              try { json = JSON.parse(text); } catch { /* not JSON */ }
              resolve({
                status: res.status,
                headers: Object.fromEntries(res.headers.entries()),
                text,
                json,
              });
              server.close();
            })
            .catch((err) => {
              server.close();
              reject(err);
            });
        });
      });
    },
  };
}

describe('server integration', () => {
  let db;
  let app;

  beforeEach(() => {
    db = new AppDatabase(':memory:');
    app = createApp(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('health check (no auth)', () => {
    it('GET /api/health returns status ok', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.json.status).toBe('ok');
      expect(res.json.uptime).toBeTypeOf('number');
      expect(res.json.timestamp).toBeTypeOf('number');
    });

    it('includes lastPollTime and lastPollAge', async () => {
      const now = Date.now();
      db.insertPrice({ timestamp: now, chain: 'ethereum', pair: 'ETH/USDC', price: 3000 });
      const res = await request(app).get('/api/health');
      expect(res.json.lastPollTime).toBe(now);
      expect(res.json.lastPollAge).toBeTypeOf('number');
      expect(res.json.lastPollAge).toBeGreaterThanOrEqual(0);
    });

    it('returns null poll times when no prices exist', async () => {
      const res = await request(app).get('/api/health');
      expect(res.json.lastPollTime).toBeNull();
      expect(res.json.lastPollAge).toBeNull();
    });
  });

  describe('dashboard page', () => {
    it('GET / returns HTML', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Arb Trader');
      expect(res.text).toContain('Dashboard');
    });

    it('GET / shows summary stats', async () => {
      const now = Date.now();
      db.insertPrice({ timestamp: now, chain: 'ethereum', pair: 'ETH/USDC', price: 3000, gas_price_gwei: 25 });
      db.insertSpread({
        detected_at: now,
        pair: 'ETH/USDC',
        buy_chain: 'ethereum',
        sell_chain: 'arbitrum',
        buy_price: 3000,
        sell_price: 3001.5,
        gross_spread_pct: 0.05,
      });
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.text).toContain('ETH/USDC');
    });
  });

  describe('trades page', () => {
    it('GET /trades returns HTML', async () => {
      const res = await request(app).get('/trades');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Filter Trades');
    });

    it('GET /trades with filters', async () => {
      const res = await request(app).get('/trades?pair=ETH/USDC&page=1&limit=10');
      expect(res.status).toBe(200);
    });
  });

  describe('analytics page', () => {
    it('GET /analytics returns HTML with chart.js', async () => {
      const res = await request(app).get('/analytics');
      expect(res.status).toBe(200);
      expect(res.text).toContain('chart.js');
      expect(res.text).toContain('Analytics');
    });
  });

  describe('API endpoints', () => {
    it('GET /api/prices/current returns JSON array', async () => {
      const res = await request(app).get('/api/prices/current');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.json)).toBe(true);
    });

    it('GET /api/spreads returns JSON array', async () => {
      const res = await request(app).get('/api/spreads');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.json)).toBe(true);
    });

    it('GET /api/spreads with status filter', async () => {
      const res = await request(app).get('/api/spreads?status=open');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.json)).toBe(true);
    });

    it('GET /api/trades returns paginated JSON', async () => {
      const res = await request(app).get('/api/trades');
      expect(res.status).toBe(200);
      expect(res.json).toHaveProperty('trades');
      expect(res.json).toHaveProperty('page');
      expect(res.json).toHaveProperty('total');
    });

    it('GET /api/stats/daily returns JSON array', async () => {
      const res = await request(app).get('/api/stats/daily');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.json)).toBe(true);
    });

    it('GET /api/stats/summary returns summary object', async () => {
      const res = await request(app).get('/api/stats/summary');
      expect(res.status).toBe(200);
      expect(res.json).toHaveProperty('totalTrades');
      expect(res.json).toHaveProperty('totalProfit');
    });
  });

  describe('auth routes (bypass mode)', () => {
    it('GET /login redirects to / when bypassed', async () => {
      const res = await request(app).get('/login');
      // Express will redirect, which fetch follows
      expect(res.status).toBe(200);
      expect(res.text).toContain('Dashboard');
    });

    it('GET /logout redirects to /login then /', async () => {
      // In bypass mode, fetch follows redirects: /logout -> /login -> /
      const res = await request(app).get('/logout');
      expect(res.status).toBe(200);
      // The redirect chain ends at the dashboard
      expect(res.text).toContain('Arb Trader');
    });
  });

  describe('startServer', () => {
    it('starts listening on a port', async () => {
      const server = startServer(db, 0);
      await new Promise((resolve) => server.on('listening', resolve));
      const addr = server.address();
      expect(addr.port).toBeGreaterThan(0);

      // Verify it responds
      const res = await fetch(`http://127.0.0.1:${addr.port}/api/health`);
      expect(res.status).toBe(200);

      server.close();
    });
  });

  describe('error handling', () => {
    it('handles errors on API routes with JSON response', async () => {
      // Test via createApp with a custom db that throws
      const errorDb = new AppDatabase(':memory:');
      const errorApp = createApp(errorDb);

      // We need to add error routes before the error handler.
      // Instead, let's test by making the DB throw on a known route.
      // Override the db.db.prepare to throw for a specific query
      const origPrepare = errorDb.db.prepare.bind(errorDb.db);
      let shouldThrow = false;
      errorDb.db.prepare = (sql) => {
        if (shouldThrow && sql.includes('prices')) {
          throw new Error('DB exploded');
        }
        return origPrepare(sql);
      };

      shouldThrow = true;
      const res = await request(errorApp).get('/api/prices/current');
      expect(res.status).toBe(500);
      // Express 5 catches route errors and forwards them to error handler
      expect(res.text).toContain('DB exploded');

      errorDb.db.prepare = origPrepare;
      errorDb.close();
    });

    it('handles errors on page routes with error view', async () => {
      const errorDb = new AppDatabase(':memory:');
      const errorApp = createApp(errorDb);

      const origPrepare = errorDb.db.prepare.bind(errorDb.db);
      errorDb.db.prepare = (sql) => {
        if (sql.includes('prices')) {
          throw new Error('Page broke');
        }
        return origPrepare(sql);
      };

      const res = await request(errorApp).get('/');
      expect(res.status).toBe(500);
      expect(res.text).toContain('Page broke');

      errorDb.db.prepare = origPrepare;
      errorDb.close();
    });
  });
});
