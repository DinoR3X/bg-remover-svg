# Latar — Penghapus Background

Aplikasi web untuk menghapus latar belakang foto langsung di browser. Hasil dapat diekspor sebagai PNG transparan atau SVG yang membungkus PNG transparan.

## Menjalankan secara lokal

Sajikan folder ini melalui server HTTP lokal (bukan membuka `index.html` langsung), misalnya:

```bash
python3 -m http.server 8000
```

Lalu buka `http://localhost:8000`. Koneksi internet diperlukan saat pertama kali mesin AI diunduh (sekitar 55 MB). Foto diproses di browser dan tidak diunggah ke server.

## Berkas utama

- `index.html` — antarmuka aplikasi.
- `styles.css` — gaya dan tata letak.
- `app.js` — alur aplikasi dan ekspor.
- `engine.js` — konfigurasi engine browser-only: CPU dan model `isnet_quint8` untuk kompatibilitas perangkat, termasuk ponsel.
- `engine-core.js` — bundle lokal [IMG.LY Background Removal JS](https://github.com/imgly/background-removal-js) dan ONNX Runtime Web; foto tetap diproses di browser.

Catatan: SVG yang diekspor berisi PNG raster transparan; hasilnya bukan gambar vektor.

## Lisensi

Sumber aplikasi ini ditawarkan di bawah GNU Affero General Public License v3.0 atau yang lebih baru. Lihat [LICENSE](LICENSE). Mesin IMG.LY memiliki lisensi AGPL-3.0; lihat juga [repository upstream](https://github.com/imgly/background-removal-js).
