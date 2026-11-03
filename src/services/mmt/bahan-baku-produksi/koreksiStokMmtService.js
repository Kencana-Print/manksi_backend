// backend/src/services/koreksiStokService.js

const pool = require("../../../config/database"); // Asumsi modul koneksi database Anda
const { format } = require("date-fns");

// Helper untuk penanganan error database
const throwDbError = (message, error) => {
  console.error(message, error.message);
  throw new Error(message + ": " + error.message);
};

// ========================================================
// READ MASTER DATA (btnRefreshClick - SQLMaster)
// ========================================================
exports.getKoreksiStokData = async (startDate, endDate) => {
  try {
    // Guard: tanggal kosong/invalid TIDAK boleh jadi klausa zero-date —
    // filter tanggal di-skip (tanpa filter) bila tidak valid.
    const isDateStr = (v) =>
      typeof v === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      !Number.isNaN(Date.parse(v));
    const dateConds = [];
    const params = [];
    if (isDateStr(startDate)) {
      dateConds.push("a.korh_tanggal >= ?");
      params.push(format(new Date(startDate), "yyyy-MM-dd"));
    }
    if (isDateStr(endDate)) {
      dateConds.push("a.korh_tanggal <= ?");
      params.push(format(new Date(endDate), "yyyy-MM-dd"));
    }
    const sqlMaster = `
      SELECT 
        a.korh_nomor AS Nomor, 
        DATE_FORMAT(a.korh_tanggal, '%d/%m/%Y') AS Tanggal, 
        a.korh_gdg_kode AS GudangKode,
        b.gdg_nama AS Gudang, 
        c.nama AS Tipe_Nama, 
        a.korh_notes AS Keterangan
      FROM tkor_hdr_mmt a
      LEFT JOIN tgudang b ON b.gdg_kode = a.korh_gdg_kode
      LEFT JOIN tkor_type_mmt c ON c.kode = a.korh_type
      WHERE 1=1
        ${dateConds.length ? "AND " + dateConds.join(" AND ") : ""}
        AND IFNULL(a.korh_typekor, 0) = 0 
        AND (b.gdg_kode LIKE '%WH-%' OR b.gdg_kode = 'GPM')
      GROUP BY a.korh_nomor, a.korh_tanggal, a.korh_notes, b.gdg_nama, a.korh_type, c.nama, a.korh_gdg_kode
      ORDER BY a.korh_tanggal DESC`;

    const [masterRows] = await pool.query(sqlMaster, params);
    if (masterRows.length === 0) return [];

    const nomorList = masterRows.map((m) => m.Nomor);

    // Detail query tanpa tobat dan tmasterstok_obat
    const sqlDetail = `
      SELECT 
        d.kord_korh_nomor AS Nomor, 
        d.kord_brg_kode AS Kode, 
        b.brg_nama AS Nama_Bahan, 
        d.kord_stok AS Stock, 
        d.kord_panjang AS Panjang, 
        d.kord_lebar AS Lebar,
        d.kord_fisik AS Fisik, 
        d.kord_qty AS Koreksi,
        d.kord_satuan AS Satuan,
        (
          SELECT GROUP_CONCAT(sub.mst_barcode ORDER BY sub.mst_barcode ASC)
          FROM tmasterstok_mmt sub
          WHERE sub.mst_noreferensi = d.kord_korh_nomor 
          AND sub.mst_brg_kode = d.kord_brg_kode
        ) AS List_Barcode
      FROM tkor_dtl_mmt d
      LEFT JOIN tbarang_mmt b ON d.kord_brg_kode = b.brg_kode
      WHERE d.kord_korh_nomor IN (?)
      ORDER BY d.kord_korh_nomor, d.kord_nourut`;

    const [detailRows] = await pool.query(sqlDetail, [nomorList]);

    const dataMap = new Map();
    masterRows.forEach((item) => {
      dataMap.set(item.Nomor, { ...item, Detail: [] });
    });

    detailRows.forEach((detail) => {
      if (dataMap.has(detail.Nomor)) {
        dataMap.get(detail.Nomor).Detail.push(detail);
      }
    });

    return Array.from(dataMap.values());
  } catch (error) {
    console.error("Gagal mengambil data koreksi stok:", error);
    throw error;
  }
};

exports.getKoreksiStokDetail = async (nomor) => {
  try {
    const [headerRows] = await pool.query(
      `SELECT 
         h.korh_nomor AS Nomor,
         DATE_FORMAT(h.korh_tanggal, '%Y-%m-%d') AS Tanggal,
         h.korh_gdg_kode AS GudangKode,
         g.gdg_nama AS Gudang,
         h.korh_type AS TypeKor,
         CASE 
           WHEN h.korh_type = 100 THEN 'Terima'
           WHEN h.korh_type = 200 THEN 'Keluar'
           WHEN h.korh_type = 300 THEN 'Sisa Produksi'
           ELSE 'Lain-lain'
         END AS Tipe_Nama,
         h.korh_notes AS Keterangan,
         h.korh_total AS Total
       FROM tkor_hdr_mmt h
       LEFT JOIN tgudang g ON g.gdg_kode = h.korh_gdg_kode
       WHERE h.korh_nomor = ? LIMIT 1`,
      [nomor]
    );

    if (!headerRows.length) return null;

    const [details] = await pool.query(
      `SELECT 
         d.kord_korh_nomor AS Nomor,
         d.kord_nourut AS NoUrut,
         d.kord_brg_kode AS KodeBarang,
         d.kord_brg_kode AS SKU,
         TRIM(b.brg_nama) AS NamaBarang,
         d.kord_satuan AS Satuan,
         IFNULL(b.brg_panjang, 0) AS Panjang,
         IFNULL(b.brg_lebar, 0) AS Lebar,
         d.kord_QTY AS Qty,
         IFNULL(d.kord_stok, IFNULL(sub.stok_akhir, 0)) AS System,
         IFNULL(d.kord_fisik, (IFNULL(sub.stok_akhir, 0) + d.kord_QTY)) AS Fisik,
         IFNULL(d.kord_harga, IFNULL(b.brg_hrgbeli, 0)) AS Harga,
         IFNULL(d.kord_nilai, (d.kord_QTY * IFNULL(b.brg_hrgbeli, 0))) AS Nilai
       FROM tkor_dtl_mmt d
       LEFT JOIN tbarang_mmt b ON b.brg_kode = d.kord_brg_kode
       LEFT JOIN (
         SELECT mst_brg_kode, SUM(mst_stok_in - mst_stok_out) AS stok_akhir
         FROM tmasterstok_mmt
         WHERE mst_gdg_kode = ?
         GROUP BY mst_brg_kode
       ) sub ON sub.mst_brg_kode = d.kord_brg_kode
       WHERE d.kord_korh_nomor = ?
       ORDER BY d.kord_nourut`,
      [headerRows[0].GudangKode, nomor]
    );

    return {
      header: headerRows[0],
      details,
    };
  } catch (error) {
    console.error("Gagal mengambil detail koreksi stok:", error);
    throw error;
  }
};

// ========================================================
// DELETE (cxButton4Click)
// ========================================================
exports.deleteKoreksiStok = async (nomor, user) => {
  const connection = await pool.getConnection();
  // Asumsi cekdelete sudah dilakukan di frontend
  try {
    await connection.beginTransaction();

    // 1. Hapus Detail (tkor_dtl_mmt)
    const sqlDeleteDetail =
      "DELETE FROM tkor_dtl_mmt WHERE kord_korh_nomor = ?";
    await connection.query(sqlDeleteDetail, [nomor]);

    // 2. Hapus Header (tkor_hdr_mmt)
    const sqlDeleteHeader = "DELETE FROM tkor_hdr_mmt WHERE korh_nomor = ?";
    const [headerResult] = await connection.query(sqlDeleteHeader, [nomor]);

    if (headerResult.affectedRows === 0) {
      throw new Error("Nomor transaksi tidak ditemukan atau sudah terhapus.");
    }

    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throwDbError("Gagal menghapus transaksi Koreksi Stok", error);
  } finally {
    connection.release();
  }
};

// ========================================================
// GENERATE MAX KODE (getmaxkode)
// ========================================================
exports.generateMaxKode = async (tanggal) => {
  const NOMERATOR = "KOR"; // Contoh nomerator
  const yyMm = format(new Date(tanggal), "yyMM");

  // Mengambil max nomor (asumsi menggunakan kode 3 digit setelah tanggal)
  const sql = `
    SELECT MAX(RIGHT(korh_nomor, 3)) AS max_num 
    FROM tkor_hdr_mmt 
    WHERE korh_nomor LIKE ?
  `;
  const prefix = `${NOMERATOR}.${yyMm}.%`;
  const [rows] = await pool.query(sql, [prefix]);

  const maxNum = rows[0].max_num ? parseInt(rows[0].max_num) : 0;
  const newSequence = maxNum + 1;

  return `${NOMERATOR}.${yyMm}.${String(newSequence).padStart(3, "0")}`;
};

exports.getStokGudangAll = async (gdg_kode, tanggal) => {
  const sql = `
        SELECT 
            brg_kode AS Kode,
            brg_nama AS Nama,
            brg_satuan AS Satuan,
            brg_panjang AS Panjang,
            brg_lebar AS Lebar,
            gdg_nama AS Gudang,
            SUM(mst_stok_in - mst_stok_out) AS Stok,
            0 AS HRGBELI 
        FROM tbarang_mmt 
        INNER JOIN tmasterstok_mmt ON mst_brg_kode = brg_kode  
        INNER JOIN tgudang ON gdg_kode = mst_gdg_kode 
        WHERE mst_gdg_kode = ?
          AND mst_tanggal <= ?
          AND gdg_kode LIKE '%WH-%'
          AND brg_satuan = 'ROLL' -- Tambahkan baris ini untuk filter satuan
        GROUP BY mst_gdg_kode, brg_kode,  brg_lebar, gdg_nama, brg_nama, brg_satuan
        ORDER BY brg_kode ASC;
    `;
  try {
    // Jika parameter tanggal kosong, gunakan tanggal hari ini
    const [rows] = await pool.query(sql, [gdg_kode, tanggal || new Date()]);
    return rows;
  } catch (error) {
    throw error;
  }
};
exports.getBarangWithStok = async (keyword, gdg_kode, tanggal) => {
  const sql = `
        SELECT 
            brg_kode AS Kode, 
            brg_nama AS NamaBarang, 
            jb_nama AS Jenis, 
            sup_nama AS Supplier, 
            brg_satuan AS Satuan, 
            brg_panjang AS Panjang, 
            brg_lebar AS Lebar, 
            brg_gramasi AS Konstruksi, 
            IFNULL(X.STOK, 0) AS STOK,
            brg_hrgbeli AS HargaBeli -- Diambil untuk mengisi clHarga di Delphi
        FROM tbarang_mmt 
        LEFT JOIN (
            SELECT 
                mst_brg_kode, 
                SUM(mst_stok_in - mst_stok_out) AS STOK 
            FROM tmasterstok_mmt 
            WHERE mst_gdg_kode = ? 
              AND mst_tanggal <= ? 
            GROUP BY MST_BRG_KODE
        ) X ON X.mst_brg_kode = brg_kode 
        LEFT JOIN tjenisbarang ON jb_kode = brg_jenis 
        LEFT JOIN tsupplier ON sup_kode = brg_sup_kode 
        WHERE brg_gdg_default = 'WH-16' -- Sesuai filter di Delphi
          AND (brg_kode LIKE ? OR brg_nama LIKE ?)
    `;
  try {
    const search = `%${keyword}%`;
    const [rows] = await pool.query(sql, [gdg_kode, tanggal, search, search]);
    return rows;
  } catch (error) {
    throw error;
  }
};

// backend/src/services/koreksiStokMmt.service.js

exports.saveKoreksiStokMMT = async (payload, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const { header, details } = payload;
    let nomor = header.Nomor;

    if (nomor === "AUTO" || !nomor) {
      nomor = await this.generateMaxKode(header.Tanggal);
    }

    // 1. Simpan Header
    const sqlHeader = `
        INSERT INTO tkor_hdr_mmt (korh_nomor, korh_tanggal, korh_gdg_kode, korh_type, korh_notes, korh_total, date_create, user_create)
        VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)
        ON DUPLICATE KEY UPDATE 
            korh_tanggal=VALUES(korh_tanggal), 
            korh_gdg_kode=VALUES(korh_gdg_kode), 
            korh_type=VALUES(korh_type), 
            korh_notes=VALUES(korh_notes), 
            korh_total=VALUES(korh_total), 
            date_modified=NOW(), 
            user_modified=?
    `;
    const totalNilai = details.reduce(
      (acc, curr) => acc + (Number(curr.Nilai) || 0),
      0,
    );
    await connection.query(sqlHeader, [
      nomor,
      header.Tanggal,
      header.GudangKode,
      header.TypeKor,
      header.Keterangan || "",
      totalNilai,
      user,
      user,
    ]);

    // 2. Hapus Detail & Master Stok Lama yang berelasi dengan nomor referensi ini
    await connection.query(
      "DELETE FROM tkor_dtl_mmt WHERE kord_korh_nomor = ?",
      [nomor],
    );
    // Hapus stok lama berdasarkan nomor referensi (Trigger akan otomatis insert ulang jika diperlukan,
    // atau jika Anda ingin aman, biarkan trigger menangani insert baru)
    await connection.query(
      "DELETE FROM tmasterstok_mmt WHERE mst_noreferensi = ?",
      [nomor],
    );

    // 3. Simpan Detail Baru (Trigger MySQL akan otomatis mengeksekusi insert ke tmasterstok_mmt)
    const validDetails = details.filter((d) => d.SKU);
    if (validDetails.length > 0) {
      const detailValues = validDetails.map((d, i) => [
        nomor,
        d.KodeBarang || d.SKU, // Pastikan kord_brg_kode menyimpan kode barang asli (cth: '280ADM3280A')
        d.Satuan || "",
        header.Tanggal,
        Number(d.Qty) || 0,
        Number(d.Panjang) || 0,
        Number(d.Lebar) || 0,
        Number(d.Harga) || 0,
        Number(d.Nilai) || 0,
        Number(d.Fisik) || 0,
        Number(d.System) || 0,
        i + 1,
      ]);

      const sqlDetail = `
        INSERT INTO tkor_dtl_mmt (
          kord_korh_nomor, kord_brg_kode, kord_satuan, kord_expired, 
          kord_qty, kord_panjang, kord_lebar, kord_harga, kord_nilai, 
          kord_fisik, kord_stok, kord_nourut
        ) VALUES ?
      `;
      await connection.query(sqlDetail, [detailValues]);
    }

    await connection.commit();
    return { success: true, nomor: nomor };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};
