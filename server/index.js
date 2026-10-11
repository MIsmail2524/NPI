'use strict';
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

require('./db');
const { seedIfEmpty } = require('./seed');
const S = require('./security');
const limits = require('./limits');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const UPLOAD_DIR = process.env.NPI_UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

seedIfEmpty();

const app = express();
app.disable('x-powered-by');
// Behind a reverse proxy (nginx, Cloudflare…) set TRUST_PROXY=1 so rate limits see real client IPs.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

/* ---------- security headers ---------- */
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],                                   // no inline scripts, no eval
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      mediaSrc: ["'self'", 'blob:', 'https:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"],                              // anti-clickjacking
      baseUri: ["'self'"],
      formAction: ["'self'"],
      manifestSrc: ["'self'"],
      workerSrc: ["'self'"],
      ...(S.IS_PROD ? { upgradeInsecureRequests: [] } : {})
    }
  },
  strictTransportSecurity: S.IS_PROD ? { maxAge: 63072000, includeSubDomains: true, preload: false } : false,
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(self), gyroscope=(self)');
  next();
});

app.use(cookieParser());

/* ---------- uploaded media: served inert (no scripts can run from here) ---------- */
app.use('/uploads', (req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
}, express.static(UPLOAD_DIR, { dotfiles: 'deny', index: false, maxAge: '30d', immutable: true }));

/* ---------- API ---------- */
const api = express.Router();
api.use(express.json({ limit: '200kb', strict: true }));
api.use(limits.api);
api.use(S.loadSession);
api.use(S.csrfProtect);
api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
api.use('/auth', require('./routes/auth'));
api.use('/admin', S.requireOwner, require('./routes/admin'));
api.use('/', require('./routes/store'));
api.use((req, res) => res.status(404).json({ error: 'Not found.' }));
app.use('/api', api);

/* ---------- owner dashboard page: only served to a logged-in owner ---------- */
app.get(['/admin', '/admin/'], S.loadSession, (req, res) => {
  if (req.user?.role !== 'owner') return res.redirect(302, '/login?next=/admin');
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(PUBLIC_DIR, 'admin', 'index.html'));
});
app.use('/admin', S.loadSession, (req, res, next) => {
  if (req.user?.role !== 'owner') return res.status(404).end();
  next();
}, express.static(path.join(PUBLIC_DIR, 'admin'), { index: false }));

/* ---------- storefront ---------- */
app.use(express.static(PUBLIC_DIR, { index: false, maxAge: S.IS_PROD ? '1h' : 0 }));
// SPA: every other GET returns the storefront shell; the client router renders the page.
app.get(/^\/(?!api\/|uploads\/).*/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

/* ---------- errors: never leak internals ---------- */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed request.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error(new Date().toISOString(), req.method, req.path, err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong on our side. Please try again.' : err.message, field: err.field });
});

app.listen(PORT, HOST, () => {
  console.log(`NPI Global Trading running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  const { db } = require('./db');
  if (!db.prepare(`SELECT 1 FROM users WHERE role = 'owner'`).get()) {
    console.log('\n  No owner account yet. Create one with:  npm run create-owner\n');
  }
});
