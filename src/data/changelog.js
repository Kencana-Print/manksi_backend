// ═══════════════════════════════════════════════════════════
// CHANGELOG — single source of truth untuk versi & riwayat rilis.
// Setiap naikkan version di package.json, tambahkan entry baru
// di sini (paling atas array = paling baru).
// ═══════════════════════════════════════════════════════════
const changelog = [
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
