# Katalog tanaman per organisasi

Katalog tanaman baru dimiliki satu organisasi. `OWNER` dan `ADMIN` organisasi dapat membuat katalog, menyusun draft versi dan parameter, lalu menerbitkannya. Anggota lain hanya dapat membaca katalog terbit milik organisasi tersebut. Keanggotaan pada organisasi lain dan izin platform tidak memberi akses tulis.

## Alur di aplikasi

1. Pilih organisasi, lalu buka **Plant Catalog**.
2. Sebagai `OWNER` atau `ADMIN`, gunakan **Buat katalog**.
3. Buka katalog, buat draft versi, isi konfigurasi JSON dan definisi parameter, lalu pilih **Publish**. Backend memvalidasi konfigurasi saat penerbitan.
4. Buka **Plant Profiles** dan pilih versi terbit milik organisasi itu.

API katalog seluruhnya berada di bawah `/api/organizations/:organizationId/plant-catalog`. Server memeriksa membership pada setiap permintaan; operasi mutasi memerlukan role `OWNER` atau `ADMIN`. Profil baru dan adopsi versi hanya menerima versi terbit dari katalog organisasi yang sama.

## Transisi data katalog lama

Migration menambahkan `organizationId` nullable. Baris katalog lama tetap tersimpan tanpa pemilik sebagai sumber legacy; migration tidak menyalin atau menghapus data. Baris legacy tidak muncul di katalog organisasi dan tidak dapat dipakai untuk membuat profil baru atau diedit melalui alur tenant. Profil lama tetap mempertahankan relasinya dan dapat dibaca. Jika katalog lama perlu dipakai ke depan, operator harus merencanakan pemindahan/penyalinan ke organisasi yang tepat melalui perubahan terpisah setelah meninjau data aktual; migration ini tidak menebak pemilik.

Migration baru belum dijalankan oleh perubahan kode ini. Setelah deployment menerapkan migration melalui proses database yang disetujui, organisasi dapat mengelola katalog tanpa provisioning `PLANT_CATALOG_ADMIN` oleh developer.
