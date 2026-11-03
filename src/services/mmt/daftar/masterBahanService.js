const pool = require("../../../config/database");
const throwDbError = (message, error) => {
  throw new Error(message + ": " + error.message);
};

const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeStatus = (status) => {
  const allowed = ["F", "S", "P", "B", "N", "-"];
  const s = String(status || "")
    .trim()
    .toUpperCase();
  return allowed.includes(s) ? s : "S";
};

exports.getBahanData = async ({ zdivisi = null, keyword = "", page = null, limit = null } = {}) => {
  try {
    let whereClause = " WHERE 1=1";
    const whereParams = [];

    // Logic Filter Divisi
    if (zdivisi !== null) {
      const z = Number(zdivisi);
      if (z === 1) {
        whereClause += ` AND b.brg_divisi IN (1, 5)`;
      } else if (z === 4) {
        whereClause += ` AND b.brg_divisi IN (3, 4)`;
      }
    }

    // Logic Filter Keyword
    if (keyword) {
      whereClause += ` AND (b.brg_kode LIKE ? OR b.brg_nama LIKE ? OR k.ktg_nama LIKE ? OR s.sup_nama LIKE ?)`;
      const q = `%${keyword}%`;
      whereParams.push(q, q, q, q);
    }

    let total = 0;
    const isPaged = page !== null && limit !== null && Number(limit) > 0;
    if (isPaged) {
      const countSql = `SELECT COUNT(*) AS total FROM tbarang_mmt b LEFT JOIN tkategori k ON k.ktg_kode = b.brg_ktg_kode LEFT JOIN tsupplier s ON s.sup_kode = b.brg_sup_kode ${whereClause}`;
      const [countRows] = await pool.query(countSql, whereParams);
      total = countRows[0]?.total || 0;
    }

    let sql = `
            SELECT
                b.brg_kode AS Kode,
                b.brg_nama AS Nama,
                IFNULL(k.ktg_nama, '') AS Kategori,
                b.brg_gdg_default AS GudangDefault,
                IFNULL(g.gdg_nama, '') AS GudangNama,
                b.brg_jenis AS Jenis,
                IFNULL(s.sup_nama, '') AS Supplier,
                IFNULL(b.brg_gramasi, '') AS Gramasi,
                b.brg_satuan AS Satuan,
                b.brg_panjang AS Panjang,
                b.brg_lebar AS Lebar,
                CASE
                    WHEN b.brg_status = 'F' THEN 'FAST MOVING'
                    WHEN b.brg_status = 'S' THEN 'SLOW MOVING'
                    WHEN b.brg_status = 'N' THEN 'NON FLEXY'
                    ELSE '-'
                END AS Status,
                b.brg_satuan_harga AS brg_satuan_harga,
                IFNULL(SUM(m.mst_stok_in - m.mst_stok_out), 0) AS Stok
            FROM tbarang_mmt b
            LEFT JOIN tmasterstok_mmt m ON b.brg_kode = m.mst_brg_kode
            LEFT JOIN tkategori k ON k.ktg_kode = b.brg_ktg_kode
            LEFT JOIN tsupplier s ON s.sup_kode = b.brg_sup_kode
            LEFT JOIN tgudang g ON g.gdg_kode = b.brg_gdg_default
            ${whereClause}
            GROUP BY b.brg_kode, b.brg_nama, k.ktg_nama, b.brg_gdg_default, g.gdg_nama, b.brg_jenis, s.sup_nama, b.brg_gramasi, b.brg_satuan, b.brg_panjang, b.brg_lebar, b.brg_status, b.brg_satuan_harga
            ORDER BY b.brg_nama
        `;

    const queryParams = [...whereParams];
    if (isPaged) {
      const p = Math.max(1, Number(page));
      const l = Number(limit);
      const offset = (p - 1) * l;
      sql += ` LIMIT ? OFFSET ?`;
      queryParams.push(l, offset);
    }

    const [rows] = await pool.query(sql, queryParams);

    if (isPaged) {
      return {
        items: rows,
        total,
        page: Number(page),
        limit: Number(limit),
      };
    }

    return rows;
  } catch (error) {
    throwDbError("Gagal mengambil data Master Barang", error);
  }
};

exports.getBahanByKode = async (kode) => {
  try {
    const sql = `
            SELECT
                b.brg_kode AS Kode,
                b.brg_nama AS Nama,
                b.brg_satuan AS Satuan,
                b.brg_satuan_harga,
                COALESCE(b.brg_hrgbeli, 0) AS HrgBeli,
                COALESCE(b.brg_hrgjual, 0) AS HrgJual,
                COALESCE(b.brg_gramasi, '') AS Gramasi,
                b.brg_panjang AS Panjang,
                b.brg_lebar AS Lebar,
                COALESCE(b.brg_stok, 0) AS Stok,
                b.brg_gdg_default AS GdgDefault,
                b.brg_sup_kode AS SupKode,
                b.brg_jenis AS Jenis,
                b.brg_ktg_kode AS KtgKode,
                COALESCE(b.brg_divisi, '') AS Divisi,
                COALESCE(b.brg_isaktif, 0) AS isAktif,
                COALESCE(b.brg_isstok, 0) AS isStok,
                COALESCE(b.brg_isexpired, 0) AS isExpired,
                COALESCE(b.brg_status, 'S') AS Status,
                COALESCE(g.gdg_nama, '') AS GudangNama,
                COALESCE(s.sup_nama, '') AS SupplierNama,
                COALESCE(j.jb_nama, '') AS JenisNama,
                COALESCE(k.ktg_nama, '') AS TipeNama,
                COALESCE(d.divisi, '') AS DivisiNama
            FROM tbarang_mmt b
            LEFT JOIN tgudang g ON g.gdg_kode = b.brg_gdg_default
            LEFT JOIN tsupplier s ON s.sup_kode = b.brg_sup_kode
            LEFT JOIN tjenisbarang j ON j.jb_kode = b.brg_jenis
            LEFT JOIN tkategori k ON k.ktg_kode = b.brg_ktg_kode
            LEFT JOIN tdivisi d ON d.kode = b.brg_divisi
            WHERE b.brg_kode = ?
            LIMIT 1
        `;

    const [rows] = await pool.query(sql, [kode]);
    if (!rows.length) throw new Error("Kode Barang tidak ditemukan.");
    return rows[0];
  } catch (error) {
    throwDbError(`Gagal memuat detail Barang dengan kode ${kode}`, error);
  }
};

exports.saveBahan = async (payload = {}, userLogin = "SYSTEM") => {
  try {
    const {
      Kode,
      Nama,
      Satuan,
      Gramasi,
      Panjang,
      Lebar,
      KtgKode,
      GdgDefault,
      SupKode,
      HrgJual,
      HrgBeli,
      isAktif,
      isStok,
      isExpired,
      Status,
      Jenis,
      Divisi,
      isEditMode,
    } = payload;

    const kode = String(Kode || "").trim();
    const nama = String(Nama || "").trim();

    if (kode.length < 3) {
      throw new Error("Kode Barang minimal 3 karakter.");
    }
    if (!nama) {
      throw new Error("Nama Barang wajib diisi.");
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const commonValues = [
        nama,
        String(Jenis || "").trim(),
        String(Satuan || "").trim(),
        String(Gramasi || "").trim(),
        toNumber(Panjang, 0),
        toNumber(Lebar, 0),
        0,
        String(KtgKode || "").trim(),
        String(GdgDefault || "WH-16").trim(),
        String(SupKode || "").trim(),
        toNumber(HrgJual, 0),
        toNumber(HrgBeli, 0),
        Number(isAktif) ? 1 : 0,
        Number(isStok) ? 1 : 0,
        Number(Divisi || 0),
        Number(isExpired) ? 1 : 0,
        normalizeStatus(Status),
      ];

      if (isEditMode) {
        const sqlUpdate = `
                    UPDATE tbarang_mmt SET
                        brg_nama = ?,
                        brg_jenis = ?,
                        brg_satuan = ?,
                        brg_gramasi = ?,
                        brg_panjang = ?,
                        brg_lebar = ?,
                        brg_stok = ?,
                        brg_ktg_kode = ?,
                        brg_gdg_default = ?,
                        brg_sup_kode = ?,
                        brg_hrgjual = ?,
                        brg_hrgbeli = ?,
                        brg_isaktif = ?,
                        brg_isstok = ?,
                        brg_divisi = ?,
                        brg_isexpired = ?,
                        brg_status = ?,
                        date_modified = NOW(),
                        user_modified = ?
                    WHERE brg_kode = ?
                `;

        const [result] = await conn.query(sqlUpdate, [
          ...commonValues,
          userLogin,
          kode,
        ]);

        if (!result.affectedRows) {
          throw new Error("Data barang yang diubah tidak ditemukan.");
        }
      } else {
        const sqlInsert = `
                    INSERT INTO tbarang_mmt (
                        brg_kode, brg_nama, brg_satuan, brg_gramasi, brg_panjang,
                        brg_lebar, brg_stok, brg_ktg_kode, brg_gdg_default, brg_sup_kode,
                        brg_hrgjual, brg_hrgbeli, brg_isaktif, brg_isstok,
                        brg_isexpired, date_create, user_create, brg_status,
                        brg_jenis, brg_divisi
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?)
                `;

        await conn.query(sqlInsert, [
          kode,
          nama,
          String(Satuan || "").trim(),
          String(Gramasi || "").trim(),
          toNumber(Panjang, 0),
          toNumber(Lebar, 0),
          0,
          String(KtgKode || "").trim(),
          String(GdgDefault || "WH-16").trim(),
          String(SupKode || "").trim(),
          toNumber(HrgJual, 0),
          toNumber(HrgBeli, 0),
          Number(isAktif) ? 1 : 0,
          Number(isStok) ? 1 : 0,
          Number(isExpired) ? 1 : 0,
          userLogin,
          normalizeStatus(Status),
          String(Jenis || "").trim(),
          Number(Divisi || 0),
        ]);
      }

      await conn.commit();
      return { kode };
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  } catch (error) {
    throwDbError("Gagal simpan Master Barang", error);
  }
};

exports.getLookupKategori = async (keyword = "") => {
  try {
    const sql = `
            SELECT ktg_kode AS Kode, ktg_nama AS Nama
            FROM tkategori
            WHERE LENGTH(ktg_kode) > 1
                AND (? = '' OR ktg_kode LIKE ? OR ktg_nama LIKE ?)
            ORDER BY ktg_nama
        `;
    const q = `%${keyword}%`;
    const [rows] = await pool.query(sql, [keyword, q, q]);
    return rows;
  } catch (error) {
    throwDbError("Gagal mengambil lookup kategori", error);
  }
};

exports.getLookupGudang = async (keyword = "") => {
  try {
    const sql = `
            SELECT gdg_kode AS Kode, gdg_nama AS Nama
            FROM tgudang
            WHERE gdg_kode LIKE 'WH-%'
                AND (? = '' OR gdg_kode LIKE ? OR gdg_nama LIKE ?)
            ORDER BY gdg_kode
        `;
    const q = `%${keyword}%`;
    const [rows] = await pool.query(sql, [keyword, q, q]);
    return rows;
  } catch (error) {
    throwDbError("Gagal mengambil lookup gudang", error);
  }
};

exports.getLookupSupplier = async (keyword = "") => {
  try {
    const sql = `
            SELECT sup_kode AS Kode, sup_nama AS Nama
            FROM tsupplier
            WHERE (? = '' OR sup_kode LIKE ? OR sup_nama LIKE ?)
            ORDER BY sup_nama
        `;
    const q = `%${keyword}%`;
    const [rows] = await pool.query(sql, [keyword, q, q]);
    return rows;
  } catch (error) {
    throwDbError("Gagal mengambil lookup supplier", error);
  }
};

exports.getLookupJenis = async (keyword = "") => {
  try {
    const sql = `
            SELECT jb_kode AS Kode, jb_nama AS Nama
            FROM tjenisbarang
            WHERE (? = '' OR jb_kode LIKE ? OR jb_nama LIKE ?)
            ORDER BY jb_nama
        `;
    const q = `%${keyword}%`;
    const [rows] = await pool.query(sql, [keyword, q, q]);
    return rows;
  } catch (error) {
    throwDbError("Gagal mengambil lookup jenis", error);
  }
};

exports.getLookupDivisi = async (keyword = "") => {
  try {
    const sql = `
            SELECT kode AS Kode, divisi AS Nama
            FROM tdivisi
            ORDER BY kode
        `;
    const q = `%${keyword}%`;
    const [rows] = await pool.query(sql, [keyword, q, q]);
    return rows;
  } catch (error) {
    throwDbError("Gagal mengambil lookup divisi", error);
  }
};

exports.getBahanDetailByKodeMmt = async (kode) => {
  try {
    const sql = `
            SELECT 
                brg_kode AS Kode, 
                brg_nama AS Nama, 
                brg_satuan AS Satuan,
                brg_panjang AS Panjang, 
                brg_lebar AS Lebar,
                brg_jenis AS Jenis,
                brg_ktg_kode AS KtgKode,
                brg_divisi AS Divisi,
                brg_gdg_default AS GdgDefault,
                brg_sup_kode AS SupKode
            FROM tbarang_mmt 
            WHERE brg_kode = ? ;
        `;

    const [rows] = await pool.query(sql, [kode]);
    if (rows.length === 0) throw new Error("Kode Bahan tidak ditemukan.");

    return rows[0];
  } catch (error) {
    throwDbError(`Gagal memuat detail Bahan dengan kode ${kode}`, error);
  }
};

exports.getLookupGdgProduksiMMT = async (keyword) => {
  try {
    let sql = `
            SELECT 
                b.brg_kode AS Kode,
                b.brg_nama AS Nama,
                b.brg_jenis AS Jenis,
                b.brg_satuan AS Satuan,
                b.brg_lebar AS Lebar,
                COALESCE(s.mst_panjang, b.brg_panjang) AS Panjang,
                COALESCE(s.mst_barcode, '') AS Barcode, -- Menampilkan barcode dari master stok atau tabel terkait
                COALESCE(SUM(s.mst_stok_in) - SUM(s.mst_stok_out), 0) AS Stok
            FROM tbarang_mmt b
            LEFT JOIN tmasterstok_mmt s 
                ON s.mst_brg_kode = b.brg_kode 
                AND s.mst_gdg_kode = 'GPM'
            WHERE 1=1
        `;

    const params = [];

    if (keyword) {
      // Ditambahkan pencarian berdasarkan barcode (mst_barcode atau brg_kode)
      sql += ` AND (b.brg_kode LIKE ? OR b.brg_nama LIKE ? OR s.mst_barcode LIKE ?)`;
      const key = `%${keyword}%`;
      params.push(key, key, key);
    }

    sql += `
            GROUP BY 
                b.brg_kode,
                b.brg_nama,
                b.brg_jenis,
                b.brg_satuan,
                b.brg_lebar,
                COALESCE(s.mst_panjang, b.brg_panjang),
                COALESCE(s.mst_barcode, '')
            ORDER BY Nama ASC, Panjang DESC
        `;

    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (error) {
    throwDbError("Gagal mengambil data lookup master & sisa produksi", error);
  }
};

// exports.getBahanData = async () => {
//     try {
//         // Replikasi SQLMaster dari Delphi, termasuk filter kritis.
//         // Catatan: Kolom Dead_Stock harus dihitung atau disediakan oleh DB.
//         const sql = `
//             SELECT
//                 b.bhn_kode AS Kode,
//                 b.bhn_name AS Nama,
//                 b.bhn_satuan AS Satuan,
//                 b.bhn_gramasi AS Gramasi,
//                 b.bhn_setting AS Setting,
//                 b.bhn_jb_kode AS Jenis,
//                 -- SIMULASI UNTUK LOGIKA CONDITIONAL STYLING (cxStyle1)
//                 CASE WHEN b.bhn_kode LIKE 'DS%' THEN 'YA' ELSE 'TIDAK' END AS Dead_Stock
//             FROM tbahan b
//             WHERE b.bhn_aktif = 0 AND b.bhn_jb_kode = 'LL'
//             ORDER BY b.bhn_name;
//         `;

//         const [rows] = await pool.query(sql);
//         return rows;

//     } catch (error) {
//         throwDbError('Gagal mengambil data Master Bahan', error);
//     }
// };

// exports.getBahanByKode = async (kode) => {
//     try {
//         const sql = `
//             SELECT *
//             FROM tbahan
//             WHERE bhn_kode = ? AND bhn_aktif = 0;
//         `;

//         const [rows] = await pool.query(sql, [kode]);
//         if (rows.length === 0) throw new Error("Kode Bahan tidak ditemukan.");

//         return rows[0];

//     } catch (error) {
//         throwDbError(`Gagal memuat detail Bahan dengan kode ${kode}`, error);
//     }
// };
