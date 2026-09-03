// ═══════════════════════════════════════════════════════════
// CHANGELOG — single source of truth untuk versi & riwayat rilis.
// Setiap naikkan version di package.json, tambahkan entry baru
// di sini (paling atas array = paling baru).
// ═══════════════════════════════════════════════════════════
const changelog = [
  {
    version: "1.0.7",
    date: "2026-09-03",
    changes: [
      {
        type: "added",
        text: "Penambahan Nomor SPK pada Laporan Stok Bahan Barcode (bagian detail), di samping Nomor PO Bahan.",
      },
      {
        type: "added",
        text: 'Kategori Stok Bahan Barcode: barcode dengan berat < 3 kg masuk Stok Reguler, ≥ 3 kg masuk Stok Ecer (nama bahan barcode otomatis mendapat tambahan karakter "-R").',
      },
      {
        type: "added",
        text: "Klasifikasi umur stok pada Laporan Umur Stok Bahan: Perhatian (6–12 bulan), Slow Moving (12–24 bulan), Dead Stock (>24 bulan), dengan pewarnaan teks sesuai kategori.",
      },
      {
        type: "added",
        text: "Penambahan Bottom Stock pada Laporan Kartu Stok Bahan, khusus bahan project Kaosan, Reszo, dan Kiddify — baris dengan stok di bawah bottom stock ditandai warna merah.",
      },
      {
        type: "added",
        text: "Penambahan kolom SO yang belum dibuatkan MKB pada halaman Browse Memo Kebutuhan Bahan (MKB).",
      },
      {
        type: "added",
        text: "Sales Order bersifat Repeat kini bisa diinput lewat kolom Repeat SO atau dengan memanggil nomor MAP terkait, sehingga referensi MAP dan kebutuhan Accessories/Bahan dari BAST MAP tetap terjaga — khusus jenis order Baju Uniform (BU), Wearpack (WP), Jas Almamater (JS), dan Jaket (JK).",
      },
      {
        type: "added",
        text: "Pada halaman SPK tab Keterangan bagian Kebutuhan Accessories, ditambahkan opsi pencarian kode Accessories dari database untuk SO yang tidak mereferensikan MAP.",
      },
      {
        type: "added",
        text: "Laporan SPK vs Realisasi vs LHK Cutting kini bisa memfilter jenis kain dan menampilkan total pemakaian (kg) per bahan.",
      },
      {
        type: "added",
        text: "Browse MAP (MAP Terbit) kini bisa difilter berdasarkan periode tanggal.",
      },
      {
        type: "added",
        text: "Realisasi Permintaan Bahan kini menampilkan warning jika bahan yang dikeluarkan berbeda dengan Permintaan Bahan/MKB; setelah pengajuan beda bahan disetujui melalui Approval, Permintaan Bahan terkait otomatis ter-close.",
      },
      {
        type: "added",
        text: "Penambahan Dashboard Gudang, meliputi: MAP/SPK yang belum ada permintaan maupun realisasi bahan, Permintaan Bahan yang belum direalisasi, PO Bahan yang belum datang, SO yang belum dibuatkan MKB, MKA yang belum terealisasi, Stok Bebas (Free Stock), dan Monitoring Buffer bahan & aksesoris Kaosan.",
      },
      {
        type: "added",
        text: "Browse Realisasi Permintaan Bahan kini menampilkan nomor Permintaan Bahan yang masih OPEN/belum direalisasi, sama seperti daftar SPK belum dibuatkan MKB pada halaman Browse MKB — mempercepat proses input.",
      },
      {
        type: "added",
        text: "Form MKA: tombol Enter kini berpindah ke kolom berikutnya, mempercepat proses input data.",
      },
      {
        type: "fixed",
        text: "Perbaikan Export Detail pada Laporan SPK vs Realisasi vs LHK Cutting, termasuk penyesuaian total summary agar sesuai dengan kolomnya masing-masing.",
      },
      {
        type: "fixed",
        text: "Revisi Laporan Realisasi Keluar Bahan: penambahan kolom Berat Potong (Kg), Std Actual, dan Selisih Berat (Kg); status kini ditampilkan sebagai chip, bukan pewarnaan baris.",
      },
      {
        type: "fixed",
        text: "Permintaan Bahan tidak lagi otomatis CLOSE jika masih ada bahan yang belum terpenuhi — status CLOSE hanya berlaku untuk Permintaan yang sudah direalisasi penuh oleh Gudang.",
      },
      {
        type: "fixed",
        text: "Approve Retur: status merah diperbaiki; bahan yang sudah masuk stok barcode kini nama bahannya tampil dengan benar di Laporan Stok Bahan Barcode.",
      },
      {
        type: "fixed",
        text: "Permintaan Bahan kini dicegah menambah detail baru pada nomor yang statusnya sudah CLOSE.",
      },
      {
        type: "fixed",
        text: "Permintaan Bahan tidak bisa diubah lagi setelah direalisasi oleh Gudang (berlaku untuk realisasi penuh maupun sebagian).",
      },
      {
        type: "fixed",
        text: "Perbaikan Export Detail pada halaman Permintaan Bahan, agar memperhitungkan filter yang sedang aktif dari user.",
      },
    ],
  },
  {
    version: "1.0.6",
    date: "2026-09-02",
    changes: [
      {
        type: "added",
        text: "Modul Baru Komitmen Kirim, digunakan untuk membantu tim Marketing dan PPIC dalam menyusun jadwal pada meeting tiap hari Senin. Dilengkapi dengan fitur Kolaborasi Real-time — beberapa user (Marketing & PPIC) bisa mengedit dokumen yang sama secara bersamaan tanpa saling menimpa data, lengkap dengan indikator siapa saja yang sedang membuka dan sedang mengetik di field yang sama.",
      },
    ],
  },
  {
    version: "1.0.5",
    date: "2026-08-27",
    changes: [
      {
        type: "added",
        text: "Baru : Saat buat MPPB, harus memanggil nomor Penawaran dan Detail Penawarannya, kalau tidak maka tidak bisa disimpan",
      },
    ],
  },
  {
    version: "1.0.4",
    date: "2026-08-26",
    changes: [
      {
        type: "added",
        text: "Fitur Baru : Agenda Kerja per Departemen, agenda dapat diinputkan oleh PIC per departemen dan bisa dilihat sesuai departemen masing-masing",
      },
      {
        type: "added",
        text: "Warning/peringatan ketika input Mutasi Produksi, jumlah tidak sesuai dengan mutasi/LHK proses sebelumnya",
      },
      {
        type: "fixed",
        text: "Perbaikan Export (terutama di bagian Penjualan)",
      },
    ],
  },
  {
    version: "1.0.3",
    date: "2026-08-21",
    changes: [
      {
        type: "added",
        text: "Laporan baru : Laporan Umur Stock Bahan untuk Gudang Bahan",
      },
    ],
  },
  {
    version: "1.0.2",
    date: "2026-08-19",
    changes: [
      {
        type: "added",
        text: "Laporan baru : Laporan Realisasi Keluar Bahan untuk Gudang",
      },
    ],
  },
  {
    version: "1.0.1",
    date: "2026-08-15",
    changes: [
      {
        type: "added",
        text: "Pada Realisasi Permintaan Bahan, jika barcode bahan yang discan berbeda dengan permintaan/MKB, maka statusnya menjadi pasif dan stok belum terpotong. Harus meminta approval terlebih dahulu dan MKB-nya diubah agar dapat aktif dan memotong stok bahan barcode",
      },
      {
        type: "added",
        text: "Sistem Tab: sekarang buka menu baru tidak perlu klik kanan > buka tab baru lagi. Semua halaman yang dibuka akan muncul sebagai tab di bagian atas, tetap dalam satu jendela — hemat memori dan gampang berpindah antar transaksi. Bisa digeser pakai scroll mouse, dinavigasi pakai tombol panah keyboard, dan ditutup satu-per-satu atau sekaligus lewat klik kanan.",
      },
      {
        type: "fixed",
        text: "Optimasi query browse Sales Order",
      },
    ],
  },
  {
    version: "1.0.0",
    date: "2026-08-04",
    changes: [
      {
        type: "added",
        text: "Rilis awal MANKSI Web — migrasi ERP produksi garmen dari aplikasi desktop ke web.",
      },
      {
        type: "added",
        text: "Modul Pembelian: Memo Kebutuhan Bahan (MKB) dan PO Bahan",
      },
      {
        type: "added",
        text: "Modul PPIC: Proof Garmen, Cetak BAST-MAP, SPK, Planning SPK PPiC, LHK Pola.",
      },
      {
        type: "added",
        text: "Modul Garmen: Bahan, Bahan Jadi, Barang Garmen, PO Jasa, Approve PO Jasa, BPB Jasa, PO Internal MAP, PO Internal SPK, Planning per SPK, Mutasi Produksi.",
      },
      {
        type: "added",
        text: "Modul Penjualan: MPPB, Permintaan Harga, Penawaran, MAP, Sales Order, Jadwal Kirim, Invoice, Surat Jalan, Cetak Kuitansi, Cetak Faktur Pajak.",
      },
      {
        type: "added",
        text: "Modul Finance: Penerimaan dan Pelunasan Piutang.",
      },
      {
        type: "added",
        text: "Tools: Master User, Appproval, dan Relationship Map.",
      },
      {
        type: "added",
        text: "Dashboard operasional untuk Marketing, Finance, Gudang, dan Produksi.",
      },
    ],
  },
  {
    version: "0.0.1",
    date: "2026-07-01",
    changes: [
      {
        type: "changed",
        text: "Versi beta manksi web.",
      },
    ],
  },
];

module.exports = changelog;
