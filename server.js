// Kira Botol Terengganu — zero-dependency server (Node 24+).
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import * as auth from './lib/auth.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 5173;
// Local only by default. Set HOST=0.0.0.0 to open it to the network (only behind HTTPS).
const HOST = process.env.HOST || '127.0.0.1';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';
const TZ = 'Asia/Kuala_Lumpur';

export const CONFIG = {
  populations: [
    { id: 'kt', name: 'Daerah Kuala Terengganu', people: 229781, year: 2020,
      source: 'DOSM Banci 2020 (via citypopulation.de)',
      url: 'https://www.citypopulation.de/en/malaysia/admin/terengganu/1104__kuala_terengganu' },
    { id: 'kn', name: 'Daerah Kuala Nerus', people: 145642, year: 2020,
      source: 'DOSM Banci 2020 (via citypopulation.de)',
      url: 'https://citypopulation.de/en/malaysia/terengganu/admin/1108__kuala_nerus' },
    { id: 'tganu', name: 'Negeri Terengganu', people: 1149440, year: 2020,
      source: 'DOSM Banci 2020',
      url: 'https://open.dosm.gov.my/dashboard/kawasanku/Terengganu' },
    { id: 'umt', name: 'Pelajar UMT', people: 10370, year: 2025,
      source: 'Times Higher Education, data 2025',
      url: 'https://timeshighereducation.com/world-university-rankings/universiti-malaysia-terengganu-umt' },
  ],
  locations: ['Kafeteria / dewan makan', 'Kolej kediaman', 'Fakulti / bilik kuliah',
    'Perpustakaan', 'Kompleks sukan', 'Kedai / mesin layan diri', 'Lain-lain'],
  bottleTypes: ['Air mineral (PET)', 'Minuman manis (PET)', 'Lain-lain'],
};

// ---------- database ----------
await mkdir(join(ROOT, 'data'), { recursive: true });
export const db = new DatabaseSync(process.env.DB_PATH || join(ROOT, 'data', 'botol.db'));
db.exec(`PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  location TEXT NOT NULL,
  bottle_type TEXT NOT NULL,
  bottles INTEGER NOT NULL CHECK (bottles >= 0),
  people INTEGER CHECK (people IS NULL OR people > 0),
  recorder TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS entries_day ON entries(day);`);
auth.migrateAuth(db);
// Additive migration: who saved each entry. Old MVP rows keep user_id NULL.
if (!db.prepare('PRAGMA table_info(entries)').all().some((c) => c.name === 'user_id')) {
  db.exec('ALTER TABLE entries ADD COLUMN user_id INTEGER REFERENCES users(id)');
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const dayOffset = (n) => {
  const d = new Date(today() + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
// Rejects dates such as 2026-02-31 that Date.parse silently rolls over.
const isRealDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().startsWith(s);

export function validateEntry(input) {
  const b = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const errors = {};
  const day = String(b.day ?? '');
  if (!isRealDay(day)) errors.day = 'Tarikh tidak sah.';
  else if (day > today()) errors.day = 'Tarikh tidak boleh pada masa depan.';
  if (!CONFIG.locations.includes(b.location)) errors.location = 'Pilih lokasi.';
  if (!CONFIG.bottleTypes.includes(b.bottle_type)) errors.bottle_type = 'Pilih jenis botol.';
  const bottles = b.bottles === '' || b.bottles == null ? NaN : Number(b.bottles);
  if (!Number.isInteger(bottles) || bottles < 0 || bottles > 100000) errors.bottles = 'Masukkan nombor bulat 0–100,000.';
  let people = null;
  if (b.people !== undefined && b.people !== null && b.people !== '') {
    people = Number(b.people);
    if (!Number.isInteger(people) || people < 1 || people > 100000) errors.people = 'Masukkan nombor bulat 1–100,000, atau biar kosong.';
  }
  const clip = (s, n) => (s == null ? null : String(s).trim().slice(0, n) || null);
  return { errors, value: { day, location: b.location, bottle_type: b.bottle_type, bottles, people,
    recorder: clip(b.recorder, 60), note: clip(b.note, 200) } };
}

export function summary(days = 14) {
  const from = dayOffset(days - 1);
  const rows = db.prepare(`SELECT day, SUM(bottles) bottles, COUNT(*) entries FROM entries
    WHERE day >= ? GROUP BY day`).all(from);
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const daily = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = dayOffset(i);
    const r = byDay.get(d);
    daily.push({ day: d, bottles: r ? Number(r.bottles) : 0, entries: r ? Number(r.entries) : 0 });
  }
  const byLocation = db.prepare(`SELECT location, SUM(bottles) bottles FROM entries
    WHERE day >= ? GROUP BY location ORDER BY bottles DESC`).all(from)
    .map((r) => ({ location: r.location, bottles: Number(r.bottles) }));
  // Per-person rate only from entries that recorded how many people were observed.
  const rate = db.prepare(`SELECT SUM(bottles) b, SUM(people) p, COUNT(*) n FROM entries
    WHERE day >= ? AND people IS NOT NULL`).get(from);
  const perPerson = rate.p ? { value: Number(rate.b) / Number(rate.p), entries: Number(rate.n), people: Number(rate.p) } : null;
  // One query for the last 14 days with data and each day's top location (portable to Postgres).
  const reports = db.prepare(`WITH d AS (
      SELECT day, SUM(bottles) bottles, COUNT(*) entries, COUNT(DISTINCT location) locations
      FROM entries GROUP BY day ORDER BY day DESC LIMIT 14),
    per AS (SELECT day, location, SUM(bottles) b FROM entries WHERE day IN (SELECT day FROM d) GROUP BY day, location),
    top AS (SELECT day, location, b, ROW_NUMBER() OVER (PARTITION BY day ORDER BY b DESC, location) rn FROM per)
    SELECT d.*, top.location top_location, top.b top_bottles FROM d LEFT JOIN top ON top.day = d.day AND top.rn = 1
    ORDER BY d.day DESC`).all()
    .map((r) => ({ day: r.day, bottles: Number(r.bottles), entries: Number(r.entries), locations: Number(r.locations),
      topLocation: r.top_location ?? null, topBottles: r.top_bottles == null ? 0 : Number(r.top_bottles) }));
  return { today: today(), days, daily, byLocation, perPerson, reports };
}

// Public totals for a chosen range ("all" = since the first record). Aggregates only: no recorder names.
export function overview(range = '30') {
  const all = range === 'all';
  const days = all ? null : Math.min(Math.max(Number(range) || 30, 1), 365);
  const from = all ? '0000-00-00' : dayOffset(days - 1);
  const t = db.prepare(`SELECT COALESCE(SUM(bottles), 0) bottles, COUNT(*) entries, COUNT(DISTINCT day) days,
    COUNT(DISTINCT location) locations, MIN(day) first, MAX(day) last FROM entries WHERE day >= ?`).get(from);
  const group = (col) => db.prepare(`SELECT ${col} k, SUM(bottles) bottles FROM entries WHERE day >= ?
    GROUP BY ${col} ORDER BY bottles DESC, k`).all(from).map((r) => ({ name: r.k, bottles: Number(r.bottles) }));
  // The chart shows at most the last 90 days, so it stays readable on a phone.
  const chartDays = all ? 90 : Math.min(days, 90);
  const rows = db.prepare(`SELECT day, SUM(bottles) bottles, COUNT(*) entries FROM entries WHERE day >= ? GROUP BY day`).all(dayOffset(chartDays - 1));
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const daily = [];
  for (let i = chartDays - 1; i >= 0; i--) {
    const d = dayOffset(i), r = byDay.get(d);
    daily.push({ day: d, bottles: r ? Number(r.bottles) : 0, entries: r ? Number(r.entries) : 0 });
  }
  const total = Number(t.bottles), dataDays = Number(t.days);
  return { today: today(), range: all ? 'all' : days, total, entries: Number(t.entries), dataDays, locations: Number(t.locations),
    first: t.first ?? null, last: t.last ?? null, avgPerDataDay: dataDays ? total / dataDays : null,
    byLocation: group('location'), byType: group('bottle_type'), chartDays, daily };
}

// ---------- news ----------
const PLACES = /terengganu|kuala nerus|marang|dungun|kemaman|besut|setiu|\bumt\b|chukai/i;
const TOPIC = /plastik|botol|kitar semula|sisa|sampah|plastic|bottle|recycl|waste/i;
const NEWS_QUERY = 'Terengganu (plastik OR botol OR "kitar semula" OR sampah OR sisa)';
let newsCache = { at: 0, tried: 0, items: [], error: null };

const decode = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)); return m ? decode(m[1]).trim() : ''; };
const stripHtml = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
// Feed links end up in href attributes: allow only http(s) so a bad feed cannot inject javascript: links.
const safeUrl = (s) => { try { const u = new URL(s); return /^https?:$/.test(u.protocol) ? u.href : null; } catch { return null; } };

export function parseNews(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const x = m[1];
    let title = tag(x, 'title');
    const source = tag(x, 'source');
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    const desc = stripHtml(tag(x, 'description'));
    const text = title + ' ' + desc;
    if (!PLACES.test(text) || !TOPIC.test(text)) continue;
    const url = safeUrl(tag(x, 'link'));
    if (!url) continue;
    const date = new Date(tag(x, 'pubDate'));
    items.push({ title: title.slice(0, 300), url, source: source.slice(0, 100), published: Number.isNaN(+date) ? null : date.toISOString() });
  }
  const seen = new Set();
  return items.filter((i) => !seen.has(i.title) && seen.add(i.title))
    .sort((a, b) => (b.published ?? '').localeCompare(a.published ?? '')).slice(0, 30);
}

async function getNews(force) {
  const fresh = Date.now() - newsCache.at < 30 * 60_000 && newsCache.items.length;
  // A forced refresh still waits 60 s between upstream calls, so the button cannot be used to flood Google.
  if ((fresh && !force) || Date.now() - newsCache.tried < 60_000) return newsCache;
  newsCache.tried = Date.now();
  const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(NEWS_QUERY) + '&hl=ms&gl=MY&ceid=MY:ms';
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { 'user-agent': 'KiraBotolTerengganu/1.0' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const xml = await res.text();
    if (xml.length > 5_000_000) throw new Error('suapan terlalu besar');
    newsCache = { ...newsCache, at: Date.now(), items: parseNews(xml), error: null };
  } catch (e) {
    // Keep the last good list; report the failure.
    newsCache = { ...newsCache, error: 'Gagal ambil berita: ' + e.message };
  }
  return newsCache;
}

// ---------- app version ----------
// Newest modification time of any file in public/. The page asks for it every minute and reloads itself when it changes,
// so people never keep looking at an old design. Cached for 5 s so polling stays cheap.
let versionCache = { at: 0, v: '' };
function appVersion() {
  if (Date.now() - versionCache.at < 5000 && versionCache.v) return versionCache.v;
  let newest = 0;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p); else newest = Math.max(newest, statSync(p).mtimeMs);
    }
  };
  try { walk(PUBLIC); } catch { /* keep what we have */ }
  versionCache = { at: Date.now(), v: String(Math.round(newest)) };
  return versionCache.v;
}

// ---------- http ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

const isHttps = (req) => COOKIE_SECURE || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https');
const clientIp = (req) => (TRUST_PROXY && String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()) || req.socket.remoteAddress || '?';

const send = (res, status, body, type = 'application/json; charset=utf-8', extra = {}) => {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': type, 'cache-control': 'no-store', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

async function readJson(req) {
  if (!/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) throw new HttpError(415, 'Hantar JSON (content-type: application/json).');
  if (Number(req.headers['content-length']) > 10_000) throw new HttpError(413, 'Data terlalu besar.');
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 10_000) throw new HttpError(413, 'Data terlalu besar.'); }
  try { return JSON.parse(raw || '{}'); } catch { throw new HttpError(400, 'JSON tidak sah.'); }
}

// Mutating requests must come from this site: blocks cross-site form posts (CSRF) on top of SameSite cookies.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients; browsers always send Origin on cross-site POST/DELETE
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

// Leading = + - @ tab or CR make Excel/Sheets treat a cell as a formula; prefix them with '.
const csvCell = (v) => {
  if (v == null) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const limits = {
  login: auth.rateLimiter(10, 15 * 60_000), // per IP and per username
  write: auth.rateLimiter(60, 60_000),      // entry create/delete, per user
  register: auth.rateLimiter(10, 60 * 60_000), // sign-up attempts per IP, so the invite code cannot be guessed
};
const tooMany = (res, wait) => send(res, 429, { error: `Terlalu banyak cubaan. Cuba lagi dalam ${wait} saat.` }, undefined, { 'retry-after': String(wait) });

// Recorder names are personal data: only signed-in contributors see them.
const entryFor = (row, user) => {
  const { user_id, ...e } = row;
  if (!user) delete e.recorder;
  return { ...e, can_delete: !!user && (user.role === 'admin' || user_id === user.id) };
};

export async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const method = req.method;
  try {
    const token = auth.readCookie(req, auth.SESSION_COOKIE);
    const user = auth.userForToken(db, token);

    if (p.startsWith('/api/')) {
      if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(req)) return send(res, 403, { error: 'Asal permintaan tidak dibenarkan.' });

      if (p === '/api/config' && method === 'GET') return send(res, 200, { ...CONFIG, today: today(), signup: auth.inviteOpen() });
      if (p === '/api/version' && method === 'GET') return send(res, 200, { v: appVersion() });

      if (p === '/api/auth/me' && method === 'GET') return send(res, 200, { user });
      if (p === '/api/auth/login' && method === 'POST') {
        const body = await readJson(req);
        const name = String(body?.username ?? '').trim().toLowerCase().slice(0, 64);
        const wait = Math.max(limits.login('ip:' + clientIp(req)), limits.login('u:' + name));
        if (wait) return tooMany(res, wait);
        const s = auth.login(db, name, body?.password);
        if (!s) return send(res, 401, { error: 'Nama pengguna atau kata laluan salah.' });
        return send(res, 200, { user: s.user }, undefined, { 'set-cookie': auth.sessionCookie(s.token, s.maxAge, isHttps(req)) });
      }
      // Self sign-up with the shared invite code. New accounts are always contributors, never admins.
      if (p === '/api/auth/register' && method === 'POST') {
        if (!auth.inviteOpen()) return send(res, 404, { error: 'Pendaftaran ditutup. Minta akaun daripada pentadbir.' });
        const wait = limits.register('ip:' + clientIp(req));
        if (wait) return tooMany(res, wait);
        const body = await readJson(req);
        if (!auth.inviteMatches(body?.invite)) return send(res, 403, { error: 'Kod jemputan salah.' });
        const name = String(body?.username ?? '').trim().toLowerCase();
        const password = String(body?.password ?? '');
        const bad = auth.checkNewCredentials(name, password);
        if (bad) return send(res, 422, { error: bad });
        try { auth.createUser(db, name, password, 'contributor'); }
        catch (e) {
          if (String(e.message).includes('UNIQUE')) return send(res, 409, { error: 'Nama pengguna sudah diambil. Pilih nama lain.' });
          throw e;
        }
        const s = auth.login(db, name, password);
        return send(res, 201, { user: s.user }, undefined, { 'set-cookie': auth.sessionCookie(s.token, s.maxAge, isHttps(req)) });
      }
      if (p === '/api/auth/logout' && method === 'POST') {
        auth.logout(db, token);
        return send(res, 200, { user: null }, undefined, { 'set-cookie': auth.sessionCookie('', 0, isHttps(req)) });
      }

      if (p === '/api/umt/summary' && method === 'GET') {
        return send(res, 200, summary(Math.min(Math.max(Number(url.searchParams.get('days')) || 14, 1), 90)));
      }
      if (p === '/api/umt/overview' && method === 'GET') return send(res, 200, overview(url.searchParams.get('range') || '30'));
      if (p === '/api/umt/entries' && method === 'GET') {
        const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 30, 1), 365);
        const rows = db.prepare('SELECT * FROM entries WHERE day >= ? ORDER BY day DESC, id DESC LIMIT 5000').all(dayOffset(days - 1));
        return send(res, 200, rows.map((r) => entryFor(r, user)));
      }
      if (p === '/api/umt/entries' && method === 'POST') {
        if (!user) return send(res, 401, { error: 'Log masuk dahulu untuk simpan rekod.' });
        const wait = limits.write('u:' + user.id);
        if (wait) return tooMany(res, wait);
        const { errors, value } = validateEntry(await readJson(req));
        if (Object.keys(errors).length) return send(res, 422, { errors });
        const r = db.prepare(`INSERT INTO entries (day, location, bottle_type, bottles, people, recorder, note, user_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(value.day, value.location, value.bottle_type, value.bottles,
          value.people, value.recorder, value.note, user.id);
        return send(res, 201, entryFor(db.prepare('SELECT * FROM entries WHERE id = ?').get(r.lastInsertRowid), user));
      }
      const del = p.match(/^\/api\/umt\/entries\/(\d{1,12})$/);
      if (del && method === 'DELETE') {
        if (!user) return send(res, 401, { error: 'Log masuk dahulu.' });
        const wait = limits.write('u:' + user.id);
        if (wait) return tooMany(res, wait);
        const row = db.prepare('SELECT id, user_id FROM entries WHERE id = ?').get(Number(del[1]));
        if (!row) return send(res, 404, { error: 'Rekod tidak dijumpai.' });
        if (user.role !== 'admin' && row.user_id !== user.id) return send(res, 403, { error: 'Hanya pentadbir atau perekod asal boleh padam rekod ini.' });
        db.prepare('DELETE FROM entries WHERE id = ?').run(row.id);
        return send(res, 204, '');
      }
      if (p === '/api/umt/export.csv' && method === 'GET') {
        if (!user) return send(res, 401, { error: 'Log masuk dahulu untuk eksport.' });
        const rows = db.prepare('SELECT * FROM entries ORDER BY day, id').all();
        const cols = ['id', 'day', 'location', 'bottle_type', 'bottles', 'people', 'recorder', 'note', 'created_at'];
        const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n');
        return send(res, 200, '﻿' + csv, 'text/csv; charset=utf-8',
          { 'content-disposition': `attachment; filename="umt-botol-${today()}.csv"` });
      }
      if (p === '/api/news' && method === 'GET') {
        const n = await getNews(url.searchParams.get('refresh') === '1');
        return send(res, n.items.length || !n.error ? 200 : 502,
          { items: n.items, fetchedAt: n.at ? new Date(n.at).toISOString() : null, error: n.error });
      }
      return send(res, 404, { error: 'Tidak dijumpai.' });
    }

    // static files; unknown paths fall back to the app shell
    if (method !== 'GET' && method !== 'HEAD') return send(res, 405, 'Method Not Allowed', 'text/plain', { allow: 'GET, HEAD' });
    const file = normalize(join(PUBLIC, p === '/' ? 'index.html' : p));
    if (!file.startsWith(PUBLIC + sep)) return send(res, 403, 'Forbidden', 'text/plain');
    // The service worker must be re-checked on every load so updates reach users.
    // Fonts and photos never change under the same name, so browsers may keep them for a year.
    const extra = p === '/sw.js' ? { 'cache-control': 'no-cache' }
      : /^\/(fonts|img)\//.test(p) ? { 'cache-control': 'public, max-age=31536000, immutable' } : {};
    try {
      return send(res, 200, await readFile(file), TYPES[extname(file)] || 'application/octet-stream', extra);
    } catch {
      if (extname(p)) return send(res, 404, 'Not Found', 'text/plain'); // missing asset, not a route
      return send(res, 200, await readFile(join(PUBLIC, 'index.html')), TYPES['.html']);
    }
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(e);
    return send(res, 500, { error: 'Ralat server.' });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const server = http.createServer(handle);
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.listen(PORT, HOST, () => {
    console.log(`Kira Botol Terengganu: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) console.log('Tiada akaun lagi. Cipta: node scripts/user.js add <nama> --role admin');
  });
}
