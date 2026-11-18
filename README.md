# Kira Botol Terengganu

App web (gaya app, bukan landing page) untuk kira penggunaan botol harian:

- **Kira** (skrin utama): papan tanda lokasi, ketik blok +1 atau taip nombor sendiri (Tambah nombor sendiri) untuk tambah botol, isi "Orang diperhati" untuk dapat kadar botol seorang, simpan rekod. Kiraan boleh dibuat tanpa akaun; menyimpan perlukan log masuk.
- **Jumlah**: foto jeti dan plat jumlah botol direkod di UMT untuk 7, 30, 90 hari atau semua; ayat lokasi teratas, bar ikut lokasi, carta harian (hari tertinggi diserlahkan, "Tiada data" bukan 0), palang ikut jenis botol. Ia hanya botol yang direkod, bukan semua yang digunakan. Reka bentuk Arah A oleh NEPO: [docs/rekabentuk/7-JUMLAH-ARAH-A](docs/rekabentuk/7-JUMLAH-ARAH-A/SPEK-JUMLAH.md).
- **Hasil**: kadar UMT (data sebenar), anggaran Kuala Terengganu (penduduk × kadar), sejarah 14 hari. Hari tanpa rekod dipapar "Tiada data", bukan 0. Dari sini ke **Kalkulator** (sendiri, kumpulan, UMT, Kuala Terengganu, Kuala Nerus, Terengganu; berat botol dan % kitar semula) dan **Rekod** (senarai, padam, eksport CSV).
- **Berita**: berita Terengganu sahaja (Google News, ditapis) dan laporan harian daripada rekod UMT.
- **PWA**: boleh dipasang ke skrin utama telefon; kerangka app dan data awam terakhir dibuka tanpa internet.

Kod visual: garis tebal pepejal = kiraan sebenar; jalur hitam-putih = anggaran.

## Jalankan

Perlu Node.js 24 atau lebih baru. Tiada `npm install`.

```powershell
npm start          # http://127.0.0.1:5173
npm test           # ujian API dan keselamatan
```

Data disimpan dalam `data/botol.db` (SQLite). Tukar port dengan `$env:PORT=8080`.

## Akaun penyumbang

**Daftar sendiri dengan kod jemputan (pilihan).** Set `INVITE_CODE` (sekurang-kurangnya 8 aksara) dan kongsi kod itu.
Dialog log masuk akan tunjuk "Daftar dengan kod jemputan"; akaun baharu sentiasa `contributor`. Tukar kod untuk
menghentikan kod lama; buang `INVITE_CODE` untuk menutup pendaftaran. Had: 10 cubaan daftar sejam setiap IP.
Akaun yang sudah dicipta tidak terjejas bila kod ditukar; sekat dengan `disable` jika perlu.

Pentadbir juga boleh cipta akaun di komputer server:

```powershell
node scripts/user.js add naim --role admin   # kata laluan diminta secara tersembunyi
node scripts/user.js add ali                 # penyumbang biasa
node scripts/user.js passwd ali              # tukar kata laluan, log keluar semua sesi
node scripts/user.js disable ali             # sekat akaun
node scripts/user.js list
```

| Peranan | Boleh |
| --- | --- |
| Awam (tanpa log masuk) | Lihat ringkasan, rekod (tanpa nama perekod), berita |
| `contributor` | Tambah rekod, padam rekod sendiri, eksport CSV |
| `admin` | Semua di atas, dan padam mana-mana rekod |

## Keselamatan

- Server dengar pada `127.0.0.1` sahaja secara lalai. Untuk rangkaian: `$env:HOST='0.0.0.0'`, hanya di belakang HTTPS
  (reverse proxy) dengan `$env:TRUST_PROXY='1'` atau `$env:COOKIE_SECURE='1'` supaya kuki ada bendera `Secure`.
- Kata laluan disimpan sebagai hash scrypt; kuki sesi `HttpOnly`, `SameSite=Strict`, tamat 7 hari; token disimpan sebagai hash SHA-256.
- Had kadar: 10 cubaan log masuk / 15 minit (setiap IP dan setiap nama), 60 tulisan / minit setiap pengguna, muat semula berita sekali seminit.
- Penulisan mesti JSON dan dari asal yang sama (menyekat CSRF). CSP, `nosniff`, `frame-ancestors 'none'` pada semua respons.
- Eksport CSV meneutralkan formula hamparan (`=`, `+`, `-`, `@`).

Pelan, stack, stakeholder dan fasa pembangunan: [docs/PLAN.md](docs/PLAN.md). Laluan Postgres: [docs/POSTGRES.md](docs/POSTGRES.md).

## Reka bentuk

Laut dan jeti Kuala Terengganu. Telefon: satu lajur. iPad potret (700-999px): skrin Kira dua lajur (kawalan di kiri, +1 besar di kanan) supaya muat tanpa skrol; skrin lain satu lajur lebih lebar. iPad landscape dan desktop (1000px ke atas): penuh lebar, dua lajur. Lima warna diambil daripada piksel foto sebenar; bahan dan sebab ada dalam [docs/rekabentuk](docs/rekabentuk/README.md).

- Fon: Barlow Semi Condensed (SIL OFL 1.1), dihos sendiri dalam `public/fonts/` bersama lesennya.
- Foto skrin Kira: jeniffertn, CC0 (domain awam), Wikimedia Commons (`public/img/jeti.jpg`); tiada kredit dipapar pada skrin kerana CC0 tidak mewajibkannya.
- Mod gelap belum direka.

## Kemas kini app

App menyemak versinya setiap minit (`GET /api/version`, iaitu masa fail terbaharu dalam `public/`). Bila fail app berubah ia dimuat semula sendiri, kecuali ada kiraan belum disimpan atau borang sedang ditaip; dalam kes itu ia hanya memberitahu. Fail kod (HTML, JS, CSS) diambil dari rangkaian dahulu oleh service worker supaya reka bentuk tak lapuk.
