const db = require("../../../config/database");

/**
 * ═══════════════════════════════════════════════════════════
 * LAPORAN PROYEKSI BULANAN
 * Migrasi dari ufrmBrowseProyeksi_mtd.pas (Delphi)
 *
 * ⚠️ Flag hak akses: form Delphi ini TIDAK PERNAH mengecek zcus,
 * zLihatHarga, zLihatBeli, ATAUPUN zLihatSup di manapun. Kolom
 * Customer & Harga SELALU tampil tanpa gating apapun — direplikasi
 * apa adanya, JANGAN ditambah gating yang tidak ada dasarnya.
 *
 * 4 mode laporan (cbopsi.ItemIndex di Delphi, di sini pakai 1-4):
 *   1 = Proyeksi   (union: Memo SPK belum jadi SPK + Penawaran
 *                   belum jadi Memo/SPK)
 *   2 = Penawaran  (union cetaktotal=0 + cetaktotal=1)
 *   3 = Memo SPK   (tmemospk yang belum jadi SPK)
 *   4 = SPK        (tspk aktif)
 *
 * Tidak ada filter divisi di form ini — cuma Periode + Laporan.
 * ═══════════════════════════════════════════════════════════
 */

// Ekspresi jumlah_meter — replikasi persis logic per-divisi Delphi:
// divisi 4 = qty apa adanya, divisi 1 = qty*panjang,
// divisi 5 = qty*panjang*lebar, lainnya = qty*1.
const jumlahMeterExpr = (divisiCol, qtyCol, panjangCol, lebarCol) => `
  ${qtyCol} * IF(${divisiCol}=4, 1,
    IF(${divisiCol}=1, ${panjangCol},
      IF(${divisiCol}=5, ${panjangCol} * ${lebarCol}, 1)))
`;

// ─────────────────────────────────────────────────────────
// MODE 1 — PROYEKSI
// ⚠️ QUIRK SUMBER: cabang "cetaktotal=0" di Delphi pakai
// "GROUP BY 1" (group by pend_pen_nomor) sambil SELECT banyak
// kolom non-agregat (mengandalkan mode longgar MySQL lama, ambil
// baris arbitrer per grup). Direplikasi persis dengan
// GROUP BY d.pend_pen_nomor — kalau server pakai sql_mode
// ONLY_FULL_GROUP_BY (default MySQL 8), query ini akan ERROR.
// Cek sql_mode server dulu sebelum deploy; TIDAK diperbaiki
// sepihak jadi agregat proper karena bisa mengubah baris yang
// muncul (mis. ambil harga termurah vs baris pertama).
// ─────────────────────────────────────────────────────────
const getProyeksi = async (startDate, endDate) => {
  const jmMemo = jumlahMeterExpr(
    "s.mspk_divisi",
    "s.mspk_rencana_order",
    "s.mspk_panjang",
    "s.mspk_lebar",
  );
  const jmPen = jumlahMeterExpr(
    "h.pen_divisi",
    "d.pend_qty",
    "d.pend_panjang",
    "d.pend_lebar",
  );
  const sql = `
    SELECT c.cus_nama AS Customer, s.mspk_nama AS NamaSpk, sl.sal_nama AS Sales,
           dv.divisi AS Divisi, s.mspk_tipe AS Tipe, s.mspk_panjang AS Panjang,
           s.mspk_lebar AS Lebar, ${jmMemo} AS JumlahMeter,
           s.mspk_rencana_order AS Qty, s.mspk_harga AS Harga,
           s.mspk_rencana_order * s.mspk_harga AS Jumlah
    FROM tmemospk s
    LEFT JOIN tdivisi dv ON dv.kode = s.mspk_divisi
    LEFT JOIN tcustomer c ON c.cus_kode = s.mspk_cus_kode
    LEFT JOIN tsales sl ON sl.sal_kode = s.mspk_sal_kode
    WHERE s.mspk_tanggal BETWEEN ? AND ?
      AND s.mspk_aktif = 'Y'
      AND s.mspk_nomor NOT IN (SELECT DISTINCT spk_memo FROM tspk WHERE spk_memo <> '')
      AND s.mspk_nomor NOT IN (SELECT DISTINCT so_memo FROM tsalesorder WHERE so_memo <> '')
      AND s.mspk_rencana_order > 0
    UNION ALL
    SELECT c.cus_nama AS Customer, d.pend_nama_barang AS NamaSpk, sl.sal_nama AS Sales,
           dv.divisi AS Divisi, h.pen_tipe AS Tipe, d.pend_panjang AS Panjang,
           d.pend_lebar AS Lebar, ${jmPen} AS JumlahMeter,
           d.pend_qty AS Qty, d.pend_harga AS Harga,
           MIN(d.pend_harga * d.pend_qty) AS Jumlah
    FROM tpenawaran_hdr h
    INNER JOIN tpenawaran_dtl d ON d.pend_pen_nomor = h.pen_nomor
    INNER JOIN tsales sl ON sl.sal_kode = h.pen_sal_kode
    INNER JOIN tdivisi dv ON dv.kode = h.pen_divisi
    INNER JOIN tcustomer c ON c.cus_kode = h.pen_cus_kode
    WHERE h.pen_tanggal BETWEEN ? AND ?
      AND h.pen_cetaktotal = 0
      AND d.pend_status = ''
      AND h.pen_nomor NOT IN (SELECT DISTINCT mspk_pen_nomor FROM tmemospk)
      AND h.pen_nomor NOT IN (SELECT DISTINCT spk_pen_nomor FROM tspk WHERE spk_pen_nomor <> '')
      AND h.pen_nomor NOT IN (SELECT DISTINCT so_pen_nomor FROM tsalesorder WHERE so_pen_nomor <> '')
    GROUP BY d.pend_pen_nomor
    UNION ALL
    SELECT c.cus_nama AS Customer, d.pend_nama_barang AS NamaSpk, sl.sal_nama AS Sales,
           dv.divisi AS Divisi, h.pen_tipe AS Tipe, d.pend_panjang AS Panjang,
           d.pend_lebar AS Lebar, ${jmPen} AS JumlahMeter,
           d.pend_qty AS Qty, d.pend_harga AS Harga,
           (d.pend_harga * d.pend_qty) AS Jumlah
    FROM tpenawaran_hdr h
    INNER JOIN tpenawaran_dtl d ON d.pend_pen_nomor = h.pen_nomor
    INNER JOIN tsales sl ON sl.sal_kode = h.pen_sal_kode
    INNER JOIN tdivisi dv ON dv.kode = h.pen_divisi
    INNER JOIN tcustomer c ON c.cus_kode = h.pen_cus_kode
    WHERE h.pen_tanggal BETWEEN ? AND ?
      AND h.pen_cetaktotal = 1
      AND d.pend_status = ''
      AND h.pen_nomor NOT IN (SELECT DISTINCT mspk_pen_nomor FROM tmemospk)
      AND h.pen_nomor NOT IN (SELECT DISTINCT spk_pen_nomor FROM tspk WHERE spk_pen_nomor <> '')
      AND h.pen_nomor NOT IN (SELECT DISTINCT so_pen_nomor FROM tsalesorder WHERE so_pen_nomor <> '')
  `;
  const params = [startDate, endDate, startDate, endDate, startDate, endDate];
  const [rows] = await db.query(sql, params);
  return rows;
};

// ─────────────────────────────────────────────────────────
// MODE 2 — PENAWARAN
// Sama persis pola union cetaktotal=0 (GROUP BY quirk sama seperti
// di atas) + cetaktotal=1, tapi berdiri sendiri (bukan bagian dari
// proyeksi) dengan kolom lebih lengkap (Penawaran nomor, Keterangan,
// Bahan ikut ditampilkan).
// ─────────────────────────────────────────────────────────
const getPenawaran = async (startDate, endDate) => {
  const jmPen = jumlahMeterExpr(
    "h.pen_divisi",
    "d.pend_qty",
    "d.pend_panjang",
    "d.pend_lebar",
  );

  const sql = `
    SELECT d.pend_pen_nomor AS Penawaran, dv.divisi AS Divisi, c.cus_nama AS Customer,
           h.pen_keterangan AS Keterangan, sl.sal_nama AS Sales,
           d.pend_nama_barang AS NamaBarang, d.pend_bahan AS Bahan,
           d.pend_panjang AS Panjang, d.pend_lebar AS Lebar, d.pend_qty AS Qty,
           ${jmPen} AS JumlahMeter, d.pend_harga AS Harga,
           MIN(d.pend_harga * d.pend_qty) AS TotalHarga, h.pen_tipe AS Tipe
    FROM tpenawaran_hdr h
    INNER JOIN tpenawaran_dtl d ON d.pend_pen_nomor = h.pen_nomor
    INNER JOIN tsales sl ON sl.sal_kode = h.pen_sal_kode
    INNER JOIN tdivisi dv ON dv.kode = h.pen_divisi
    INNER JOIN tcustomer c ON c.cus_kode = h.pen_cus_kode
    WHERE h.pen_tanggal BETWEEN ? AND ?
      AND h.pen_cetaktotal = 0
      AND d.pend_status = ''
      AND h.pen_nomor NOT IN (SELECT DISTINCT mspk_pen_nomor FROM tmemospk)
      AND h.pen_nomor NOT IN (SELECT DISTINCT spk_pen_nomor FROM tspk)
    GROUP BY d.pend_pen_nomor

    UNION ALL

    SELECT d.pend_pen_nomor AS Penawaran, dv.divisi AS Divisi, c.cus_nama AS Customer,
           h.pen_keterangan AS Keterangan, sl.sal_nama AS Sales,
           d.pend_nama_barang AS NamaBarang, d.pend_bahan AS Bahan,
           d.pend_panjang AS Panjang, d.pend_lebar AS Lebar, d.pend_qty AS Qty,
           ${jmPen} AS JumlahMeter, d.pend_harga AS Harga,
           (d.pend_harga * d.pend_qty) AS TotalHarga, h.pen_tipe AS Tipe
    FROM tpenawaran_hdr h
    INNER JOIN tpenawaran_dtl d ON d.pend_pen_nomor = h.pen_nomor
    INNER JOIN tsales sl ON sl.sal_kode = h.pen_sal_kode
    INNER JOIN tdivisi dv ON dv.kode = h.pen_divisi
    INNER JOIN tcustomer c ON c.cus_kode = h.pen_cus_kode
    WHERE h.pen_tanggal BETWEEN ? AND ?
      AND h.pen_cetaktotal = 1
      AND d.pend_status = ''
      AND h.pen_nomor NOT IN (SELECT DISTINCT mspk_pen_nomor FROM tmemospk)
      AND h.pen_nomor NOT IN (SELECT DISTINCT spk_pen_nomor FROM tspk)
  `;
  const params = [startDate, endDate, startDate, endDate];
  const [rows] = await db.query(sql, params);
  return rows;
};

// ─────────────────────────────────────────────────────────
// MODE 3 — MEMO SPK
// ⚠️ Beda dari cabang Memo di mode Proyeksi: di sini Tipe pakai
// IF(mspk_tipe='','-',mspk_tipe) — replikasi persis, JANGAN
// disamakan dengan cabang Proyeksi yang tidak pakai fallback '-'.
// ─────────────────────────────────────────────────────────
const getMemoSpk = async (startDate, endDate) => {
  const jm = jumlahMeterExpr(
    "s.mspk_divisi",
    "s.mspk_rencana_order",
    "s.mspk_panjang",
    "s.mspk_lebar",
  );

  const sql = `
    SELECT s.mspk_nomor AS Memo, dv.divisi AS Divisi, s.mspk_panjang AS Panjang,
           s.mspk_lebar AS Lebar, ${jm} AS JumlahMeter, c.cus_nama AS Customer,
           s.mspk_rencana_order AS RencanaOrder,
           IF(s.mspk_tipe = '', '-', s.mspk_tipe) AS Tipe,
           s.mspk_harga AS Harga, s.mspk_rencana_order * s.mspk_harga AS TotalHarga,
           sl.sal_nama AS Sales
    FROM tmemospk s
    INNER JOIN tdivisi dv ON dv.kode = s.mspk_divisi
    INNER JOIN tcustomer c ON c.cus_kode = s.mspk_cus_kode
    INNER JOIN tsales sl ON sl.sal_kode = s.mspk_sal_kode
    WHERE s.mspk_tanggal BETWEEN ? AND ?
      AND s.mspk_aktif = 'Y'
      AND s.mspk_nomor NOT IN (SELECT DISTINCT spk_memo FROM tspk)
    ORDER BY s.mspk_nomor
  `;
  const [rows] = await db.query(sql, [startDate, endDate]);
  return rows;
};

// ─────────────────────────────────────────────────────────
// MODE 4 — SPK
// ─────────────────────────────────────────────────────────
const getSpk = async (startDate, endDate) => {
  const jm = jumlahMeterExpr(
    "spk_divisi",
    "spk_jumlah",
    "spk_panjang",
    "spk_lebar",
  );

  const sql = `
    SELECT spk_nomor AS Spk, dv.divisi AS Divisi, c.cus_nama AS Customer,
           spk_nama AS NamaSpk, spk_ukuran AS Ukuran, spk_tipe AS Tipe,
           spk_panjang AS Panjang, spk_lebar AS Lebar, ${jm} AS JumlahMeter,
           spk_harga AS Harga, spk_jumlah AS Jumlah,
           spk_jumlah * spk_harga AS TotalHarga
    FROM tspk
    LEFT JOIN tcustomer c ON c.cus_kode = spk_cus_kode
    LEFT JOIN tdivisi dv ON dv.kode = spk_divisi
    WHERE spk_tanggal BETWEEN ? AND ?
      AND spk_aktif = 'Y'
  `;
  const [rows] = await db.query(sql, [startDate, endDate]);
  return rows;
};

// ─────────────────────────────────────────────────────────
// METADATA KOLOM per mode — dipakai frontend untuk bangun header
// grid & footer summary. `sum: true` = kolom itu di-total-kan di
// footer (skSum), posisinya persis mengikuti kolom mana yang benar-
// benar di-skSum di source Delphi (bukan tebakan).
// ─────────────────────────────────────────────────────────
const COLUMNS = {
  1: [
    // Proyeksi
    { key: "Customer", title: "Customer" },
    { key: "NamaSpk", title: "Nama_SPK" },
    { key: "Sales", title: "Sales" },
    { key: "Divisi", title: "divisi" },
    { key: "Tipe", title: "Tipe" },
    { key: "Panjang", title: "Panjang", numeric: true },
    { key: "Lebar", title: "Lebar", numeric: true },
    { key: "JumlahMeter", title: "jumlah_meter", numeric: true, sum: true },
    { key: "Qty", title: "Qty", numeric: true, sum: true },
    { key: "Harga", title: "Harga", numeric: true },
    { key: "Jumlah", title: "jumlah", numeric: true, sum: true },
  ],
  2: [
    // Penawaran
    { key: "Penawaran", title: "Penawaran" },
    { key: "Divisi", title: "divisi" },
    { key: "Customer", title: "Customer" },
    { key: "Keterangan", title: "keterangan" },
    { key: "Sales", title: "Sales" },
    { key: "NamaBarang", title: "Nama_barang" },
    { key: "Bahan", title: "Bahan" },
    { key: "Panjang", title: "Panjang", numeric: true },
    { key: "Lebar", title: "Lebar", numeric: true },
    { key: "Qty", title: "Qty", numeric: true, sum: true },
    { key: "JumlahMeter", title: "Jumlah_Meter", numeric: true, sum: true },
    { key: "Harga", title: "Harga", numeric: true },
    { key: "TotalHarga", title: "Total_Harga", numeric: true, sum: true },
    { key: "Tipe", title: "Tipe" },
  ],
  3: [
    // Memo SPK
    { key: "Memo", title: "Memo" },
    { key: "Divisi", title: "Divisi" },
    { key: "Panjang", title: "Panjang", numeric: true },
    { key: "Lebar", title: "Lebar", numeric: true },
    { key: "JumlahMeter", title: "Jumlah_Meter", numeric: true, sum: true },
    { key: "Customer", title: "Customer" },
    { key: "RencanaOrder", title: "Rencana_Order", numeric: true, sum: true },
    { key: "Tipe", title: "Tipe" },
    { key: "Harga", title: "Harga", numeric: true },
    { key: "TotalHarga", title: "Total_Harga", numeric: true, sum: true },
    { key: "Sales", title: "Sales" },
  ],
  4: [
    // SPK
    { key: "Spk", title: "SPK" },
    { key: "Divisi", title: "Divisi" },
    { key: "Customer", title: "Customer" },
    { key: "NamaSpk", title: "Nama_SPK" },
    { key: "Ukuran", title: "Ukuran" },
    { key: "Tipe", title: "Tipe" },
    { key: "Panjang", title: "Panjang", numeric: true },
    { key: "Lebar", title: "Lebar", numeric: true },
    { key: "JumlahMeter", title: "Jumlah_Meter", numeric: true, sum: true },
    { key: "Harga", title: "Harga", numeric: true },
    { key: "Jumlah", title: "Jumlah", numeric: true, sum: true },
    { key: "TotalHarga", title: "Total_Harga", numeric: true, sum: true },
  ],
};

// ⚠️ Judul dinamis sesuai mode dipilih — INI BUKAN replikasi Delphi
// (Delphi hardcode 'LAPORAN PROYEKSI' untuk semua mode). Diubah
// sesuai instruksi eksplisit user, bukan tebakan.
const REPORT_TITLES = {
  1: "Proyeksi Bulanan",
  2: "Penawaran",
  3: "Memo SPK",
  4: "SPK",
};

const getBrowse = async (startDate, endDate, laporan = 1) => {
  const mode = Number(laporan) || 1;
  let rows;
  switch (mode) {
    case 1:
      rows = await getProyeksi(startDate, endDate);
      break;
    case 2:
      rows = await getPenawaran(startDate, endDate);
      break;
    case 3:
      rows = await getMemoSpk(startDate, endDate);
      break;
    case 4:
      rows = await getSpk(startDate, endDate);
      break;
    default:
      throw new Error("Jenis laporan tidak dikenali.");
  }
  return {
    rows,
    columns: COLUMNS[mode],
    reportTitle: REPORT_TITLES[mode],
  };
};

module.exports = {
  getBrowse,
  getProyeksi,
  getPenawaran,
  getMemoSpk,
  getSpk,
};
