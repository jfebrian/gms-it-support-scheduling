# GMS IT Support Scheduling

Aplikasi web lokal untuk merencanakan dan melacak penugasan volunteer IT
Support di gereja-gereja lokal GMS wilayah Jakarta · Jawa Barat · Banten.

## Cara menjalankan

Pastikan [Node.js](https://nodejs.org) sudah terpasang.

Pertama kali saja:

```sh
npm install
```

Untuk menjalankan aplikasi:

```sh
npm run dev
```

Perintah ini mencetak URL lokal (biasanya `http://localhost:5173`) — buka
URL itu di browser. Perubahan yang dilakukan di UI langsung disimpan ke
file di `data/`, dan aplikasi membacanya kembali saat halaman di-refresh.

Untuk memastikan file data masih valid (berguna setelah edit manual atau
pull dari git):

```sh
npm run validate:data
```

## Lokasi data

Semua data yang dibaca dan ditulis aplikasi tersimpan di folder `data/` di
samping aplikasi: gereja, volunteer, jadwal bulanan, event, dan catatan
ketidaktersediaan. Folder ini berisi YAML biasa, jadi mudah untuk
di-backup, dibandingkan, dan dikelola dengan git. Kalau ada sesuatu yang
ingin diubah tapi belum tersedia di UI, file-nya bisa diedit langsung lalu
dijalankan `npm run validate:data` untuk memastikan tidak ada yang rusak.

Tidak ada data yang keluar dari komputer — tidak ada akun server, tidak ada
sinkronisasi cloud, tidak ada database bersama.

## Fitur

> Catatan: bagian ini menggambarkan fungsionalitas saat ini dan bisa
> berubah seiring waktu — yang lebih pasti adalah perintah di atas.

Sidebar punya tiga bagian.

### Jadwal

Halaman utama. Pilih bulan dengan tombol panah di header — URL ikut berubah
sehingga bulan tertentu bisa di-bookmark atau dibagikan.

Halaman ini punya dua tab:

- **Jadwal** — grid per gereja yang menampilkan semua shift mingguan dan
  semua event di bulan tersebut. Gereja livestream (Central Park, Gandaria)
  disematkan di atas supaya roster siaran terlihat lebih dulu. Setiap baris
  menampilkan tanggal, ibadah yang dicover oleh shift, dan volunteer yang
  ditugaskan.
- **Tidak tersedia** — tempat mencatat tanggal tertentu di mana seorang
  volunteer tidak bisa bertugas. Untuk hari mingguan rutin (misalnya selalu
  tidak bisa hari Minggu pagi), gunakan profil volunteer.

Dari halaman jadwal, hal yang bisa dilakukan:

- **Populate (acak)** — mengisi otomatis bulan kosong dengan randomizer
  yang adil. Algoritma menghindari volunteer yang sama bertugas dua kali di
  minggu yang sama, mengusahakan setiap volunteer mendapat minimal satu
  shift per bulan, dan memakai riwayat enam bulan terakhir untuk meratakan
  beban dari waktu ke waktu.
- **Klik sebuah cell** untuk mengganti volunteer di shift tertentu secara
  manual. Perubahan manual ditandai "confirmed" sehingga tombol populate
  tidak akan menimpanya pada putaran berikutnya.
- **Tambah event** (Jumat Agung, Natal, dll.) dan menugaskan volunteer ke
  banyak gereja sekaligus dalam satu form.
- **Share** — membuka tampilan bersih dan ramah-screenshot dari jadwal
  satu bulan penuh untuk dikirim ke tim.

### Gereja

Daftar gereja lokal di wilayah, dengan kode warna per gereja. Gunakan
**+ Tambah gereja** untuk mendaftarkan gereja baru (nama, warna, channel
livestream opsional), lalu buka detailnya untuk menyiapkan ibadah mingguan
dan shift-nya.

Halaman tiap gereja bisa digunakan untuk mengubah:

- **Ibadah mingguan** — daftar ibadah mingguan (Umum 1–7, AOG, EK Voltage,
  dst.), masing-masing dengan hari, jam, dan flag "IT Support" yang
  menandai apakah ibadah tersebut memerlukan volunteer IT.
- **Shift mingguan** — slot tugas volunteer. Satu shift bisa mencakup satu
  atau beberapa ibadah yang ditandai IT Support. Shift bisa dibatasi ke
  minggu tertentu saja (misalnya hanya minggu pertama) dan jumlah
  volunteer yang dibutuhkan bisa diatur.

Chip picker "Ibadah yang dicover" hanya menampilkan ibadah dengan flag IT
Support — ibadah tanpa flag (misalnya pelayanan anak) tidak ikut masuk ke
rotasi.

### Volunteer

Semua orang yang bisa dijadwalkan. Filter berdasarkan Aktif / Semua / Tidak
aktif. Setiap volunteer punya:

- Gereja asal (tempat biasanya melayani).
- Daftar gereja yang dapat ditugaskan.
- Jadwal tidak tersedia mingguan rutin (misalnya setiap Minggu pagi).
- Flag aktif/tidak aktif untuk mem-pause seseorang tanpa kehilangan
  riwayat tugas-tugas sebelumnya.
