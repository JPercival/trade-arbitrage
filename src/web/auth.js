/**
 * Google OAuth Authentication — ARB-13
 *
 * Uses passport-google-oauth20 for login.
 * AUTH_BYPASS=true skips all auth (local dev).
 * ALLOWED_EMAILS restricts access to a comma-separated email list.
 */

import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import session from 'express-session';

// ── Config helpers ─────────────────────────────────────────────────────────────

function isAuthBypassed() {
  return process.env.AUTH_BYPASS === 'true';
}

function getAllowedEmails() {
  const raw = process.env.ALLOWED_EMAILS || '';
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// ── Passport setup ─────────────────────────────────────────────────────────────

function configurePassport() {
  passport.serializeUser((user, done) => {
    done(null, user);
  });

  passport.deserializeUser((user, done) => {
    done(null, user);
  });

  const clientID = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const callbackURL = process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback';

  if (clientID && clientSecret) {
    passport.use(
      new GoogleStrategy(
        { clientID, clientSecret, callbackURL },
        (accessToken, refreshToken, profile, done) => {
          const email = profile.emails?.[0]?.value?.toLowerCase() || '';
          const allowed = getAllowedEmails();

          if (allowed.length > 0 && !allowed.includes(email)) {
            return done(null, false, { message: 'Email not in allowlist' });
          }

          const user = {
            id: profile.id,
            email,
            name: profile.displayName,
            avatar: profile.photos?.[0]?.value || null,
          };
          return done(null, user);
        },
      ),
    );
  }
}

// ── Middleware ──────────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (isAuthBypassed()) return next();
  if (req.isAuthenticated?.()) return next();
  // API routes get 401 JSON; pages redirect to login
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  return res.redirect('/login');
}

// ── Mount auth on Express app ──────────────────────────────────────────────────

function setupAuth(app) {
  const sessionSecret = process.env.SESSION_SECRET || 'dev-secret-change-me';

  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 1 week
      },
    }),
  );

  app.use(passport.initialize());
  app.use(passport.session());

  configurePassport();

  // ── Auth routes ──────────────────────────────────────────────────────────

  app.get('/login', (req, res) => {
    if (isAuthBypassed() || req.isAuthenticated?.()) {
      return res.redirect('/');
    }
    res.render('login', { title: 'Sign In' });
  });

  app.get('/auth/google', (req, res, next) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.redirect('/login?error=oauth_not_configured');
    }
    passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
  });

  app.get('/auth/google/callback', (req, res, next) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.redirect('/login?error=oauth_not_configured');
    }
    passport.authenticate('google', { failureRedirect: '/login?error=denied' })(req, res, () => {
      res.redirect('/');
    });
  });

  app.get('/logout', (req, res) => {
    if (req.logout) {
      req.logout((err) => {
        req.session?.destroy?.(() => {});
        res.redirect('/login');
      });
    } else {
      req.session?.destroy?.(() => {});
      res.redirect('/login');
    }
  });
}

export {
  setupAuth,
  requireAuth,
  isAuthBypassed,
  getAllowedEmails,
  configurePassport,
};
