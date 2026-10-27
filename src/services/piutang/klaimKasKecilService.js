const db = require("../../config/database");

const httpError = (msg, status) => Object.assign(new Error(msg), { status });

// cabang: null/"ALL" = semua cabang (pusat); selain itu dibatasi ke cabang itu.
// Pembatasan per user dipaksa di controller, bukan dipercaya dari query string.
const filterCabang = (cabang) =>
  cabang && cabang !== "ALL" && cabang !== "HO-" ? cabang : null;

// ── Browse (satu baris per klaim) ─────────────────────────────────────
const getBrowse = async (startDate, endDate, cabang) => {
  const cab = filterCabang(cabang);
  let sql = `
    SELECT h.kkh_nomor AS Nomor,
      DATE_FORMAT(h.kkh_tanggal,'%Y-%m-%d') AS Tanggal,
      h.kkh_cabang AS Cabang,
      h.kkh_rek_asal AS RekAsal,
      h.kkh_rek_tujuan AS RekTujuan,
      h.kkh_total AS Total,
      h.kkh_status AS Status,
      h.kkh_keterangan AS Keterangan,
      h.user_create AS Dibuat,
      (SELECT COUNT(*) FROM tklaim_kaskecil_dtl d
        WHERE d.kkd_kkh_nomor = h.kkh_nomor) AS JumlahBkk
    FROM tklaim_kaskecil_hdr h
    WHERE h.kkh_tanggal BETWEEN ? AND ?`;
  const params = [startDate, endDate];
  if (cab) {
    sql += ` AND h.kkh_cabang = ?`;
    params.push(cab);
  }
  sql += ` ORDER BY h.kkh_nomor DESC`;

  const [rows] = await db.query(sql, params);
  if (rows.length === 0) return [];

  // Nama rekening (finance.trekening) — query terpisah, bukan JOIN lintas DB
  const kodeRek = [...new Set(rows.flatMap((r) => [r.RekAsal, r.RekTujuan]))];
  const [rek] = await db.query(
    `SELECT rek_kode, rek_nama FROM finance.trekening WHERE rek_kode IN (?)`,
    [kodeRek],
  );
  const namaRek = new Map(rek.map((r) => [r.rek_kode, r.rek_nama]));

  // Keterkaitan ke Pengajuan Transfer: ptd_trs = nomor klaim, baris tidak batal
  const [pjt] = await db.query(
    `SELECT ptd_trs AS klaim, ptd_nomor AS pjt,
            DATE_FORMAT(MAX(ptd_realisasi),'%Y-%m-%d') AS tglRealisasi,
            MAX(ptd_jur_no <> '') AS sudahRealisasi
     FROM finance.tpengajuan_transfer_dtl
     WHERE ptd_trs IN (?) AND ptd_batal = ''
     GROUP BY ptd_trs, ptd_nomor`,
    [rows.map((r) => r.Nomor)],
  );
  const infoPjt = new Map(pjt.map((r) => [r.klaim, r]));

  return rows.map((r) => {
    const p = infoPjt.get(r.Nomor);
    let statusTransfer = "-";
    if (r.Status === "AKTIF") {
      if (!p) statusTransfer = "Belum diajukan";
      else if (Number(p.sudahRealisasi) === 1) statusTransfer = "Terealisasi";
      else statusTransfer = "Diajukan";
    }
    return {
      ...r,
      Total: Number(r.Total),
      JumlahBkk: Number(r.JumlahBkk),
      NamaRekAsal: namaRek.get(r.RekAsal) || "",
      NamaRekTujuan: namaRek.get(r.RekTujuan) || "",
      NomorPjt: p ? p.pjt : "",
      TglRealisasi: p ? p.tglRealisasi || "" : "",
      StatusTransfer: statusTransfer,
    };
  });
};

// ── Browse detail (daftar BKK per klaim, untuk expand) ────────────────
const getBrowseDetail = async (startDate, endDate, cabang) => {
  const cab = filterCabang(cabang);
  let sql = `
    SELECT d.kkd_kkh_nomor AS Nomor,
      d.kkd_jur_no AS Bkk,
      d.kkd_bon_nomor AS Bon,
      DATE_FORMAT(d.kkd_tanggal,'%Y-%m-%d') AS Tanggal,
      d.kkd_uraian AS Uraian,
      d.kkd_nominal AS Nominal
    FROM tklaim_kaskecil_dtl d
    INNER JOIN tklaim_kaskecil_hdr h ON h.kkh_nomor = d.kkd_kkh_nomor
    WHERE h.kkh_tanggal BETWEEN ? AND ?`;
  const params = [startDate, endDate];
  if (cab) {
    sql += ` AND h.kkh_cabang = ?`;
    params.push(cab);
  }
  sql += ` ORDER BY d.kkd_kkh_nomor, d.kkd_jur_no`;

  const [rows] = await db.query(sql, params);
  return rows.map((r) => ({ ...r, Nominal: Number(r.Nominal) }));
};

// ── Batal klaim ───────────────────────────────────────────────────────
// Hanya jika belum dipanggil Pengajuan Transfer. BKK dilepas kembali
// (kkd_kunci = NULL) supaya bisa diklaim ulang.
// cabangScope: cabang user bila bukan pusat, null bila pusat.
const batalKlaim = async (nomor, user, cabangScope) => {
  const [[h]] = await db.query(
    `SELECT kkh_status, kkh_cabang FROM tklaim_kaskecil_hdr WHERE kkh_nomor = ?`,
    [nomor],
  );
  if (!h) throw httpError("Klaim tidak ditemukan.", 404);
  if (cabangScope && h.kkh_cabang !== cabangScope)
    throw httpError("Klaim ini bukan milik cabang Anda.", 403);
  if (h.kkh_status !== "AKTIF") throw httpError("Klaim sudah dibatalkan.", 400);

  const [[pjt]] = await db.query(
    `SELECT ptd_nomor FROM finance.tpengajuan_transfer_dtl
     WHERE ptd_trs = ? AND ptd_batal = '' LIMIT 1`,
    [nomor],
  );
  if (pjt)
    throw httpError(
      `Klaim sudah dipanggil di Pengajuan Transfer ${pjt.ptd_nomor}. Tidak bisa dibatalkan.`,
      400,
    );

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [upd] = await conn.query(
      `UPDATE tklaim_kaskecil_hdr
       SET kkh_status = 'BATAL', user_modified = ?, date_modified = NOW()
       WHERE kkh_nomor = ? AND kkh_status = 'AKTIF'`,
      [user.kode, nomor],
    );
    if (upd.affectedRows === 0) throw httpError("Klaim sudah dibatalkan.", 400);
    await conn.query(
      `UPDATE tklaim_kaskecil_dtl SET kkd_kunci = NULL WHERE kkd_kkh_nomor = ?`,
      [nomor],
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

module.exports = { getBrowse, getBrowseDetail, batalKlaim };
