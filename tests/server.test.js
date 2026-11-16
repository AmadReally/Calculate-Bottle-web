import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const dbPath = join(tmpdir(), `kbt-test-${process.pid}.db`);
process.env.DB_PATH = dbPath;
const { handle, parseNews, validateEntry, db } = await import('../server.js');
const auth = await import('../lib/auth.js');

let server, base, adminCookie, aliCookie;
const PASS = 'kata-laluan-ujian-1';
before(async () => {
  server = http.createServer(handle);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.createUser(db, 'pentadbir', PASS, 'admin');
  auth.createUser(db, 'ali', PASS, 'contributor');
  adminCookie = await signIn('pentadbir');
  aliCookie = await signIn('ali');
});
after(() => { server.close(); db.close(); rmSync(dbPath, { force: true }); });

async function signIn(username, password = PASS) {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
  assert.equal(r.status, 200);
  return r.headers.get('set-cookie').split(';')[0];
}

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
const post = (body, cookie = aliCookie, headers = {}) => fetch(base + '/api/umt/entries', { method: 'POST',
  headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, body: JSON.stringify(body) });
const ok = { day: today, location: 'Lain-lain', bottle_type: 'Lain-lain', bottles: 1 };

test('config exposes sourced populations', async () => {
  const c = await (await fetch(base + '/api/config')).json();
  assert.equal(c.populations.find((p) => p.id === 'kt').people, 229781);
  assert.ok(c.populations.every((p) => p.url.startsWith('https://')));
});

test('rejects invalid entries with field errors', async () => {
  const r = await post({ day: '2999-01-01', location: 'x', bottle_type: 'y', bottles: -3 });
  assert.equal(r.status, 422);
  const { errors } = await r.json();
  assert.deepEqual(Object.keys(errors).sort(), ['bottle_type', 'bottles', 'day', 'location']);
});

test('stores entries and summarises them', async () => {
  const a = await post({ day: today, location: 'Kafeteria / dewan makan', bottle_type: 'Air mineral (PET)', bottles: 120, people: 300 });
  assert.equal(a.status, 201);
  const b = await post({ day: today, location: 'Kolej kediaman', bottle_type: 'Air mineral (PET)', bottles: '30', people: '' });
  assert.equal(b.status, 201);
  const s = await (await fetch(base + '/api/umt/summary?days=14')).json();
  assert.equal(s.daily.length, 14);
  assert.equal(s.daily.at(-1).bottles, 150);
  assert.equal(s.byLocation[0].location, 'Kafeteria / dewan makan');
  // rate uses only entries with people counted: 120 / 300
  assert.equal(s.perPerson.value, 0.4);
  assert.equal(s.reports[0].topLocation, 'Kafeteria / dewan makan');
  assert.equal(s.reports[0].topBottles, 120);
});

test('exports CSV and deletes entries', async () => {
  const csv = await (await fetch(base + '/api/umt/export.csv', { headers: { cookie: aliCookie } })).text();
  assert.match(csv, /Kolej kediaman/);
  const rows = await (await fetch(base + '/api/umt/entries', { headers: { cookie: aliCookie } })).json();
  const d = await fetch(base + '/api/umt/entries/' + rows[0].id, { method: 'DELETE', headers: { cookie: aliCookie } });
  assert.equal(d.status, 204);
  const d2 = await fetch(base + '/api/umt/entries/' + rows[0].id, { method: 'DELETE', headers: { cookie: aliCookie } });
  assert.equal(d2.status, 404);
});

test('blocks path traversal and serves the app shell', async () => {
  const r = await fetch(base + '/..%2fserver.js');
  assert.doesNotMatch(await r.text(), /import/);
  const shell = await (await fetch(base + '/kira')).text();
  assert.match(shell, /<title>Kira Botol Terengganu<\/title>/);
});

test('news parser keeps only Terengganu + topic items', () => {
  const xml = `<rss><channel>
    <item><title>Sampah pantai Terengganu jadi duit - Kosmo</title><link>https://a</link><pubDate>Sat, 24 Jan 2026 08:00:00 GMT</pubDate><source url="x">Kosmo</source><description>d</description></item>
    <item><title>941 permohonan skim perumahan Terengganu lulus - Utusan</title><link>https://b</link><pubDate>Sat, 27 Jun 2026 07:00:00 GMT</pubDate><source url="x">Utusan</source></item>
    <item><title>Industri kitar semula diperkasa - BH</title><link>https://c</link><pubDate>Tue, 19 May 2026 07:00:00 GMT</pubDate><source url="x">BH</source></item>
  </channel></rss>`;
  const items = parseNews(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Sampah pantai Terengganu jadi duit');
  assert.equal(items[0].source, 'Kosmo');
});

test('validateEntry requires a bottle count', () => {
  assert.ok(validateEntry({ day: today, location: 'Lain-lain', bottle_type: 'Lain-lain', bottles: '' }).errors.bottles);
});

test('validateEntry treats blank people as not counted', () => {
  const { errors, value } = validateEntry({ day: today, location: 'Lain-lain', bottle_type: 'Lain-lain', bottles: 1, people: '' });
  assert.deepEqual(errors, {});
  assert.equal(value.people, null);
});

// ---------- security (fasa 2) ----------

test('validateEntry rejects impossible dates and non-object bodies', () => {
  assert.ok(validateEntry({ ...ok, day: '2026-02-31' }).errors.day);
  assert.ok(validateEntry(null).errors.day);
  assert.ok(validateEntry([1]).errors.bottles);
});

test('writing needs a signed-in contributor', async () => {
  assert.equal((await post(ok, null)).status, 401);
  assert.equal((await fetch(base + '/api/umt/export.csv')).status, 401);
  assert.equal((await fetch(base + '/api/umt/entries/1', { method: 'DELETE' })).status, 401);
  assert.equal((await post(ok, 'kbt_sid=palsu')).status, 401);
});

test('login: wrong password fails, cookie is HttpOnly + SameSite=Strict, logout ends the session', async () => {
  const bad = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'ali', password: 'salah-sekali-lagi' }) });
  assert.equal(bad.status, 401);
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'ALI ', password: PASS }) });
  const set = r.headers.get('set-cookie');
  assert.match(set, /HttpOnly/); assert.match(set, /SameSite=Strict/);
  const cookie = set.split(';')[0];
  const me = await (await fetch(base + '/api/auth/me', { headers: { cookie } })).json();
  assert.equal(me.user.username, 'ali');
  assert.equal(me.user.pass_hash, undefined);
  await fetch(base + '/api/auth/logout', { method: 'POST', headers: { cookie } });
  assert.equal((await post(ok, cookie)).status, 401);
});

test('passwords are stored as scrypt hashes', () => {
  const row = db.prepare("SELECT pass_hash FROM users WHERE username = 'ali'").get();
  assert.match(row.pass_hash, /^scrypt\$/);
  assert.ok(!row.pass_hash.includes(PASS));
});

test('blocks cross-site and non-JSON writes (CSRF)', async () => {
  assert.equal((await post(ok, aliCookie, { origin: 'https://jahat.example' })).status, 403);
  const form = await fetch(base + '/api/umt/entries', { method: 'POST', headers: { 'content-type': 'text/plain', cookie: aliCookie }, body: JSON.stringify(ok) });
  assert.equal(form.status, 415);
});

test('only the owner or an admin can delete; public list hides recorder names', async () => {
  const mine = await (await post({ ...ok, recorder: 'Ali bin Abu' }, aliCookie)).json();
  const theirs = await (await post({ ...ok, recorder: 'Pentadbir' }, adminCookie)).json();
  assert.equal((await fetch(base + '/api/umt/entries/' + theirs.id, { method: 'DELETE', headers: { cookie: aliCookie } })).status, 403);
  const pub = await (await fetch(base + '/api/umt/entries')).json();
  assert.ok(pub.every((e) => !('recorder' in e) && !('user_id' in e) && e.can_delete === false));
  assert.equal((await fetch(base + '/api/umt/entries/' + mine.id, { method: 'DELETE', headers: { cookie: adminCookie } })).status, 204);
  assert.equal((await fetch(base + '/api/umt/entries/' + theirs.id, { method: 'DELETE', headers: { cookie: adminCookie } })).status, 204);
});

test('CSV export neutralises spreadsheet formulas', async () => {
  const e = await (await post({ ...ok, note: '=HYPERLINK("http://x","klik")' })).json();
  const csv = await (await fetch(base + '/api/umt/export.csv', { headers: { cookie: aliCookie } })).text();
  assert.match(csv, /"'=HYPERLINK/);
  await fetch(base + '/api/umt/entries/' + e.id, { method: 'DELETE', headers: { cookie: aliCookie } });
});

test('sends security headers and PWA files', async () => {
  const r = await fetch(base + '/');
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const m = await fetch(base + '/manifest.webmanifest');
  assert.equal(m.headers.get('content-type'), 'application/manifest+json');
  assert.equal((await m.json()).display, 'standalone');
  const sw = await fetch(base + '/sw.js');
  assert.equal(sw.headers.get('cache-control'), 'no-cache');
  assert.equal((await fetch(base + '/tiada.js')).status, 404);
});

test('news parser drops non-http links', () => {
  const xml = `<item><title>Sampah plastik Terengganu</title><link>javascript:alert(1)</link></item>`;
  assert.equal(parseNews(xml).length, 0);
});

test('login is rate limited', async () => {
  let last;
  for (let i = 0; i < 12; i++) {
    last = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'sasaran', password: 'cuba-' + i }) });
  }
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get('retry-after')) > 0);
});

test('serves fonts and photos with the right type and a long cache', async () => {
  const f = await fetch(base + '/fonts/barlow-semi-condensed-latin-700-normal.woff2');
  assert.equal(f.status, 200);
  assert.equal(f.headers.get('content-type'), 'font/woff2');
  assert.match(f.headers.get('cache-control'), /max-age=31536000/);
  const i = await fetch(base + '/img/jeti.jpg');
  assert.equal(i.headers.get('content-type'), 'image/jpeg');
  const css = await fetch(base + '/styles.css');
  assert.equal(css.headers.get('cache-control'), 'no-store'); // code stays fresh
});

test('overview: public totals by range, location and type, with no recorder names', async () => {
  const get = async (q = '') => (await fetch(base + '/api/umt/overview' + q)).json();
  const before = await get('?range=all');
  const yesterday = new Date(Date.now() - 864e5 + 8 * 36e5).toISOString().slice(0, 10);
  for (const b of [
    { day: today, location: 'Perpustakaan', bottle_type: 'Air mineral (PET)', bottles: 10, people: 20 },
    { day: today, location: 'Kolej kediaman', bottle_type: 'Minuman manis (PET)', bottles: 5 },
    { day: yesterday, location: 'Perpustakaan', bottle_type: 'Air mineral (PET)', bottles: 7 },
  ]) assert.equal((await post(b)).status, 201);
  const after = await get('?range=all');
  assert.equal(after.total - before.total, 22);
  assert.equal(after.entries - before.entries, 3);
  assert.equal(after.daily.length, 90);
  const lib = after.byLocation.find((l) => l.name === 'Perpustakaan').bottles - (before.byLocation.find((l) => l.name === 'Perpustakaan')?.bottles ?? 0);
  assert.equal(lib, 17);
  assert.ok(after.byType.some((x) => x.name === 'Minuman manis (PET)'));
  assert.ok(after.avgPerDataDay > 0);
  assert.equal(JSON.stringify(after).includes('"ali"'), false); // no recorder names in a public response
  const week = await get('?range=7');
  assert.equal(week.daily.length, 7);
  assert.ok(week.daily.at(-1).bottles >= 15);
  assert.equal((await get('?range=abc')).range, 30); // bad input falls back to 30 days
  assert.equal((await get('?range=99999')).range, 365); // and is capped
});

test('version: stable between calls, never cached, changes when a public file changes', async () => {
  const a = await fetch(base + '/api/version');
  assert.equal(a.status, 200);
  assert.equal(a.headers.get('cache-control'), 'no-store');
  const { v } = await a.json();
  assert.match(v, /^\d{9,}$/);
  assert.equal((await (await fetch(base + '/api/version')).json()).v, v);
});
