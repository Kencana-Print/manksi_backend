const db = require("../../../config/database");

// ─────────────────────────────────────────────────────────
// Helper — bangun klausa WHERE + params yang sama dipakai baik buat
// browse maupun export (biar 2 fungsi ini gak bisa "ketuker" filter)
// ⚠️ zcus selalu TRUE (konsisten keputusan established sebelumnya).
// ─────────────────────────────────────────────────────────
const buildMasterWhere = (query) => {
  const today = new Date().toISOString().substring(0, 10);
  const startDate = query.startDate || today;
  const endDate = query.endDate || today;
  const customerKode = query.customerKode || "";
  const perushKode = query.perushKode || "";
  const salesKode = query.salesKode || "";
  const divisi = query.divisi || "0"; // ✅ default "0 - ALL" (beda dari SPK vs STBJ)
  const status = query.status || "0"; // 0=All, 1=Belum Terpenuhi, 2=Sudah Terpenuhi

  const params = [
    startDate,
    endDate,
    `${customerKode}%`,
    `${perushKode}%`,
    `${salesKode}%`,
  ];

  let where = `
    WHERE s.spk_aktif = 'Y'
      AND s.spk_tanggal >= ?
      AND s.spk_tanggal <= ?
      AND s.spk_cus_kode LIKE ?
      AND s.spk_perush_kode LIKE ?
      AND s.spk_sal_kode LIKE ?
  `;

  if (status === "1") {
    where += ` AND s.spk_jumlah > s.spk_jumlah_kirim`;
  } else if (status === "2") {
    where += ` AND s.spk_jumlah <= s.spk_jumlah_kirim`;
  }

  if (divisi && divisi !== "0") {
    where += ` AND s.spk_divisi = ?`;
    params.push(divisi);
  }

  return { where, params };
};

const MASTER_SELECT = `
  SELECT
    s.spk_nomor AS Nomor,
    DATE_FORMAT(s.spk_tanggal, '%Y-%m-%d') AS Tanggal,
    v.divisi AS Divisi,
    c.cus_nama AS NamaCustomer,
    s.spk_nama AS Nama,
    s.spk_ukuran AS Ukuran,
    s.spk_jo_kode AS Jenis,
    s.spk_jumlah AS Jumlah,
    s.spk_prasj AS Prasj,
    s.spk_jumlah_kirim AS Kirim,
    DATE_FORMAT(s.spk_dateline, '%Y-%m-%d') AS Dateline,
    s.spk_nomor_po AS NomorPO
  FROM tspk s
  INNER JOIN tcustomer c ON s.spk_cus_kode = c.cus_kode
  LEFT JOIN tdivisi v ON v.kode = s.spk_divisi
`;

// ─────────────────────────────────────────────────────────
// BROWSE — buat tabel di layar (master doang, tanpa detail)
// ─────────────────────────────────────────────────────────
const getBrowseList = async (query) => {
  const { where, params } = buildMasterWhere(query);
  const sql = `${MASTER_SELECT} ${where} ORDER BY s.spk_tanggal`;
  const [rows] = await db.query(sql, params);
  return rows;
};

// ─────────────────────────────────────────────────────────
// EXPORT — master + 2 list detail independen (SJ & Invoice), semua
// sekaligus dalam 1 request biar gak N+1 query per baris SPK.
// Frontend yang nanti nge-interleave SJ/Invoice ke baris Excel
// (kalau SJ 3 baris tapi Invoice 1 baris, baris ke-2/3 kolom
// Invoice-nya dikosongin — persis pola Delphi aslinya).
// ─────────────────────────────────────────────────────────
const getExportData = async (query) => {
  const { where, params } = buildMasterWhere(query);
  const masterSql = `${MASTER_SELECT} ${where} ORDER BY s.spk_tanggal`;
  const [master] = await db.query(masterSql, params);

  if (master.length === 0) {
    return { master: [], sjDetails: [], invDetails: [] };
  }

  const nomorList = master.map((m) => m.Nomor);

  // ✅ Replikasi persis: TANPA IF(status_otomatis,...) kayak modul SPK
  // vs SJ — di sini sj_nomor selalu diambil apa adanya. TANPA filter
  // perush_kode juga (konsisten sama fix SPK vs SJ kemarin).
  // ✅ FIXED: kondisi cross-check kode cabang SPK vs SJ semula pakai
  // LEFT(sjd_spk_nomor,2) — itu valid untuk format nomor SPK LAMA tanpa
  // prefix ("KP-KO-000003"). Format SPK SEKARANG & SETERUSNYA selalu
  // pakai prefix "SPK-" (4 karakter) sebelum kode cabang, jadi diganti
  // MID(sjd_spk_nomor,5,2) supaya ambil kode cabang yang benar
  // ("SPK-KP-KO-000003" -> "KP", bukan "SP").
  const sjSql = `
    SELECT
      d.sjd_spk_nomor AS SpkNomor,
      h.sj_nomor AS NomorSJ,
      DATE_FORMAT(h.sj_tanggal, '%Y-%m-%d') AS TanggalSJ,
      g.gdg_nama AS Gudang,
      d.sjd_ukuran AS Ukuran,
      d.sjd_jumlah AS Jumlah,
      h.sj_alamat_customer AS Alamat,
      h.sj_kota_customer AS Kota
    FROM tsj_hdr h
    INNER JOIN tgudang g ON g.gdg_kode = h.sj_gdg_kode
    INNER JOIN tsj_dtl d ON d.sjd_sj_nomor = h.sj_nomor
    WHERE h.sj_approve <> 2
      AND d.sjd_spk_nomor IN (?)
      AND MID(d.sjd_spk_nomor, 5, 2) = MID(h.sj_nomor, 4, 2)
    ORDER BY d.sjd_spk_nomor, h.sj_tanggal
  `;
  const [sjDetails] = await db.query(sjSql, [nomorList]);

  const invSql = `
    SELECT
      d.invd_spk_nomor AS SpkNomor,
      h.inv_nomor AS NomorInv,
      DATE_FORMAT(h.inv_tanggal, '%Y-%m-%d') AS TanggalInv,
      h.inv_keterangan AS Keterangan,
      d.invd_jumlah AS Jumlah,
      d.invd_harga AS Harga
    FROM tinv_hdr h
    INNER JOIN tinv_dtl d ON d.invd_inv_nomor = h.inv_nomor
    WHERE h.inv_status_otomatis = 0
      AND d.invd_spk_nomor IN (?)
    ORDER BY d.invd_spk_nomor
  `;
  const [invDetails] = await db.query(invSql, [nomorList]);

  return { master, sjDetails, invDetails };
};

// ─────────────────────────────────────────────────────────
// DETAIL PER-NOMOR — dipanggil on-demand saat row di-expand di
// Browse. Query sama persis kayak yang dipakai getExportData, cuma
// difilter 1 nomor doang (bukan IN list).
// ─────────────────────────────────────────────────────────
const getDetailByNomor = async (nomor) => {
  const sjSql = `
    SELECT
      h.sj_nomor AS NomorSJ,
      DATE_FORMAT(h.sj_tanggal, '%Y-%m-%d') AS TanggalSJ,
      g.gdg_nama AS Gudang,
      d.sjd_ukuran AS Ukuran,
      d.sjd_jumlah AS Jumlah,
      h.sj_alamat_customer AS Alamat,
      h.sj_kota_customer AS Kota
    FROM tsj_hdr h
    INNER JOIN tgudang g ON g.gdg_kode = h.sj_gdg_kode
    INNER JOIN tsj_dtl d ON d.sjd_sj_nomor = h.sj_nomor
    WHERE h.sj_approve <> 2
      AND d.sjd_spk_nomor = ?
      AND MID(d.sjd_spk_nomor, 5, 2) = MID(h.sj_nomor, 4, 2)
    ORDER BY h.sj_tanggal
  `;
  const invSql = `
    SELECT
      h.inv_nomor AS NomorInv,
      DATE_FORMAT(h.inv_tanggal, '%Y-%m-%d') AS TanggalInv,
      h.inv_keterangan AS Keterangan,
      d.invd_jumlah AS Jumlah,
      d.invd_harga AS Harga
    FROM tinv_hdr h
    INNER JOIN tinv_dtl d ON d.invd_inv_nomor = h.inv_nomor
    WHERE h.inv_status_otomatis = 0
      AND d.invd_spk_nomor = ?
  `;

  const [[sjDetails], [invDetails]] = await Promise.all([
    db.query(sjSql, [nomor]),
    db.query(invSql, [nomor]),
  ]);

  return { sjDetails, invDetails };
};

module.exports = {
  getBrowseList,
  getExportData,
  getDetailByNomor,
};
