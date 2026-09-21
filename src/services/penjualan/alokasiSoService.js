const db = require("../../config/database");

// --- BROWSE: daftar SO + ringkasan alokasi ---
const getBrowseData = async (startDate, endDate, divisiKode, userInfo) => {
  let query = `
    SELECT
      s.so_nomor AS Nomor,
      DATE_FORMAT(s.so_tanggal, '%Y-%m-%d') AS Tanggal,
      v.Divisi AS Divisi,
      c.cus_nama AS Customer,
      a.sal_nama AS Sales,
      s.so_nama AS NamaPekerjaan,
      s.so_jumlah AS QtyOrder,
      s.so_aktif AS Aktif,
      IFNULL((
        SELECT COUNT(*) FROM tsalesorder_alokasi soa WHERE soa.soa_so_nomor = s.so_nomor
      ), 0) AS JmlAlokasi,
      IFNULL((
        SELECT SUM(soa.soa_jumlah) FROM tsalesorder_alokasi soa WHERE soa.soa_so_nomor = s.so_nomor
      ), 0) AS TotalAlokasi,
      (
        SELECT spk_nomor FROM tspk WHERE spk_so_ref = s.so_nomor AND spk_is_so = 0 LIMIT 1
      ) AS SpkTurunan
    FROM tsalesorder s
    LEFT JOIN tdivisi v ON v.kode = s.so_divisi
    LEFT JOIN tcustomer c ON c.cus_kode = s.so_cus_kode
    LEFT JOIN tsales a ON a.sal_kode = s.so_sal_kode
    WHERE s.so_tanggal >= ? AND s.so_tanggal <= ?
  `;
  const params = [startDate, endDate];

  if (divisiKode && divisiKode !== "0" && divisiKode !== "ALL") {
    query += ` AND s.so_divisi = ?`;
    params.push(divisiKode);
  }

  const isManagerOrAdmin =
    userInfo.jabatan?.includes("MANAGER-CMO-MO") ||
    userInfo.kode === "ADMIN" ||
    userInfo.bagian?.toUpperCase() === "AUDIT" ||
    userInfo.bagian?.toUpperCase() === "FINANCE" ||
    userInfo.bagian?.toUpperCase() === "MARKETING" ||
    userInfo.jabatan?.toUpperCase() === "MARKETING" ||
    userInfo.jabatan?.toUpperCase() === "MO" ||
    userInfo.flags?.cmo === 1 ||
    userInfo.flags?.cmo === "1" ||
    userInfo.flags?.cmo === "Y";

  if (!isManagerOrAdmin) {
    if (userInfo.jabatan === "CRM") {
      query += ` AND (s.so_sal_kode = "019" OR s.user_create = ?)`;
      params.push(userInfo.kode);
    } else if (userInfo.cabKaos && userInfo.cabKaos !== "KDC") {
      query += ` AND s.so_cabkaos = ?`;
      params.push(userInfo.cabKaos);
    } else {
      query += ` AND s.user_create = ?`;
      params.push(userInfo.kode);
    }
  }

  query += ` ORDER BY s.so_nomor DESC`;

  const [rows] = await db.query(query, params);
  return rows;
};

// --- GET DETAIL: header SO ringkas + daftar alokasi tersimpan ---
const getAlokasi = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT s.so_nomor, s.so_nama, s.so_jumlah, s.so_cus_kode, c.cus_nama,
            (SELECT spk_nomor FROM tspk WHERE spk_so_ref = s.so_nomor AND spk_is_so = 0 LIMIT 1) AS SpkTurunan
     FROM tsalesorder s
     LEFT JOIN tcustomer c ON c.cus_kode = s.so_cus_kode
     WHERE s.so_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Sales Order tidak ditemukan.");

  const [alokasi] = await db.query(
    `SELECT soa_urut AS urut, soa_alamat AS alamat, soa_kota AS kota,
            soa_person AS person, soa_hp AS hp, soa_jumlah AS jumlah
     FROM tsalesorder_alokasi WHERE soa_so_nomor = ? ORDER BY soa_urut`,
    [nomor],
  );

  return {
    nomor: hdr.so_nomor,
    namaPekerjaan: hdr.so_nama,
    customer: hdr.cus_nama,
    custKode: hdr.so_cus_kode,
    qtyOrder: Number(hdr.so_jumlah) || 0,
    spkTurunan: hdr.SpkTurunan || null,
    alokasi,
  };
};

// --- SAVE: replace seluruh alokasi SO ini, sync ke SPK turunan jika ada ---
const saveAlokasi = async (nomor, rows, userKode) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[hdr]] = await conn.query(
      `SELECT so_nomor, so_jumlah FROM tsalesorder WHERE so_nomor = ? FOR UPDATE`,
      [nomor],
    );
    if (!hdr) throw new Error("Sales Order tidak ditemukan.");

    const validRows = (rows || []).filter((r) => r.alamat || r.kota);

    const sumAlokasi = validRows.reduce(
      (acc, r) => acc + (Number(r.jumlah) || 0),
      0,
    );
    const qtyPesan = Number(hdr.so_jumlah) || 0;
    if (sumAlokasi > 0 && sumAlokasi !== qtyPesan) {
      throw new Error(
        `Total Qty Alokasi (${sumAlokasi}) tidak sama dengan Jumlah SO (${qtyPesan}). Silakan cek dulu.`,
      );
    }

    await conn.query(`DELETE FROM tsalesorder_alokasi WHERE soa_so_nomor = ?`, [
      nomor,
    ]);
    for (let i = 0; i < validRows.length; i++) {
      const item = validRows[i];
      await conn.query(
        `INSERT INTO tsalesorder_alokasi
           (soa_so_nomor, soa_urut, soa_alamat, soa_kota, soa_person, soa_hp, soa_jumlah)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          nomor,
          i + 1,
          item.alamat || "",
          item.kota || "",
          item.person || "",
          item.hp || "",
          item.jumlah || 0,
        ],
      );
    }

    // Sync ke SPK turunan (jika SO ini sudah dibuatkan SPK PPIC) —
    // ⚠️ ASUMSI struktur tspk_alokasi mengikuti pola prefix yang sama
    // dengan tsalesorder_alokasi (soa_* -> spka_*). Perlu dikonfirmasi.
    const [[turunan]] = await conn.query(
      `SELECT spk_nomor FROM tspk WHERE spk_so_ref = ? AND spk_is_so = 0 LIMIT 1`,
      [nomor],
    );
    if (turunan) {
      await conn.query(`DELETE FROM tspk_alokasi WHERE spka_spk_nomor = ?`, [
        turunan.spk_nomor,
      ]);
      for (let i = 0; i < validRows.length; i++) {
        const item = validRows[i];
        await conn.query(
          `INSERT INTO tspk_alokasi
             (spka_spk_nomor, spka_urut, spka_alamat, spka_kota, spka_person, spka_hp, spka_jumlah)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            turunan.spk_nomor,
            i + 1,
            item.alamat || "",
            item.kota || "",
            item.person || "",
            item.hp || "",
            item.jumlah || 0,
          ],
        );
      }
    }

    await conn.query(
      `UPDATE tsalesorder SET user_modified = ?, date_modified = NOW() WHERE so_nomor = ?`,
      [userKode, nomor],
    );

    await conn.commit();
    return { synced: !!turunan, spkNomor: turunan?.spk_nomor || null };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

module.exports = {
  getBrowseData,
  getAlokasi,
  saveAlokasi,
};
