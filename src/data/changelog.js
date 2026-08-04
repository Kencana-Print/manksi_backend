// ═══════════════════════════════════════════════════════════
// CHANGELOG — single source of truth untuk versi & riwayat rilis.
// Setiap naikkan version di package.json, tambahkan entry baru
// di sini (paling atas array = paling baru).
// ═══════════════════════════════════════════════════════════
const changelog = [
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
