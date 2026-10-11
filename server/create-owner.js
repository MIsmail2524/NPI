'use strict';
/* Creates (or resets the password of) an owner account from the server terminal.
   There is deliberately no default owner password and no web sign-up for owners.
   Usage:  npm run create-owner
   Non-interactive:  OWNER_EMAIL=… OWNER_NAME=… OWNER_PASSWORD=… npm run create-owner */
const readline = require('node:readline');
const { db } = require('./db');
const S = require('./security');

function ask(rl, q, hidden = false) {
  return new Promise((resolve) => {
    if (!hidden) return rl.question(q, resolve);
    const out = rl.output;
    rl.output = { write: (s) => { if (s.includes(q)) out.write(s); } };
    rl.question(q, (a) => { rl.output = out; out.write('\n'); resolve(a); });
  });
}

(async () => {
  let { OWNER_EMAIL: email, OWNER_NAME: name, OWNER_PASSWORD: password } = process.env;
  if (!email || !password) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    email = email || await ask(rl, 'Owner email: ');
    name = name || await ask(rl, 'Owner name: ');
    password = await ask(rl, 'Password (min 8, letters + numbers): ', true);
    const again = await ask(rl, 'Repeat password: ', true);
    rl.close();
    if (password !== again) { console.error('Passwords do not match.'); process.exit(1); }
  }
  let cleanEmail;
  try { cleanEmail = S.email({ email }); } catch (e) { console.error(e.message); process.exit(1); }
  const problem = S.passwordProblem(password, cleanEmail);
  if (problem) { console.error(problem); process.exit(1); }

  const existing = db.prepare('SELECT id, role FROM users WHERE email = ?').get(cleanEmail);
  if (existing) {
    db.prepare(`UPDATE users SET role = 'owner', password_hash = ?, failed_logins = 0, locked_until = 0, disabled = 0 WHERE id = ?`)
      .run(S.hashPassword(password), existing.id);
    S.destroyAllSessionsForUser(existing.id);
    console.log(`Updated ${cleanEmail} — it is now an owner account with the new password.`);
  } else {
    db.prepare(`INSERT INTO users (email, name, phone, password_hash, role, created_at) VALUES (?, ?, '', ?, 'owner', ?)`)
      .run(cleanEmail, (name || 'Owner').slice(0, 80), S.hashPassword(password), Date.now());
    console.log(`Owner account created for ${cleanEmail}. Log in at /login, then open /admin.`);
  }
})();
