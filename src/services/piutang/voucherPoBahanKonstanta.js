// services/piutang/voucherPoBahanKonstanta.js
// Tipe nota POB: PO Bahan (jenis 0 & 3), Greige (1) dan Celup (2) dipanggil
// langsung ke Voucher Pembayaran. Menggantikan tipe PCL.

const TIPE_PO_BAHAN = "POB";

// po_jenis: 0 = Bahan (lama, diperlakukan sama dengan 3), 1 = Greige,
// 2 = Celup, 3 = Bahan. Jenis 4 (Lain-lain) tetap tipe POL.
const JENIS_PO_BAHAN = [0, 1, 2, 3];

const LABEL_JENIS_PO = {
  0: "PO Bahan",
  1: "PO Greige",
  2: "PO Celup",
  3: "PO Bahan",
};

// PO bertanggal sebelum ini tidak muncul dan tidak bisa dipanggil sebagai POB
// (data PO 2019 dst. belum punya riwayat voucher di sistem ini).
// Ditetapkan user 27 Okt 2026: mulai hari ini. Dipakai juga oleh Daftar Hutang
// untuk baris PO Greige.
const TANGGAL_MULAI_PO_BAHAN = "2026-10-27";

// Syarat "BPB b milik PO p" untuk aturan anti-dobel bayar POB vs BPB.
// - Umumnya BPB menunjuk PO lewat bpb_po_nomor.
// - BPB Celup pola baru: bpb_po_nomor = PO Greige, bpb_keterangan = PO Celup.
//   BPB itu milik PO Celup, BUKAN milik PO Greige (beda supplier, beda hutang).
// - Akibatnya PO Greige praktis tidak punya BPB sendiri.
// b, p = alias tabel tbpb_hdr dan tpo_hdr (boleh nama tabelnya jika tanpa alias).
const SQL_BPB_MILIK_PO = (b, p) => `(
  (${b}.bpb_po_nomor = ${p}.po_nomor
    AND NOT EXISTS (
      SELECT 1 FROM tpo_hdr kc
      WHERE kc.po_nomor = ${b}.bpb_keterangan
        AND kc.po_jenis = 2
        AND kc.po_nomor <> ${p}.po_nomor))
  OR (${p}.po_jenis = 2 AND ${b}.bpb_keterangan = ${p}.po_nomor)
)`;

module.exports = {
  TIPE_PO_BAHAN,
  JENIS_PO_BAHAN,
  LABEL_JENIS_PO,
  TANGGAL_MULAI_PO_BAHAN,
  SQL_BPB_MILIK_PO,
};
