const db = require("../../config/database");
const {
  validasiPeriode,
  adalahSuperadmin,
  cabangUser,
  galat,
  cekTutupBuku,
} = require("./lhk/lhkCommon");

const T = {
  hdr: "kencanaprint.tmutasi_marketing_spanduk",
  dtl: "kencanaprint.tmutasi_marketing_spanduk_dtl",
  memo: "kencanaprint.tmemospk",
  user: "kencanaprint.tuser",
};

// Browse: satu baris per dokumen. MO diambil dari tmemospk.user_create
// (bisa lebih dari satu MO per dokumen).
const getBrowse = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);

  const params = [tglAwal, tglAkhir, tglAwal, tglAkhir];
  let sqlCab = "";
  if (!adalahSuperadmin(user)) {
    sqlCab = "AND h.mmk_cab = ?";
    params.push(cabangUser(user));
  }

  const query = `
    SELECT h.mmk_nomor AS Nomor,
           DATE_FORMAT(h.mmk_tanggal, '%Y-%m-%d') AS Tanggal,
           h.mmk_cab AS Lokasi,
           IFNULL(h.mmk_keterangan, '') AS Keterangan,
           IFNULL(x.jml_map, 0) AS Jumlah_MAP,
           IFNULL(x.total_qty, 0) AS Total_Qty,
           IFNULL(x.mo, '') AS MO,
           IFNULL(x.jml_diterima, 0) AS Jumlah_Diterima
    FROM ${T.hdr} h
    LEFT JOIN (
      SELECT d.mmkd_nomor AS xnomor,
             COUNT(*) AS jml_map,
             SUM(d.mmkd_qty) AS total_qty,
             GROUP_CONCAT(DISTINCT IFNULL(NULLIF(u.user_nama, ''), m.user_create)
                          SEPARATOR ', ') AS mo,
             SUM(d.mmkd_diterima_tgl IS NOT NULL) AS jml_diterima
      FROM ${T.dtl} d
      JOIN ${T.hdr} hh ON hh.mmk_nomor = d.mmkd_nomor
                      AND hh.mmk_tanggal BETWEEN ? AND ?
      LEFT JOIN ${T.memo} m ON m.mspk_nomor = d.mmkd_mspk_nomor
      LEFT JOIN ${T.user} u ON u.user_kode = m.user_create
      GROUP BY d.mmkd_nomor
    ) x ON x.xnomor = h.mmk_nomor
    WHERE h.mmk_tanggal BETWEEN ? AND ?
    ${sqlCab}
    ORDER BY h.mmk_tanggal DESC, h.mmk_nomor DESC
  `;
  const [rows] = await db.query(query, params);
  return rows;
};

// Detail: satu baris per MAP dalam dokumen (periode dan cabang sama dengan browse)
const getDetail = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);

  const params = [tglAwal, tglAkhir];
  let sqlCab = "";
  if (!adalahSuperadmin(user)) {
    sqlCab = "AND h.mmk_cab = ?";
    params.push(cabangUser(user));
  }

  const query = `
    SELECT d.mmkd_nomor AS Nomor,
           d.mmkd_mspk_nomor AS Nomor_MAP,
           IFNULL(m.mspk_nama, '') AS Nama_MAP,
           d.mmkd_qty AS Qty,
           IFNULL(NULLIF(u.user_nama, ''), IFNULL(m.user_create, '')) AS MO,
           DATE_FORMAT(d.mmkd_diterima_tgl, '%Y-%m-%d') AS Tgl_Diterima
    FROM ${T.dtl} d
    JOIN ${T.hdr} h ON h.mmk_nomor = d.mmkd_nomor
    LEFT JOIN ${T.memo} m ON m.mspk_nomor = d.mmkd_mspk_nomor
    LEFT JOIN ${T.user} u ON u.user_kode = m.user_create
    WHERE h.mmk_tanggal BETWEEN ? AND ?
    ${sqlCab}
    ORDER BY d.mmkd_nomor, d.mmkd_no_urut, d.mmkd_mspk_nomor
  `;
  const [rows] = await db.query(query, params);
  return rows;
};

const deleteMutasi = async (nomorUrl, user) => {
  const nomor = String(nomorUrl ?? "").trim();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [hdr] = await conn.query(
      `SELECT mmk_nomor, mmk_cab, DATE_FORMAT(mmk_tanggal, '%Y-%m-%d') AS tgl
       FROM ${T.hdr} WHERE mmk_nomor = ? FOR UPDATE`,
      [nomor],
    );
    if (hdr.length === 0)
      throw galat("Dokumen Mutasi Marketing tidak ditemukan", "notFound");
    if (
      !adalahSuperadmin(user) &&
      String(hdr[0].mmk_cab).trim() !== cabangUser(user)
    ) {
      throw galat("Dokumen ini bukan milik cabang Anda", "forbidden");
    }

    const [diterima] = await conn.query(
      `SELECT COUNT(*) AS n FROM ${T.dtl}
       WHERE mmkd_nomor = ? AND mmkd_diterima_tgl IS NOT NULL`,
      [nomor],
    );
    if (Number(diterima[0].n) > 0) {
      throw galat(
        "Dokumen tidak bisa dihapus: sudah ada MAP yang diterima marketing",
      );
    }

    await cekTutupBuku(hdr[0].tgl);

    await conn.query(`DELETE FROM ${T.dtl} WHERE mmkd_nomor = ?`, [nomor]);
    await conn.query(`DELETE FROM ${T.hdr} WHERE mmk_nomor = ?`, [nomor]);
    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
};

module.exports = { getBrowse, getDetail, deleteMutasi };
