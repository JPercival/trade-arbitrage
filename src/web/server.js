/**
 * Express Web Server — ARB-9, ARB-13
 *
 * Exports the Express app for testing.
 * Starts listening if run directly or called from index.js via startServer().
 */

import express from 'express';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { setupAuth, requireAuth } from './auth.js';
import { createRoutes } from './routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const START_TIME = Date.now();

function createApp(db) {
  const app = express();

  // ── Trust Railway's reverse proxy (needed for secure cookies, correct req.ip) ──
  app.set('trust proxy', 1);

  // ── EJS setup ──────────────────────────────────────────────────────────────
  app.set('view engine', 'ejs');
  app.set('views', resolve(__dirname, 'views'));

  // ── Body parsing ───────────────────────────────────────────────────────────
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // ── Auth setup ─────────────────────────────────────────────────────────────
  setupAuth(app);

  // ── Health check — NO auth ─────────────────────────────────────────────────
  app.get('/api/health', (req, res) => {
    const lastPrice = db.db.prepare(
      'SELECT MAX(timestamp) as last_poll FROM prices',
    ).get();

    res.json({
      status: 'ok',
      uptime: Math.floor((Date.now() - START_TIME) / 1000),
      lastPollTime: lastPrice?.last_poll || null,
      lastPollAge: lastPrice?.last_poll
        ? Math.floor((Date.now() - lastPrice.last_poll) / 1000)
        : null,
      timestamp: Date.now(),
    });
  });

  // ── Protected routes ───────────────────────────────────────────────────────
  app.use(requireAuth);

  const routes = createRoutes(db);
  app.use(routes);

  // ── Error handling ─────────────────────────────────────────────────────────
  app.use((err, req, res, _next) => {
    console.error('Server error:', err);
    const status = err.status || 500;
    if (req.path.startsWith('/api/')) {
      return res.status(status).json({ error: err.message || 'Internal server error' });
    }
    res.status(status).render('error', {
      title: 'Error',
      message: err.message || 'Something went wrong',
      status,
      user: req.user || null,
    });
  });

  return app;
}

function startServer(db, port = 3000) {
  const app = createApp(db);
  const host = process.env.HOST || '0.0.0.0';
  const server = app.listen(port, host, () => {
    console.log(`Dashboard running at http://${host}:${port}`);
  });
  return server;
}

export { createApp, startServer };
export default createApp;
