'use strict';
const express = require('express');
const { db } = require('../db');
const S = require('../security');
const limits = require('../limits');

const router = express.Router();

const publicUser = (u) => u && ({ id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role });

router.get('/me', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ user: publicUser(req.user), csrf: req.session?.csrf || null });
});

router.post('/register', limits.register, (req, res) => {
  const name = S.str(req.body, 'name', { max: 80, required: true, label: 'Name' });
  const email = S.email(req.body);
  const phone = S.phone(req.body, 'phone');
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const problem = S.passwordProblem(password, email);
  if (problem) throw new S.ValidationError(problem, 'password');

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) throw new S.ValidationError('An account with this email already exists. Try logging in.', 'email');

  const info = db.prepare(`INSERT INTO users (email, name, phone, password_hash, role, created_at)
                           VALUES (?, ?, ?, ?, 'customer', ?)`)
    .run(email, name, phone, S.hashPassword(password), Date.now());
  const user = { id: Number(info.lastInsertRowid), email, name, phone, role: 'customer' };
  const csrf = S.createSession(req, res, user);
  res.status(201).json({ user: publicUser(user), csrf });
});

router.post('/login', limits.login, (req, res) => {
  const generic = 'Email or password is incorrect.';
  let email;
  try { email = S.email(req.body); } catch { return res.status(401).json({ error: generic }); }
  const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 200) : '';
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  if (!user) {
    S.verifyPassword(password, S.DUMMY_HASH); // equalise timing
    return res.status(401).json({ error: generic });
  }
  if (user.locked_until > Date.now()) {
    const mins = Math.ceil((user.locked_until - Date.now()) / 60000);
    return res.status(429).json({ error: `Too many wrong attempts. This account is locked for ${mins} more minute(s).` });
  }
  if (!S.verifyPassword(password, user.password_hash)) {
    S.registerFailedLogin(user);
    S.audit({ ip: req.ip, user: null }, 'login_failed', 'user', user.id);
    return res.status(401).json({ error: generic });
  }
  if (user.disabled) return res.status(403).json({ error: 'This account has been disabled. Please contact us.' });

  S.clearFailedLogins(user.id);
  const csrf = S.createSession(req, res, user);
  if (user.role === 'owner') S.audit({ ip: req.ip, user }, 'owner_login', 'user', user.id);
  res.json({ user: publicUser(user), csrf });
});

router.post('/logout', (req, res) => {
  S.destroySession(req, res);
  res.json({ ok: true });
});

router.put('/profile', S.requireUser, (req, res) => {
  const name = S.str(req.body, 'name', { max: 80, required: true, label: 'Name' });
  const phone = S.phone(req.body, 'phone');
  db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(name, phone, req.user.id);
  res.json({ user: { ...publicUser(req.user), name, phone } });
});

router.post('/change-password', S.requireUser, (req, res) => {
  const current = typeof req.body?.current === 'string' ? req.body.current : '';
  const next = typeof req.body?.next === 'string' ? req.body.next : '';
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!S.verifyPassword(current, row.password_hash)) throw new S.ValidationError('Current password is incorrect.', 'current');
  const problem = S.passwordProblem(next, req.user.email);
  if (problem) throw new S.ValidationError(problem, 'next');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(S.hashPassword(next), req.user.id);
  // Sign out every other device.
  S.destroyAllSessionsForUser(req.user.id, req.session.tokenHash);
  S.audit(req, 'password_changed', 'user', req.user.id);
  res.json({ ok: true });
});

module.exports = router;
