# SimpanIdea: Fasa 0, ujian butang Share

Tujuan fasa ni satu sahaja: buktikan screenshot dari phone Android boleh sampai ke Google Drive dan Google Sheets kau melalui butang Share.

## Isi projek

| Folder | Kegunaan |
|---|---|
| `docs/` | App yang dipasang kat phone, dihoskan di GitHub Pages |
| `apps-script/` | Backend yang simpan data ke Drive dan Sheets |
| `tools/` | Pelayan ujian tempatan dan penjana ikon |
| `tests/` | Ujian backend |

## Langkah 1: Sediakan backend Google

1. Buka <https://script.google.com> dan tekan **New project**. Namakan `SimpanIdea`.
2. Padam kod contoh, kemudian tampal isi [apps-script/Code.gs](apps-script/Code.gs) ke dalam `Code.gs`.
3. Tekan **Project Settings** (ikon gear), dan tandakan **Show "appsscript.json" manifest file in editor**.
4. Balik ke **Editor**, buka `appsscript.json`, dan ganti isinya dengan [apps-script/appsscript.json](apps-script/appsscript.json).
5. Pilih fungsi `setup` di bar atas dan tekan **Run**. Benarkan akses bila diminta.
   - Kalau keluar amaran "Google hasn't verified this app", tekan **Advanced**, kemudian **Go to SimpanIdea**. Ini skrip kau sendiri.
6. Salin **kunci rahsia** daripada log di bawah. Jangan kongsi dengan sesiapa.
7. Tekan **Deploy → New deployment**, pilih jenis **Web app**:
   - **Execute as:** Me
   - **Who has access:** Anyone
8. Tekan **Deploy** dan salin **Web app URL** yang berakhir dengan `/exec`.

Sekarang Drive kau ada folder `SimpanIdea` dengan fail `SimpanIdea Data`.

"Anyone" diperlukan supaya app boleh sampai ke backend. Tanpa kunci rahsia, tiada apa boleh dibaca atau disimpan.

## Langkah 2: Letak app di GitHub Pages

1. Cipta repositori awam di GitHub, contohnya `simpanidea`, dan muat naik projek ni.
2. Pergi ke **Settings → Pages**.
3. Di **Source** pilih **Deploy from a branch**, kemudian branch `main` dan folder `/docs`. Tekan **Save**.
4. Tunggu seminit dua. Alamat app ialah `https://NAMA-KAU.github.io/simpanidea/`.

Kod boleh jadi awam sebab kunci rahsia dan data kau tak ada di dalamnya.

## Langkah 3: Pasang kat Android

1. Buka alamat app dalam **Chrome** kat phone.
2. Di **Tetapan**, tampal URL Web App dan kunci rahsia, kemudian tekan **Simpan dan uji**.
3. Pastikan **Sambungan ke Google: berjaya** ditanda.
4. Tekan **Pasang app**. Kalau butang tu tak keluar, buka menu Chrome (⋮) dan pilih **Add to Home screen** atau **Install app**, kemudian pilih **Install** kalau ditanya.
5. Buka SimpanIdea dari home screen sekali, dan isi tetapan semula kalau kosong.

## Langkah 4: Ujian sebenar

| # | Cuba | Hasil yang patut keluar |
|---|---|---|
| 1 | Ambil screenshot, tekan **Share → SimpanIdea** | Gambar masuk `SimpanIdea/Screenshot/<bulan>` dan ada satu baris baru dalam Sheet |
| 2 | Dari Gallery, pilih 3 gambar dan Share | 3 fail dan 3 baris |
| 3 | Dari Chrome, Share satu link | Baris jenis `link` dengan URL betul |
| 4 | Dari YouTube atau TikTok, Share satu video | Baris jenis `link` dengan URL betul |
| 5 | Hidupkan Airplane mode, Share screenshot, kemudian matikan semula | Item menunggu dalam barisan, dan masuk Drive selepas app dibuka semula |

SimpanIdea mungkin ambil beberapa minit untuk muncul dalam senarai Share selepas dipasang. Kalau masih tiada, mulakan semula phone.

## Kalau ada masalah

| Masalah | Sebab biasa | Cara betulkan |
|---|---|---|
| `Failed to fetch` atau "Belum sampai" berterusan | Web App bukan "Anyone" | Semak tetapan deployment |
| "Kunci rahsia salah" | Tersalah salin kunci | Jalankan `setup` semula untuk tengok kunci dalam log |
| SimpanIdea tiada dalam senarai Share | App cuma jadi pintasan, bukan dipasang | Buang dari home screen dan pasang semula guna Chrome |
| Kod Apps Script diubah tapi tak berkesan | Deployment lama masih digunakan | **Deploy → Manage deployments → Edit → New version** |

Kalau kunci terdedah, jalankan fungsi `rotateSecret` dan masukkan kunci baru dalam app.

## Ujian di komputer

```bash
node --test tests/backend.test.js
```

```bash
node tools/dev-server.js
```

Pelayan ujian menjalankan `Code.gs` dengan tiruan Google di <http://localhost:5173>, jadi tiada data sebenar disentuh. Kunci tiruan ada di `/mock-state`, dan URL backendnya ialah `http://localhost:5173/mock-exec`.

Butang Share sebenar, sambungan ke Google dan storan Drive hanya boleh disahkan melalui Langkah 4.
