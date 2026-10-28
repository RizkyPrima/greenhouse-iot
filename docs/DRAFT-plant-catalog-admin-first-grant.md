# DRAFT — Provisioning awal `PLANT_CATALOG_ADMIN`

> **STATUS: BELUM DISETUJUI — DILARANG DIGUNAKAN UNTUK PROVISIONING.**
>
> Dokumen ini adalah rancangan untuk ditinjau oleh pemilik layanan, pemilik perubahan, dan fungsi keamanan. Dokumen ini tidak memberi otorisasi, bukan prosedur operasional yang disetujui, dan tidak boleh digunakan untuk membuat atau mengubah grant.

## Tujuan dan batas

Rancangan ini membahas hanya penerbitan grant platform pertama dengan permission `PLANT_CATALOG_ADMIN`. Grant tersebut membuka akses ke operasi platform-admin katalog yang dijaga `PlatformAdminGuard`. Rancangan ini tidak membuat pengguna, tidak mengubah role organisasi, dan tidak mencakup grant permission lain.

`RESEARCH_SOURCE_GRANT_ADMIN` adalah permission berbeda dengan bootstrap dan runbook tersendiri (`phase10-4-2i-platform-admin-bootstrap.md`). Script dan prosedur tersebut tidak membuat grant katalog dan tidak boleh dipakai sebagai jalan pintas. Runbook itu juga menyatakan signer approval tepercaya belum tersedia; JWT akses aplikasi biasa maupun `JWT_SECRET` bukan approval yang dapat dipercaya.

## Status implementasi dan keputusan terbuka

Di repository belum ditemukan prosedur resmi atau mekanisme approval tepercaya untuk provisioning pertama `PLANT_CATALOG_ADMIN`. Controller menyatakan grant pertama dilakukan out of band, tetapi tidak mendefinisikan otorisasi, signer, operator, maupun proses eksekusinya. Guard memerlukan grant katalog aktif; ini tidak menyediakan bootstrap pertama.

Sebelum rancangan ini dapat disetujui, pemilik layanan dan pemilik perubahan harus menunjuk peran approver/change owner, menentukan mekanisme approval bertanda tangan yang diverifikasi server-side, menetapkan operator yang berwenang, dan menyetujui target, bukti audit, verifikasi, serta pemulihan. Nama orang, signer, layanan approval, kunci, dan perintah eksekusi belum ditetapkan di sini karena belum tersedia dalam implementasi.

## Kontrol yang wajib dirancang dan disetujui

### Persetujuan tepercaya dan pengikatan target

- Approver/change owner yang ditunjuk melalui tata kelola organisasi menyetujui change record sebelum operasi. Identitas/peran approver dan bukti persetujuan disimpan di sistem perubahan resmi; dokumen ini tidak menunjuk individu.
- Mekanisme approval harus memakai issuer/signer tepercaya yang disetujui dan verifikasi kriptografis pada sisi server/tool provisioning. Private key tidak diberikan kepada operator. JWT akses aplikasi, `JWT_SECRET`, klaim yang dikirim sendiri, atau persetujuan lisan bukan pengganti mekanisme tersebut.
- Bukti approval harus berumur pendek, sekali pakai atau terlindung replay, dan mengikat secara tak ambigu setidaknya: permission persis `PLANT_CATALOG_ADMIN`, ID stabil penerima (`User.id`), identitas operator terautentikasi, change reference, environment, identitas target database, waktu berlaku, issuer, dan audience. Validasi harus gagal tertutup bila klaim tidak cocok, kedaluwarsa, atau tidak dapat diverifikasi.
- Sebelum perubahan, operator yang berwenang melakukan preflight baca-saja terhadap identitas database dan akun penerima melalui sumber resmi independen. Cocokkan target database/environment dan ID penerima dengan approval; pastikan penerima aktif dan tinjau grant/audit relevan. Ketidakcocokan, grant aktif yang sudah ada, atau target yang ambigu berarti berhenti dan minta keputusan perubahan terpisah.

### Operator, transaksi, dan audit

- Operator harus ditunjuk dalam proses perubahan resmi dan diautentikasi secara terpisah dari approver. Tidak ada operator tertentu atau jalur CLI yang disetujui saat ini.
- Desain implementasi harus membuat satu grant katalog dan catatan audit terkait dalam satu transaksi database atomik. Kegagalan pembuatan audit harus membatalkan grant; kegagalan grant tidak boleh meninggalkan audit keberhasilan. Desain concurrency/lock dan perlindungan terhadap replay harus ditinjau sebelum persetujuan.
- Catatan harus menghubungkan ID grant, penerima, permission, operator sebagai aktor/pemberi, change reference, dan waktu. Rahasia, token approval, private key, kredensial, serta data sensitif tidak boleh masuk metadata audit.
- Tidak ada perintah SQL langsung atau perubahan grant manual dalam rancangan ini. Cara menjalankan transaksi harus berasal dari implementasi yang ditinjau dan disetujui, bukan disimpulkan dari runbook research grant.

### Verifikasi baca-saja

Sesudah prosedur yang kelak disetujui, lakukan verifikasi melalui endpoint read-only yang dijaga `PlatformAdminGuard` atau mekanisme baca-saja resmi yang ditinjau. Cocokkan environment/target, permission persis `PLANT_CATALOG_ADMIN`, penerima yang disetujui, waktu pemberian, status aktif, serta catatan audit yang menunjuk grant dan change reference yang sama. Pastikan tidak ada grant permission lain yang berubah. Simpan bukti hasil baca-saja pada change record; jangan menyimpan token atau kredensial.

Endpoint daftar grant saat ini juga memerlukan grant katalog aktif. Karena itu endpoint tersebut tidak dapat dipakai untuk memverifikasi grant pertama sebelum akses telah tersedia; rancangan prosedur harus menentukan pembacaan pasca-perubahan yang aman tanpa melemahkan guard atau membocorkan grant permission lain.

### Kegagalan dan pemulihan

- Jika approval, target, identitas penerima, atau hasil verifikasi tidak cocok, hentikan proses tanpa mutasi dan eskalasi kepada pemilik perubahan.
- Jika operasi gagal atau responsnya ambigu, jangan mengulang atau mencoba jalur lain. Minta operator berwenang melakukan inspeksi baca-saja pada grant dan audit untuk memastikan apakah transaksi berhasil atau rollback.
- Jika audit gagal, transaksi wajib rollback. Jika keadaan tidak konsisten, grant salah penerima, atau grant ganda terdeteksi, hentikan penggunaan, pertahankan bukti, dan minta change pemulihan terpisah yang disetujui. Pemulihan hanya melalui mekanisme aplikasi yang sudah diotorisasi; jangan menulis langsung ke database, mem-bypass guard, atau memakai grant/role lain sebagai pengganti.
- Jika tidak ada admin katalog aktif untuk melakukan pemulihan, proses harus berhenti sampai desain break-glass yang tepercaya, diaudit, dan disetujui tersedia. Dokumen ini bukan prosedur break-glass.

## Gerbang persetujuan sebelum prosedur dapat dipakai

Semua butir berikut harus memiliki pemilik dan bukti persetujuan pada change record: pemilik layanan; approver/change owner; signer/issuer dan cara verifikasi; pengikatan approval ke operator, permission, penerima, target, dan change; implementasi transaksi grant+audit serta kontrol replay/concurrency; operator berwenang; metode preflight dan verifikasi baca-saja; rencana recovery; serta kaji keamanan dan operasional. Sampai implementasi dan persetujuan tersebut tersedia, status provisioning pertama tetap **terblokir**.
