const db = require("../../config/database");

/**
 * Mengambil data lengkap SJ MAP untuk Edit
 */
const getSjMapDetails = async (nomorSj) => {
  const [headerRows] = await db.query(
    `SELECT h.*, p.perush_nama, c.cus_nama, c.cus_alamat, c.cus_kota
     FROM tsj_hdr_memo h
     INNER JOIN tperusahaan p ON h.sj_perush_kode = p.perush_kode
     INNER JOIN tcustomer c ON h.sj_cus_kode = c.cus_kode
     WHERE h.sj_nomor = ?`,
    [nomorSj],
  );

  if (headerRows.length === 0) return null;

  const [detailRows] = await db.query(
    `SELECT d.*, m.mspk_nama, m.mspk_kain,
      (m.mspk_jumlah_kirim - d.sjd_jumlah) AS jml_kirim_lama,
      (m.mspk_jumlah - m.mspk_jumlah_kirim + d.sjd_jumlah) AS sisa_order
     FROM tsj_dtl_memo d
     LEFT JOIN tmemospk m ON d.sjd_mspk_nomor = m.mspk_nomor
     WHERE d.sjd_sj_nomor = ?`,
    [nomorSj],
  );

  // Cek Status PIN 5 (Approval Edit)
  const [pinRows] = await db.query(
    `SELECT * FROM tspk_pin5 WHERE pin_trs="SJ MAP" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1`,
    [nomorSj],
  );

  return {
    header: headerRows[0],
    details: detailRows,
    pinStatus: pinRows[0] || null,
  };
};

/**
 * Mengambil detail MAP saat dipilih di modal (loaddatadetail Delphi)
 */
const getMapItemDetails = async (nomorMap, cusKode, divisi) => {
  const [rows] = await db.query(
    `SELECT 
        m.MSPK_Nomor, 
        m.Mspk_nama, 
        m.Mspk_ukuran, 
        m.Mspk_kain, 
        m.Mspk_jumlah, 
        m.Mspk_jumlah_kirim, 
        m.Mspk_cus_kode, -- M besar, spk kecil
        m.mspk_divisi, 
        m.mspk_cmo,
        d.divisi as nama_divisi
     FROM tmemospk m
     LEFT JOIN tdivisi d ON m.mspk_divisi = d.kode
     WHERE m.MSPK_Nomor = ?`, // MSPK kapital semua
    [nomorMap],
  );

  if (rows.length === 0) throw new Error("MAP tidak ditemukan.");

  const map = rows[0];

  // --- AKSES DATA SESUAI CASING TABEL ---
  const dbCusKode = (map.Mspk_cus_kode || "").toString().trim(); // Mspk_cus_kode
  const inputCusKode = (cusKode || "").toString().trim();
  const dbDivisi = (map.mspk_divisi || "").toString().trim(); // mspk_divisi
  const inputDivisi = (divisi || "").toString().trim();

  // Validasi Divisi
  if (dbDivisi !== inputDivisi) {
    throw new Error(`MAP tsb dibuat di divisi ${map.nama_divisi || dbDivisi}`);
  }

  // Validasi Customer
  if (dbCusKode !== inputCusKode) {
    throw new Error(
      `MAP tidak ditemukan di customer tsb (DB: ${dbCusKode} vs Input: ${inputCusKode})`,
    );
  }

  // Validasi CMO
  if (!map.mspk_cmo || map.mspk_cmo === "") {
    throw new Error("MAP tsb belum di approve oleh CMO");
  }

  return {
    kode: map.MSPK_Nomor,
    nama: map.Mspk_nama,
    ukuran: map.Mspk_ukuran,
    bahan: map.Mspk_kain,
    jumlah_kirim: map.Mspk_jumlah_kirim || 0,
    kurang: (map.Mspk_jumlah || 0) - (map.Mspk_jumlah_kirim || 0),
  };
};

/**
 * Generate Nomor Otomatis (getmaxnomor Delphi)
 * Format: APG/SJ/[PERUSH]/[SEQUENCE]/[YYYY]
 */
const generateSjNumber = async (perushKode, tanggal) => {
  const year = new Date(tanggal).getFullYear();
  const prefix = `APG/SJ/${perushKode}`;

  const [rows] = await db.query(
    `SELECT IFNULL(MAX(SUBSTR(sj_nomor, 11, 5)), 0) as max_seq 
     FROM tsj_hdr_memo 
     WHERE LEFT(sj_nomor, 9) = ? AND RIGHT(sj_nomor, 4) = ?`,
    [prefix, String(year)],
  );

  const nextSeq = parseInt(rows[0].max_seq) + 1;
  const seqStr = String(nextSeq).padStart(5, "0");

  return `${prefix}/${seqStr}/${year}`;
};

/**
 * Simpan Data (Transactional)
 */
const saveSjMap = async (payload, userKode) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const { header, details, isEdit, pinStatus } = payload;
    let nomorSj = header.sj_nomor;

    if (!isEdit) {
      nomorSj = await generateSjNumber(
        header.sj_perush_kode,
        header.sj_tanggal,
      );
    }

    // 1. Header Logic
    if (isEdit) {
      await conn.query(
        `UPDATE tsj_hdr_memo SET 
          sj_tanggal=?, sj_keterangan=?, sj_perush_kode=?, sj_cus_kode=?, 
          sj_alamat_customer=?, sj_kota_customer=?, sj_up=?, 
          date_modified=NOW(), user_modified=?
         WHERE sj_nomor=?`,
        [
          header.sj_tanggal,
          header.sj_keterangan,
          header.sj_perush_kode,
          header.sj_cus_kode,
          header.sj_alamat_customer,
          header.sj_kota_customer,
          header.sj_up,
          userKode,
          nomorSj,
        ],
      );
    } else {
      await conn.query(
        `INSERT INTO tsj_hdr_memo 
          (sj_nomor, sj_divisi, sj_tanggal, sj_keterangan, sj_perush_kode, sj_cus_kode, sj_up, sj_alamat_customer, sj_kota_customer, date_create, user_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
        [
          nomorSj,
          header.sj_divisi,
          header.sj_tanggal,
          header.sj_keterangan,
          header.sj_perush_kode,
          header.sj_cus_kode,
          header.sj_up,
          header.sj_alamat_customer,
          header.sj_kota_customer,
          userKode,
        ],
      );
    }

    // 2. Detail Logic (Sync)
    // Kembalikan dulu mspk_jumlah_kirim sebelum update detail baru (agar sisa order kembali normal)
    const [oldDetails] = await conn.query(
      `SELECT * FROM tsj_dtl_memo WHERE sjd_sj_nomor=?`,
      [nomorSj],
    );
    for (const od of oldDetails) {
      await conn.query(
        `UPDATE tmemospk SET mspk_jumlah_kirim = mspk_jumlah_kirim - ? WHERE mspk_nomor = ?`,
        [od.sjd_jumlah, od.sjd_mspk_nomor],
      );
    }

    await conn.query(`DELETE FROM tsj_dtl_memo WHERE sjd_sj_nomor=?`, [
      nomorSj,
    ]);

    for (const d of details) {
      if (d.kode) {
        await conn.query(
          `INSERT INTO tsj_dtl_memo (sjd_sj_nomor, sjd_mspk_nomor, sjd_jumlah, sjd_ukuran) VALUES (?, ?, ?, ?)`,
          [nomorSj, d.kode, d.jumlah, d.ukuran],
        );
        // Update mspk_jumlah_kirim di master MAP
        await conn.query(
          `UPDATE tmemospk SET mspk_jumlah_kirim = mspk_jumlah_kirim + ? WHERE mspk_nomor = ?`,
          [d.jumlah, d.kode],
        );
      }
    }

    // 3. Update PIN status if ACC
    if (pinStatus && pinStatus.pin_acc === "Y") {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai="Y" WHERE pin_trs="SJ MAP" AND pin_nomor=? AND pin_urut=?`,
        [nomorSj, pinStatus.pin_urut],
      );
    }

    await conn.commit();
    return nomorSj;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

const getPrintData = async (nomorSj) => {
  const query = `
    SELECT h.*, DATE_FORMAT(h.sj_tanggal, '%d %b %Y') AS tgl_indo,
           DATE_FORMAT(h.date_create, '%d-%m-%Y %T') AS created,
           p.perush_nama, p.perush_alamat, p.perush_kota, p.perush_telp, p.perush_fax, p.perush_email,
           c.cus_nama, c.cus_alamat, c.cus_kota,
           d.sjd_jumlah, d.sjd_ukuran, d.sjd_mspk_nomor,
           m.Mspk_nama, m.mspk_cmo
    FROM tsj_hdr_memo h
    INNER JOIN tsj_dtl_memo d ON h.sj_nomor = d.sjd_sj_nomor
    INNER JOIN tperusahaan p ON h.sj_perush_kode = p.perush_kode
    INNER JOIN tcustomer c ON h.sj_cus_kode = c.cus_kode
    LEFT JOIN tmemospk m ON d.sjd_mspk_nomor = m.MSPK_Nomor
    WHERE h.sj_nomor = ?
  `;
  const [rows] = await db.query(query, [nomorSj]);
  return rows;
};

module.exports = {
  getSjMapDetails,
  getMapItemDetails,
  saveSjMap,
  getPrintData,
};
