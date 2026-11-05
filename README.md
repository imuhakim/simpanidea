# SimpanIdea

App peribadi untuk simpan screenshot, link, nota, tugasan, kad kanban, kelas online dan video dalam satu tempat. Data kau kekal dalam Google Drive dan Google Sheets kau sendiri.

| Bahagian | Kegunaan |
|---|---|
| **Inbox, Semua, Screenshot, Link, Nota** | Semua yang disimpan dari phone dan komputer |
| **Info Penting** | Gambar yang kau perlu rujuk semula, seperti resit dan tiket |
| **Tugasan** | Senarai tugasan dikumpul ikut tarikh |
| **Papan** | Kanban dengan lajur yang boleh ditambah dan kad yang boleh diseret |
| **Kelas** | Link, akaun, password disulitkan, dan rekod dah buka atau belum |
| **Tonton** | Video YouTube, TikTok dan Facebook dimainkan terus dalam app |
| **Resit** | Ambil gambar resit, dan AI isikan peniaga, tarikh, jumlah dan barangan |
| **Tanya AI** | Tanya apa saja, atau minta AI huraikan screenshot dan rekod kau |
| **Arkib** | Rekod yang keluar dari senarai harian, tapi kekal untuk dirujuk |
| **Sampah** | Rekod yang dipadam, boleh dipulihkan dalam 30 hari |

## Isi projek

| Folder | Kegunaan |
|---|---|
| `docs/` | App yang dipasang kat phone, dihoskan di GitHub Pages |
| `apps-script/` | Backend yang simpan data ke Drive dan Sheets |
| `tools/` | Pelayan ujian tempatan dan penjana ikon |
| `tests/` | Ujian backend, video dan penyulitan |

## Setup kali pertama

### Langkah 1: Backend Google

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

"Anyone" diperlukan supaya app boleh sampai ke backend. Tanpa kunci rahsia, tiada apa boleh dibaca atau disimpan.

### Langkah 2: Pasang kat Android

1. Buka <https://imuhakim.github.io/simpanidea/> dalam **Chrome** kat phone.
2. Tekan ikon menu (☰), dan pilih **Tetapan**. Tampal URL Web App dan kunci rahsia, kemudian tekan **Simpan dan uji**.
3. Pastikan **Sambungan ke Google berjaya** ada di bahagian Semakan.
4. Tekan **Pasang app** di Tetapan. Kalau butang tu tak keluar, buka menu Chrome (⋮) dan pilih **Add to Home screen** atau **Install app**.
5. Buka SimpanIdea dari home screen sekali, dan isi tetapan semula kalau kosong.

## Kemas kini backend

Bila `Code.gs` atau `appsscript.json` berubah, app mungkin papar amaran "Backend Google masih versi lama".

1. Tampal isi baru [apps-script/Code.gs](apps-script/Code.gs) dan [apps-script/appsscript.json](apps-script/appsscript.json) dalam Apps Script, dan simpan.
2. Pilih fungsi `setup` dan tekan **Run**. Kalau Google minta kebenaran baru, benarkan. Data dan kunci sedia ada tak berubah.
3. Tekan **Deploy → Manage deployments**, kemudian ikon pensil (**Edit**).
4. Di **Version**, pilih **New version**, dan tekan **Deploy**.

Cara ni mengekalkan URL yang sama, jadi tetapan app tak perlu diubah. Jangan pilih **New deployment**, sebab URL akan bertukar.

## Senarai ujian kat phone

| # | Cuba | Hasil yang patut keluar |
|---|---|---|
| 1 | Ambil screenshot, tekan **Share → SimpanIdea** | Masuk Inbox, folder `SimpanIdea/Screenshot/<bulan>`, dan tab `Item` |
| 2 | Dari Gallery, pilih 3 gambar dan Share | 3 fail dan 3 baris |
| 3 | Share satu link dari Chrome | Masuk Inbox dan tab Link |
| 4 | Share video dari YouTube, TikTok dan Facebook | Keluar dalam Tonton dan boleh dimainkan |
| 5 | Di Papan, tekan lama pada kad dan seret ke lajur lain | Kad pindah, dan kekal selepas tekan segerak |
| 6 | Di Info Penting, tekan **Ambil gambar** | Kamera terbuka, dan gambar tersimpan di situ |
| 7 | Hidupkan Airplane mode, tambah tugasan, kemudian matikan | Tugasan menunggu, dan masuk Sheet bila internet kembali |

SimpanIdea mungkin ambil beberapa minit untuk muncul dalam senarai Share selepas dipasang. Kalau masih tiada, mulakan semula phone.

## Password kelas

- Kali pertama kau simpan password, app minta kau cipta **kata laluan induk**.
- Password disulitkan dalam peranti sebelum dihantar, jadi Sheet cuma simpan teks yang tak boleh dibaca.
- Kata laluan induk tak disimpan di mana-mana. **Kalau lupa, password yang tersimpan tak boleh dipulihkan.**
- App mengunci semula selepas 15 minit, atau bila kau tekan **Kunci password**.
- Status kelas dan tarikh terakhir dibuka hanya direkod kalau kau buka kelas melalui butang **Buka** dalam app.

## Share dari iPhone

iPhone tak benarkan web app masuk senarai Share, jadi 2 Shortcut kecil menggantikannya. Langkah penuh ada di **Tetapan → Share dari iPhone**, dengan butang untuk menyalin URL dan kunci rahsia.

- **Simpan Gambar:** menerima gambar dari Photos, termasuk banyak gambar sekali gus.
- **Simpan Link:** menerima link dan teks dari Safari dan app lain.

Shortcut guna **kunci Shortcut** yang berasingan daripada kunci rahsia. Ia cuma boleh menambah item, dan tak boleh membaca, mengubah atau memadam data. Kalau tersebar, tekan **Tukar kunci** di Tetapan, dan kemas kini kedua-dua Shortcut.

## Info Penting tersorok

- Hanya tajuk dan tarikh kelihatan. Tekan ikon mata untuk tengok isi, dan tekan sekali lagi untuk sorok.
- Isi disorok semula bila kau tukar halaman, tinggalkan app, atau app dikunci.
- Rekod Info Penting tak muncul di Semua, Screenshot, Link dan Nota. Carian hanya melihat tajuknya.
- Tanya AI hanya menerima tajuknya, kecuali kau bertanya terus dari rekod tersebut.
- Ini penyorok paparan, bukan penyulitan. Isinya masih biasa dalam Drive dan Sheet, jadi jangan simpan password di sini. Gunakan Kelas untuk password.

## Resit

Tekan **Ambil gambar** di halaman Resit. Resit terus dimuat naik dan AI mengisi datanya, dipaparkan di sebelah gambar.

- **Perlu kunci API:** sama seperti Tanya AI, dan setiap imbasan dicaj kepada akaun API kau. Model ikut pilihan dalam panel Tanya AI.
- **Semak hasilnya:** AI boleh tersilap baca, terutama resit kabur atau pudar. Semua medan boleh dibetulkan.
- **Tiada kunci atau gagal:** resit tetap tersimpan, dan boleh diimbas kemudian dengan **Imbas dengan AI**.
- **Jumlah bulanan:** dikira ikut tarikh resit, dan diasingkan ikut mata wang.

## Tarikh dan masa

Semua rekod menunjukkan tarikh dan masa ia dibuat. Item yang menunggu internet kekal dengan masa ia dibuat di peranti, bukan masa ia sampai ke Google. Masa ini ikut jam peranti kau.

## Pindah, Arkib dan Sampah

- **Pindah:** buka rekod dan tekan **Pindah** untuk alihkan antara Nota, Info Penting, Tugasan dan Papan. Teks dan gambar ikut sekali.
- **Arkib:** rekod keluar dari senarai harian dan tinggal di **Arkib**, dan masih boleh dicari. Tekan **Keluarkan** untuk pulangkan.
- **Padam:** rekod masuk **Sampah**, dan boleh dipulihkan selama 30 hari. Selepas itu ia dibuang kekal bila app dibuka.
- **Padam kekal:** gambar dialih ke tong sampah Google Drive, dan rekod dibuang dari Sheet.

## Tanya AI

Tekan **Tanya AI** di bahagian atas, atau dalam mana-mana rekod. Dari screenshot, AI boleh tengok gambar tu dan menghuraikannya. Jawapan boleh disimpan sebagai nota, tugasan atau kad.

Untuk mula, kau perlu kunci API sendiri:

1. Buka <https://console.anthropic.com/settings/keys> dan log masuk.
2. Tambah kredit. API dibayar berasingan daripada langganan Claude, dan elok letak had belanja.
3. Cipta API key, dan tampal di **Tetapan → Tanya AI**.

Yang perlu tahu:

- **Kunci API:** disimpan dalam Script Properties di Apps Script kau, dan tak pernah dipulangkan kepada app.
- **Data yang dihantar ke Anthropic:** bila **Guna simpanan aku** ditanda, tajuk, catatan dan link dihantar sekali. Gambar hanya dihantar bila kau bertanya dari rekod tersebut.
- **Tak pernah dihantar:** password, username kelas, kunci rahsia, dan rekod dalam Sampah.
- **Kos:** setiap jawapan tunjuk jumlah token. Opus 5.5 ialah lalai dan paling mahal, manakala Haiku 5.5 paling murah. Tukar di bawah kotak soalan.
- **Had:** soalan melalui Apps Script, jadi jawapan muncul sekali gus dan jawapan panjang boleh dipotong. AI tak boleh mengubah data sendiri, dan tak boleh membuka link.

## Kunci PIN

- Hidupkan di **Tetapan → Kunci app**. PIN ialah 6 digit, dan berasingan untuk setiap peranti.
- App dikunci setiap kali dibuka, selepas tidak digunakan (1 hingga 30 minit, lalai 5), dan bila kau tekan ikon kunci di sidebar.
- Screenshot yang dikongsi tetap dihantar ke Google walaupun app terkunci, tapi kau perlu PIN untuk melihatnya.
- Selepas 5 kali salah, kau perlu tunggu 30 saat, dan tempoh ini bertambah sehingga 15 minit.
- **Lupa PIN?** Tekan butang tu di skrin kunci untuk kosongkan peranti. Data di Google selamat, tapi kau perlu masukkan URL Web App dan kunci rahsia semula, dan perubahan yang belum dihantar akan hilang.
- PIN menghalang orang yang memegang peranti daripada membuka app dengan mudah. Ia bukan penyulitan, jadi kunci skrin phone masih perlu dipasang, dan jangan isi tetapan di komputer yang dikongsi.

## Had Tonton

- Pemilik video boleh menghalang tontonan di luar app asal, dan video peribadi takkan dapat dimainkan. Butang **Buka di ...** sentiasa ada sebagai pilihan.
- Link pendek TikTok dan Facebook dibuka melalui backend untuk dapatkan alamat sebenar. Kalau gagal, gunakan butang tadi.

## Kalau ada masalah

| Masalah | Sebab biasa | Cara betulkan |
|---|---|---|
| `Failed to fetch` atau "Belum sampai" berterusan | Web App bukan "Anyone" | Semak tetapan deployment |
| "Kunci rahsia salah" | Tersalah salin kunci | Jalankan `setup` semula untuk tengok kunci dalam log |
| "Backend Google masih versi lama" | Kod baru belum di-deploy | Ikut **Kemas kini backend** di atas |
| Link pendek tak dapat dimainkan | Kebenaran baru belum diberi | Tampal `appsscript.json` baru, jalankan `setup`, dan benarkan |
| SimpanIdea tiada dalam senarai Share | App cuma jadi pintasan, bukan dipasang | Buang dari home screen dan pasang semula guna Chrome |

Kalau kunci rahsia terdedah, jalankan fungsi `rotateSecret` dan masukkan kunci baru dalam app.

## Ujian di komputer

```bash
node --test tests/backend.test.js tests/app-lib.test.mjs
```

```bash
node tools/dev-server.js
```

Pelayan ujian menjalankan `Code.gs` dengan tiruan Google di <http://localhost:5173>, jadi tiada data sebenar disentuh. Kunci tiruan ada di `/mock-state`, dan URL backendnya ialah `http://localhost:5173/mock-exec`.

Butang Share sebenar, sentuhan kat skrin phone, kamera, Google sebenar serta video TikTok dan Facebook hanya boleh disahkan kat phone kau.
