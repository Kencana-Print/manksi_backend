const db = require("../../../config/database");

// ─────────────────────────────────────────────────────────
// Replikasi ufrmLapRealisasiKirimSpk.btnRefreshClick.
// Filter divisi: Delphi ambil KARAKTER PERTAMA dari cbdivisi.Text
// (misal "4 - GARMEN" -> "4"); '0' (ALL) berarti tidak difilter sama
// sekali. Di sini `divisi` cukup dikirim sebagai angka biasa (0 = ALL).
// SjNomorAwal/SjTglAwal & SjNomorAkhir/SjTglAkhir masing2 correlated
// subquery TERPISAH (ORDER BY tanggal ASC vs DESC, LIMIT 1) — bukan
// hasil MIN/MAX gabungan, direplikasi persis strukturnya.
// lambat_kirim_awal/akhir = DATEDIFF(tgl SJ, spk_dateline) — NEGATIF
// berarti kirim lebih cepat dari dateline, POSITIF berarti telat.
// ─────────────────────────────────────────────────────────
const getBrowse = async (
  startDate,
  endDate,
  divisi = 0,
  canLihatCus = false,
) => {
  let where = `
    WHERE s.spk_aktif = 'Y'
      AND s.spk_tanggal >= ? AND s.spk_tanggal <= ?
  `;
  const params = [startDate, endDate];

  const divisiNum = Number(divisi);
  if (divisiNum && divisiNum !== 0) {
    where += ` AND s.spk_divisi = ?`;
    params.push(divisiNum);
  }

  // ⚠️ Kolom customer cuma diikutkan kalau user punya flag lihatCus
  // (user_lihat_cus di tuser) — persis kondisi `if zcus=1` di Delphi.
  // zcus BUKAN konstanta global statis, itu per-user permission flag
  // yang di-set saat login, dibaca dari req.user.flags.lihatCus (JWT).
  const custCols = canLihatCus
    ? `c.Cus_nama AS CusNama, c.Cus_alamat AS CusAlamat,`
    : `NULL AS CusNama, NULL AS CusAlamat,`;

  const sql = `
    SELECT
      DATE_FORMAT(s.spk_Tanggal, '%Y-%m-%d') AS spkTanggal,
      v.divisi AS Divisi,
      s.SPK_Nomor AS SpkNomor,
      s.spk_nama AS Nama,
      s.spk_jumlah AS JmlOrder,
      s.spk_harga AS Harga,
      (s.spk_jumlah * s.spk_harga) AS Nilai,
      DATE_FORMAT(s.spk_dateline, '%Y-%m-%d') AS Dateline,
      ${custCols}
      IFNULL((
        SELECT h.SJ_Nomor FROM tsj_dtl d
        LEFT JOIN tsj_hdr h ON h.SJ_Nomor = d.SJD_SJ_Nomor
        WHERE d.SJD_SPK_Nomor = s.SPK_Nomor
        ORDER BY h.SJ_Tanggal LIMIT 1
      ), '') AS SjNomorAwal,
      IFNULL((
        SELECT DATE_FORMAT(h.SJ_Tanggal, '%Y-%m-%d') FROM tsj_dtl d
        LEFT JOIN tsj_hdr h ON h.SJ_Nomor = d.SJD_SJ_Nomor
        WHERE d.SJD_SPK_Nomor = s.SPK_Nomor
        ORDER BY h.SJ_Tanggal LIMIT 1
      ), '') AS SjTglAwal,
      IFNULL((
        SELECT h.SJ_Nomor FROM tsj_dtl d
        LEFT JOIN tsj_hdr h ON h.SJ_Nomor = d.SJD_SJ_Nomor
        WHERE d.SJD_SPK_Nomor = s.SPK_Nomor
        ORDER BY h.SJ_Tanggal DESC LIMIT 1
      ), '') AS SjNomorAkhir,
      IFNULL((
        SELECT DATE_FORMAT(h.SJ_Tanggal, '%Y-%m-%d') FROM tsj_dtl d
        LEFT JOIN tsj_hdr h ON h.SJ_Nomor = d.SJD_SJ_Nomor
        WHERE d.SJD_SPK_Nomor = s.SPK_Nomor
        ORDER BY h.SJ_Tanggal DESC LIMIT 1
      ), '') AS SjTglAkhir,
      IFNULL(DATEDIFF((
        SELECT h.SJ_Tanggal FROM tsj_dtl d
        LEFT JOIN tsj_hdr h ON h.SJ_Nomor = d.SJD_SJ_Nomor
        WHERE d.SJD_SPK_Nomor = s.SPK_Nomor
        ORDER BY h.SJ_Tanggal LIMIT 1
      ), s.spk_dateline), '') AS LambatKirimAwal,
      IFNULL(DATEDIFF((
        SELECT h.SJ_Tanggal FROM tsj_dtl d
        LEFT JOIN tsj_hdr h ON h.SJ_Nomor = d.SJD_SJ_Nomor
        WHERE d.SJD_SPK_Nomor = s.SPK_Nomor
        ORDER BY h.SJ_Tanggal DESC LIMIT 1
      ), s.spk_dateline), '') AS LambatKirimAkhir,
      s.spk_tipe AS Tipe,
      s.spk_reason AS Reason
    FROM tspk s
    LEFT JOIN tcustomer c ON c.Cus_kode = s.spk_cus_kode
    LEFT JOIN tdivisi v ON v.kode = s.spk_divisi
    ${where}
    ORDER BY s.spk_tanggal, s.spk_divisi
  `;

  const [rows] = await db.query(sql, params);

  return rows.map((r) => ({
    ...r,
    JmlOrder: r.JmlOrder !== null ? Number(r.JmlOrder) : null,
    Harga: r.Harga !== null ? Number(r.Harga) : null,
    Nilai: r.Nilai !== null ? Number(r.Nilai) : null,
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
// UPDATE REASON — dialog kecil "Reason" (cxButton5Click di Delphi).
// ─────────────────────────────────────────────────────────
const updateReason = async (spkNomor, reason) => {
  if (!spkNomor) throw new Error("SPK Nomor wajib diisi.");
  await db.query(`UPDATE tspk SET spk_reason = ? WHERE spk_nomor = ?`, [
    reason || "",
    spkNomor,
  ]);
  return { spkNomor, reason: reason || "" };
};

module.exports = {
  getBrowse,
  updateReason,
};
