const db = require("../../config/database");

const MENU_ID = "165";

// Mapping cabang → kode gudang, sesuai Delphi
const CABANG_GUDANG_MAP = {
  P01: "GJ002",
  P02: "WH002",
  P04: "GJ001",
  P05: "WH-010",
};

// ═══════════════════════════════════════════════════════════
// BROWSE
// Sesuai Delphi btnRefreshClick — filter gudang berdasar cabang user
// ═══════════════════════════════════════════════════════════
const getBrowse = async (tglAwal, tglAkhir, cabang = "") => {
  let gudangFilter = "";
  const params = [tglAwal, tglAkhir];

  const gdgKode = CABANG_GUDANG_MAP[cabang];
  if (gdgKode) {
    gudangFilter = ` AND h.sj_gdg_kode = ?`;
    params.push(gdgKode);
  }

  const [rows] = await db.query(
    `SELECT
       IF(h.sj_approve=1,'Sudah', IF(h.sj_approve=2,'Batal','')) AS Approved,
       v.divisi                                  AS Divisi,
       h.sj_nomor                                AS Nomor,
       DATE_FORMAT(h.sj_tanggal,'%Y-%m-%d')      AS Tanggal,
       h.sj_gdg_kode                              AS KodeGdg,
       g.gdg_nama                                 AS Gudang,
       h.sj_cus_kode                              AS KodeCustomer,
       c.cus_nama                                  AS Customer,
       h.sj_alamat_customer                        AS Alamat,
       h.sj_kota_customer                          AS Kota,
       h.sj_keterangan                             AS Keterangan,
       h.sj_perush_kode                            AS ID
     FROM tsj_hdr h
     LEFT JOIN tgudang g ON g.gdg_kode = h.sj_gdg_kode
     LEFT JOIN tcustomer c ON c.cus_kode = h.sj_cus_kode
     LEFT JOIN tdivisi v ON v.kode = h.sj_divisi
     WHERE h.sj_status_otomatis = 0
       AND h.date_create >= '2020-08-24'
       AND h.sj_tanggal >= ?
       AND h.sj_tanggal <= ?
       ${gudangFilter}
     ORDER BY h.sj_approve, h.sj_nomor`,
    params,
  );
  return rows;
};

const getBrowseDetail = async (tglAwal, tglAkhir, cabang = "", nomor = "") => {
  let gudangFilter = "";
  const params = [tglAwal, tglAkhir];

  const gdgKode = CABANG_GUDANG_MAP[cabang];
  if (gdgKode) {
    gudangFilter = ` AND h.sj_gdg_kode = ?`;
    params.push(gdgKode);
  }

  let nomorFilter = "";
  if (nomor) {
    nomorFilter = ` AND d.sjd_sj_nomor = ?`;
    params.push(nomor);
  }

  const [rows] = await db.query(
    `SELECT
       d.sjd_sj_nomor   AS Nomor,
       d.sjd_spk_nomor  AS SpkNomor,
       s.spk_nama       AS Nama,
       d.sjd_ukuran     AS Ukuran,
       s.spk_panjang    AS Panjang,
       s.spk_lebar      AS Lebar,
       d.sjd_jumlah     AS Jumlah,
       d.sjd_keterangan AS Keterangan
     FROM tsj_hdr h
     INNER JOIN tsj_dtl d ON h.sj_nomor = d.sjd_sj_nomor
     LEFT JOIN tspk s ON s.spk_nomor = d.sjd_spk_nomor
     WHERE h.sj_status_otomatis = 0
       AND h.date_create >= '2020-08-24'
       AND h.sj_tanggal >= ?
       AND h.sj_tanggal <= ?
       ${gudangFilter}
       ${nomorFilter}
     ORDER BY d.sjd_sj_nomor`,
    params,
  );
  return rows;
};

// ═══════════════════════════════════════════════════════════
// SHOW ALL NOT APPROVED
// Sesuai Delphi btnShowClick — tanpa filter gudang/cabang, tanpa filter tanggal
// ═══════════════════════════════════════════════════════════
const getAllNotApproved = async () => {
  const [rows] = await db.query(
    `SELECT
       IF(h.sj_approve=1,'Sudah', IF(h.sj_approve=2,'Batal','')) AS Approved,
       v.divisi                                  AS Divisi,
       h.sj_nomor                                AS Nomor,
       DATE_FORMAT(h.sj_tanggal,'%Y-%m-%d')      AS Tanggal,
       h.sj_gdg_kode                              AS KodeGdg,
       g.gdg_nama                                 AS Gudang,
       h.sj_cus_kode                              AS KodeCustomer,
       c.cus_nama                                  AS Customer,
       h.sj_alamat_customer                        AS Alamat,
       h.sj_kota_customer                          AS Kota,
       h.sj_keterangan                             AS Keterangan,
       h.sj_perush_kode                            AS ID
     FROM tsj_hdr h
     INNER JOIN tgudang g ON g.gdg_kode = h.sj_gdg_kode
     LEFT JOIN tcustomer c ON c.cus_kode = h.sj_cus_kode
     LEFT JOIN tdivisi v ON v.kode = h.sj_divisi
     WHERE h.sj_status_otomatis <> 1
       AND h.sj_approve = 0
       AND h.date_create >= '2020-08-24'
     ORDER BY h.sj_nomor`,
  );
  return rows;
};

// ═══════════════════════════════════════════════════════════
// APPROVE single SJ
// Sesuai Delphi Approval1Click
// ═══════════════════════════════════════════════════════════
const approveSingle = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT sj_nomor, sj_approve, sj_gdg_kode FROM tsj_hdr WHERE sj_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");
  if (hdr.sj_approve === 1) throw new Error("Sudah di approve.");
  if (hdr.sj_approve === 2)
    throw new Error("Masukkan ke Pending dulu baru di Approve.");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(`UPDATE tsj_hdr SET sj_approve = 1 WHERE sj_nomor = ?`, [
      nomor,
    ]);

    const [dtl] = await conn.query(
      `SELECT sjd_sj_nomor, sjd_spk_nomor, sjd_ukuran, sjd_jumlah
       FROM tsj_dtl WHERE sjd_sj_nomor = ?`,
      [nomor],
    );

    for (const d of dtl) {
      await conn.query(
        `INSERT INTO tsj_approve (sja_nomor, sja_spk_nomor, sja_size, sja_jumlah, sja_gdg_kode)
         VALUES (?, ?, ?, ?, ?)`,
        [
          d.sjd_sj_nomor,
          d.sjd_spk_nomor,
          d.sjd_ukuran,
          d.sjd_jumlah,
          hdr.sj_gdg_kode,
        ],
      );
    }

    await conn.commit();
    return { nomor };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ═══════════════════════════════════════════════════════════
// PENDING — batalkan approve (kembali ke pending)
// Sesuai Delphi Pending1Click
// ═══════════════════════════════════════════════════════════
const setPending = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT sj_nomor, sj_approve FROM tsj_hdr WHERE sj_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");
  if (hdr.sj_approve === 0)
    throw new Error("Status belum di approve.\nTidak perlu dibatalkan.");
  if (hdr.sj_approve !== 1)
    throw new Error("Hanya SJ berstatus Sudah yang bisa di-pending.");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`UPDATE tsj_hdr SET sj_approve = 0 WHERE sj_nomor = ?`, [
      nomor,
    ]);
    await conn.query(`DELETE FROM tsj_approve WHERE sja_nomor = ?`, [nomor]);
    await conn.commit();
    return { nomor };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ═══════════════════════════════════════════════════════════
// BATAL SJ — batalkan total
// Sesuai Delphi BatalSJ1Click
// ═══════════════════════════════════════════════════════════
const batalSj = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT sj_nomor, sj_approve FROM tsj_hdr WHERE sj_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");
  if (hdr.sj_approve === 1) {
    throw new Error(
      "Sudah di approve.\nSilahkan di Pending utk membatalkan Approve, baru di batalkan.",
    );
  }
  if (hdr.sj_approve === 2) throw new Error("SJ ini sudah batal.");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(`UPDATE tsj_hdr SET sj_approve = 2 WHERE sj_nomor = ?`, [
      nomor,
    ]);

    // Kurangi spk_prasj sesuai jumlah yang sudah dialokasikan di SJ ini
    await conn.query(
      `UPDATE tspk s
       SET s.spk_prasj = s.spk_prasj - IFNULL((
         SELECT SUM(d.sjd_jumlah) FROM tsj_dtl d
         WHERE d.sjd_sj_nomor = ? AND d.sjd_spk_nomor = s.spk_nomor
       ), 0)
       WHERE s.spk_nomor IN (
         SELECT sjd_spk_nomor FROM tsj_dtl WHERE sjd_sj_nomor = ?
       )`,
      [nomor, nomor],
    );

    await conn.commit();
    return { nomor };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ═══════════════════════════════════════════════════════════
// BULK APPROVAL (dialog terpisah — ufrmSJapv2)
// ═══════════════════════════════════════════════════════════

const getBulkList = async (divisi = "", cabang = "") => {
  let where = `h.sj_status_otomatis = 0 AND h.sj_approve = 0 AND h.date_create >= '2020-08-24'`;
  const params = [];

  if (divisi && divisi !== "0") {
    where += ` AND h.sj_divisi = ?`;
    params.push(divisi);
  }

  // Filter gudang khusus divisi 4 (garmen) sesuai Delphi
  if (divisi === "4") {
    if (cabang === "P01") {
      where += ` AND h.sj_gdg_kode = 'GJ002'`;
    } else if (cabang === "P04") {
      where += ` AND h.sj_gdg_kode = 'GJ001'`;
    }
  }

  const [rows] = await db.query(
    `SELECT
       v.divisi                              AS Divisi,
       h.sj_nomor                            AS Nomor,
       DATE_FORMAT(h.sj_tanggal,'%Y-%m-%d')  AS Tanggal,
       g.gdg_nama                             AS Gudang,
       h.sj_cus_kode                          AS KdCus,
       c.cus_nama                              AS Nama,
       c.cus_alamat                            AS Alamat,
       c.cus_kota                              AS Kota,
       h.sj_gdg_kode                           AS KodeGdg
     FROM tsj_hdr h
     INNER JOIN tgudang g ON g.gdg_kode = h.sj_gdg_kode
     LEFT JOIN tcustomer c ON c.cus_kode = h.sj_cus_kode
     LEFT JOIN tdivisi v ON v.kode = h.sj_divisi
     WHERE ${where}
     ORDER BY h.sj_tanggal`,
    params,
  );
  return rows;
};

const approveBulk = async (nomorList) => {
  if (!Array.isArray(nomorList) || !nomorList.length) {
    throw new Error(
      "Tidak ada data yang akan di approval. Silahkan di refresh dulu.",
    );
  }

  const conn = await db.getConnection();
  const results = { success: [], failed: [] };

  try {
    await conn.beginTransaction();

    for (const nomor of nomorList) {
      try {
        const [[hdr]] = await conn.query(
          `SELECT sj_nomor, sj_gdg_kode FROM tsj_hdr WHERE sj_nomor = ?`,
          [nomor],
        );
        if (!hdr) {
          results.failed.push({ nomor, reason: "Tidak ditemukan" });
          continue;
        }

        await conn.query(
          `UPDATE tsj_hdr SET sj_approve = 1 WHERE sj_nomor = ?`,
          [nomor],
        );

        const [dtl] = await conn.query(
          `SELECT sjd_sj_nomor, sjd_spk_nomor, sjd_ukuran, sjd_jumlah
           FROM tsj_dtl WHERE sjd_sj_nomor = ?`,
          [nomor],
        );

        for (const d of dtl) {
          await conn.query(
            `INSERT INTO tsj_approve (sja_nomor, sja_spk_nomor, sja_size, sja_jumlah, sja_gdg_kode)
             VALUES (?, ?, ?, ?, ?)`,
            [
              d.sjd_sj_nomor,
              d.sjd_spk_nomor,
              d.sjd_ukuran,
              d.sjd_jumlah,
              hdr.sj_gdg_kode,
            ],
          );
        }

        results.success.push(nomor);
      } catch (e) {
        results.failed.push({ nomor, reason: e.message });
      }
    }

    await conn.commit();
    return results;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ═══════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════
const getExportData = async (tglAwal, tglAkhir, cabang = "") =>
  getBrowse(tglAwal, tglAkhir, cabang);
const getExportDetail = async (tglAwal, tglAkhir, cabang = "") =>
  getBrowseDetail(tglAwal, tglAkhir, cabang);

// ═══════════════════════════════════════════════════════════
// DIVISI LIST untuk bulk dialog (filter dropdown)
// ═══════════════════════════════════════════════════════════
const getDivisiList = async () => {
  const [rows] = await db.query(
    `SELECT kode, divisi AS nama FROM tdivisi ORDER BY kode`,
  );
  return rows;
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  getAllNotApproved,
  approveSingle,
  setPending,
  batalSj,
  getBulkList,
  approveBulk,
  getExportData,
  getExportDetail,
  getDivisiList,
};
