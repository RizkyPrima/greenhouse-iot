# Katalog tanaman per organisasi (alur teknis)

> Pintu masuk utama pengguna adalah **AI Plant Setup** (`/plant-setup`). Dokumen ini tetap
> menjelaskan administrasi katalog dan pemulihan data untuk OWNER/ADMIN.

Katalog tanaman baru dimiliki satu organisasi. `OWNER` dan `ADMIN` organisasi dapat membuat katalog, menyusun draft versi dan parameter, lalu menerbitkannya. Anggota lain hanya dapat membaca katalog terbit milik organisasi tersebut. Keanggotaan pada organisasi lain dan izin platform tidak memberi akses tulis.

## Alur di aplikasi

1. Pilih organisasi, lalu gunakan **AI Plant Setup** untuk memberi identitas tanaman, meninjau kandidat parameter/stage, dan menyimpan draft.
2. Dari halaman setup, buka detail katalog untuk memeriksa draft. Plant Catalog tetap tersedia bagi OWNER/ADMIN untuk koreksi teknis; publikasi memerlukan tindakan manusia eksplisit.
3. Setelah standar terbit, gunakan **Plant Profiles** untuk membuat atau mengadopsi versi katalog dan memvalidasi konfigurasi stage.
4. Gunakan **Evidence & AI Review** untuk mencatat sumber yang telah diperiksa, memverifikasi evidence melalui alasan review, dan meminta recommendation ketika evidence cocok.

API katalog seluruhnya berada di bawah `/api/organizations/:organizationId/plant-catalog`. Server memeriksa membership pada setiap permintaan; operasi mutasi memerlukan role `OWNER` atau `ADMIN`. Profil baru dan adopsi versi hanya menerima versi terbit dari katalog organisasi yang sama.

## Transisi data katalog lama

Migration menambahkan `organizationId` nullable. Baris katalog lama tetap tersimpan tanpa pemilik sebagai sumber legacy; migration tidak menyalin atau menghapus data. Baris legacy tidak muncul di katalog organisasi dan tidak dapat dipakai untuk membuat profil baru atau diedit melalui alur tenant. Profil lama tetap mempertahankan relasinya dan dapat dibaca. Jika katalog lama perlu dipakai ke depan, operator harus merencanakan pemindahan/penyalinan ke organisasi yang tepat melalui perubahan terpisah setelah meninjau data aktual; migration ini tidak menebak pemilik.

Migration baru belum dijalankan oleh perubahan kode ini. Setelah deployment menerapkan migration melalui proses database yang disetujui, organisasi dapat mengelola katalog tanpa provisioning `PLANT_CATALOG_ADMIN` oleh developer. AI Plant Setup hanya membuat draft parameter/stage; tidak mengarang nilai, unit, sumber, evidence, atau hasil verifikasi.
