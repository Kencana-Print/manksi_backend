const db = require("../../../config/database");

// ─────────────────────────────────────────────────────────
// Replikasi ufrmLapRealisasiKirimMAP.btnRefreshClick.
// ⚠️ Flag hak akses: HANYA zcus yang dicek di source Delphi ini.
// zLihatHarga/zLihatBeli/zLihatSup TIDAK pernah dicek — kolom Harga
// & Nominal SELALU tampil tanpa gating, sesuai source apa adanya.
//
// lambat_kirim_awal/akhir beda formula dari versi SPK: bukan cuma
// DATEDIFF(tgl SJ, dateline), tapi DATEDIFF(tgl SJ, MSPK_Tanggal)
// dikurangi offset per-divisi (divisi 1 → 3 hari, divisi 5 → 1 hari,
// lainnya → 5 hari). Direplikasi persis, jangan disederhanakan.
//
// ⚠️ BUG SUMBER (lihat updateReason): SELECT baca s.mspk_kendala
// sebagai Reason, tapi tombol simpan Delphi (cxButton5Click) nulis
// ke kolom mspk_reason — beda kolom. Direplikasi apa adanya, BUKAN
// disatukan sepihak. Perlu konfirmasi user sebelum diubah.
// ─────────────────────────────────────────────────────────
const getBrowse = async (
  startDate,
  endDate,
  divisi = 0,
  canLihatCus = false,
) => {
  let where = `WHERE s.mspk_tanggal >= ? AND s.mspk_tanggal <= ?`;
  const params = [startDate, endDate];

  const divisiNum = Number(divisi);
  if (divisiNum && divisiNum !== 0) {
    where += ` AND s.mspk_divisi = ?`;
    params.push(divisiNum);
  }

  const custCols = canLihatCus
    ? `c.Cus_nama AS Customer, c.Cus_alamat AS Alamat,`
    : `NULL AS Customer, NULL AS Alamat,`;

  const sql = `
    SELECT
      x.Tanggal,
      x.Divisi,
      x.Nomor,
      x.Nama,
      x.JmlOrder,
      x.Harga,
      x.Nominal,
      x.Dateline,
      x.Customer,
      x.Alamat,
      x.SjNomorAwal,
      x.SjTglAwal,
      x.SjNomorAkhir,
      x.SjTglAkhir,
      IF(x.SjNomorAwal = '', '', IF(x.la < 0, 0, x.la))   AS LambatKirimAwal,
      IF(x.SjNomorAkhir = '', '', IF(x.lk < 0, 0, x.lk))  AS LambatKirimAkhir,
      x.BeritaAcara,
      x.Tipe,
      x.Reason,
      x.Aktif
    FROM (
      SELECT
        DATE_FORMAT(s.MSPK_Tanggal, '%Y-%m-%d') AS Tanggal,
        v.divisi AS Divisi,
        s.MSPK_Nomor AS Nomor,
        s.MSPK_nama AS Nama,
        s.mspk_rencana_order AS JmlOrder,
        s.mspk_harga AS Harga,
        (s.mspk_rencana_order * s.mspk_harga) AS Nominal,
        DATE_FORMAT(s.MSPK_dateline, '%Y-%m-%d') AS Dateline,
        ${custCols}
        IFNULL((
          SELECT h.SJ_Nomor FROM tsj_dtl_memo d
          LEFT JOIN tsj_hdr_memo h ON h.SJ_Nomor = d.SJD_SJ_Nomor
          WHERE d.SJD_MSPK_Nomor = s.MSPK_Nomor
          ORDER BY h.SJ_Tanggal LIMIT 1
        ), '') AS SjNomorAwal,
        IFNULL((
          SELECT DATE_FORMAT(h.SJ_Tanggal, '%Y-%m-%d') FROM tsj_dtl_memo d
          LEFT JOIN tsj_hdr_memo h ON h.SJ_Nomor = d.SJD_SJ_Nomor
          WHERE d.SJD_MSPK_Nomor = s.MSPK_Nomor
          ORDER BY h.SJ_Tanggal LIMIT 1
        ), '') AS SjTglAwal,
        IFNULL((
          SELECT h.SJ_Nomor FROM tsj_dtl_memo d
          LEFT JOIN tsj_hdr_memo h ON h.SJ_Nomor = d.SJD_SJ_Nomor
          WHERE d.SJD_MSPK_Nomor = s.MSPK_Nomor
          ORDER BY h.SJ_Tanggal DESC LIMIT 1
        ), '') AS SjNomorAkhir,
        IFNULL((
          SELECT DATE_FORMAT(h.SJ_Tanggal, '%Y-%m-%d') FROM tsj_dtl_memo d
          LEFT JOIN tsj_hdr_memo h ON h.SJ_Nomor = d.SJD_SJ_Nomor
          WHERE d.SJD_MSPK_Nomor = s.MSPK_Nomor
          ORDER BY h.SJ_Tanggal DESC LIMIT 1
        ), '') AS SjTglAkhir,
        (IFNULL(DATEDIFF((
          SELECT h.SJ_Tanggal FROM tsj_dtl_memo d
          LEFT JOIN tsj_hdr_memo h ON h.SJ_Nomor = d.SJD_SJ_Nomor
          WHERE d.SJD_MSPK_Nomor = s.MSPK_Nomor
          ORDER BY h.SJ_Tanggal LIMIT 1
        ), s.MSPK_Tanggal), 0) - (IF(s.mspk_divisi = 1, 3, IF(s.mspk_divisi = 5, 1, 5)))) AS la,
        (IFNULL(DATEDIFF((
          SELECT h.SJ_Tanggal FROM tsj_dtl_memo d
          LEFT JOIN tsj_hdr_memo h ON h.SJ_Nomor = d.SJD_SJ_Nomor
          WHERE d.SJD_MSPK_Nomor = s.MSPK_Nomor
          ORDER BY h.SJ_Tanggal DESC LIMIT 1
        ), s.MSPK_Tanggal), 0) - (IF(s.mspk_divisi = 1, 3, IF(s.mspk_divisi = 5, 1, 5)))) AS lk,
        (
          SELECT IF(COUNT(*) > 1, 'Sudah', 'Belum')
          FROM tkesesuaianMAP m
          WHERE m.mspk_nomor = s.mspk_nomor
        ) AS BeritaAcara,
        s.mspk_tipe AS Tipe,
        s.mspk_kendala AS Reason,
        s.mspk_aktif AS Aktif
      FROM tmemospk s
      LEFT JOIN tcustomer c ON c.Cus_kode = s.mspk_cus_kode
      LEFT JOIN tdivisi v ON v.kode = s.mspk_divisi
      ${where}
    ) x
    ORDER BY x.Tanggal, x.Divisi
  `;

  const [rows] = await db.query(sql, params);

  return rows.map((r) => ({
    ...r,
    JmlOrder: r.JmlOrder !== null ? Number(r.JmlOrder) : null,
    Harga: r.Harga !== null ? Number(r.Harga) : null,
    Nominal: r.Nominal !== null ? Number(r.Nominal) : null,
    LambatKirimAwal:
      r.LambatKirimAwal === "" || r.LambatKirimAwal === null
        ? ""
        : Number(r.LambatKirimAwal),
    LambatKirimAkhir:
      r.LambatKirimAkhir === "" || r.LambatKirimAkhir === null
        ? ""
        : Number(r.LambatKirimAkhir),
  }));
};

// ─────────────────────────────────────────────────────────
// UPDATE REASON — dialog "Reason".
// FIX (bukan replikasi bug Delphi): source asli SELECT baca dari
// mspk_kendala tapi tombol simpan nulis ke mspk_reason (kolom beda,
// menyebabkan reason yang baru disimpan tidak muncul lagi setelah
// refresh). Di sini disatukan — update & select sama-sama pakai
// mspk_kendala.
// ─────────────────────────────────────────────────────────
const updateReason = async (mapNomor, reason) => {
  if (!mapNomor) throw new Error("Nomor MAP wajib diisi.");
  await db.query(`UPDATE tmemospk SET mspk_kendala = ? WHERE mspk_nomor = ?`, [
    reason || "",
    mapNomor,
  ]);
  return { mapNomor, reason: reason || "" };
};

module.exports = {
  getBrowse,
  updateReason,
};
