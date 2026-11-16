// Contributor accounts, sessions and rate limits. Only node:crypto, no packages.
import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

export const ROLES = ['contributor', 'admin'];
export const SESSION_COOKIE = 'kbt_sid';
const SESSION_DAYS = 7;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const USERNAME = /^[a-z0-9._-]{3,32}$/;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(String(password).normalize('NFKC'), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [alg, N, r, p, salt, key] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const want = Buffer.from(key, 'base64');
  const got = scryptSync(String(password).normalize('NFKC'), Buffer.from(salt, 'base64'), want.length,
    { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return got.length === want.length && timingSafeEqual(got, want);
}

// Used when the username does not exist, so a failed login takes the same time either way.
const DUMMY_HASH = hashPassword(randomBytes(12).toString('hex'));

export function checkNewCredentials(username, password) {
  if (!USERNAME.test(String(username))) return 'Nama pengguna: 3–32 aksara, huruf kecil, nombor, titik, sengkang atau garis bawah.';
  if (String(password).length < 10) return 'Kata laluan mesti sekurang-kurangnya 10 aksara.';
  if (String(password).length > 200) return 'Kata laluan terlalu panjang.';
  return null;
}

const tokenHash = (t) => createHash('sha256').update(t).digest('hex');

export function migrateAuth(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    pass_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'contributor' CHECK (role IN ('contributor', 'admin')),
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);`);
}

export function createUser(db, username, password, role = 'contributor') {
  const err = checkNewCredentials(username, password);
  if (err) throw new Error(err);
  if (!ROLES.includes(role)) throw new Error('Peranan tidak sah: ' + role);
  return db.prepare('INSERT INTO users (username, pass_hash, role) VALUES (?, ?, ?)')
    .run(username, hashPassword(password), role).lastInsertRowid;
}

export function setPassword(db, username, password) {
  const err = checkNewCredentials(username, password);
  if (err) throw new Error(err);
  const r = db.prepare('UPDATE users SET pass_hash = ? WHERE username = ?').run(hashPassword(password), username);
  if (!r.changes) throw new Error('Pengguna tidak dijumpai.');
  // A new password signs out every existing session.
  db.prepare('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)').run(username);
}

export function setDisabled(db, username, disabled) {
  const r = db.prepare('UPDATE users SET disabled = ? WHERE username = ?').run(disabled ? 1 : 0, username);
  if (!r.changes) throw new Error('Pengguna tidak dijumpai.');
  if (disabled) db.prepare('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)').run(username);
}

export function login(db, username, password) {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username ?? '').trim().toLowerCase());
  const ok = verifyPassword(String(password ?? ''), u ? u.pass_hash : DUMMY_HASH);
  if (!u || !ok || u.disabled) return null;
  const token = randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(tokenHash(token), u.id, Date.now() + SESSION_DAYS * 86_400_000);
  return { token, user: publicUser(u), maxAge: SESSION_DAYS * 86_400 };
}

export function logout(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
}

export function userForToken(db, token) {
  if (!token) return null;
  const u = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0`).get(tokenHash(token), Date.now());
  return u ? publicUser(u) : null;
}

const publicUser = (u) => ({ id: Number(u.id), username: u.username, role: u.role });

export function readCookie(req, name) {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function sessionCookie(token, maxAge, secure) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

// Fixed-window counter per key, in memory. Enough for one server process.
export function rateLimiter(limit, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    let h = hits.get(key);
    if (!h || now - h.start >= windowMs) {
      h = { start: now, n: 0 };
      hits.set(key, h);
      if (hits.size > 10_000) for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
    }
    h.n += 1;
    return h.n <= limit ? 0 : Math.ceil((h.start + windowMs - now) / 1000); // seconds to wait
  };
}
