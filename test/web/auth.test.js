/**
 * Tests for src/web/auth.js — ARB-13
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to control env before importing
describe('auth', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Reset module cache between tests
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('isAuthBypassed', () => {
    it('returns true when AUTH_BYPASS=true', async () => {
      process.env.AUTH_BYPASS = 'true';
      const { isAuthBypassed } = await import('../../src/web/auth.js');
      expect(isAuthBypassed()).toBe(true);
    });

    it('returns false when AUTH_BYPASS is not set', async () => {
      delete process.env.AUTH_BYPASS;
      const { isAuthBypassed } = await import('../../src/web/auth.js');
      expect(isAuthBypassed()).toBe(false);
    });

    it('returns false when AUTH_BYPASS=false', async () => {
      process.env.AUTH_BYPASS = 'false';
      const { isAuthBypassed } = await import('../../src/web/auth.js');
      expect(isAuthBypassed()).toBe(false);
    });
  });

  describe('getAllowedEmails', () => {
    it('returns empty array when ALLOWED_EMAILS not set', async () => {
      delete process.env.ALLOWED_EMAILS;
      const { getAllowedEmails } = await import('../../src/web/auth.js');
      expect(getAllowedEmails()).toEqual([]);
    });

    it('parses comma-separated emails', async () => {
      process.env.ALLOWED_EMAILS = 'foo@bar.com, baz@qux.com';
      const { getAllowedEmails } = await import('../../src/web/auth.js');
      expect(getAllowedEmails()).toEqual(['foo@bar.com', 'baz@qux.com']);
    });

    it('lowercases emails', async () => {
      process.env.ALLOWED_EMAILS = 'FOO@Bar.COM';
      const { getAllowedEmails } = await import('../../src/web/auth.js');
      expect(getAllowedEmails()).toEqual(['foo@bar.com']);
    });

    it('filters empty strings', async () => {
      process.env.ALLOWED_EMAILS = ',,,foo@bar.com,,';
      const { getAllowedEmails } = await import('../../src/web/auth.js');
      expect(getAllowedEmails()).toEqual(['foo@bar.com']);
    });
  });

  describe('requireAuth middleware', () => {
    it('passes through when AUTH_BYPASS=true', async () => {
      process.env.AUTH_BYPASS = 'true';
      const { requireAuth } = await import('../../src/web/auth.js');
      const req = { path: '/', isAuthenticated: () => false };
      const res = {};
      const next = vi.fn();
      requireAuth(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('passes through when user is authenticated', async () => {
      delete process.env.AUTH_BYPASS;
      const { requireAuth } = await import('../../src/web/auth.js');
      const req = { path: '/', isAuthenticated: () => true };
      const res = {};
      const next = vi.fn();
      requireAuth(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('returns 401 JSON for unauthenticated API requests', async () => {
      delete process.env.AUTH_BYPASS;
      const { requireAuth } = await import('../../src/web/auth.js');
      const req = { path: '/api/prices/current', isAuthenticated: () => false };
      const jsonFn = vi.fn();
      const statusFn = vi.fn(() => ({ json: jsonFn }));
      const res = { status: statusFn };
      const next = vi.fn();
      requireAuth(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(statusFn).toHaveBeenCalledWith(401);
      expect(jsonFn).toHaveBeenCalledWith({ error: 'Authentication required' });
    });

    it('redirects to /login for unauthenticated page requests', async () => {
      delete process.env.AUTH_BYPASS;
      const { requireAuth } = await import('../../src/web/auth.js');
      const req = { path: '/', isAuthenticated: () => false };
      const redirectFn = vi.fn();
      const res = { redirect: redirectFn };
      const next = vi.fn();
      requireAuth(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(redirectFn).toHaveBeenCalledWith('/login');
    });

    it('works when isAuthenticated is undefined', async () => {
      delete process.env.AUTH_BYPASS;
      const { requireAuth } = await import('../../src/web/auth.js');
      const req = { path: '/' };
      const redirectFn = vi.fn();
      const res = { redirect: redirectFn };
      const next = vi.fn();
      requireAuth(req, res, next);
      expect(redirectFn).toHaveBeenCalledWith('/login');
    });
  });

  describe('setupAuth', () => {
    it('registers session, passport, and auth routes on app', async () => {
      process.env.AUTH_BYPASS = 'true';
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      const { setupAuth } = await import('../../src/web/auth.js');

      const useCalls = [];
      const getCalls = [];
      const app = {
        use: (fn) => useCalls.push(fn),
        get: (path, ...handlers) => getCalls.push({ path, handlers }),
      };

      setupAuth(app);

      // Should have 3 use() calls: session, passport.initialize, passport.session
      expect(useCalls.length).toBe(3);

      // Should register 4 GET routes: /login, /auth/google, /auth/google/callback, /logout
      expect(getCalls.length).toBe(4);
      expect(getCalls.map((c) => c.path)).toEqual([
        '/login',
        '/auth/google',
        '/auth/google/callback',
        '/logout',
      ]);
    });

    it('configures Google strategy when credentials are present', async () => {
      process.env.GOOGLE_CLIENT_ID = 'test-client-id';
      process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
      process.env.GOOGLE_CALLBACK_URL = '/auth/google/callback';
      process.env.ALLOWED_EMAILS = 'test@example.com';
      const { setupAuth } = await import('../../src/web/auth.js');

      const app = {
        use: vi.fn(),
        get: vi.fn(),
      };

      // Should not throw
      setupAuth(app);
      expect(app.use).toHaveBeenCalled();
      expect(app.get).toHaveBeenCalled();
    });
  });

  describe('login route handler', () => {
    it('redirects to / when auth is bypassed', async () => {
      process.env.AUTH_BYPASS = 'true';
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      const { setupAuth } = await import('../../src/web/auth.js');

      const getCalls = {};
      const app = {
        use: vi.fn(),
        get: (path, ...handlers) => {
          getCalls[path] = handlers;
        },
      };
      setupAuth(app);

      const loginHandler = getCalls['/login'][0];
      const req = { isAuthenticated: () => false };
      const redirectFn = vi.fn();
      const renderFn = vi.fn();
      const res = { redirect: redirectFn, render: renderFn };

      loginHandler(req, res);
      expect(redirectFn).toHaveBeenCalledWith('/');
    });

    it('redirects to / when already authenticated', async () => {
      delete process.env.AUTH_BYPASS;
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      const { setupAuth } = await import('../../src/web/auth.js');

      const getCalls = {};
      const app = {
        use: vi.fn(),
        get: (path, ...handlers) => {
          getCalls[path] = handlers;
        },
      };
      setupAuth(app);

      const loginHandler = getCalls['/login'][0];
      const req = { isAuthenticated: () => true };
      const redirectFn = vi.fn();
      const renderFn = vi.fn();
      const res = { redirect: redirectFn, render: renderFn };

      loginHandler(req, res);
      expect(redirectFn).toHaveBeenCalledWith('/');
    });

    it('renders login page when not authenticated', async () => {
      delete process.env.AUTH_BYPASS;
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      const { setupAuth } = await import('../../src/web/auth.js');

      const getCalls = {};
      const app = {
        use: vi.fn(),
        get: (path, ...handlers) => {
          getCalls[path] = handlers;
        },
      };
      setupAuth(app);

      const loginHandler = getCalls['/login'][0];
      const req = { isAuthenticated: () => false };
      const redirectFn = vi.fn();
      const renderFn = vi.fn();
      const res = { redirect: redirectFn, render: renderFn };

      loginHandler(req, res);
      expect(renderFn).toHaveBeenCalledWith('login', { title: 'Sign In' });
    });
  });

  describe('logout route handler', () => {
    it('calls logout, destroys session, and redirects', async () => {
      process.env.AUTH_BYPASS = 'true';
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      const { setupAuth } = await import('../../src/web/auth.js');

      const getCalls = {};
      const app = {
        use: vi.fn(),
        get: (path, ...handlers) => {
          getCalls[path] = handlers;
        },
      };
      setupAuth(app);

      const logoutHandler = getCalls['/logout'][0];
      const destroyFn = vi.fn((cb) => cb());
      const logoutFn = vi.fn((cb) => cb());
      const req = { logout: logoutFn, session: { destroy: destroyFn } };
      const redirectFn = vi.fn();
      const res = { redirect: redirectFn };

      logoutHandler(req, res);
      expect(logoutFn).toHaveBeenCalled();
      expect(destroyFn).toHaveBeenCalled();
      expect(redirectFn).toHaveBeenCalledWith('/login');
    });

    it('handles missing logout function gracefully', async () => {
      process.env.AUTH_BYPASS = 'true';
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      const { setupAuth } = await import('../../src/web/auth.js');

      const getCalls = {};
      const app = {
        use: vi.fn(),
        get: (path, ...handlers) => {
          getCalls[path] = handlers;
        },
      };
      setupAuth(app);

      const logoutHandler = getCalls['/logout'][0];
      const destroyFn = vi.fn((cb) => cb());
      const req = { session: { destroy: destroyFn } };
      const redirectFn = vi.fn();
      const res = { redirect: redirectFn };

      logoutHandler(req, res);
      expect(destroyFn).toHaveBeenCalled();
      expect(redirectFn).toHaveBeenCalledWith('/login');
    });

    it('handles completely empty req gracefully', async () => {
      process.env.AUTH_BYPASS = 'true';
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      const { setupAuth } = await import('../../src/web/auth.js');

      const getCalls = {};
      const app = {
        use: vi.fn(),
        get: (path, ...handlers) => {
          getCalls[path] = handlers;
        },
      };
      setupAuth(app);

      const logoutHandler = getCalls['/logout'][0];
      const req = {};
      const redirectFn = vi.fn();
      const res = { redirect: redirectFn };

      // Should not throw
      logoutHandler(req, res);
      expect(redirectFn).toHaveBeenCalledWith('/login');
    });
  });

  describe('Google callback route handler', () => {
    it('redirects to / on successful auth', async () => {
      process.env.AUTH_BYPASS = 'true';
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      const { setupAuth } = await import('../../src/web/auth.js');

      const getCalls = {};
      const app = {
        use: vi.fn(),
        get: (path, ...handlers) => {
          getCalls[path] = handlers;
        },
      };
      setupAuth(app);

      // The callback route has 2 handlers: passport.authenticate and the redirect
      const callbackHandlers = getCalls['/auth/google/callback'];
      expect(callbackHandlers.length).toBe(2);

      // Test the success handler (second handler)
      const successHandler = callbackHandlers[1];
      const redirectFn = vi.fn();
      const res = { redirect: redirectFn };
      successHandler({}, res);
      expect(redirectFn).toHaveBeenCalledWith('/');
    });
  });

  describe('Google Strategy verify callback', () => {
    it('allows email in allowlist', async () => {
      process.env.GOOGLE_CLIENT_ID = 'test-id';
      process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
      process.env.ALLOWED_EMAILS = 'allowed@example.com';

      // We need to access the verify callback from passport strategy
      // Mock passport to capture the strategy
      const strategies = {};
      vi.doMock('passport', () => ({
        default: {
          serializeUser: vi.fn(),
          deserializeUser: vi.fn(),
          use: (strategy) => {
            strategies.google = strategy;
          },
          initialize: () => vi.fn(),
          session: () => vi.fn(),
          authenticate: vi.fn(),
        },
      }));

      // Need to capture the verify function from GoogleStrategy constructor
      let verifyFn;
      vi.doMock('passport-google-oauth20', () => ({
        Strategy: class {
          constructor(opts, verify) {
            this.name = 'google';
            verifyFn = verify;
          }
        },
      }));

      const { configurePassport } = await import('../../src/web/auth.js');
      configurePassport();

      expect(verifyFn).toBeDefined();

      // Test allowed email
      const done = vi.fn();
      const profile = {
        id: '123',
        displayName: 'Test User',
        emails: [{ value: 'allowed@example.com' }],
        photos: [{ value: 'http://photo.jpg' }],
      };
      verifyFn('access', 'refresh', profile, done);
      expect(done).toHaveBeenCalledWith(null, {
        id: '123',
        email: 'allowed@example.com',
        name: 'Test User',
        avatar: 'http://photo.jpg',
      });
    });

    it('rejects email not in allowlist', async () => {
      process.env.GOOGLE_CLIENT_ID = 'test-id';
      process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
      process.env.ALLOWED_EMAILS = 'allowed@example.com';

      let verifyFn;
      vi.doMock('passport', () => ({
        default: {
          serializeUser: vi.fn(),
          deserializeUser: vi.fn(),
          use: vi.fn(),
          initialize: () => vi.fn(),
          session: () => vi.fn(),
        },
      }));
      vi.doMock('passport-google-oauth20', () => ({
        Strategy: class {
          constructor(opts, verify) {
            this.name = 'google';
            verifyFn = verify;
          }
        },
      }));

      const { configurePassport } = await import('../../src/web/auth.js');
      configurePassport();

      const done = vi.fn();
      const profile = {
        id: '456',
        displayName: 'Bad User',
        emails: [{ value: 'notallowed@example.com' }],
        photos: [],
      };
      verifyFn('access', 'refresh', profile, done);
      expect(done).toHaveBeenCalledWith(null, false, { message: 'Email not in allowlist' });
    });

    it('allows any email when ALLOWED_EMAILS is empty', async () => {
      process.env.GOOGLE_CLIENT_ID = 'test-id';
      process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
      delete process.env.ALLOWED_EMAILS;

      let verifyFn;
      vi.doMock('passport', () => ({
        default: {
          serializeUser: vi.fn(),
          deserializeUser: vi.fn(),
          use: vi.fn(),
          initialize: () => vi.fn(),
          session: () => vi.fn(),
        },
      }));
      vi.doMock('passport-google-oauth20', () => ({
        Strategy: class {
          constructor(opts, verify) {
            this.name = 'google';
            verifyFn = verify;
          }
        },
      }));

      const { configurePassport } = await import('../../src/web/auth.js');
      configurePassport();

      const done = vi.fn();
      const profile = {
        id: '789',
        displayName: 'Any User',
        emails: [{ value: 'anyone@example.com' }],
        photos: [],
      };
      verifyFn('access', 'refresh', profile, done);
      expect(done).toHaveBeenCalledWith(null, expect.objectContaining({
        email: 'anyone@example.com',
      }));
    });

    it('handles profile without email or photos', async () => {
      process.env.GOOGLE_CLIENT_ID = 'test-id';
      process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
      delete process.env.ALLOWED_EMAILS;

      let verifyFn;
      vi.doMock('passport', () => ({
        default: {
          serializeUser: vi.fn(),
          deserializeUser: vi.fn(),
          use: vi.fn(),
          initialize: () => vi.fn(),
          session: () => vi.fn(),
        },
      }));
      vi.doMock('passport-google-oauth20', () => ({
        Strategy: class {
          constructor(opts, verify) {
            this.name = 'google';
            verifyFn = verify;
          }
        },
      }));

      const { configurePassport } = await import('../../src/web/auth.js');
      configurePassport();

      const done = vi.fn();
      const profile = {
        id: '999',
        displayName: 'No Email',
        emails: [],
        photos: null,
      };
      verifyFn('access', 'refresh', profile, done);
      expect(done).toHaveBeenCalledWith(null, {
        id: '999',
        email: '',
        name: 'No Email',
        avatar: null,
      });
    });
  });

  describe('passport serialize/deserialize', () => {
    it('serialize and deserialize pass user through', async () => {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;

      let serializeFn, deserializeFn;
      vi.doMock('passport', () => ({
        default: {
          serializeUser: (fn) => { serializeFn = fn; },
          deserializeUser: (fn) => { deserializeFn = fn; },
          use: vi.fn(),
          initialize: () => vi.fn(),
          session: () => vi.fn(),
        },
      }));
      vi.doMock('passport-google-oauth20', () => ({
        Strategy: class { constructor() { this.name = 'google'; } },
      }));

      const { configurePassport } = await import('../../src/web/auth.js');
      configurePassport();

      const user = { id: '1', email: 'test@test.com' };

      // Test serialize
      const serDone = vi.fn();
      serializeFn(user, serDone);
      expect(serDone).toHaveBeenCalledWith(null, user);

      // Test deserialize
      const desDone = vi.fn();
      deserializeFn(user, desDone);
      expect(desDone).toHaveBeenCalledWith(null, user);
    });
  });
});
