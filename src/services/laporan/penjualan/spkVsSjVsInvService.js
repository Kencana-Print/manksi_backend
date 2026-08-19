const db = require("../../../config/database");

// Tanggal migrasi format SPK — sebelum tanggal ini, SO masih punya
// turunan SPK PPIC lama (via tspk.spk_so_ref). Sesudahnya, skema
// penomoran berubah sehingga kolom SPK tidak lagi relevan/diisi.
const SPK_LEGACY_CUTOFF = "2026-08-06";

// ─────────────────────────────────────────────────────────
// Helper — bangun klausa WHERE + params, sumber SO = UNION
// tsalesorder (baru) + tspk legacy (spk_is_so=1, pre-migrasi).
// Kolom di-alias jadi spk_* seragam, sama pola dengan
// salesOrderService.getBrowseList — supaya SELECT/WHERE di bawah
// tidak perlu tahu asal barisnya dari tabel mana.
// ─────────────────────────────────────────────────────────
const buildMasterWhere = (query) => {
  const today = new Date().toISOString().substring(0, 10);
  const startDate = query.startDate || today;
  const endDate = query.endDate || today;
  const customerKode = query.customerKode || "";
  const perushKode = query.perushKode || "";
  const salesKode = query.salesKode || "";
  const divisi = query.divisi || "0";
  const status = query.status || "0";

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

  // ⚠️ FIX: bandingkan terhadap Kirim yang sekarang dihitung live
  // (alias "kirim.total" dari LEFT JOIN), bukan kolom cache
  // spk_jumlah_kirim yang sudah tidak ada di subquery s.
  if (status === "1") {
    where += ` AND s.spk_jumlah > IFNULL(kirim.total, 0)`;
  } else if (status === "2") {
    where += ` AND s.spk_jumlah <= IFNULL(kirim.total, 0)`;
  }

  if (divisi && divisi !== "0") {
    where += ` AND s.spk_divisi = ?`;
    params.push(divisi);
  }

  return { where, params };
};

const buildMasterSelect = (canLihatCus) => {
  const custCol = canLihatCus
    ? "c.cus_nama AS NamaCustomer,"
    : `"" AS NamaCustomer,`;
  return `
    SELECT
      s.spk_nomor AS Nomor,
      DATE_FORMAT(s.spk_tanggal, '%Y-%m-%d') AS Tanggal,
      v.divisi AS Divisi,
      ${custCol}
      s.spk_nama AS Nama,
      s.spk_ukuran AS Ukuran,
      s.spk_jo_kode AS Jenis,
      s.spk_jumlah AS Jumlah,
      s.spk_prasj AS Prasj,
      IFNULL(kirim.total, 0) AS Kirim,
      DATE_FORMAT(s.spk_dateline, '%Y-%m-%d') AS Dateline,
      s.spk_nomor_po AS NomorPO,
      -- ⚠️ Kolom SPK: hanya diisi untuk SO format lama (sebelum
      -- SPK_LEGACY_CUTOFF), diambil dari turunan SPK PPIC via
      -- spk_so_ref. Untuk SO format baru (sesudah cutoff), kolom
      -- ini sengaja dikosongkan — skema penomoran baru tidak lagi
      -- punya turunan SPK PPIC terpisah dengan pola yang sama.
      IFNULL(spkref.SpkNomor, '') AS Spk
    FROM (
      SELECT
        spk_nomor, spk_tanggal, spk_divisi, spk_cus_kode, spk_nama, spk_ukuran,
        spk_jo_kode, spk_jumlah, spk_prasj, spk_dateline,
        spk_nomor_po, spk_perush_kode, spk_sal_kode, spk_aktif
      FROM tspk
      WHERE spk_is_so = 1
      UNION ALL
      SELECT
        so_nomor AS spk_nomor, so_tanggal AS spk_tanggal, so_divisi AS spk_divisi,
        so_cus_kode AS spk_cus_kode, so_nama AS spk_nama, so_ukuran AS spk_ukuran,
        so_jo_kode AS spk_jo_kode, so_jumlah AS spk_jumlah, 0 AS spk_prasj,
        so_dateline AS spk_dateline,
        so_nomor_po AS spk_nomor_po, so_perush_kode AS spk_perush_kode,
        so_sal_kode AS spk_sal_kode, so_aktif AS spk_aktif
      FROM tsalesorder
    ) s
    INNER JOIN tcustomer c ON s.spk_cus_kode = c.cus_kode
    LEFT JOIN tdivisi v ON v.kode = s.spk_divisi
    LEFT JOIN (
      SELECT ppic.spk_so_ref AS SoNomor, SUM(d.sjd_jumlah) AS total
      FROM tspk ppic
      INNER JOIN tsj_dtl d ON d.sjd_spk_nomor = ppic.spk_nomor
      INNER JOIN tsj_hdr h ON h.sj_nomor = d.sjd_sj_nomor
      WHERE ppic.spk_is_so = 0 AND h.sj_status_otomatis = 0
      GROUP BY ppic.spk_so_ref
    ) kirim ON kirim.SoNomor = s.spk_nomor
    -- ⚠️ BARU: turunan SPK PPIC lama (format sebelum migrasi),
    -- dipetakan dari spk_so_ref sama seperti join "kirim" di atas.
    -- 1 SO idealnya cuma punya 1 turunan; GROUP_CONCAT sebagai
    -- pengaman kalau ada lebih dari 1.
    LEFT JOIN (
      SELECT ppic.spk_so_ref AS SoNomor,
        GROUP_CONCAT(ppic.spk_nomor SEPARATOR ', ') AS SpkNomor
      FROM tspk ppic
      WHERE ppic.spk_is_so = 0
      GROUP BY ppic.spk_so_ref
    ) spkref ON spkref.SoNomor = s.spk_nomor
  `;
};

// ─────────────────────────────────────────────────────────
// BROWSE — buat tabel di layar (master doang, tanpa detail)
// ─────────────────────────────────────────────────────────
const getBrowseList = async (query, canLihatCus = false) => {
  const { where, params } = buildMasterWhere(query);
  const sql = `${buildMasterSelect(canLihatCus)} ${where} ORDER BY s.spk_tanggal`;
  const [rows] = await db.query(sql, params);
  return rows;
};

// ─────────────────────────────────────────────────────────
// Ambil peta SO Nomor -> SPK PPIC turunan(nya). SJ mereferensikan
// SPK PPIC turunan (sjd_spk_nomor), BUKAN nomor SO langsung — beda
// dari Invoice yang langsung pakai nomor SO (invd_spk_nomor).
// 1 SO idealnya cuma punya 1 turunan, tapi query ini toleran kalau
// suatu saat ada lebih dari 1.
// ─────────────────────────────────────────────────────────
const getPpicMapForSoList = async (soNomorList) => {
  if (!soNomorList.length) return { ppicToSo: {}, ppicNomorList: [] };
  const [rows] = await db.query(
    `SELECT spk_so_ref AS SoNomor, spk_nomor AS PpicNomor
     FROM tspk WHERE spk_so_ref IN (?) AND spk_is_so = 0`,
    [soNomorList],
  );
  const ppicToSo = {};
  const ppicNomorList = [];
  for (const r of rows) {
    ppicToSo[r.PpicNomor] = r.SoNomor;
    ppicNomorList.push(r.PpicNomor);
  }
  return { ppicToSo, ppicNomorList };
};

// ─────────────────────────────────────────────────────────
// EXPORT — master + 2 list detail independen (SJ & Invoice), semua
// sekaligus dalam 1 request biar gak N+1 query per baris SO.
// ─────────────────────────────────────────────────────────
const getExportData = async (query, canLihatCus = false) => {
  const { where, params } = buildMasterWhere(query);
  const masterSql = `${buildMasterSelect(canLihatCus)} ${where} ORDER BY s.spk_tanggal`;
  const [master] = await db.query(masterSql, params);

  if (master.length === 0) {
    return { master: [], sjDetails: [], invDetails: [] };
  }

  const nomorList = master.map((m) => m.Nomor);

  // ⚠️ FIX: SJ join sekarang lewat SPK PPIC turunan (spk_so_ref),
  // bukan match langsung ke nomor SO seperti kode lama. Hack
  // MID(...)=MID(...) yang dulu jadi cross-check "kira-kira" sudah
  // tidak diperlukan — join sekarang presisi via relasi terstruktur.
  const { ppicToSo, ppicNomorList } = await getPpicMapForSoList(nomorList);

  let sjDetails = [];
  if (ppicNomorList.length > 0) {
    const sjSql = `
      SELECT
        d.sjd_spk_nomor AS PpicNomor,
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
      ORDER BY d.sjd_spk_nomor, h.sj_tanggal
    `;
    const [rows] = await db.query(sjSql, [ppicNomorList]);
    // Petakan balik ke nomor SO supaya frontend tetap group by SO
    // (kontrak SpkNomor dipertahankan, isinya sekarang = SO Nomor)
    sjDetails = rows.map((r) => ({
      ...r,
      SpkNomor: ppicToSo[r.PpicNomor] || r.PpicNomor,
    }));
  }

  // Invoice tetap langsung — invd_spk_nomor sudah nunjuk ke SO.
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
// DETAIL PER-NOMOR — dipanggil on-demand saat row di-expand.
// Sama logic seperti getExportData, difilter 1 nomor SO doang.
// ─────────────────────────────────────────────────────────
const getDetailByNomor = async (nomor) => {
  const { ppicNomorList } = await getPpicMapForSoList([nomor]);

  let sjDetails = [];
  if (ppicNomorList.length > 0) {
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
        AND d.sjd_spk_nomor IN (?)
      ORDER BY h.sj_tanggal
    `;
    const [rows] = await db.query(sjSql, [ppicNomorList]);
    sjDetails = rows;
  }

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
  const [invDetails] = await db.query(invSql, [nomor]);

  return { sjDetails, invDetails };
};

module.exports = {
  getBrowseList,
  getExportData,
  getDetailByNomor,
};
