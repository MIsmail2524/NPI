'use strict';
/* ============================================================
   Security core: password hashing, sessions, CSRF, auth guards,
   input validation and audit logging.
   ============================================================ */
const crypto = require('node:crypto');
const { db } = require('./db');

const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_COOKIE = IS_PROD ? '__Host-npi_sid' : 'npi_sid';
const SESSION_IDLE_MS = 1000 * 60 * 60 * 24 * 7;      // 7 days idle (customers)
const OWNER_IDLE_MS = 1000 * 60 * 60 * 8;             // 8 hours idle (owner)
const SESSION_ABSOLUTE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days hard cap
const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 1000 * 60 * 15;

/* ---------------- passwords (scrypt, per-user salt) ---------------- */
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEYLEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  try {
    const [algo, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem
    });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
// Used when the email doesn't exist so response time doesn't reveal which accounts exist.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwerty123',
  'qwertyuiop', '11111111', '00000000', 'abc12345', 'iloveyou', 'admin123', 'welcome1',
  'pakistan', 'pakistan123', 'letmein1', 'football', 'baseball', 'sunshine', 'princess', 'npiglobal'
]);

function passwordProblem(pw, email = '') {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters.';
  if (pw.length > 128) return 'Password is too long (max 128 characters).';
  if (COMMON_PASSWORDS.has(pw.toLowerCase())) return 'That password is too common. Please choose another.';
  if (email && pw.toLowerCase() === String(email).toLowerCase()) return 'Password cannot be your email.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use at least one letter and one number.';
  return null;
}

/* ---------------- tokens ---------------- */
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/* ---------------- sessions ---------------- */
function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax',
    path: '/',
    maxAge
  };
}

function createSession(req, res, user) {
  // Rotate: never reuse a pre-login session (prevents session fixation).
  destroySession(req, res);
  const token = randomToken(32);
  const now = Date.now();
  const csrf = randomToken(24);
  db.prepare(`INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, last_seen_at, expires_at, ip, user_agent)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(sha256(token), user.id, csrf, now, now, now + SESSION_ABSOLUTE_MS,
      String(req.ip || '').slice(0, 64), String(req.get('user-agent') || '').slice(0, 255));
  res.cookie(SESSION_COOKIE, token, cookieOptions(SESSION_ABSOLUTE_MS));
  return csrf;
}

function destroySession(req, res) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(0), maxAge: undefined });
}

function destroyAllSessionsForUser(userId, exceptHash = null) {
  if (exceptHash) db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, exceptHash);
  else db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

/** Middleware: attaches req.user / req.session when a valid session cookie is present. */
function loadSession(req, res, next) {
  req.user = null;
  req.session = null;
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token || typeof token !== 'string' || token.length > 100) return next();
  const hash = sha256(token);
  const row = db.prepare(`
    SELECT s.id AS sid, s.csrf_token, s.last_seen_at, s.expires_at,
           u.id, u.email, u.name, u.phone, u.role, u.disabled
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?`).get(hash);
  const now = Date.now();
  if (!row) { res.clearCookie(SESSION_COOKIE, { path: '/' }); return next(); }
  const idle = row.role === 'owner' ? OWNER_IDLE_MS : SESSION_IDLE_MS;
  if (row.disabled || row.expires_at < now || now - row.last_seen_at > idle) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.sid);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return next();
  }
  if (now - row.last_seen_at > 60_000) {
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now, row.sid);
  }
  req.session = { id: row.sid, csrf: row.csrf_token, tokenHash: hash };
  req.user = { id: row.id, email: row.email, name: row.name, phone: row.phone, role: row.role };
  next();
}

/* ---------------- CSRF + origin check for state-changing requests ---------------- */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function csrfProtect(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  // 1) Origin / Referer must match our own host (blocks cross-site form posts).
  const origin = req.get('origin') || req.get('referer');
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch { host = null; }
    if (!host || host !== req.get('host')) return res.status(403).json({ error: 'Request blocked (origin mismatch).' });
  }
  // 2) Logged-in requests must carry the per-session CSRF token in a header.
  if (req.session) {
    const sent = req.get('x-csrf-token');
    if (!sent || !safeEqual(sent, req.session.csrf)) {
      return res.status(403).json({ error: 'Your session token is missing or expired. Please refresh the page.' });
    }
  }
  next();
}

/* ---------------- guards ---------------- */
function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in first.' });
  next();
}
function requireOwner(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in first.' });
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Owner access only.' });
  next();
}

/* ---------------- account lockout ---------------- */
function registerFailedLogin(user) {
  const fails = user.failed_logins + 1;
  const lockedUntil = fails >= MAX_FAILED_LOGINS ? Date.now() + LOCK_MS : 0;
  db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?')
    .run(lockedUntil ? 0 : fails, lockedUntil, user.id);
}
function clearFailedLogins(userId) {
  db.prepare('UPDATE users SET failed_logins = 0, locked_until = 0, last_login_at = ? WHERE id = ?').run(Date.now(), userId);
}

/* ---------------- validation helpers ----------------
   Every write endpoint whitelists fields through these. They throw
   ValidationError, which the global error handler turns into a 400. */
class ValidationError extends Error {
  constructor(message, field) { super(message); this.status = 400; this.field = field; }
}

// strips control characters (keeps \n and \t where allowed)
function cleanText(v, { max = 200, multiline = false } = {}) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string' && typeof v !== 'number') throw new ValidationError('Invalid text value.');
  let s = String(v).normalize('NFC');
  s = multiline ? s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n')
    : s.replace(/[\u0000-\u001F\u007F]/g, ' ');
  s = s.trim();
  if (s.length > max) throw new ValidationError(`Text is too long (max ${max} characters).`);
  return s;
}

function str(body, key, opts = {}) {
  const s = cleanText(body?.[key], opts);
  if (opts.required && !s) throw new ValidationError(`${opts.label || key} is required.`, key);
  return s;
}

function int(body, key, { min = 0, max = 2_000_000_000, required = false, label = key, def = 0 } = {}) {
  const raw = body?.[key];
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw new ValidationError(`${label} is required.`, key);
    return def;
  }
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''));
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new ValidationError(`${label} must be a whole number.`, key);
  if (n < min || n > max) throw new ValidationError(`${label} must be between ${min} and ${max}.`, key);
  return n;
}

/** Money in minor units. Accepts number (minor units) only — the client converts. */
function money(body, key, opts = {}) {
  return int(body, key, { max: 10_000_000_000 / 100, ...opts });
}

function bool(body, key, def = false) {
  const v = body?.[key];
  if (v === undefined || v === null) return def;
  return v === true || v === 1 || v === '1' || v === 'true';
}

function oneOf(body, key, allowed, def) {
  const v = body?.[key];
  if (v === undefined || v === null || v === '') {
    if (def !== undefined) return def;
    throw new ValidationError(`${key} is required.`, key);
  }
  if (!allowed.includes(v)) throw new ValidationError(`Invalid value for ${key}.`, key);
  return v;
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
function email(body, key = 'email') {
  const s = cleanText(body?.[key], { max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(s)) throw new ValidationError('Please enter a valid email address.', key);
  return s;
}

function phone(body, key = 'phone', required = false) {
  const s = cleanText(body?.[key], { max: 30 });
  if (!s) { if (required) throw new ValidationError('Phone number is required.', key); return ''; }
  if (!/^[+0-9][0-9 ()-]{6,29}$/.test(s)) throw new ValidationError('Please enter a valid phone number.', key);
  return s;
}

/** Only allow site-relative upload paths or https URLs (blocks javascript:, data: etc.). */
function mediaUrl(v) {
  const s = cleanText(v, { max: 500 });
  if (!s) return '';
  if (/^\/uploads\/[A-Za-z0-9_-]{8,64}\.(?:jpg|png|webp|gif|mp4|webm)$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.protocol === 'https:') return u.toString();
  } catch { /* fallthrough */ }
  throw new ValidationError('Media must be an uploaded file or an https:// link.');
}

function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';
}

/* ---------------- audit log ---------------- */
function audit(req, action, entity = '', entityId = '', details = '') {
  db.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(req.user?.id ?? null, action, entity, String(entityId), String(details).slice(0, 1000),
      String(req.ip || '').slice(0, 64), Date.now());
}

/* periodic cleanup of expired sessions */
setInterval(() => {
  try { db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()); } catch { /* ignore */ }
}, 60 * 60 * 1000).unref();

module.exports = {
  IS_PROD, SESSION_COOKIE, hashPassword, verifyPassword, DUMMY_HASH, passwordProblem,
  randomToken, sha256, createSession, destroySession, destroyAllSessionsForUser,
  loadSession, csrfProtect, requireUser, requireOwner, registerFailedLogin, clearFailedLogins,
  MAX_FAILED_LOGINS, ValidationError, cleanText, str, int, money, bool, oneOf, email, phone,
  mediaUrl, slugify, audit
};
