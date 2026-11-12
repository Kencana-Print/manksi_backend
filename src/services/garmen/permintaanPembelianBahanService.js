const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// Bagian yang boleh mengelola dokumen semua cabang
const BAGIAN_SUPER = ["EDP", "DIR", "DIREKSI", "AUDIT"];

// Total pesanan PO per (permintaan, bahan): permintaan ada di header PO
const SQL_DIPESAN = `
  SELECT h.po_mbb_nomor AS pod_mbb_nomor, d.pod_bhn_kode,
         SUM(d.pod_jumlah) AS dipesan,
         GROUP_CONCAT(DISTINCT h.po_nomor ORDER BY h.po_nomor SEPARATOR ', ') AS po
    FROM tpo_hdr h
    JOIN tpo_dtl d ON d.pod_po_nomor = h.po_nomor
   WHERE h.po_mbb_nomor <> ''
   GROUP BY h.po_mbb_nomor, d.pod_bhn_kode`;

// Sisa per baris
const SQL_SISA = `GREATEST(ROUND(d.mbbd_jumlah - IFNULL(p.dipesan, 0), 2), 0)`;

const getBrowse = async (startDate, endDate, cabang) => {
  const params = [startDate, endDate];
  // Status: DICLOSE tersimpan; PROSES/CLOSE dihitung dari PO. CLOSE = semua baris
  // sudah terpesan penuh (pesanan boleh melebihi sisa).
  let query = `
    SELECT
      h.mbb_nomor AS Nomor,
      DATE_FORMAT(h.mbb_tanggal, "%Y-%m-%d") AS Tanggal,
      h.mbb_ket AS Keterangan,
      h.mbb_cab AS Cab,
      h.mbb_bagian AS Bagian,
      IFNULL(h.user_create, "") AS Usr,
      DATE_FORMAT(h.date_create, "%Y-%m-%d %H:%i:%s") AS Created,
      DATE_FORMAT(h.date_modified, "%Y-%m-%d %H:%i:%s") AS Modified,
      CASE
        WHEN h.mbb_status <> '' THEN h.mbb_status
        WHEN IFNULL(x.jml_dipakai, 0) = 0 THEN ''
        WHEN IFNULL(x.jml_kurang, 0) = 0 THEN 'CLOSE'
        ELSE 'PROSES'
      END AS Status,
      IFNULL(x.jml_item, 0) AS JmlItem
    FROM tmintabelibahan_hdr h
    LEFT JOIN (
      SELECT d.mbbd_nomor,
             COUNT(*) AS jml_item,
             SUM(IFNULL(p.dipesan, 0) > 0) AS jml_dipakai,
             SUM(ROUND(IFNULL(p.dipesan, 0), 2) < ROUND(d.mbbd_jumlah, 2)) AS jml_kurang
        FROM tmintabelibahan_dtl d
        LEFT JOIN (${SQL_DIPESAN}) p
               ON p.pod_mbb_nomor = d.mbbd_nomor AND p.pod_bhn_kode = d.mbbd_bhn_kode
       GROUP BY d.mbbd_nomor
    ) x ON x.mbbd_nomor = h.mbb_nomor
    WHERE h.mbb_tanggal BETWEEN ? AND ?
  `;

  if (cabang && cabang !== "ALL") {
    query += ` AND h.mbb_cab = ?`;
    params.push(cabang);
  }

  query += ` ORDER BY h.mbb_nomor DESC`;

  const [rows] = await db.query(query, params);
  return rows;
};

const getBrowseDetail = async (nomor) => {
  const [rows] = await db.query(
    `SELECT
       d.mbbd_nomor AS Nomor,
       d.mbbd_bhn_kode AS Kode,
       IFNULL(b.Bhn_Name, "") AS Nama,
       IF(LEFT(d.mbbd_bhn_kode, 2) = "SB", "", IFNULL(s.bs_nama, "")) AS Setting,
       d.mbbd_satuan AS Satuan,
       d.mbbd_jumlah AS Jumlah,
       d.mbbd_ket AS Keterangan,
       IFNULL(p.dipesan, 0) AS Dipesan,
       ${SQL_SISA} AS Sisa,
       IFNULL(p.po, "") AS PO
     FROM tmintabelibahan_dtl d
     LEFT JOIN tbahan b ON b.Bhn_kode = d.mbbd_bhn_kode
     LEFT JOIN tbahan_setting s ON s.bs_kode = RIGHT(d.mbbd_bhn_kode, 2)
                               AND LEFT(d.mbbd_bhn_kode, 2) <> 'SB'
     LEFT JOIN (${SQL_DIPESAN}) p
            ON p.pod_mbb_nomor = d.mbbd_nomor AND p.pod_bhn_kode = d.mbbd_bhn_kode
     WHERE d.mbbd_nomor = ?
     ORDER BY d.mbbd_nourut`,
    [nomor],
  );
  return rows;
};

const getBrowseDetailRange = async (startDate, endDate, cabang) => {
  const params = [startDate, endDate];
  let query = `
    SELECT
      d.mbbd_nomor AS Nomor,
      DATE_FORMAT(h.mbb_tanggal, "%Y-%m-%d") AS Tanggal,
      h.mbb_cab AS Cab,
      h.mbb_status AS Status,
      d.mbbd_bhn_kode AS Kode,
      IFNULL(b.Bhn_Name, "") AS Nama,
      IF(LEFT(d.mbbd_bhn_kode, 2) = "SB", "", IFNULL(s.bs_nama, "")) AS Setting,
      d.mbbd_satuan AS Satuan,
      d.mbbd_jumlah AS Jumlah,
      d.mbbd_ket AS Keterangan,
      IFNULL(p.dipesan, 0) AS Dipesan,
      ${SQL_SISA} AS Sisa,
      IFNULL(p.po, "") AS PO
    FROM tmintabelibahan_dtl d
    JOIN tmintabelibahan_hdr h ON h.mbb_nomor = d.mbbd_nomor
    LEFT JOIN tbahan b ON b.Bhn_kode = d.mbbd_bhn_kode
    LEFT JOIN tbahan_setting s ON s.bs_kode = RIGHT(d.mbbd_bhn_kode, 2)
                              AND LEFT(d.mbbd_bhn_kode, 2) <> 'SB'
    LEFT JOIN (${SQL_DIPESAN}) p
           ON p.pod_mbb_nomor = d.mbbd_nomor AND p.pod_bhn_kode = d.mbbd_bhn_kode
    WHERE h.mbb_tanggal BETWEEN ? AND ?
  `;
  if (cabang && cabang !== "ALL") {
    query += ` AND h.mbb_cab = ?`;
    params.push(cabang);
  }
  query += ` ORDER BY d.mbbd_nomor, d.mbbd_nourut`;

  const [rows] = await db.query(query, params);
  return rows;
};

// --- DATA CETAK ---
const getPrintData = async (nomor) => {
  const [hdr] = await db.query(
    `SELECT
       h.mbb_nomor AS Nomor,
       DATE_FORMAT(h.mbb_tanggal, "%d-%m-%Y") AS Tanggal,
       h.mbb_ket AS Keterangan,
       h.mbb_cab AS Cabang,
       h.mbb_bagian AS Bagian,
       h.mbb_status AS Status,
       IFNULL(h.user_create, "") AS Pembuat
     FROM tmintabelibahan_hdr h
     WHERE h.mbb_nomor = ?`,
    [nomor],
  );
  if (hdr.length === 0) throw new Error("Data permintaan tidak ditemukan.");

  const [details] = await db.query(
    `SELECT
       d.mbbd_bhn_kode AS Kode,
       IFNULL(b.Bhn_Name, "") AS Nama,
       IF(LEFT(d.mbbd_bhn_kode, 2) = "SB", "", IFNULL(s.bs_nama, "")) AS Setting,
       IFNULL(b.bhn_konstruksi, "") AS Konstruksi,
       b.bhn_panjang AS Panjang,
       b.bhn_lebar AS Lebar,
       d.mbbd_satuan AS Satuan,
       d.mbbd_jumlah AS Jumlah,
       d.mbbd_ket AS Keterangan
     FROM tmintabelibahan_dtl d
     LEFT JOIN tbahan b ON b.Bhn_kode = d.mbbd_bhn_kode
     LEFT JOIN tbahan_setting s ON s.bs_kode = RIGHT(d.mbbd_bhn_kode, 2)
                               AND LEFT(d.mbbd_bhn_kode, 2) <> 'SB'
     WHERE d.mbbd_nomor = ?
     ORDER BY d.mbbd_nourut`,
    [nomor],
  );

  return { header: hdr[0], details };
};

const deletePermintaan = async (nomor, user) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [hdr] = await conn.query(
      `SELECT mbb_tanggal, mbb_cab, mbb_status
         FROM tmintabelibahan_hdr WHERE mbb_nomor = ? FOR UPDATE`,
      [nomor],
    );
    if (hdr.length === 0) throw new Error("Data tidak ditemukan.");

    // Dokumen cabang lain hanya boleh dihapus superadmin
    const bagian = String(user?.bagian || "").toUpperCase();
    const cabUser = String(user?.cabang || "");
    if (!BAGIAN_SUPER.includes(bagian) && cabUser !== hdr[0].mbb_cab) {
      throw new Error("Dokumen cabang lain tidak bisa dihapus.");
    }

    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    if (zdtClose && new Date(hdr[0].mbb_tanggal) < zdtClose) {
      throw new Error("Transaksi tsb sudah close.\nTidak bisa dihapus.");
    }

    if (hdr[0].mbb_status !== "") {
      throw new Error(`Sudah ${hdr[0].mbb_status}\nTidak bisa dihapus.`);
    }

    const [dipakai] = await conn.query(
      `SELECT po_nomor FROM tpo_hdr WHERE po_mbb_nomor = ? LIMIT 1`,
      [nomor],
    );
    if (dipakai.length > 0) {
      throw new Error(
        `Sudah dipakai di PO ${dipakai[0].po_nomor}. Tidak bisa dihapus.`,
      );
    }

    await conn.query(`DELETE FROM tmintabelibahan_dtl WHERE mbbd_nomor = ?`, [
      nomor,
    ]);
    await conn.query(`DELETE FROM tmintabelibahan_hdr WHERE mbb_nomor = ?`, [
      nomor,
    ]);

    await conn.commit();
    return true;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// --- CLOSE MANUAL ---
const SUPERADMIN = ["EDP", "DIR", "DIREKSI", "AUDIT"];

const closeData = async (nomor, alasan, user) => {
  const ket = String(alasan || "").trim();
  if (!ket) throw new Error("Alasan close wajib diisi.");
  if (ket.length > 255) throw new Error("Alasan maksimal 255 karakter.");

  const [hdr] = await db.query(
    `SELECT mbb_status, user_create FROM tmintabelibahan_hdr WHERE mbb_nomor = ?`,
    [nomor],
  );
  if (hdr.length === 0) throw new Error("Data permintaan tidak ditemukan.");
  if (hdr[0].mbb_status === "DICLOSE")
    throw new Error("Permintaan sudah ditutup.");

  const bagian = String(user.bagian || "").toUpperCase();
  const kode = String(user.kode || "").toUpperCase();
  const superadmin = SUPERADMIN.includes(bagian) || SUPERADMIN.includes(kode);
  const pemilik = String(hdr[0].user_create || "").toUpperCase() === kode;
  if (!superadmin && !pemilik)
    throw new Error("Hanya pembuat dokumen yang boleh menutup permintaan ini.");

  // Sudah CLOSE hasil hitungan (semua baris terpesan penuh) → tidak perlu ditutup manual
  const [dtl] = await db.query(
    `SELECT d.mbbd_jumlah AS jumlah, IFNULL(p.dipesan, 0) AS dipesan
       FROM tmintabelibahan_dtl d
       LEFT JOIN (
         SELECT pd.pod_bhn_kode, SUM(pd.pod_jumlah) AS dipesan
           FROM tpo_hdr ph
           JOIN tpo_dtl pd ON pd.pod_po_nomor = ph.po_nomor
          WHERE ph.po_mbb_nomor = ?
          GROUP BY pd.pod_bhn_kode
       ) p ON p.pod_bhn_kode = d.mbbd_bhn_kode
      WHERE d.mbbd_nomor = ?`,
    [nomor, nomor],
  );
  const semuaTerpenuhi =
    dtl.length > 0 && dtl.every((r) => Number(r.dipesan) >= Number(r.jumlah));
  if (semuaTerpenuhi)
    throw new Error(
      "Permintaan sudah CLOSE (semua bahan terpesan penuh), tidak perlu ditutup manual.",
    );

  // Kondisi status di WHERE: mencegah dua orang menutup bersamaan
  const [res] = await db.query(
    `UPDATE tmintabelibahan_hdr
        SET mbb_status = 'DICLOSE',
            mbb_alasan_close = ?,
            mbb_user_close = ?,
            mbb_tgl_close = NOW()
      WHERE mbb_nomor = ? AND mbb_status <> 'DICLOSE'`,
    [ket, user.kode, nomor],
  );
  if (res.affectedRows === 0) throw new Error("Permintaan sudah ditutup.");
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  getBrowseDetailRange,
  getPrintData,
  closeData,
  deletePermintaan,
};
