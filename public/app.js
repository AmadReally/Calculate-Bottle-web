// Kira Botol Terengganu: telefon dahulu. Tab: Kira, Hasil, Berita. Kalkulator dan Rekod dicapai dari Hasil.

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('ms-MY');
const nf2 = new Intl.NumberFormat('ms-MY', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const fmt = (n) => nf.format(Math.round(n));
const dayLabel = (iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  new Intl.DateTimeFormat('ms-MY', { ...opts, timeZone: 'UTC' }).format(new Date(iso + 'T00:00:00Z'));
const timeLabel = (iso) => new Intl.DateTimeFormat('ms-MY', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(iso));

const store = {
  get: (k, d) => { try { const v = localStorage.getItem('kbt.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('kbt.' + k, JSON.stringify(v)); } catch { /* mod peribadi */ } },
};

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...opts });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(body.error || 'Ralat ' + res.status); e.status = res.status; e.body = body; throw e; }
  return body;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function confirmDialog(text) {
  const d = $('#confirm');
  $('#confirm-text').textContent = text;
  d.returnValue = ''; // Esc kekalkan nilai lama; tanpa ini "Padam" lama akan mengesahkan semula
  d.showModal();
  return new Promise((resolve) => d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true }));
}

let config;
let live = null; // penyegar senyap untuk skrin yang sedang dibuka
let me = null; // penyumbang yang log masuk, atau null
const pop = (id) => config.populations.find((p) => p.id === id);

const errorBlock = (msg, retry = true) =>
  `<div class="empty"><p class="error">${esc(msg)}</p>${retry ? '<p><button class="btn btn-text" data-retry>Cuba lagi</button></p>' : ''}</div>`;
const loading = () => '<div aria-busy="true"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';

// Log masuk dalam dialog; selesai dengan true bila berjaya.
// Dialog yang sama untuk daftar (kod jemputan) bila pentadbir membuka pendaftaran.
function askLogin() {
  const d = $('#login-dlg'), f = $('#login');
  let signup = false;
  const setMode = (on) => {
    signup = on;
    $('#login-h').textContent = on ? 'Daftar akaun penyumbang' : 'Log masuk untuk simpan';
    $('#l-hint').textContent = on ? 'Masukkan kod jemputan daripada pentadbir, kemudian pilih nama pengguna dan kata laluan anda sendiri.'
      : 'Kiraan boleh dibuat tanpa akaun. Menyimpan rekod perlukan akaun penyumbang' + (config?.signup ? '.' : '; minta daripada pentadbir projek.');
    $('#l-invite-field').hidden = !on; $('#l-invite').required = on;
    $('#l-user-hint').hidden = !on; $('#l-pass-hint').hidden = !on;
    $('#l-pass').autocomplete = on ? 'new-password' : 'current-password';
    $('#l-submit').textContent = on ? 'Daftar' : 'Log masuk';
    $('#l-mode').textContent = on ? 'Sudah ada akaun? Log masuk' : 'Belum ada akaun? Daftar dengan kod jemputan';
    $('#l-err').textContent = '';
    (on ? $('#l-invite') : $('#l-user')).focus();
  };
  f.reset();
  $('#l-mode').hidden = !config?.signup;
  d.showModal();
  setMode(false);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; f.removeEventListener('submit', onSubmit); $('#login-cancel').removeEventListener('click', onCancel); $('#l-mode').removeEventListener('click', onMode); d.removeEventListener('close', onClose); if (d.open) d.close(); resolve(v); };
    const onCancel = () => finish(false);
    const onClose = () => finish(false);
    const onMode = () => setMode(!signup);
    const onSubmit = async (e) => {
      e.preventDefault();
      const btn = $('#l-submit'); btn.disabled = true; $('#l-err').textContent = '';
      const data = Object.fromEntries(new FormData(f));
      if (!signup) delete data.invite;
      try {
        ({ user: me } = await api(signup ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body: JSON.stringify(data) }));
        if (signup) toast('Akaun ' + me.username + ' dicipta');
        finish(true);
      } catch (err) { $('#l-err').textContent = err.message; f.password.value = ''; (err.status === 403 && signup ? $('#l-invite') : f.password).focus(); }
      finally { btn.disabled = false; }
    };
    f.addEventListener('submit', onSubmit);
    $('#login-cancel').addEventListener('click', onCancel);
    $('#l-mode').addEventListener('click', onMode);
    d.addEventListener('close', onClose);
  });
}

// Kadar botol seorang: pilihan pengguna (andaian atau data UMT). Dikongsi oleh Kira dan Hasil.
function ratePref(summary) {
  let mode = store.get('rateMode', 'umt');
  const assumed = Number(store.get('assumedRate', 1));
  if (mode === 'umt' && !summary?.perPerson) mode = 'assume';
  const rate = mode === 'umt' ? summary.perPerson.value : assumed;
  return { mode, assumed, rate };
}
const totalEntries = (s) => s.daily.reduce((a, d) => a + d.entries, 0);

// ---------- skrin Kira ----------
async function viewKira(el) {
  const draft = store.get('draft', { count: 0, people: '', location: '', type: '', day: '' });
  if (!config.locations.includes(draft.location)) draft.location = config.locations[0];
  if (!config.bottleTypes.includes(draft.type)) draft.type = config.bottleTypes[0];
  const d = new Date(config.today + 'T00:00:00Z');
  el.innerHTML = `<section class="kira">
    <h1 class="sr-only">Kira botol</h1>
    <div class="photo">
      <img src="/img/jeti.jpg" width="1000" height="560" alt="Bot nelayan di Sungai Terengganu">
      <span class="photo-date">${esc(dayLabel(config.today, { weekday: 'long', day: 'numeric', month: 'short' }))}</span>
    </div>
    <div class="sign-wrap">
      <label class="sign"><span class="sign-k">Lokasi</span><span class="sign-v" id="loc-text"></span>
        <select id="loc" aria-label="Lokasi kiraan">${config.locations.map((l) => `<option ${l === draft.location ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <i class="post" aria-hidden="true"></i><i class="post" aria-hidden="true"></i>
    </div>
    <div class="count">
      <input id="count" inputmode="numeric" pattern="[0-9]*" maxlength="6" aria-label="Botol dikira sesi ini" value="${draft.count}">
      <div class="count-side"><p>botol dikira sesi ini</p><p class="hint" id="count-state">Belum disimpan</p>
        <select id="type" aria-label="Jenis botol">${config.bottleTypes.map((t) => `<option ${t === draft.type ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
    </div>
    <div class="people">
      <div class="people-head"><label for="people">Orang diperhati</label><span class="people-why">Menentukan kadar</span></div>
      <div class="stepper">
        <button type="button" id="p-minus" aria-label="Kurang seorang">−</button>
        <input id="people" inputmode="numeric" pattern="[0-9]*" maxlength="6" value="${esc(draft.people)}" aria-describedby="rate-line">
        <button type="button" id="p-plus" aria-label="Tambah seorang">+</button>
      </div>
      <p class="rate-line" id="rate-line"></p>
    </div>
    <form class="custom" id="custom" novalidate>
      <label for="add-n">Tambah nombor sendiri</label>
      <div class="custom-row">
        <input id="add-n" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" placeholder="cth. 12" aria-describedby="add-hint">
        <button type="submit" class="btn" id="add-go">Tambah</button>
      </div>
      <p class="error custom-err" id="add-hint" role="alert"></p>
    </form>
    <div class="actions">
      <button type="button" class="btn" id="undo">Undur −1</button>
      <button type="button" class="btn btn-solid" id="save">Simpan rekod</button>
    </div>
    <p class="k-err error" id="k-err" role="alert"></p>
    <button type="button" class="tap" id="tap"><span class="tap-n" aria-hidden="true">+1</span><span class="tap-t">Ketik untuk tambah botol</span></button>
    <div class="band" aria-hidden="true"></div>
    <p class="estimate-line" id="est-line"></p>
  </section>`;

  const countEl = $('#count'), peopleEl = $('#people');
  const num = (v) => { const n = parseInt(String(v).replace(/\D/g, ''), 10); return Number.isFinite(n) ? n : null; };
  const persist = () => {
    // Tarikh kiraan = hari ia mula dikira, supaya kiraan malam yang disimpan esok pagi tetap dicap tarikh yang betul.
    if (draft.count < 1 && !draft.people) draft.day = '';
    else if (!draft.day) draft.day = config.today;
    store.set('draft', draft);
  };
  let saved = false;
  const stateText = () => (saved ? 'Disimpan' : 'Belum disimpan') + (draft.day && draft.day !== config.today ? ` · dikira ${dayLabel(draft.day)}` : '');
  const render = () => {
    countEl.value = String(draft.count);
    countEl.style.setProperty('--d', String(Math.max(2, countEl.value.length)));
    peopleEl.value = draft.people;
    $('#loc-text').textContent = draft.location;
    const p = num(draft.people);
    $('#rate-line').textContent = p && p > 0
      ? `${fmt(draft.count)} ÷ ${fmt(p)} = ${nf2.format(draft.count / p)} botol seorang`
      : 'Isi bilangan orang untuk dapat kadar seorang.';
    $('#save').disabled = draft.count < 1;
    $('#undo').disabled = draft.count < 1;
    persist();
    $('#count-state').textContent = stateText();
  };
  const setCount = (n) => { draft.count = Math.min(100000, Math.max(0, n)); saved = false; render(); };

  $('#tap').addEventListener('click', () => { setCount(draft.count + 1); navigator.vibrate?.(8); });
  $('#undo').addEventListener('click', () => setCount(draft.count - 1));
  $('#custom').addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = $('#add-n'), err = $('#add-hint');
    const n = num(inp.value);
    if (!n || n < 1 || n > 100000) {
      err.textContent = 'Masukkan nombor bulat 1 hingga 100,000.';
      inp.setAttribute('aria-invalid', 'true'); inp.focus(); return;
    }
    err.textContent = ''; inp.removeAttribute('aria-invalid');
    if (draft.count + n > 100000) { err.textContent = 'Jumlah kiraan tidak boleh melebihi 100,000.'; inp.setAttribute('aria-invalid', 'true'); return; }
    setCount(draft.count + n);
    inp.value = '';
    $('#count-state').textContent = `Belum disimpan · baru tambah ${fmt(n)}`;
    navigator.vibrate?.(8);
  });
  $('#add-n').addEventListener('input', () => { $('#add-hint').textContent = ''; $('#add-n').removeAttribute('aria-invalid'); });
  countEl.addEventListener('input', () => { draft.count = Math.min(100000, num(countEl.value) ?? 0); countEl.style.setProperty('--d', String(Math.max(2, String(draft.count).length))); $('#save').disabled = draft.count < 1; $('#undo').disabled = draft.count < 1; persist(); updateRate(); });
  countEl.addEventListener('focus', () => countEl.select());
  countEl.addEventListener('blur', render);
  const updateRate = () => {
    const p = num(draft.people);
    $('#rate-line').textContent = p && p > 0 ? `${fmt(draft.count)} ÷ ${fmt(p)} = ${nf2.format(draft.count / p)} botol seorang`
      : 'Isi bilangan orang untuk dapat kadar seorang.';
  };
  peopleEl.addEventListener('input', () => { const n = num(peopleEl.value); draft.people = n ? String(Math.min(100000, n)) : ''; persist(); updateRate(); });
  peopleEl.addEventListener('blur', render);
  $('#p-plus').addEventListener('click', () => { draft.people = String((num(draft.people) || 0) + 1); render(); });
  $('#p-minus').addEventListener('click', () => { const n = (num(draft.people) || 0) - 1; draft.people = n > 0 ? String(n) : ''; render(); });
  $('#loc').addEventListener('change', (e) => { draft.location = e.target.value; render(); });
  $('#type').addEventListener('change', (e) => { draft.type = e.target.value; persist(); });

  const save = async () => {
    const btn = $('#save'); $('#k-err').textContent = '';
    if (!me && !(await askLogin())) return;
    btn.disabled = true;
    try {
      await refreshToday();
      const body = { day: draft.day || config.today, location: draft.location, bottle_type: draft.type, bottles: draft.count, people: num(draft.people) || '' };
      await api('/api/umt/entries', { method: 'POST', body: JSON.stringify(body) });
      draft.count = 0; draft.people = ''; draft.day = ''; saved = true; render();
      toast('Rekod disimpan');
      loadEstimate();
    } catch (err) {
      if (err.status === 401) { me = null; $('#k-err').textContent = 'Sesi tamat. Tekan Simpan rekod untuk log masuk semula.'; }
      else $('#k-err').textContent = err.body?.errors ? Object.values(err.body.errors).join(' ') : err.message;
    } finally { btn.disabled = draft.count < 1; }
  };
  $('#save').addEventListener('click', save);

  async function loadEstimate() {
    try {
      const s = await api('/api/umt/summary?days=14');
      if (!el.isConnected) return;
      const kt = pop('kt'), r = ratePref(s);
      $('#est-line').textContent = `Anggaran Kuala Terengganu: ${fmt(kt.people * r.rate)} botol sehari (${fmt(kt.people)} × ${nf2.format(r.rate)}). Bukan kiraan.`;
    } catch { if (el.isConnected) $('#est-line').textContent = 'Anggaran Kuala Terengganu tidak dapat dimuat sekarang.'; }
  }
  render();
  loadEstimate();
  live = loadEstimate;
}

// ---------- skrin Hasil ----------
async function viewHasil(el, silent = false) {
  live = () => viewHasil(el, true).catch(() => {});
  if (!silent) el.innerHTML = `<section class="screen"><h1 class="screen-title">Hasil</h1>${loading()}</section>`;
  const s = await api('/api/umt/summary?days=14');
  if (!el.isConnected) return;
  const sig = JSON.stringify(s);
  if (silent && el.__sig === sig) return; // tiada perubahan: jangan lukis semula
  el.__sig = sig;
  const scrollY0 = window.scrollY;
  const kt = pop('kt');
  const total = totalEntries(s);
  const pp = s.perPerson;
  const ratio = pp && total ? Math.round((pp.entries / total) * 100) : 0;

  el.innerHTML = `<section class="screen">
    <h1 class="screen-title">Hasil</h1>
    <p class="screen-intro">Garis tebal ialah kiraan sebenar. Jalur hitam-putih ialah anggaran.</p>

    <div class="block block-real" aria-labelledby="umt-h">
      <h2 id="umt-h">Kadar UMT, data sebenar</h2>
      ${pp ? `<p class="big">${nf2.format(pp.value)}<span class="big-unit">botol seorang sehari</span></p>
        <p class="body-line">${fmt(pp.people ? pp.value * pp.people : 0)} botol ÷ ${fmt(pp.people)} orang, daripada ${pp.entries} rekod (14 hari).${total > pp.entries ? ` ${total - pp.entries} rekod tanpa bilangan orang tidak dikira.` : ''}</p>
        <div class="bar" role="img" aria-label="${pp.entries} daripada ${total} rekod ada bilangan orang"><i style="width:${ratio}%"></i></div>
        <p class="hint">${pp.entries} / ${total} rekod ada bilangan orang diperhati</p>`
      : `<p class="nodata">Tiada data</p>
        <p class="body-line">${total ? `${total} rekod belum ada bilangan orang diperhati, jadi kadar belum boleh dikira.` : 'Belum ada rekod dalam 14 hari.'} Isi “Orang diperhati” di tab Kira.</p>`}
    </div>

    <div class="block block-est" aria-labelledby="kt-h">
      <div class="band" aria-hidden="true"></div>
      <h2 id="kt-h">Anggaran Kuala Terengganu</h2>
      <p class="mult" id="kt-mult"></p>
      <p class="result" id="kt-big"></p>
      <div class="seg" role="group" aria-label="Sumber kadar" style="margin-top:16px">
        <button type="button" data-mode="umt" aria-pressed="false" ${pp ? '' : 'disabled'}>Kadar UMT${pp ? ' ' + nf2.format(pp.value) : ''}</button>
        <button type="button" data-mode="assume" aria-pressed="false">Andaian</button>
      </div>
      <div class="field" id="assume-field" hidden>
        <label for="rate-in">Botol seorang sehari (andaian)</label>
        <input id="rate-in" inputmode="decimal" value="${esc(String(store.get('assumedRate', 1)))}">
      </div>
      <p class="note hint" style="margin-top:12px">Anggaran, bukan kiraan. Pelajar UMT tidak mewakili seluruh penduduk. Penduduk: <a href="${esc(kt.url)}" target="_blank" rel="noopener">${esc(kt.source)}</a>.</p>
      <a class="link-row" href="#/kalkulator">Kira untuk orang lain ›</a>
    </div>

    <div class="block block-real block-wide" aria-labelledby="his-h">
      <h2 id="his-h">Sejarah</h2>
      <ul class="days">${[...s.daily].reverse().map((d, i) => d.entries
        ? `<li><span>${i === 0 ? 'Hari ini' : esc(dayLabel(d.day))}</span><span class="v">${fmt(d.bottles)}</span><span class="n">${d.entries} rekod</span></li>`
        : `<li><span>${i === 0 ? 'Hari ini' : esc(dayLabel(d.day))}</span><span class="v-none">Tiada data</span><span class="n">belum ada rekod</span></li>`).join('')}</ul>
      <a class="link-row" href="#/rekod">Semua rekod ›</a>
    </div>
  </section>`;

  let { mode, assumed } = ratePref(s);
  const render = () => {
    const rate = mode === 'umt' && pp ? pp.value : assumed;
    $('#kt-mult').innerHTML = `${fmt(kt.people)} orang × <b>${nf2.format(rate)}</b>`;
    $('#kt-big').innerHTML = `= ${fmt(kt.people * rate)}<span class="big-unit">botol sehari</span>`;
    el.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    $('#assume-field').hidden = mode !== 'assume';
  };
  if (silent) window.scrollTo(0, scrollY0);
  el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; store.set('rateMode', mode); render(); }));
  $('#rate-in').addEventListener('input', (e) => {
    const v = Number(String(e.target.value).replace(',', '.'));
    if (Number.isFinite(v) && v >= 0 && v <= 50) { assumed = v; store.set('assumedRate', v); render(); }
  });
  render();
}

// ---------- skrin Jumlah (Arah A: papan tanda) ----------
const niceTop = (max) => {
  if (max <= 1) return 1;
  const raw = max / 2, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  return Math.ceil(max / step) * step;
};
const RANGE_TEXT = { 7: '7 hari terakhir', 30: '30 hari terakhir', 90: '90 hari terakhir', all: 'sejak rekod pertama' };
// Hari tertinggi: hanya hari yang ada rekod (hari tanpa rekod ialah "Tiada data", bukan 0).
const peakDay = (daily) => daily.reduce((p, d) => (d.entries && (!p || d.bottles > p.bottles) ? d : p), null);

// Carta palang harian, satu siri. Lebar dan ketinggian ikut skrin supaya teks paksi kekal terbaca.
function dayChart(daily, width, height, peak) {
  const W = Math.max(280, Math.round(width)), H = height, padL = 40, padB = 28, padT = 26;
  const max = Math.max(1, ...daily.map((d) => d.bottles));
  const top = niceTop(max);
  const ticks = top >= 4 ? [0, top / 2, top] : [0, top];
  const n = daily.length, innerW = W - padL, innerH = H - padB - padT, slot = innerW / n;
  const bw = Math.max(2, Math.min(26, slot - 2));
  const y = (v) => padT + innerH - (v / top) * innerH;
  const cx = (i) => padL + i * slot + slot / 2;
  const clampX = (x, m) => Math.min(Math.max(x, padL + m), W - m);
  const bars = daily.map((d, i) => {
    const x = cx(i) - bw / 2;
    if (!d.entries) return `<line class="nodata-tick" x1="${x}" x2="${x + bw}" y1="${padT + innerH - 1}" y2="${padT + innerH - 1}"><title>${esc(dayLabel(d.day))}: Tiada data</title></line>`;
    const h = Math.max(2, (d.bottles / top) * innerH);
    const isPeak = peak && d.day === peak.day;
    return `<rect class="col${isPeak ? ' peak' : ''}" x="${x}" y="${padT + innerH - h}" width="${bw}" height="${h}"><title>${esc(dayLabel(d.day))}: ${fmt(d.bottles)} botol, ${d.entries} rekod</title></rect>`;
  }).join('');
  const step = n <= 10 ? 1 : n <= 35 ? 7 : 14; // label x: setiap 7 hari (30 hari), 14 hari (90 hari)
  const xl = [];
  for (let i = n - 1; i >= 0; i -= step) xl.push(i);
  const labels = xl.map((i) => `<text class="axis" x="${clampX(cx(i), 18)}" y="${H - 6}" text-anchor="middle">${esc(dayLabel(daily[i].day, { day: 'numeric', month: 'short' }))}</text>`).join('');
  const pi = peak ? daily.findIndex((d) => d.day === peak.day) : -1;
  const peakTxt = pi >= 0 ? `<text class="axis peak-n" x="${clampX(cx(pi), 14)}" y="${y(peak.bottles) - 6}" text-anchor="middle">${fmt(peak.bottles)}</text>` : '';
  const grid = ticks.map((t) => `<line class="grid-line" x1="${padL}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${padL - 6}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Botol direkod setiap hari, ${n} hari terakhir">${grid}${bars}${peakTxt}${labels}</svg>`;
}

async function viewJumlah(el, silent = false) {
  live = () => viewJumlah(el, true).catch(() => {});
  let range = store.get('jumlahRange', '30');
  if (!['7', '30', '90', 'all'].includes(range)) range = '30';
  if (!silent) el.innerHTML = `<section class="screen"><h1 class="screen-title">Jumlah</h1>${loading()}</section>`;
  const o = await api('/api/umt/overview?range=' + range);
  if (!el.isConnected) return;
  const sig = range + JSON.stringify(o);
  if (silent && el.__sig === sig) return;
  el.__sig = sig; el.__o = o;
  const scrollY0 = window.scrollY;
  const rangeBtn = (v, t) => `<button type="button" data-range="${v}" aria-pressed="${range === v}">${t}</button>`;
  const peak = peakDay(o.daily);
  const lead = o.byLocation[0];
  const max = Math.max(1, ...o.byLocation.map((l) => l.bottles));
  const pct = (b) => (o.total ? Math.round((b / o.total) * 100) : 0);
  const typeCls = (i) => 't' + Math.min(i + 1, 3);
  const empty = !o.entries;

  const plate = empty
    ? `<p class="j-label">Jumlah botol direkod · ${RANGE_TEXT[range]}</p><p class="j-none">Tiada data</p><p class="j-sub">${range === 'all' ? 'Belum ada rekod.' : `Belum ada rekod dalam ${RANGE_TEXT[range]}.`}</p>`
    : `<p class="j-label">Jumlah botol direkod · ${RANGE_TEXT[range]}</p><p class="j-num">${fmt(o.total)}<small>botol</small></p>
       <p class="j-sub">${fmt(o.entries)} rekod di ${o.locations} lokasi · ${o.dataDays} hari ada data</p>`;
  const says = empty
    ? `<p class="j-lead">Belum ada botol direkod.</p><p class="j-honest">Cuba pilih "Semua", atau buat rekod pertama di tab Kira. Hari tanpa rekod ialah "Tiada data", bukan 0.</p>
       <a class="j-cta" href="#/kira">Buat rekod di tab Kira</a>`
    : `<p class="j-lead">${esc(lead.name)} paling banyak direkod: ${fmt(lead.bottles)} botol, ${pct(lead.bottles)}%.</p>
       <p class="j-honest">Hanya botol yang dikira dan direkod di UMT. Bukan semua botol yang digunakan. Lokasi yang lebih kerap dikira nampak lebih banyak.</p>`;
  const locSec = `<div class="j-sec j-loc" aria-labelledby="loc-h"><h2 id="loc-h">Ikut lokasi</h2><ul>${o.byLocation.map((l) => `<li>
      <div class="j-row"><span>${esc(l.name)}</span><span><b>${fmt(l.bottles)}</b><i>${pct(l.bottles)}%</i></span></div>
      <div class="j-track" aria-hidden="true"><div class="j-fill" style="width:${(l.bottles / max) * 100}%"></div></div></li>`).join('')}</ul></div>`;
  const daySec = `<div class="j-sec j-day" aria-labelledby="day-h"><h2 id="day-h">Setiap hari</h2>
      ${empty ? '<div class="j-empty-chart"><span>Tiada data</span></div>' : '<div class="chart" id="day-chart"></div>'}
      ${empty ? '' : `<p class="j-leg"><span><i class="k-peak"></i>Tertinggi: ${fmt(peak.bottles)} botol, ${esc(dayLabel(peak.day, { day: 'numeric', month: 'short' }))}</span><span><i class="k-nd"></i>Tiada data</span></p>
      <p class="j-leg">${o.chartDays} hari terakhir${o.range === 'all' || o.range > 90 ? ' (carta paparkan paling banyak 90 hari)' : ''}. Purata ${nf2.format(o.avgPerDataDay)} botol sehari, dikira hanya bagi hari yang ada data.</p>
      <details class="table-view"><summary>Lihat jadual</summary>
        <table><thead><tr><th>Tarikh</th><th>Botol</th><th>Rekod</th></tr></thead><tbody>
        ${[...o.daily].reverse().map((d) => `<tr><td>${esc(dayLabel(d.day))}</td><td>${d.entries ? fmt(d.bottles) : 'Tiada data'}</td><td>${d.entries || '—'}</td></tr>`).join('')}</tbody></table></details>`}
    </div>`;
  const typSec = `<div class="j-sec j-typ" aria-labelledby="typ-h"><h2 id="typ-h">Ikut jenis botol</h2>
      <div class="j-stack" role="img" aria-label="${esc(o.byType.map((t) => `${t.name} ${pct(t.bottles)}%`).join(', '))}">${o.byType.map((t, i) => `<span class="${typeCls(i)}" style="flex:${Math.max(t.bottles, 1)}">${pct(t.bottles) >= 10 ? pct(t.bottles) + '%' : ''}</span>`).join('')}</div>
      <ul class="j-tl">${o.byType.map((t, i) => `<li><i class="sw ${typeCls(i)}"></i>${esc(t.name)}<b>${fmt(t.bottles)}</b><i class="pc">${pct(t.bottles)}%</i></li>`).join('')}</ul></div>`;

  el.innerHTML = `<section class="jumlah"><div class="j-wrap">
    <div class="j-hero">
      <div class="j-photo"><img src="/img/jeti.jpg" width="1000" height="560" alt="Bot nelayan di Sungai Terengganu"><h1 class="j-tab">Jumlah</h1></div>
      <div class="j-plate">${plate}</div>
    </div>
    <div class="j-top">
      <div class="j-seg" role="group" aria-label="Tempoh">${rangeBtn('7', '7 hari')}${rangeBtn('30', '30 hari')}${rangeBtn('90', '90 hari')}${rangeBtn('all', 'Semua')}</div>
      <div class="j-says">${says}</div>
    </div>
    <div class="j-grid${empty ? ' j-grid-empty' : ''}">${empty ? daySec : locSec + daySec + typSec}</div>
    <div class="j-links"><a class="link-row" href="#/hasil">Kadar botol seorang dan anggaran Kuala Terengganu ›</a><a class="link-row" href="#/rekod">Semua rekod ›</a></div>
  </div></section>`;
  if (silent) window.scrollTo(0, scrollY0);

  const draw = () => {
    const c = $('#day-chart', el);
    if (!c) return;
    const w = c.clientWidth || 340;
    c.innerHTML = dayChart(o.daily, w, w >= 520 ? 330 : 200, peak);
    c.dataset.w = String(w);
  };
  draw();
  el.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => {
    store.set('jumlahRange', b.dataset.range); el.__sig = '';
    viewJumlah(el).catch((e) => { el.innerHTML = `<section class="screen">${errorBlock(e.message)}</section>`; });
  }));
  // Lukis semula carta sahaja bila lebar berubah (cth. putar telefon); satu pendengar bagi setiap skrin.
  if (!el.__rs) {
    el.__rs = true;
    window.addEventListener('resize', function onResize() {
      if (!el.isConnected) return window.removeEventListener('resize', onResize);
      const c = $('#day-chart', el);
      if (c && Math.abs(c.clientWidth - Number(c.dataset.w || 0)) > 20) {
        const w = c.clientWidth;
        c.innerHTML = dayChart(el.__o.daily, w, w >= 520 ? 330 : 200, peakDay(el.__o.daily));
        c.dataset.w = String(w);
      }
    });
  }
}

// ---------- skrin Berita ----------
const reportItem = (r) => `<li><p><b>${esc(dayLabel(r.day, { weekday: 'long', day: 'numeric', month: 'long' }))}</b></p>
  <p class="body-line">${fmt(r.bottles)} botol direkod di UMT, ${r.entries} rekod dari ${r.locations} lokasi.${r.topLocation ? ` Paling banyak: ${esc(r.topLocation)} (${fmt(r.topBottles)}).` : ''}</p></li>`;

async function viewBerita(el) {
  el.innerHTML = `<section class="screen">
    <h1 class="screen-title">Berita</h1>
    <p class="screen-intro">Berita Terengganu sahaja tentang botol, plastik, sisa dan kitar semula, ditapis automatik daripada Google News.</p>
    <div class="block block-real" aria-labelledby="news-h">
      <div class="row" style="justify-content:space-between"><h2 id="news-h">Terkini</h2>
        <span><span class="small muted" id="news-at"></span> <button class="btn btn-text" id="news-refresh">Muat semula</button></span></div>
      <div id="news">${loading()}</div>
    </div>
    <div class="block block-real" aria-labelledby="rep-h">
      <h2 id="rep-h">Laporan harian UMT</h2>
      <div id="reports">${loading()}</div>
    </div>
  </section>`;
  const loadNews = async (refresh, silent = false) => {
    const btn = $('#news-refresh'); btn.disabled = true;
    if (refresh) $('#news').innerHTML = loading();
    try {
      const n = await api('/api/news' + (refresh ? '?refresh=1' : ''));
      if (!el.isConnected) return;
      const sig = JSON.stringify(n.items.map((i) => i.url)) + (n.error || '');
      $('#news-at').textContent = n.fetchedAt ? 'Dikemas kini ' + new Intl.DateTimeFormat('ms-MY', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(n.fetchedAt)) : '';
      if (silent && el.__newsSig === sig) return; // senarai sama: hanya masa dikemas kini
      el.__newsSig = sig;
      $('#news').innerHTML = (n.error ? `<p class="error">${esc(n.error)} Senarai di bawah dari cache terakhir.</p>` : '') +
        (n.items.length ? `<ul class="list">${n.items.map((i) => `<li><a class="news-title" href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a>
          <p class="meta">${esc(i.source)}${i.published ? ' · ' + esc(timeLabel(i.published)) : ''}</p></li>`).join('')}</ul>`
          : '<div class="empty"><p>Tiada berita Terengganu yang sepadan buat masa ini.</p></div>');
    } catch (e) { if (el.isConnected && !silent) $('#news').innerHTML = errorBlock(e.message); }
    finally { if (el.isConnected) btn.disabled = false; }
  };
  $('#news-refresh').addEventListener('click', () => loadNews(true));
  el.addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) loadNews(true); });
  const loadReports = (silent = false) => api('/api/umt/summary?days=14').then((s) => {
    if (!el.isConnected) return;
    const sig = JSON.stringify(s.reports);
    if (silent && el.__repSig === sig) return;
    el.__repSig = sig;
    $('#reports').innerHTML = s.reports.length ? `<ul class="list">${s.reports.map(reportItem).join('')}</ul>`
      : '<div class="empty"><p>Belum ada laporan.</p><p class="hint">Laporan dijana bila ada rekod UMT.</p></div>';
  }).catch((e) => { if (el.isConnected && !silent) $('#reports').innerHTML = errorBlock(e.message, false); });
  loadReports();
  loadNews(false);
  live = () => { loadReports(true); loadNews(false, true); };
}

// ---------- skrin Kalkulator ----------
function viewKalkulator(el) {
  const st = store.get('calc', { scope: 'self', people: 1, rate: 1, period: 1, unit: 'day', weight: '', recycle: '' });
  const scopes = [['self', 'Sendiri'], ['group', 'Kumpulan'], ...config.populations.map((p) => [p.id, p.name.replace('Daerah ', '')])];
  el.innerHTML = `<section class="screen screen-calc">
    <h1 class="screen-title">Kalkulator</h1>
    <p><a class="link-row" href="#/hasil">‹ Hasil</a></p>
    <div class="calc-out" aria-live="polite">
      <p class="result" id="r-total"></p>
      <p class="body-line" id="r-formula"></p>
      <dl id="r-facts"></dl>
    </div>
    <form id="calc" novalidate>
      <div class="field"><span class="label" id="scope-l">Untuk siapa</span>
        <div class="seg" role="group" aria-labelledby="scope-l">${scopes.map(([id, n]) => `<button type="button" data-scope="${id}" aria-pressed="${st.scope === id}">${esc(n)}</button>`).join('')}</div>
        <p class="hint" id="scope-src"></p></div>
      <div class="field-row">
        <div class="field"><label for="c-people">Bilangan orang</label><input id="c-people" name="people" type="number" inputmode="numeric" min="1" step="1" value="${esc(st.people)}"></div>
        <div class="field"><label for="c-rate">Botol seorang sehari</label><input id="c-rate" name="rate" type="number" inputmode="decimal" min="0" step="0.1" value="${esc(st.rate)}"></div>
      </div>
      <div class="field"><label for="c-period">Tempoh</label>
        <div class="input-unit"><input id="c-period" name="period" type="number" inputmode="numeric" min="1" step="1" value="${esc(st.period)}">
          <select name="unit" aria-label="Unit tempoh">${[['day', 'hari'], ['week', 'minggu'], ['month', 'bulan'], ['year', 'tahun']].map(([v, n]) => `<option value="${v}" ${st.unit === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>
      <div class="field-row">
        <div class="field"><label for="c-weight">Berat sebotol (gram)</label><input id="c-weight" name="weight" type="number" inputmode="decimal" min="0" step="0.5" value="${esc(st.weight)}"><p class="hint">Pilihan.</p></div>
        <div class="field"><label for="c-recycle">Dikitar semula (%)</label><input id="c-recycle" name="recycle" type="number" inputmode="decimal" min="0" max="100" step="1" value="${esc(st.recycle)}"><p class="hint">Pilihan.</p></div>
      </div>
      <p class="error" id="c-err" role="alert" style="margin-top:12px"></p>
    </form>
  </section>`;
  const form = $('#calc');
  const days = { day: 1, week: 7, month: 30, year: 365 };
  const setScope = (id, fill) => {
    st.scope = id;
    form.querySelectorAll('[data-scope]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scope === id)));
    const p = pop(id);
    if (fill) form.people.value = p ? p.people : id === 'self' ? 1 : Math.max(2, Number(form.people.value) || 2);
    form.people.readOnly = id === 'self';
    $('#scope-src').innerHTML = p ? `${fmt(p.people)} orang · <a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.source)}</a>` : '';
  };
  const calc = () => {
    const v = Object.fromEntries(new FormData(form));
    Object.assign(st, v); store.set('calc', st);
    const people = Number(v.people), rate = Number(v.rate), period = Number(v.period);
    const bad = { people: !(people >= 1), rate: !(rate >= 0), period: !(period >= 1) };
    const err = bad.people ? 'Bilangan orang mesti sekurang-kurangnya 1.' : bad.rate ? 'Botol seorang sehari tidak boleh negatif.' : bad.period ? 'Tempoh mesti sekurang-kurangnya 1.' : '';
    $('#c-err').textContent = err;
    for (const k of Object.keys(bad)) form[k].setAttribute('aria-invalid', String(bad[k]));
    if (err) { $('#r-total').textContent = '—'; $('#r-formula').textContent = ''; $('#r-facts').innerHTML = ''; return; }
    const nDays = period * days[v.unit], perDay = people * rate, total = perDay * nDays;
    $('#r-total').innerHTML = `${fmt(total)}<span class="big-unit">botol</span>`;
    $('#r-formula').textContent = `${fmt(people)} orang × ${nf2.format(rate)} botol × ${fmt(nDays)} hari`;
    const facts = [['Sehari', fmt(perDay)]];
    const w = Number(v.weight), rc = Number(v.recycle);
    if (v.weight !== '' && w > 0) { const kg = (total * w) / 1000; facts.push(['Berat plastik', kg >= 1000 ? `${nf2.format(kg / 1000)} tan` : `${nf2.format(kg)} kg`]); }
    if (v.recycle !== '' && rc >= 0 && rc <= 100) facts.push(['Tidak dikitar semula', fmt(total * (1 - rc / 100))]);
    $('#r-facts').innerHTML = facts.map(([k, x]) => `<dt>${k}</dt><dd>${x}</dd>`).join('');
  };
  form.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => { setScope(b.dataset.scope, true); calc(); }));
  form.addEventListener('input', (e) => { if (e.target.name === 'people' && pop(st.scope)) setScope('group', false); calc(); });
  setScope(st.scope, false);
  calc();
}

// ---------- skrin Rekod ----------
async function viewRekod(el) {
  const range = store.get('umtRange', 30);
  el.innerHTML = `<section class="screen">
    <h1 class="screen-title">Rekod</h1>
    <p><a class="link-row" href="#/hasil">‹ Hasil</a></p>
    <div class="row" style="margin-top:12px;justify-content:space-between">
      <span class="small">${me ? `Log masuk: <b>${esc(me.username)}</b>${me.role === 'admin' ? ' (pentadbir)' : ''}` : 'Tidak log masuk'}</span>
      ${me ? '<span><a class="btn btn-text" href="/api/umt/export.csv" download>Eksport CSV</a><button class="btn btn-text" id="logout">Log keluar</button></span>'
        : '<button class="btn btn-text" id="login-open">Log masuk</button>'}
    </div>
    <div class="block block-real" aria-labelledby="loc-h">
      <div class="row" style="justify-content:space-between"><h2 id="loc-h">Ikut lokasi</h2>
        <select id="range" aria-label="Tempoh" style="width:auto;min-height:44px">${[7, 30, 90].map((d) => `<option value="${d}" ${d === range ? 'selected' : ''}>${d} hari</option>`).join('')}</select></div>
      <div id="by-loc">${loading()}</div>
    </div>
    <div class="block block-real" aria-labelledby="list-h"><h2 id="list-h">Semua rekod</h2><div id="entries">${loading()}</div></div>
  </section>`;
  const load = async (silent = false) => {
    const days = Number($('#range').value); store.set('umtRange', days);
    try {
      const [s, rows] = await Promise.all([api('/api/umt/summary?days=' + days), api('/api/umt/entries?days=' + days)]);
      if (!el.isConnected) return;
      const sig = JSON.stringify([s.byLocation, rows]);
      if (silent && el.__sig === sig) return;
      el.__sig = sig;
      const max = Math.max(1, ...s.byLocation.map((l) => l.bottles));
      $('#by-loc').innerHTML = s.byLocation.length
        ? `<ul class="hbars">${s.byLocation.map((l) => `<li><span>${esc(l.location)}</span><b class="num">${fmt(l.bottles)}</b><div class="track" aria-hidden="true"><div class="fill" style="width:${(l.bottles / max) * 100}%"></div></div></li>`).join('')}</ul>`
        : `<div class="empty"><p>Tiada rekod dalam ${days} hari.</p></div>`;
      $('#entries').innerHTML = rows.length ? `<ul class="list">${rows.map((r) => `<li><div class="rec">
          <span class="where">${esc(r.location)}</span><span class="v">${fmt(r.bottles)}</span>
          <span class="sub">${esc(dayLabel(r.day))} · ${esc(r.bottle_type)}${r.people ? ` · ${fmt(r.people)} orang` : ''}${me && r.recorder ? ` · ${esc(r.recorder)}` : ''}${r.note ? ` · ${esc(r.note)}` : ''}</span>
          ${r.can_delete ? `<button class="btn btn-text del" data-del="${Number(r.id)}" aria-label="Padam rekod ${esc(dayLabel(r.day))}, ${esc(r.location)}">Padam</button>` : ''}
        </div></li>`).join('')}</ul>` : '<div class="empty"><p>Belum ada rekod.</p><p class="hint">Rekod pertama dibuat di tab Kira.</p></div>';
    } catch (e) { if (el.isConnected && !silent) { $('#entries').innerHTML = errorBlock(e.message); $('#by-loc').innerHTML = ''; } }
  };
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del]');
    if (b && await confirmDialog('Padam rekod ini? Tindakan ini tidak boleh dibatalkan.')) {
      try { await api('/api/umt/entries/' + b.dataset.del, { method: 'DELETE' }); toast('Rekod dipadam'); load(); } catch (err) { toast(err.message); }
    }
    if (e.target.closest('[data-retry]')) load();
    if (e.target.closest('#login-open') && await askLogin()) { toast('Log masuk berjaya'); route(); }
    if (e.target.closest('#logout')) { try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* kuki mungkin sudah tiada */ } me = null; toast('Log keluar'); route(); }
  });
  $('#range').addEventListener('change', () => load());
  load();
  live = () => load(true);
}

// ---------- versi app baru ----------
// Pelayan memberitahu bila fail app berubah. Muat semula sendiri supaya reka bentuk tak lapuk, tetapi jangan
// ganggu kiraan yang belum disimpan atau borang yang sedang ditaip: beritahu sahaja, dan muat semula bila selamat.
let bootV = null, versionToast = false;
async function checkVersion() {
  try {
    const { v } = await api('/api/version');
    if (bootV === null) { bootV = v; return; }
    if (v === bootV) return;
    const d = store.get('draft', {});
    const ae = document.activeElement;
    const typing = document.querySelector('dialog[open]') || (ae && ['INPUT', 'TEXTAREA'].includes(ae.tagName) && ae.value);
    if ((d.count || 0) > 0 || d.people || typing) {
      if (!versionToast) { versionToast = true; toast('Versi baharu tersedia. Ia dimuat semula bila kiraan disimpan.'); }
    } else location.reload();
  } catch { /* luar talian: cuba lagi minit depan */ }
}

// ---------- tarikh auto-kemas kini ----------
// Tarikh datang daripada server (waktu Kuala Lumpur). Disemak semula bila kembali ke tab, setiap minit,
// dan sebelum menyimpan; bila hari bertukar skrin dilukis semula supaya semua angka ikut hari baru.
let checkingDay = false;
async function refreshToday() {
  try {
    const c = await api('/api/config');
    const changed = c.today !== config.today;
    config = c;
    return changed;
  } catch { return false; } // luar talian: kekalkan tarikh sedia ada
}
async function checkDay() {
  if (checkingDay || !config) return;
  checkingDay = true;
  try { if (await refreshToday()) { toast('Hari baharu: ' + dayLabel(config.today, { weekday: 'long', day: 'numeric', month: 'short' })); route(); } }
  finally { checkingDay = false; }
}

// ---------- penghala ----------
const routes = {
  kira: ['Kira', 'kira', viewKira],
  jumlah: ['Jumlah', 'jumlah', viewJumlah],
  hasil: ['Hasil', 'hasil', viewHasil],
  berita: ['Berita', 'berita', viewBerita],
  kalkulator: ['Kalkulator', 'hasil', viewKalkulator],
  rekod: ['Rekod', 'hasil', viewRekod],
};
async function route() {
  const key = location.hash.replace('#/', '').replace(/^ringkasan$/, 'hasil').replace(/^umt$/, 'rekod') || 'kira';
  const [title, tab, view] = routes[key] || routes.kira;
  document.querySelectorAll('.tabs a').forEach((a) => (a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  document.title = `${title} · Kira Botol Terengganu`;
  live = null;
  const el = document.createElement('div'); // bekas baharu setiap lawatan: pendengar dan hasil lewat skrin lama digugurkan
  $('#view').replaceChildren(el);
  try { await view(el); } catch (e) { el.innerHTML = `<section class="screen">${errorBlock(e.message)}</section>`; el.querySelector('[data-retry]')?.addEventListener('click', route); }
}

async function boot() {
  try { [config, { user: me }] = await Promise.all([api('/api/config'), api('/api/auth/me')]); }
  catch (e) { $('#view').innerHTML = `<section class="screen">${errorBlock('Server tidak dapat dihubungi. ' + e.message)}</section>`; $('[data-retry]')?.addEventListener('click', boot); return; }
  // Segar sendiri: bila kembali ke tab dan setiap minit. Berhenti bila tab tersembunyi supaya tidak membazir bateri.
  let lastTick = 0;
  const tick = () => {
    if (document.visibilityState !== 'visible' || Date.now() - lastTick < 5_000) return;
    lastTick = Date.now();
    checkVersion();
    checkDay();
    live?.();
  };
  document.addEventListener('visibilitychange', tick);
  window.addEventListener('focus', tick);
  window.addEventListener('pageshow', tick);
  setInterval(tick, 60_000);
  checkVersion(); // catat versi semasa app dimuatkan
  window.addEventListener('hashchange', () => { route(); $('#view').focus({ preventScroll: true }); window.scrollTo(0, 0); });
  route();
}
boot();

// Shell luar talian dan pasang ke skrin utama. Pelayar hanya benarkan pada https atau localhost.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('/sw.js').catch(() => { /* app tetap berfungsi tanpa ini */ });
}
