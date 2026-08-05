const db = require("../../config/database");

/**
 * Resolusi cabang efektif — HANYA dipakai buat FILTER browse (bukan
 * lock akses). Browse module ini TIDAK membatasi cabang siapapun bisa
 * lihat data cabang manapun, beda dari modul Koreksi Stok.
 */
const resolveDefaultCabang = (user) => {
  const userCab = user.cabang || "";
  if (userCab && userCab !== "HO-") return userCab;
  return "ALL";
};

/**
 * Browse Pemakaian Obat.
 * ⚠️ Replikasi persis query .pas — termasuk kolom "Keterangan" yang
 * dihitung di inner subquery tapi TIDAK PERNAH dipakai di outer select
 * (dead computation di source, saya buang di sini).
 */
const getBrowseData = async (startDate, endDate, cabang) => {
  let filterCabang = "";
  const params = [startDate, endDate];
  if (cabang && cabang !== "ALL") {
    filterCabang = "AND h.ob_cab = ?";
    params.push(cabang);
  }

  const qMaster = `
    SELECT x.Nomor, x.Cab, x.Tanggal, x.Spk, x.NamaSpk, x.JenisOrder, x.JumlahSpk,
      x.Lini,
      x.rata2 AS HasilProduksiRata2,
      x.totpakai AS TotPakaiObat,
      ROUND(x.totpakai / x.rata2) AS KonsumsiObatPerPcs,
      x.nominal AS RpPakaiObat,
      ROUND(x.nominal / x.rata2) AS RpObatPerSet,
      x.user_create AS Created,
      (
        SELECT GROUP_CONCAT(b.Bhn_Name SEPARATOR ", ")
        FROM tpakaiobat_komponen k
        INNER JOIN tbahan b ON b.Bhn_kode = k.obk_kode
        WHERE k.obk_nomor = x.Nomor
      ) AS Komponen
    FROM (
      SELECT h.ob_nomor AS Nomor, h.ob_cab AS Cab, h.ob_tanggal AS Tanggal,
        h.ob_spk_nomor AS Spk,
        IFNULL(s.spk_nama, m.Mspk_nama) AS NamaSpk,
        o.jo_nama AS JenisOrder,
        IFNULL(s.spk_jumlah, m.mspk_jumlah) AS JumlahSpk,
        h.ob_lini AS Lini, h.user_create,
        IFNULL((
          SELECT SUM(k.obk_hasil) / COUNT(k.obk_nomor)
          FROM tpakaiobat_komponen k
          WHERE k.obk_kode <> '' AND k.obk_nomor = h.ob_nomor
        ), 0) AS rata2,
        IFNULL((
          SELECT SUM(d.obd_jumlah * 1000)
          FROM tpakaiobat_dtl d
          WHERE d.obd_nomor = h.ob_nomor
        ), 0) AS totpakai,
        IFNULL((
          SELECT SUM((o.brg_harga / 1000) * (d.obd_jumlah * 1000))
          FROM tpakaiobat_dtl d
          LEFT JOIN tgarmen_brg o ON o.brg_kode = d.obd_okode
          WHERE d.obd_nomor = h.ob_nomor
        ), 0) AS nominal
      FROM tpakaiobat_hdr h
      LEFT JOIN tspk s ON s.spk_nomor = h.ob_spk_nomor
      LEFT JOIN tmemospk m ON m.Mspk_nomor = h.ob_spk_nomor
      LEFT JOIN tjenisorder o ON o.jo_kode = LEFT(RIGHT(h.ob_spk_nomor, 9), 2)
      WHERE h.ob_tanggal >= ? AND h.ob_tanggal <= ?
      ${filterCabang}
    ) x
    ORDER BY x.Nomor
  `;
  const [masterRows] = await db.query(qMaster, params);

  // ⚠️ "j.o_satuan" REPLIKASI PERSIS bug source — literal string, bukan
  // kolom. Konfirmasi kalau mau diperbaiki jadi j.brg_satuan.
  const qDetail = `
    SELECT h.ob_nomor AS Nomor, j.brg_nama AS JenisObat,
        (d.obd_jumlah * 1000) AS Jumlah,
        IF(j.brg_satuan = 'KG', 'GRAM', j.brg_satuan) AS Satuan,
        ((d.obd_jumlah * 1000) * (j.brg_harga / 1000)) AS Harga
    FROM tpakaiobat_hdr h
    INNER JOIN tpakaiobat_dtl d ON d.obd_nomor = h.ob_nomor
    LEFT JOIN tgarmen_brg j ON j.brg_kode = d.obd_okode
    WHERE h.ob_tanggal >= ? AND h.ob_tanggal <= ?
    ${filterCabang}
    ORDER BY h.ob_nomor
    `;
  const [detailRows] = await db.query(qDetail, params);

  return masterRows.map((master) => ({
    ...master,
    details: detailRows.filter((d) => d.Nomor === master.Nomor),
  }));
};

/**
 * Hapus Pemakaian Obat.
 * ⚠️ Replikasi persis: hanya DELETE tpakaiobat_hdr (asumsi trigger
 * cascade tpakaiobat_dtl + tpakaiobat_komponen — KONFIRMASI).
 * ⚠️ Pengecekan cabang: "HO-"/kosong dianggap TIDAK terkunci (staff HO
 * bebas akses semua cabang) — KONFIRMASI asumsi ini, karena beda dari
 * literal Delphi (frmMenu.CAB='' vs kita selalu isi fallback "HO-").
 */
const deleteData = async (nomor, user) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT ob_nomor, ob_cab FROM tpakaiobat_hdr WHERE ob_nomor = ? FOR UPDATE`,
      [nomor],
    );
    if (rows.length === 0) throw new Error("Data tidak ditemukan.");

    const userCab = user.cabang || "";
    if (userCab !== "" && userCab !== "HO-" && rows[0].ob_cab !== userCab) {
      throw new Error("Data tsb bukan cabang anda.");
    }

    await conn.query(`DELETE FROM tpakaiobat_hdr WHERE ob_nomor = ?`, [nomor]);

    await conn.commit();
    return true;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

/**
 * Data cetak — replikasi query cetak() Delphi persis, termasuk
 * INNER JOIN ke tpakaiobat_dtl. Komponen SENGAJA tidak diambil (source
 * comment-out query komponen, tidak pernah dipakai di report).
 */
const getPrintData = async (nomor) => {
  const q = `
    SELECT h.ob_nomor AS Nomor, h.ob_tanggal AS Tanggal, h.ob_spk_nomor AS Spk,
      IFNULL(s.spk_nama, m.Mspk_nama) AS NamaSpk,
      o.jo_nama AS JenisOrder,
      IFNULL(s.spk_jumlah, m.mspk_jumlah) AS JmlSpk,
      h.ob_lini AS Lini, h.ob_keterangan AS Keterangan,
      j.brg_nama AS JenisObat, d.obd_jumlah AS Jumlah, j.brg_satuan AS Satuan
    FROM tpakaiobat_hdr h
    INNER JOIN tpakaiobat_dtl d ON d.obd_nomor = h.ob_nomor
    LEFT JOIN tspk s ON s.spk_nomor = h.ob_spk_nomor
    LEFT JOIN tmemospk m ON m.Mspk_nomor = h.ob_spk_nomor
    LEFT JOIN tjenisorder o ON o.jo_kode = LEFT(RIGHT(h.ob_spk_nomor, 9), 2)
    LEFT JOIN tgarmen_brg j ON j.brg_kode = d.obd_okode
    WHERE h.ob_nomor = ?
  `;
  const [rows] = await db.query(q, [nomor]);
  if (rows.length === 0) return null;

  const { Nomor, Tanggal, Spk, NamaSpk, Lini, Keterangan } = rows[0];
  const details = rows.map((r) => ({
    jenisObat: r.JenisObat,
    jumlah: r.Jumlah,
    satuan: r.Satuan,
  }));

  return {
    nomor: Nomor,
    tanggal: Tanggal,
    spk: Spk,
    product: NamaSpk,
    lini: Lini,
    keterangan: Keterangan,
    details,
  };
};

module.exports = {
  resolveDefaultCabang,
  getBrowseData,
  deleteData,
  getPrintData,
};
