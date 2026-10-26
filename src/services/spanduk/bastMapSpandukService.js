const db = require("../../config/database");
const {
  galat,
  norm,
  validasiPeriode,
  adalahSuperadmin,
  cabangUser,
  cekTutupBuku,
} = require("./lhk/lhkCommon");
const {
  KESESUAIAN_SPANDUK,
  hariKerjaSql,
} = require("./bastMapSpandukFormService");

const DIVISI_SPANDUK = 1;

// Filter dasar: divisi 1, MAP ber-CMO, scoping cabang, periode / On Progress
const susunFilter = (filters, user) => {
  const { startDate, endDate, onProgressOnly } = filters;
  const params = [DIVISI_SPANDUK];
  let where = `WHERE m.mspk_divisi = ? AND m.mspk_cmo <> ""`;

  const superadmin = adalahSuperadmin(user);
  const cab = superadmin ? null : cabangUser(user);
  if (cab) {
    where += ` AND m.mspk_cab = ?`;
    params.push(cab);
  }

  if (onProgressOnly === "true" || onProgressOnly === true) {
    where += ` AND m.mspk_nomor IN (SELECT map FROM kencanaprint.tkesesuaianmap_lock WHERE apv = "N"`;
    if (cab) {
      where += ` AND cab = ?`;
      params.push(cab);
    }
    where += `)`;
  } else {
    validasiPeriode(startDate, endDate);
    where += ` AND m.mspk_tanggal >= ? AND m.mspk_tanggal <= ?`;
    params.push(`${startDate} 00:00:00`, `${endDate} 23:59:59`);
  }
  return { where, params };
};

const getBrowseList = async (filters, user) => {
  const { where, params } = susunFilter(filters, user);
  const [rows] = await db.query(
    `
    SELECT
      m.mspk_nomor AS Nomor,
      m.mspk_tipe AS Tipe,
      m.mspk_tanggal AS Tanggal,
      IF(EXISTS (SELECT 1 FROM kencanaprint.tkesesuaianmap s
                 WHERE s.mspk_nomor = m.mspk_nomor), "SUDAH", "") AS CetakBAST,
      m.mspk_nama AS NamaPekerjaan,
      m.mspk_nama2 AS NamaExt,
      m.mspk_ukuran AS Ukuran,
      m.mspk_keterangan AS Keterangan,
      m.mspk_kendala AS kendalaProduksi,
      m.mspk_jumlah_jadi AS Jumlah,
      (SELECT IFNULL(l.apv, "") FROM kencanaprint.tkesesuaianmap_lock l
        WHERE l.map = m.mspk_nomor LIMIT 1) AS OnProgres,
      (SELECT IF(COUNT(*) > 0 AND SUM(s.status <> 'N') = 0, 1, 0)
         FROM kencanaprint.tkesesuaianmap s
        WHERE s.mspk_nomor = m.mspk_nomor
          AND s.kode_sesuai IN (${KESESUAIAN_SPANDUK.join(",")})) AS SemuaN,
      (SELECT p.keputusan FROM kencanaprint.tkesesuaianmap_keputusan p
        WHERE p.map = m.mspk_nomor) AS Keputusan,
      (SELECT p.alasan FROM kencanaprint.tkesesuaianmap_keputusan p
        WHERE p.map = m.mspk_nomor) AS AlasanKeputusan,
      (SELECT GROUP_CONCAT(DISTINCT d.lprd_lpr_nomor
              ORDER BY d.lprd_lpr_nomor SEPARATOR ', ')
        FROM kencanaprint.tlhk_proof_dtl d
      WHERE d.lprd_spk_nomor = m.mspk_nomor) AS NomorProof
      ,
      ${hariKerjaSql(
        "DATE(m.date_create)",
        `IFNULL((SELECT DATE(MIN(s.date_create)) FROM kencanaprint.tkesesuaianmap s WHERE s.mspk_nomor = m.mspk_nomor), CURDATE())`,
      )} AS HariBAST
    FROM kencanaprint.tmemospk m
    ${where}
    ORDER BY m.mspk_tanggal DESC, m.mspk_nomor DESC
    `,
    params,
  );
  return rows;
};

const deleteBast = async (nomor, user) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[map]] = await conn.query(
      `SELECT mspk_nomor, mspk_divisi, mspk_cab,
              DATE_FORMAT(mspk_tanggal, '%Y-%m-%d') AS tgl
         FROM kencanaprint.tmemospk WHERE mspk_nomor = ? FOR UPDATE`,
      [nomor],
    );
    if (!map) {
      throw galat(`MAP ${nomor} tidak ditemukan`, "notFound");
    }
    if (Number(map.mspk_divisi) !== DIVISI_SPANDUK) {
      throw galat(`MAP ${nomor} bukan divisi Spanduk`, "forbidden");
    }
    if (!adalahSuperadmin(user) && norm(map.mspk_cab) !== cabangUser(user)) {
      throw galat(`MAP ${nomor} milik cabang lain`, "forbidden");
    }
    const [serah] = await conn.query(
      `SELECT mmkd_nomor FROM kencanaprint.tmutasi_marketing_spanduk_dtl
       WHERE mmkd_mspk_nomor = ? LIMIT 1`,
      [nomor],
    );
    if (serah.length > 0) {
      throw galat(
        `BAST tidak bisa dihapus: MAP sudah diserahkan ke marketing (${serah[0].mmkd_nomor})`,
      );
    }
    await cekTutupBuku(map.tgl);

    const [[ada]] = await conn.query(
      `SELECT COUNT(*) AS n FROM kencanaprint.tkesesuaianmap WHERE mspk_nomor = ?`,
      [nomor],
    );
    if (!Number(ada.n)) {
      throw galat(`MAP ${nomor} belum memiliki BAST`);
    }

    await conn.query(
      `DELETE FROM kencanaprint.tkesesuaianmap WHERE mspk_nomor = ?`,
      [nomor],
    );
    await conn.query(
      `UPDATE kencanaprint.tmemospk
          SET mspk_jumlah_jadi = 0, mspk_kendala = ""
        WHERE mspk_nomor = ?`,
      [nomor],
    );
    await conn.query(
      `DELETE FROM kencanaprint.tkesesuaianmap_komponen WHERE nomor = ?`,
      [nomor],
    );
    await conn.query(
      `DELETE FROM kencanaprint.tkesesuaianmap_obat WHERE ko_nomor = ?`,
      [nomor],
    );
    await conn.query(
      `DELETE FROM kencanaprint.tkesesuaianmap_lock WHERE map = ?`,
      [nomor],
    );
    await conn.query(
      `DELETE FROM kencanaprint.tkesesuaianmap_keputusan WHERE map = ?`,
      [nomor],
    );

    await conn.commit();
    return true;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = { getBrowseList, deleteBast };
