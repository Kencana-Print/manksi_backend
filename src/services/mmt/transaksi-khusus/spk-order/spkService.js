// backend/src/services/spk.service.js

const pool = require("../../../../config/database");
const { format } = require("date-fns");

const throwDbError = (message, error) => {
  throw new Error(message + ": " + error.message);
};

/**
 * Logika Utama: Menggabungkan TSPK, TMEMOSPK, dan Kalkulasi Produksi
 * Diperbaiki agar menyertakan status 'Ngedit' (PIN), Approval, Akumulasi, dan DATA GAMBAR/QR sesuai Delphi
 */
const getBaseSpkQuery = (
  whereClauseReguler = "1=1",
  whereClauseMemo = "1=1",
) => {
  return `
        SELECT x.*,
            /* LOGIKA SINKRONISASI CETAK:
               Jika spk_cmo sudah terisi (bukan null & bukan kosong), maka otomatis 'ACC' (Bisa Cetak).
               Jika belum terisi, maka dia akan mengecek jalur PIN seperti biasa. */
            IF(TRIM(IFNULL(x.Acc_MO, '')) <> '', 'ACC',
                IFNULL(
                    IF(x.ppin = 'N', 'TOLAK',
                        IF(x.ppin = 'Y' AND x.ppakai = '', 'ACC',
                            IF(x.ppin = 'Y' AND x.ppakai = 'Y', '', 
                                IF(x.ppin = '', 'WAIT', '')
                            )
                        )
                    ), ''
                )
            ) AS Ngedit
        FROM (
            /* --- SECTION 1: SPK REGULER --- */
            SELECT 
                t.spk_nomor AS SPK, 
                t.user_create AS MO,
                t.spk_cmo AS CMO,
                t.spk_tanggal AS Tanggal, 
                t.spk_dateline AS Deadline,
                t.spk_statuskerja AS Kepentingan,
                t.spk_divisi AS Divisi, 
                t.spk_nama AS Nama, 
                t.spk_cab AS Cabang,
                t.spk_workshop AS Workshop,
                t.spk_pending AS Pending,            
                t.spk_ketpending AS Ket_Pending,       
                'REGULER' AS Tipe_SPK,
                IFNULL(t.spk_panjang, 0) AS Panjang, 
                IFNULL(t.spk_lebar, 0) AS Lebar,
                t.spk_ukuran AS Ukuran,
                t.spk_gramasi AS Gramasi,
                t.spk_kain AS Bahan, 
                t.spk_finishing AS Finishing,
                t.spk_keterangan AS Pesan,            
                0 AS PraSJ,                                                         
                0 AS Kirim,                                                         
                t.user_create AS Created,
                t.spk_nomor_po AS PO,
                t.spk_ketpo AS Ket_PO,
                t.spk_datelinepo AS Dateline_PO,
                IF(t.spk_aktif='Y', 'Open', 'Closed') AS STATUS, 
                '' AS Alasan_Close,
                t.spk_pen_nomor AS No_Penawaran,
                t.spk_memo AS MAP,                                        
                IFNULL(t.spk_alokasi, 'TIDAK') AS Alokasi,                 
                
                /* Progress Jalur Kerja Internal (Realisasi) */
                IFNULL(t.spk_mpotong, 'N') AS Potong,
                t.spk_repeat AS "Repeat",
                
                /* Status Kontrol / QC Produksi Eksternal */
                IFNULL(t.spk_ppotong, 'N') AS QC_Potong,
                IFNULL(t.spk_bordir, 'N') AS Bordir,
                CAST(IFNULL(prod.total_pernah_cetak, 0) AS UNSIGNED) AS Sudah_Cetak,
                IFNULL(t.spk_pcetak, 'N') AS QC_Cetak,
                IFNULL(t.spk_invdc, '') AS DC,       
                IFNULL(t.spk_pjahit, 'N') AS Jahit,
                IFNULL(t.spk_pfinishing, 'N') AS Lipat,
                
                /* Logika Jadi diambil langsung dari spk_jumlah_jadi */
                CAST(IFNULL(t.spk_jumlah_jadi, 0) AS UNSIGNED) AS Jadi,

                /* Selisih Manufaktur */
                CAST(GREATEST(0, t.spk_jumlah - IFNULL(t.spk_jumlah_jadi, 0)) AS UNSIGNED) AS Kurang_Jadi,

                0 AS Kurang_Potong,
                0 AS Kurang_Bordir,
                CAST(GREATEST(0, t.spk_jumlah - IFNULL(prod.total_pernah_cetak, 0)) AS UNSIGNED) AS Kurang_Cetak_Prod,
                0 AS Kurang_QC_Cetak,
                0 AS Kurang_Jahit,
                0 AS Kurang_Lipat,
                
                t.spk_aktif AS Aktif,
                t.spk_cmo AS Acc_MO,
                t.spk_newdesign AS design_baru,
                t.spk_desain AS design_done,          

                /* Mapping Image & QR Code Sesuai Alur Penyimpanan File Delphi */
                CONCAT(t.spk_nomor, '.jpg') AS Design_Image,
                t.spk_nomor AS QR_Data,

                /* PIN System */
                IFNULL((SELECT pin_acc FROM tspk_pin5 WHERE pin_trs="SPK" AND pin_nomor=t.spk_nomor ORDER BY pin_urut DESC LIMIT 1), "") as ppin,
                IFNULL((SELECT pin_dipakai FROM tspk_pin5 WHERE pin_trs="SPK" AND pin_nomor=t.spk_nomor ORDER BY pin_urut DESC LIMIT 1), "") as ppakai,
                t.spk_jumlah AS Jumlah
            FROM tspk t
            
            /* JOIN 1: Hitungan Cetak Mesin */
            LEFT JOIN (
                SELECT ld_spk_nomor, SUM(ld_total_qtycetak) as total_pernah_cetak
                FROM tlhk_mesin_dtl
                GROUP BY ld_spk_nomor
            ) prod ON prod.ld_spk_nomor = t.spk_nomor
            
            /* JOIN 2: Hitungan Ambil Stok dari Gudang DC */
            LEFT JOIN (
                SELECT d.invd_inv_nomor, SUM(d.invd_jumlah) AS total_stok_dc
                FROM retail.tinv_dtl d
                INNER JOIN retail.tinv_hdr h ON d.invd_inv_nomor = h.inv_nomor
                GROUP BY d.invd_inv_nomor
            ) dc_stock ON dc_stock.invd_inv_nomor = t.spk_invdc
            
            WHERE ${whereClauseReguler}

            UNION ALL

            /* --- SECTION 2: MEMO SPK --- */
            SELECT 
                m.mspk_nomor AS SPK, 
                '' AS MO,
                '' AS CMO,
                m.mspk_tanggal AS Tanggal,
                m.mspk_dateline AS Deadline,
                'INTERNAL' AS Kepentingan,
                m.mspk_divisi AS Divisi,              
                m.mspk_nama AS Nama, 
                m.mspk_cab AS Cabang,                
                m.mspk_workshop AS Workshop,          
                'NORMAL' AS Pending,
                '' AS Ket_Pending,
                'MEMO' AS Tipe_SPK,
                IFNULL(m.mspk_panjang, 0) AS Panjang, 
                IFNULL(m.mspk_lebar, 0) AS Lebar,
                m.mspk_ukuran AS Ukuran,
                m.mspk_gramasi AS Gramasi,

                m.mspk_kain AS Bahan,                
                m.mspk_finishing AS Finishing,        
                m.mspk_keterangan AS Pesan,           
                0 AS PraSJ,
                0 AS Kirim,
                '' AS Created,
                m.mspk_nomor_po AS PO,                
                '' AS Ket_PO,
                m.mspk_tgl_po AS Dateline_PO,         
                'Open' AS STATUS,
                '' AS Alasan_Close,
                '' AS No_Penawaran,
                '' AS MAP,
                'TIDAK' AS Alokasi,
                'N' AS Potong,                        
                'N' AS "Repeat",
                'N' AS QC_Potong,
                'N' AS Bordir,
                CAST(IFNULL(prod_m.total_pernah_cetak, 0) AS UNSIGNED) AS Sudah_Cetak,
                'N' AS QC_Cetak,
                '' AS DC,
                'N' AS Jahit,
                'N' AS Lipat,
                
                /* Logika Jadi Memo: menggunakan mspk_jumlah_jadi (fallback ke 0 jika tidak ada) */
                CAST(IFNULL(m.mspk_jumlah_jadi, 0) AS UNSIGNED) AS Jadi,
                
                CAST(GREATEST(0, m.mspk_jumlah - IFNULL(m.mspk_jumlah_jadi, 0)) AS UNSIGNED) AS Kurang_Jadi,
                0 AS Kurang_Potong,
                0 AS Kurang_Bordir,
                CAST(GREATEST(0, m.mspk_jumlah - IFNULL(prod_m.total_pernah_cetak, 0)) AS UNSIGNED) AS Kurang_Cetak_Prod, 
                0 AS Kurang_QC_Cetak,
                0 AS Kurang_Jahit,
                0 AS Kurang_Lipat,
                m.mspk_aktif AS Aktif,                
                '' AS Acc_MO, 
                'N' AS design_baru,
                'Y' AS design_done,

                CONCAT(m.mspk_nomor, '.jpg') AS Design_Image,
                m.mspk_nomor AS QR_Data,

                '' as ppin,
                '' as ppakai,
                m.mspk_jumlah AS Jumlah        
            FROM tmemospk m
            LEFT JOIN (
                SELECT ld_spk_nomor, SUM(ld_total_qtycetak) as total_pernah_cetak
                FROM tlhk_mesin_dtl
                GROUP BY ld_spk_nomor
            ) prod_m ON prod_m.ld_spk_nomor = m.mspk_nomor
            WHERE ${whereClauseMemo}
        ) x
    `;
};

// ===================================
// BROWSE DATA (UTAMA)
// ===================================
exports.getAllSpkData = async (filters) => {
  try {
    const { startDate, endDate, keyword, cabang } = filters;

    let whereReguler = "1=1";
    let whereMemo = "1=1";
    const params = [];

    // 1. Filter Rentang Tanggal
    if (startDate && endDate) {
      whereReguler += ` AND DATE(t.spk_tanggal) BETWEEN ? AND ?`;
      whereMemo += ` AND DATE(m.mspk_tanggal) BETWEEN ? AND ?`;
      params.push(startDate, endDate, startDate, endDate);
    }

    // 2. Filter Cabang langsung di MySQL
    if (cabang && cabang !== "ALL") {
      whereReguler += ` AND t.spk_cab = ?`;
      whereMemo += ` AND m.mspk_cab = ?`; // memfilter tabel tmemospk berdasarkan cabang
      params.push(cabang, cabang);
    }

    let sql = getBaseSpkQuery(whereReguler, whereMemo);

    // 3. Filter Keyword
    if (keyword) {
      sql = `SELECT * FROM (${sql}) as sub WHERE SPK LIKE ? OR Nama LIKE ?`;
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    sql += ` ORDER BY Tanggal DESC`;

    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (error) {
    throwDbError("Gagal mengambil data Browse SPK secara keseluruhan", error);
  }
};

// ===================================
// LOOKUP STBJ (Untuk Modal Pencarian)
// ===================================
const getBaseStbjQuery = (whereClause = "1=1") => {
  return `
        SELECT 
            h.stbj_nomor AS Nomor,
            h.stbj_tanggal AS Tanggal,
            h.stbj_keterangan AS Keterangan,
            h.stbj_gdg_kode AS Gudang_Asal,
            h.stbj_gdgp_kode AS Gudang_Tujuan,
            h.stbj_checker AS Checker,
            h.stbj_ts_nomor AS No_TS,
            IFNULL(dtl.total_qty, 0) AS Total_Qty,
            IFNULL(dtl.total_koli, 0) AS Total_Koli
        FROM tstbj_hdr h
        LEFT JOIN (
            SELECT 
                stbjd_stbj_nomor, 
                SUM(stbjd_jumlah) as total_qty, 
                SUM(stbjd_koli) as total_koli 
            FROM tstbj_dtl 
            GROUP BY stbjd_stbj_nomor
        ) dtl ON h.stbj_nomor = dtl.stbjd_stbj_nomor
        WHERE ${whereClause}
    `;
};

exports.getStbjLookupData = async (keyword) => {
  try {
    let sql = `SELECT * FROM (${getBaseStbjQuery()}) AS stbj_combined`;
    const params = [];

    if (keyword) {
      sql += ` WHERE (Nomor LIKE ? OR Keterangan LIKE ? OR No_TS LIKE ?)`;
      const searchKeyword = `%${keyword}%`;
      params.push(searchKeyword, searchKeyword, searchKeyword);
    }

    sql += ` ORDER BY Tanggal DESC LIMIT 50`;

    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (error) {
    throwDbError("Gagal mengambil data lookup STBJ", error);
  }
};

/**
 * PERBAIKAN: Mengganti spk_close menjadi spk_aktif agar sinkron dengan alor data Open/Closed Delphi & Web
 */
exports.getSpkForStbjLookup = async (keyword) => {
  try {
    const sql = `
            SELECT 
                t.spk_nomor AS SPK,
                t.spk_nama AS Nama,
                t.spk_tanggal AS Tanggal,
                t.spk_ukuran AS Ukuran,
                t.spk_jumlah AS Qty_Order,
                CAST(IFNULL(stbj.total_stbj, 0) AS UNSIGNED) AS Sudah_STBJ,
                CAST(GREATEST(0, t.spk_jumlah - IFNULL(stbj.total_stbj, 0)) AS UNSIGNED) AS Kurang_STBJ,
                t.spk_statuskerja AS Kepentingan,
                IF(t.spk_aktif='Y', 'Open', 'Closed') AS STATUS
            FROM tspk t
            LEFT JOIN (
                SELECT stbjd_spk_nomor, SUM(stbjd_jumlah) AS total_stbj
                FROM tstbj_dtl
                GROUP BY stbjd_spk_nomor
            ) stbj ON stbj.stbjd_spk_nomor = t.spk_nomor
            WHERE (t.spk_nomor LIKE ? OR t.spk_nama LIKE ?)
            ORDER BY t.spk_tanggal DESC
            LIMIT 100
        `;

    const searchKeyword = `%${keyword}%`;
    const [rows] = await pool.query(sql, [searchKeyword, searchKeyword]);
    return rows;
  } catch (error) {
    throwDbError("Gagal mengambil perhitungan SPK vs STBJ", error);
  }
};

// ===================================
// DETAIL STBJ (Header & Rincian Item)
// ===================================
exports.getStbjFullDetail = async (nomorStbj) => {
  try {
    const [header] = await pool.query(getBaseStbjQuery("h.stbj_nomor = ?"), [
      nomorStbj,
    ]);
    if (header.length === 0)
      throw new Error(`STBJ ${nomorStbj} tidak ditemukan.`);

    const sqlItems = `
            SELECT 
                d.stbjd_spk_nomor AS No_SPK,
                s.spk_nama AS Nama_SPK,
                d.stbjd_size AS Size,
                d.stbjd_jumlah AS Qty,
                d.stbjd_koli AS Koli,
                d.stbjd_packing AS Packing,
                d.stbjd_keterangan AS Catatan
            FROM tstbj_dtl d
            LEFT JOIN tspk s ON d.stbjd_spk_nomor = s.spk_nomor
            WHERE d.stbjd_stbj_nomor = ?
            ORDER BY d.stbjd_spk_nomor ASC
        `;
    const [items] = await pool.query(sqlItems, [nomorStbj]);

    return {
      ...header[0],
      items: items,
    };
  } catch (error) {
    throwDbError(`Gagal memuat detail STBJ ${nomorStbj}`, error);
  }
};

exports.getSpkForJadwalKirimLookup = async (keyword) => {
  try {
    // Menambahkan filter cabang 'p05' dan status aktif untuk Reguler & Memo
    const whereReguler = "t.spk_aktif = 'Y' AND t.spk_cab = 'p05'";
    const whereMemo = "m.mspk_aktif = 'Y' AND m.mspk_cab = 'p05'";

    const baseQuery = getBaseSpkQuery(whereReguler, whereMemo);
    const sql = `
            SELECT 
                combined.SPK,
                combined.Nama,
                combined.Tanggal,
                combined.Ukuran,
                combined.Bahan,
                combined.Jumlah AS Total_Order,
                CAST(IFNULL(jdwl.total_terjadwal, 0) AS UNSIGNED) AS Sudah_Kirim,
                CAST(GREATEST(0, combined.Jumlah - IFNULL(jdwl.total_terjadwal, 0)) AS UNSIGNED) AS Belum_Kirim,
                CASE WHEN combined.Tipe_SPK = 'REGULER'
                  THEN (SELECT IF(t.spk_close = 1 OR t.spk_aktif <> 'Y', 'Closed', 'Open') FROM tspk t WHERE t.spk_nomor = combined.SPK)
                  ELSE (SELECT IF(m.mspk_close = 'Y' OR m.mspk_aktif <> 'Y', 'Closed', 'Open') FROM tmemospk m WHERE m.mspk_nomor = combined.SPK)
                END AS Status_SPK,
                combined.Tipe_SPK,
                combined.Ngedit,
                -- Ringkasan teks kota untuk tampilan lookup
                alok.daftar_kota AS Alokasi,
                -- Rincian lengkap alokasi dalam bentuk JSON Array
                alok.alokasi_list
            FROM (${baseQuery}) AS combined
            LEFT JOIN (
                SELECT spk_nomor, SUM(jumlah) AS total_terjadwal
                FROM tjadwalkirim
                GROUP BY spk_nomor
            ) jdwl ON jdwl.spk_nomor = combined.SPK
            LEFT JOIN (
                SELECT 
                    spka_spk_nomor,
                    GROUP_CONCAT(DISTINCT spka_kota ORDER BY spka_urut SEPARATOR ', ') AS daftar_kota,
                    JSON_ARRAYAGG(
                        JSON_OBJECT(
                            'urut', spka_urut,
                            'kota', spka_kota,
                            'toko', spka_toko,
                            'alamat', spka_alamat,
                            'person', spka_person,
                            'hp', spka_hp,
                            'jumlah', spka_jumlah
                        )
                    ) AS alokasi_list
                FROM tspk_alokasi
                GROUP BY spka_spk_nomor
            ) alok ON alok.spka_spk_nomor = combined.SPK
            WHERE (combined.SPK LIKE ? OR combined.Nama LIKE ? OR alok.daftar_kota LIKE ?)
            ORDER BY combined.Tanggal DESC
            LIMIT 100
        `;

    const searchKeyword = `%${keyword || ""}%`;
    const [rows] = await pool.query(sql, [
      searchKeyword,
      searchKeyword,
      searchKeyword,
    ]);

    // Parsing alokasi_list jika driver MySQL mengembalikannya sebagai string JSON
    const parsedRows = rows.map((row) => ({
      ...row,
      alokasi_list:
        typeof row.alokasi_list === "string"
          ? JSON.parse(row.alokasi_list)
          : row.alokasi_list || [],
    }));

    return parsedRows;
  } catch (error) {
    throwDbError("Gagal mengambil data SPK untuk Jadwal Kirim", error);
  }
};

exports.getSpkLookupData = async (keyword) => {
  try {
    let sql = `SELECT * FROM (${getBaseSpkQuery()}) AS combined_spk`;
    const params = [];
    if (keyword) {
      sql += ` WHERE (SPK LIKE ? OR Nama LIKE ?)`;
      const searchKeyword = `%${keyword}%`;
      params.push(searchKeyword, searchKeyword);
    }

    sql += ` ORDER BY Tanggal DESC LIMIT 50`;
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (error) {
    throwDbError("Gagal mengambil data SPK untuk lookup", error);
  }
};

// backend/src/services/spk.service.js

exports.getAlokasiBySpk = async (nomorSpk) => {
  try {
    // Catatan: Cek apakah sistem Anda memakai tabel `talokasi` atau `tspk_alokasi`
    // Pola tabel Delphi talokasi:
    const sql = `
      SELECT 
        IFNULL(kota, '') AS kota,
        '' AS toko,
        IFNULL(alamat, '') AS alamat,
        IFNULL(person, '') AS person,
        IFNULL(hp, '') AS hp,
        IFNULL(jumlah, 0) AS jumlah
      FROM talokasi
      WHERE spk_nomor = ?
      ORDER BY urut ASC
    `;
    const [rows] = await pool.query(sql, [nomorSpk]);

    // Jika kosong di talokasi, fallback cek tspk_alokasi (skema dengan toko)
    if (rows.length === 0) {
      const sqlFallback = `
        SELECT 
          IFNULL(spka_kota, '') AS kota,
          IFNULL(spka_toko, '') AS toko,
          IFNULL(spka_alamat, '') AS alamat,
          IFNULL(spka_person, '') AS person,
          IFNULL(spka_hp, '') AS hp,
          IFNULL(spka_jumlah, 0) AS jumlah
        FROM tspk_alokasi
        WHERE spka_spk_nomor = ?
        ORDER BY spka_urut ASC
      `;
      const [rowsFallback] = await pool.query(sqlFallback, [nomorSpk]);
      return rowsFallback;
    }

    return rows;
  } catch (error) {
    throwDbError(`Gagal mengambil alokasi untuk SPK ${nomorSpk}`, error);
  }
};
// ===================================
// 2. DETAIL SIZE (Expanded Row Logic)
// ===================================
exports.getSpkDetailSize = async (nomor) => {
  try {
    const sql = `
            SELECT 
                z.spks_nomor AS Nomor, 
                z.spks_size AS Size, 
                z.spks_qty AS Qty,
                IFNULL((SELECT SUM(d.stbjd_jumlah) FROM tstbj_dtl d 
                        WHERE d.stbjd_spk_nomor=z.spks_nomor AND d.stbjd_size=z.spks_size), 0) AS Stbj,
                (z.spks_qty - IFNULL((SELECT SUM(d.stbjd_jumlah) FROM tstbj_dtl d 
                                      WHERE d.stbjd_spk_nomor=z.spks_nomor AND d.stbjd_size=z.spks_size), 0)) AS Kurang
            FROM tspk_size z
            WHERE z.spks_nomor = ?
        `;
    const [rows] = await pool.query(sql, [nomor]);
    return rows;
  } catch (error) {
    throwDbError("Gagal memuat detail size", error);
  }
};

// ===================================
// 3. DETAIL UNTUK PRINT / EDIT
// ===================================
exports.getSpkDetailByNomor = async (nomor) => {
  try {
    const sql = `SELECT * FROM (${getBaseSpkQuery("t.spk_nomor = ?", "m.mspk_nomor = ?")}) AS combined_spk`;
    const [rows] = await pool.query(sql, [nomor, nomor]);
    if (rows.length === 0)
      throw new Error(`Nomor SPK \${nomor} tidak ditemukan.`);
    return rows[0];
  } catch (error) {
    throwDbError(`Gagal memuat detail SPK \${nomor}`, error);
  }
};

/**
 * PERBAIKAN: Mengganti pemanggilan konteks 'this' menjadi 'exports' langsung
 * untuk mencegah error runtime Node.js saat dipanggil di routing controller.
 */
exports.getSpkForPrint = async (nomor) => {
  try {
    // 1. Ambil Header Data SPK Utama
    const header = await exports.getSpkDetailByNomor(nomor);

    // 2. Ambil Detail Size (jika ada)
    const details = await exports.getSpkDetailSize(nomor);

    // 3. PERBAIKAN UTAMA: Mengambil data distribusi pengiriman asli dari tabel talokasi
    let alokasiDetails = [];
    if (header.Alokasi === "YA" || header.Alokasi === "Y") {
      const sqlAlokasi = `
              SELECT 
                  IFNULL(alamat, '') AS Alamat,
                  IFNULL(kota, '') AS Kota,
                  IFNULL(person, '') AS Person,
                  IFNULL(hp, '') AS Hp,
                  IFNULL(jumlah, 0) AS Jumlah
              FROM talokasi
              WHERE spk_nomor = ?
              ORDER BY urut ASC
          `;
      const [rowsAlokasi] = await pool.query(sqlAlokasi, [nomor]);

      // Lakukan pemetaan (mapping) data agar dibaca dengan seragam oleh Frontend Vue
      alokasiDetails = rowsAlokasi.map((row) => {
        return {
          // Jika alamat kosong, fallback tampilkan nama Kota (Sesuai Gambar 1: CILACAP, JEMBER, dll.)
          Alokasi: row.Kota
            ? row.Kota.toUpperCase()
            : row.Alamat
              ? row.Alamat
              : "-",
          Jumlah: Number(row.Jumlah),
          Detail_Lengkap: {
            Alamat: row.Alamat,
            Kota: row.Kota,
            Person: row.Person,
            Hp: row.Hp,
          },
        };
      });
    }

    return {
      ...header,
      details: details,
      Daftar_Alokasi: alokasiDetails, // Menggunakan nama properti array 'Daftar_Alokasi'
    };
  } catch (error) {
    throwDbError(`Gagal memproses data cetak SPK ${nomor}`, error);
  }
};

const getBaseSpkRegulerOnlyQuery = (whereClause = "1=1") => {
  return `
        SELECT x.*,
            IFNULL(
                IF(x.ppin='N', 'TOLAK',
                    IF(x.ppin='Y' AND x.ppakai='', 'ACC',
                        IF(x.ppin='Y' AND x.ppakai='Y', '', 
                            IF(x.ppin='WAIT', 'WAIT', '')
                        )
                    )
                ), ''
            ) AS Ngedit
        FROM (
            SELECT 
                t.spk_nomor AS SPK, 
                t.spk_nama AS Nama, 
                v.divisi AS Divisi, 
                t.spk_tanggal AS Tanggal, 
                t.spk_jumlah AS Jumlah,
                t.spk_ukuran AS Ukuran, 
                t.spk_kain AS Bahan, 
                t.spk_gramasi AS Gramasi,
                IFNULL(t.spk_panjang, 0) AS Panjang, 
                IFNULL(t.spk_lebar, 0) AS Lebar,
                t.spk_statuskerja AS Kepentingan,
                t.spk_cmo AS CMO,
                IF(t.spk_aktif='Y', 'Open', 'Closed') AS STATUS,
                t.spk_aktif AS Aktif,
                t.spk_pending AS Pending,
                t.spk_accpending AS AccPending,
                t.spk_newdesign AS design_baru,
                t.spk_designdone AS design_done,

                /* PIN System (Logika Ngedit) */
                IFNULL((SELECT pin_acc FROM tspk_pin5 WHERE pin_trs="SPK" AND pin_nomor=t.spk_nomor ORDER BY pin_urut DESC LIMIT 1), "NULL") as ppin,
                IFNULL((SELECT pin_dipakai FROM tspk_pin5 WHERE pin_trs="SPK" AND pin_nomor=t.spk_nomor ORDER BY pin_urut DESC LIMIT 1), "NULL") as ppakai,

                /* PERBAIKAN: Akumulasi Produksi Gabungan (Mesin Standar + Mesin Tekstil) */
                CAST((IFNULL(prod.total_cetak_reguler, 0) + IFNULL(prod_tekstil.total_cetak_tekstil, 0)) AS UNSIGNED) AS Sudah_Cetak,
                
                /* Kurang Cetak = Jumlah Order dikurangi Total Sudah Cetak */
                CAST(GREATEST(0, t.spk_jumlah - (IFNULL(prod.total_cetak_reguler, 0) + IFNULL(prod_tekstil.total_cetak_tekstil, 0))) AS UNSIGNED) AS Kurang_Cetak,
                'REGULER' as Tipe_SPK
            FROM tspk t
            LEFT JOIN v_help_spk v ON v.Spk = t.spk_nomor
            
            /* JOIN 1: Hitungan Cetak Mesin Reguler */
            LEFT JOIN (
                SELECT ld_spk_nomor, SUM(ld_total_qtycetak) as total_cetak_reguler
                FROM tlhk_mesin_dtl
                GROUP BY ld_spk_nomor
            ) prod ON prod.ld_spk_nomor = t.spk_nomor

            /* JOIN 2: PERBAIKAN BERSAMA - Hitungan Cetak Mesin Tekstil */
            LEFT JOIN (
                SELECT ltd_spk_nomor, SUM(ltd_qty_cetak) as total_cetak_tekstil
                FROM tlhk_mesintekstil_dtl
                GROUP BY ltd_spk_nomor
            ) prod_tekstil ON prod_tekstil.ltd_spk_nomor = t.spk_nomor
            
            WHERE ${whereClause}
        ) x
    `;
};

exports.getSpkForMesin = async (keyword) => {
  try {
    const baseQuery = getBaseSpkRegulerOnlyQuery(
      "t.spk_aktif = 'Y' AND t.spk_cab = 'p05'",
    );
    let sql = `SELECT * FROM (${baseQuery}) AS spk_mesin`;

    const params = [];

    if (keyword) {
      sql += ` WHERE (SPK LIKE ? OR Nama LIKE ?)`;
      const searchKeyword = `%${keyword}%`;
      params.push(searchKeyword, searchKeyword);
    }

    sql += ` ORDER BY Tanggal DESC LIMIT 100`;

    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (error) {
    throwDbError("Gagal mengambil data SPK khusus Mesin", error);
  }
};

exports.getMemoSpkLookupData = async (keyword) => {
  try {
    let sql = `
            SELECT 
                m.mspk_nomor AS SPK, 
                m.mspk_tanggal AS Tanggal,
                m.mspk_dateline AS Deadline,
                m.mspk_divisi AS Divisi,             
                m.mspk_nama AS Nama, 
                m.mspk_nama2 AS Nama2,           -- [DITAMBAHKAN]
                m.mspk_cab AS Cabang,
                m.mspk_workshop AS Workshop,
                m.mspk_sublim AS Sublim,
                'MEMO' AS Tipe_SPK,
                IFNULL(m.mspk_panjang, 0) AS Panjang, 
                IFNULL(m.mspk_lebar, 0) AS Lebar,
                m.mspk_ukuran AS Ukuran,
                m.mspk_gramasi AS Gramasi,
                m.mspk_kain AS Bahan,                
                m.mspk_finishing AS Finishing,       
                m.mspk_keterangan AS Pesan,          
                'Open' AS STATUS,
                m.mspk_aktif AS Aktif,
                m.mspk_jumlah AS Jumlah,
                CAST(IFNULL(prod_m.total_pernah_cetak, 0) AS UNSIGNED) AS Sudah_Cetak,
                CAST(GREATEST(0, m.mspk_jumlah - IFNULL(prod_m.total_pernah_cetak, 0)) AS UNSIGNED) AS Kurang_Cetak
            FROM tmemospk m
            LEFT JOIN (
                SELECT ld_spk_nomor, SUM(ld_total_qtycetak) as total_pernah_cetak
                FROM tlhk_mesin_dtl
                GROUP BY ld_spk_nomor
            ) prod_m ON prod_m.ld_spk_nomor = m.mspk_nomor
            WHERE 1=1
        `;

    const params = [];

    if (keyword) {
      sql += ` AND (m.mspk_nomor LIKE ? OR m.mspk_nama LIKE ?)`;
      const searchKeyword = `%${keyword}%`;
      params.push(searchKeyword, searchKeyword);
    }

    sql += ` ORDER BY m.mspk_tanggal DESC LIMIT 50`;

    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (error) {
    throwDbError("Gagal mengambil data lookup Memo SPK", error);
  }
};

// ===================================
// LOOKUP SPK FOR SUBLIM (Optimized for Speed)
// ===================================
exports.getSpkForSublimLookup = async (keyword) => {
  try {
    const params = [];
    let whereReguler = "t.spk_aktif = 'Y' AND t.spk_sublim = 'Y'";
    let whereMemo = "m.mspk_aktif = 'Y' AND m.mspk_sublim = 'Y'";

    if (keyword) {
      whereReguler += " AND (t.spk_nomor LIKE ? OR t.spk_nama LIKE ?)";
      whereMemo += " AND (m.mspk_nomor LIKE ? OR m.mspk_nama LIKE ?)";
      const searchKeyword = `%${keyword}%`;
      params.push(searchKeyword, searchKeyword, searchKeyword, searchKeyword);
    }

    const baseQuery = getBaseSpkQuery(whereReguler, whereMemo);

    const sql = `
            SELECT 
                combined.SPK,
                combined.SPK AS spk_nomor,
                combined.SPK AS poi_spk_nomor,
                combined.SPK AS poi_nomor,
                combined.Nama,
                combined.Nama AS spk_nama,
                combined.Nama AS nama_pekerjaan,
                combined.Tanggal,
                combined.Jumlah AS Qty_Order,
                combined.Ukuran AS Ukuran,
                combined.Bahan AS Nama_Bahan_Rencana,
                combined.Tipe_SPK,
                combined.Divisi,
                
                -- Ambil Size & qty order per size dari tspk_size
                IFNULL(z.spks_size, '') AS Size,
                IFNULL(z.spks_size, '') AS poid_size,
                IFNULL(z.spks_qty, 0) AS Size_Qty,
                IFNULL(z.spks_qty, 0) AS spk_qty,

                -- Ambil Panjang & Lebar dari LHK Pola Grading (jika ada)
                COALESCE(g.ldg_panjang, combined.Panjang) AS Panjang,
                COALESCE(g.ldg_lebar, combined.Lebar) AS Lebar,

                -- Data Realisasi Gudang dari Header & Detail
                IFNULL(h.promin_nomor, '-') AS Nomor_Realisasi,
                IFNULL(d.promind_bhn_kode, '') AS Barang_ID,
                combined.Bahan AS Nama_Bahan_Realisasi,
                CAST(IFNULL(d.promind_jumlah, 0) AS DECIMAL(10,2)) AS Bahan_Awal,

                -- Data Komponen Potong dari tspk_komponen_potong
                IFNULL(k.sk_kode, '') AS Kode_Komponen,
                IFNULL(k.sk_kode, '') AS sk_kode,
                IFNULL(k.sk_kode, '') AS poid_bhn_kode,
                
                -- Master Bahan dari tbahan (b.Bhn_Name)
                IFNULL(b.Bhn_Name, '') AS Bhn_Name,
                IFNULL(b.Bhn_Name, '') AS bhn_name,
                IFNULL(b.Bhn_Name, k.sk_kode) AS Nama_Komponen,
                IFNULL(b.Bhn_Name, k.sk_kode) AS nama_komponen,
                
                IFNULL(k.sk_nourut, 0) AS No_Urut_Komponen
                
            FROM (${baseQuery}) AS combined
            
            -- JOIN ke tspk_size untuk mengambil rincian Size
            LEFT JOIN tspk_size z ON z.spks_nomor = combined.SPK

            -- JOIN ke LHK Pola Grading berdasarkan SPK
            LEFT JOIN (
                SELECT 
                    ldg_spk_nomor, 
                    MAX(ldg_panjang) AS ldg_panjang, 
                    MAX(ldg_lebar) AS ldg_lebar
                FROM tlhkpola_grading_dtl 
                GROUP BY ldg_spk_nomor
            ) g ON g.ldg_spk_nomor = combined.SPK

            -- JOIN Realisasi Gudang
            LEFT JOIN tproduksiminta_hdr h ON h.promin_spk_nomor = combined.SPK
            LEFT JOIN tproduksiminta_dtl d ON d.promind_promin_nomor = h.promin_nomor

            -- JOIN Komponen Potong & Master Bahan
            LEFT JOIN tspk_komponen_potong k ON k.sk_nomor = combined.SPK
            LEFT JOIN tbahan b ON b.Bhn_kode = k.sk_kode
            
            ORDER BY combined.Tanggal DESC, k.sk_nourut ASC
            LIMIT 200
        `;

    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (error) {
    throwDbError(
      "Gagal mengambil data SPK untuk Sublim beserta Realisasi Bahan & Komponen Potong",
      error,
    );
  }
};

