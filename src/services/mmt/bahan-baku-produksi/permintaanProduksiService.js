const pool = require("../../../config/database");
const { format } = require("date-fns");

const throwDbError = (message, error) => {
  throw new Error(message + ": " + error.message);
};

// exports.getStokByBarcode = async (barcode, gudangKode) => {
//     try {
//         const sql = `
//             SELECT
//                 s.mst_barcode AS Barcode,
//                 s.mst_brg_kode AS Kode,
//                 TRIM(b.brg_nama) AS Nama_Bahan,
//                 b.brg_satuan AS Satuan,
//                 s.mst_panjang AS Panjang,
//                 s.mst_lebar AS Lebar,
//                 s.mst_spk_nomor AS Nomor_SPK,
//                 -- Menghitung total saldo stok dari semua baris di gudang tersebut
//                 SUM(s.mst_stok_in - s.mst_stok_out) AS Stok
//             FROM tmasterstok_mmt s
//             LEFT JOIN tbarang_mmt b ON s.mst_brg_kode = b.brg_kode
//             WHERE s.mst_barcode = ?
//               AND s.mst_gdg_kode = ?
//             GROUP BY
//                 s.mst_barcode, s.mst_brg_kode, b.brg_nama,
//                 b.brg_satuan, s.mst_panjang, s.mst_lebar, s.mst_spk_nomor
//             -- Filter hasil akhir: hanya tampilkan jika total stok > 0
//             HAVING Stok > 0;
//         `;

//         const [results] = await pool.query(sql, [barcode, gudangKode]);

//         // Jika saldo akhir 0 atau negatif, results akan kosong []
//         return results[0] || null;
//     } catch (error) {
//         throwDbError('Gagal mencari data barcode', error);
//     }
// };

exports.getStokByBarcode = async (barcode, gudangKode) => {
  try {
    const sqlMMT = `
            SELECT 
    TRIM(REPLACE(m.mst_barcode, '\t', '')) AS Barcode, 
    m.mst_brg_kode AS Kode, 
    TRIM(b.brg_nama) AS Nama_Bahan, 
    b.brg_satuan AS Satuan, 
    ROUND(SUM(COALESCE(m.mst_stok_in, 0) * m.mst_panjang) - SUM(COALESCE(m.mst_stok_out, 0) * m.mst_panjang), 3) AS Panjang, 
    MAX(m.mst_spk_nomor) AS Nomor_SPK,
    SUM(COALESCE(m.mst_stok_in, 0) - COALESCE(m.mst_stok_out, 0)) AS Stok
FROM tmasterstok_mmt m
LEFT JOIN tbarang_mmt b ON m.mst_brg_kode = b.brg_kode
WHERE TRIM(REPLACE(m.mst_barcode, '\t', '')) = TRIM(REPLACE(?, '\t', '')) AND m.mst_gdg_kode = ?
GROUP BY TRIM(REPLACE(m.mst_barcode, '\t', '')), m.mst_brg_kode, b.brg_nama, b.brg_satuan
HAVING Stok > 0;
        `;

    const [resultsMMT] = await pool.query(sqlMMT, [barcode, gudangKode]);

    // Jika ketemu di MMT, lengkapi Lebar dari baris terbaru (toleran barcode kotor)
    if (resultsMMT.length > 0) {
      const row = resultsMMT[0];
      const [lebarRows] = await pool.query(
        `SELECT mst_lebar FROM tmasterstok_mmt
         WHERE TRIM(REPLACE(mst_barcode, '\t', '')) = TRIM(REPLACE(?, '\t', ''))
         ORDER BY mst_tanggal DESC, id DESC LIMIT 1`,
        [barcode],
      );
      if (lebarRows.length > 0) row.Lebar = lebarRows[0].mst_lebar;
      return row;
    }

    // --- LANGKAH 2: Cari di tabel OBAT (DENGAN mst_aktif) ---
    if (gudangKode === "WH-20") {
      const sqlObat = `
                SELECT 
                    m.mst_barcode AS Barcode, 
                    m.mst_brg_kode AS Kode, 
                    TRIM(b.o_nama) AS Nama_Bahan, 
                    b.o_satuan AS Satuan, 
                    ROUND(SUM(COALESCE(m.mst_stok_in, 0) * m.mst_panjang) - SUM(COALESCE(m.mst_stok_out, 0) * m.mst_panjang), 3) AS Panjang, 
                    MAX(m.mst_lebar) AS Lebar,
                    MAX(m.mst_spk_nomor) AS Nomor_SPK,
                    SUM(COALESCE(m.mst_stok_in, 0) - COALESCE(m.mst_stok_out, 0)) AS Stok
                FROM tmasterstok_obat m
                LEFT JOIN tobat b ON m.mst_brg_kode = b.o_kode
                WHERE m.mst_barcode = ? 
                  AND m.mst_gdg_kode = ?
                  AND m.mst_aktif = 'Y' -- Sesuai karena di OBAT kolom ini ada
                GROUP BY m.mst_barcode, m.mst_brg_kode, b.o_nama, b.o_satuan
                HAVING Stok > 0;
            `;

      const [resultsObat] = await pool.query(sqlObat, [barcode, gudangKode]);
      return resultsObat[0] || null;
    }

    return null;
  } catch (error) {
    throw new Error(`Gagal verifikasi stok barcode: ${error.message}`);
  }
};

exports.getPermintaanProduksiData = async (startDate, endDate, userDivisi) => {
  try {
    let sqlMaster = "";
    let sqlDetail = "";
    const divisi = Number(userDivisi);
    const DATE_FORMAT_SQL = "DATE_FORMAT(??, '%d/%m/%Y')";

    // Guard: tanggal kosong ("") di-skip agar tidak jadi klausa zero-date.
    const dateParamsObat = [];
    let dateClauseObat = "1=1";
    if (startDate && endDate) {
      dateClauseObat = `h.promin_tanggal BETWEEN ? AND ?`;
      dateParamsObat.push(startDate, endDate);
    } else if (startDate) {
      dateClauseObat = `h.promin_tanggal >= ?`;
      dateParamsObat.push(startDate);
    } else if (endDate) {
      dateClauseObat = `h.promin_tanggal <= ?`;
      dateParamsObat.push(endDate);
    }
    const dateParamsMmt = [];
    let dateClauseMmt = "1=1";
    if (startDate && endDate) {
      dateClauseMmt = `h.mnt_tanggal BETWEEN ? AND ?`;
      dateParamsMmt.push(startDate, endDate);
    } else if (startDate) {
      dateClauseMmt = `h.mnt_tanggal >= ?`;
      dateParamsMmt.push(startDate);
    } else if (endDate) {
      dateClauseMmt = `h.mnt_tanggal <= ?`;
      dateParamsMmt.push(endDate);
    }

    if (divisi === 4) {
      sqlMaster = `
                SELECT
                    h.promin_nomor AS Nomor, 
                    'WH-20' AS Gudang, 
                    'Gudang Obat/Tinta' AS Nama,
                    DATE_FORMAT(h.promin_tanggal, '%d/%m/%Y') AS Tanggal, 
                    h.promin_ket AS Keterangan,
                    'OBAT' AS Tipe
                FROM tobatproduksiminta_hdr h
                WHERE ${dateClauseObat}
                ORDER BY h.promin_tanggal DESC;
            `;

      sqlDetail = `
                SELECT
                    d.promind_nomor AS Nomor, d.promind_o_kode AS Kode, 
                    TRIM(b.o_nama) AS Nama_Bahan, d.promind_jumlah AS Jumlah, b.o_satuan AS Satuan,
                    '0' AS Nomor_SPK, d.promind_ket AS Keterangan
                FROM tobatproduksiminta_dtl d
                LEFT JOIN tobat b ON d.promind_o_kode = b.o_kode
                WHERE d.promind_nomor IN (?);
            `;
    } else {
      let filterDivisi = "";
      if (divisi === 1) {
        filterDivisi = "AND mnt_gdg_kode IN ('WH-16', 'WH-BP')";
      }

      sqlMaster = `
                SELECT
                    h.mnt_nomor AS Nomor, h.mnt_gdg_kode AS Gudang, g.gdg_nama AS Nama,
                    DATE_FORMAT(h.mnt_tanggal, '%d/%m/%Y') AS Tanggal, 
                    h.mnt_keterangan AS Keterangan,
                    'MMT' AS Tipe
                FROM tminta_mmt_hdr h
                LEFT JOIN tgudang g ON g.gdg_kode = h.mnt_gdg_kode
                WHERE ${dateClauseMmt} ${filterDivisi}
                ORDER BY h.mnt_tanggal DESC;
            `;

      sqlDetail = `
                SELECT
                    d.mntd_mnt_nomor AS Nomor, d.mntd_brg_kode AS Kode, d.mntd_barcode AS Barcode,
                    TRIM(b.brg_nama) AS Nama_Bahan, d.mntd_qty AS Jumlah, d.mntd_brg_satuan AS Satuan,
                    d.mntd_spk_nomor AS Nomor_SPK, d.mntd_keterangan AS Keterangan
                FROM tminta_mmt_dtl d
                LEFT JOIN tbarang_mmt b ON d.mntd_brg_kode = b.brg_kode
                WHERE d.mntd_mnt_nomor IN (?);
            `;
    }

    const [masterResults] = await pool.query(sqlMaster, divisi === 4 ? dateParamsObat : dateParamsMmt);
    if (masterResults.length === 0) return [];

    const masterNomors = masterResults.map((row) => row.Nomor);
    const [detailResults] = await pool.query(sqlDetail, [masterNomors]);

    const dataMap = new Map();
    masterResults.forEach((item) => {
      // Fallback jika tanggal null agar tidak jadi 1970
      if (!item.Tanggal) item.Tanggal = format(new Date(), "yyyy-MM-dd");
      dataMap.set(item.Nomor, { ...item, Detail: [] });
    });

    detailResults.forEach((detail) => {
      if (dataMap.has(detail.Nomor)) {
        dataMap.get(detail.Nomor).Detail.push(detail);
      }
    });

    return Array.from(dataMap.values());
  } catch (error) {
    throw new Error("Gagal ambil data permintaan: " + error.message);
  }
};

exports.getPermintaanProduksiDataByNomor = async (nomor) => {
  try {
    const [hdr] = await pool.query(
      `SELECT h.mnt_nomor AS Nomor, h.mnt_gdg_kode AS GudangKode, g.gdg_nama AS NamaGudang,
              DATE_FORMAT(h.mnt_tanggal, '%Y-%m-%d') AS Tanggal,
              h.mnt_keterangan AS Keterangan, h.mnt_permintaan AS Permintaan,
              h.mnt_lokasiproduksi AS LokasiProduksi,
              gl.gdg_nama AS NamaLokasiProduksi
       FROM tminta_mmt_hdr h
       LEFT JOIN tgudang g ON g.gdg_kode = h.mnt_gdg_kode
       LEFT JOIN tgudang gl ON gl.gdg_kode = h.mnt_lokasiproduksi
       WHERE h.mnt_nomor = ? LIMIT 1`,
      [nomor]
    );
    if (!hdr.length) return null;

    const [dtls] = await pool.query(
      `SELECT d.mntd_brg_kode AS sku, d.mntd_barcode AS barcode,
              TRIM(b.brg_nama) AS nama, d.mntd_qty AS qty, d.mntd_brg_satuan AS satuan,
              d.mntd_spk_nomor AS spk, d.mntd_keterangan AS keterangan,
              COALESCE(NULLIF(d.mntd_panjang, 0), b.brg_panjang, 0) AS panjang,
              COALESCE(NULLIF(d.mntd_lebar, 0), b.brg_lebar, 0) AS lebar
       FROM tminta_mmt_dtl d
       LEFT JOIN tbarang_mmt b ON d.mntd_brg_kode = b.brg_kode
       WHERE d.mntd_mnt_nomor = ?
       ORDER BY d.mntd_nourut ASC`,
      [nomor]
    );

    return {
      header: hdr[0],
      details: dtls
    };
  } catch (error) {
    throw new Error("Gagal mengambil detail realisasi: " + error.message);
  }
};

// ===================================
// 2. DELETE (cxButton4Click)
// ===================================
exports.deletePermintaanProduksi = async (nomor) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Hapus Detail (tminta_mmt_dtl)
    await connection.query(
      "DELETE FROM tminta_mmt_dtl WHERE mntd_mnt_nomor = ?",
      [nomor],
    );

    // 2. Hapus Header (tminta_mmt_hdr)
    const [result] = await connection.query(
      "DELETE FROM tminta_mmt_hdr WHERE mnt_nomor = ?",
      [nomor],
    );

    await connection.commit();
    return result.affectedRows > 0;
  } catch (error) {
    await connection.rollback();
    throwDbError("Database Transaction Error on Delete", error);
  } finally {
    connection.release();
  }
};

// ===================================
// 5. GET MAX KODE (cxButton2Click -> getmaxkode)
// ===================================
exports.getNewNomor = async () => {
  // Definisi Nomerator/Prefiks sesuai permintaan Anda
  const NOMERATOR = "MMT.MP";

  try {
    // 1. Dapatkan Tahun (2 digit) dan Bulan (2 digit) saat ini: YYMM
    const currentYYMM = format(new Date(), "yyMM"); // Hasilnya: 2512

    // 2. Tentukan pola pencarian: MMT.MP.YYMM.%
    const searchPattern = `${NOMERATOR}.${currentYYMM}.%`;

    // 3. Query SQL: Mencari nomor tertinggi yang sudah ada untuk bulan ini
    const sql = `
            SELECT MAX(mnt_nomor) AS MaxNomor 
            FROM tminta_mmt_hdr 
            WHERE mnt_nomor LIKE ?;
        `;

    // Eksekusi query
    const [results] = await pool.query(sql, [searchPattern]);

    const maxNomor = results[0].MaxNomor;

    let newNumber = "0001";

    if (maxNomor) {
      // Ambil nomor urut terakhir dari string (misalnya '0045')
      const lastNumberString = maxNomor.substring(
        maxNomor.lastIndexOf(".") + 1,
      );

      // Konversi ke integer dan tambahkan 1
      const lastNumber = parseInt(lastNumberString, 10);

      // Format kembali menjadi string 4 digit dengan leading zero
      newNumber = (lastNumber + 1).toString().padStart(4, "0");
    }
    return `${NOMERATOR}.${currentYYMM}.${newNumber}`;
  } catch (error) {
    throwDbError("Gagal mendapatkan nomor dokumen MMT.MP baru", error);
  }
};

exports.savePermintaanProduksi = async (data, isUpdate = false, userLogin) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    let {
      Nomor,
      Gudang,
      Tanggal,
      Keterangan,
      Details,
      LokasiProduksi,
      Permintaan,
      NomorMinta,
      PinUrut,
      StatusPin,
    } = data;
    const idPermintaan = NomorMinta || Permintaan || data.mnt_permintaan;

    const serverTime = new Date();
    const activeUser = userLogin || "SYSTEM";

    // -------------------------------------------------------
    // JALUR 1: GUDANG WH-20 (LOGIKA OBAT / DELPHI)
    // -------------------------------------------------------
    if (Gudang === "WH-20") {
      if (!idPermintaan) {
        throw new Error(
          "Nomor Permintaan (promin_minta) tidak boleh kosong untuk WH-20",
        );
      }

      const tahun = format(new Date(Tanggal), "yyyy");

      if (!isUpdate && (!Nomor || Nomor === "AUTO")) {
        const [rows] = await connection.query(
          `SELECT IFNULL(MAX(RIGHT(promin_nomor, 5)), 0) AS jumlah 
                 FROM tobatproduksiminta_hdr WHERE LEFT(promin_nomor, 8) = ?`,
          [`REO-${tahun}`],
        );
        const nextNum = parseInt(rows[0].jumlah) + 1;
        Nomor = `REO-${tahun}${nextNum.toString().padStart(5, "0")}`;
      }

      if (isUpdate) {
        await connection.query(
          `UPDATE tobatproduksiminta_hdr SET 
                    promin_tanggal=?, promin_minta=?, promin_ket=?, 
                    user_modified=?, date_modified=? WHERE promin_nomor=?`,
          [Tanggal, idPermintaan, Keterangan, activeUser, serverTime, Nomor],
        );
        await connection.query(
          "DELETE FROM tobatproduksiminta_dtl WHERE promind_nomor = ?",
          [Nomor],
        );
      } else {
        await connection.query(
          `INSERT INTO tobatproduksiminta_hdr 
                    (promin_nomor, promin_tanggal, promin_minta, promin_ket, user_create, date_create) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
          [Nomor, Tanggal, idPermintaan, Keterangan, activeUser, serverTime],
        );
      }

      if (Details && Details.length > 0) {
        const detailValues = Details.map((d) => [
          Nomor,
          d.sku,
          d.qty,
          d.keterangan || "",
        ]);
        await connection.query(
          `INSERT INTO tobatproduksiminta_dtl (promind_nomor, promind_o_kode, promind_jumlah, promind_ket) VALUES ?`,
          [detailValues],
        );

        const [reqData] = await connection.query(
          `SELECT SUM(mind_jumlah) as total FROM tobatminta_dtl WHERE mind_nomor=?`,
          [idPermintaan],
        );
        const [prevData] = await connection.query(
          `SELECT IFNULL(SUM(d.promind_jumlah), 0) as sudah FROM tobatproduksiminta_hdr h INNER JOIN tobatproduksiminta_dtl d ON d.promind_nomor=h.promin_nomor WHERE h.promin_minta=? AND h.promin_nomor<>?`,
          [idPermintaan, Nomor],
        );

        const totalMinta = reqData[0] ? reqData[0].total || 0 : 0;
        const totalKumulatif =
          parseFloat(prevData[0].sudah) +
          Details.reduce((sum, d) => sum + parseFloat(d.qty || 0), 0);

        let statusClose =
          totalKumulatif >= totalMinta ? 1 : totalKumulatif > 0 ? 2 : 0;
        if (statusClose > 0) {
          await connection.query(
            `UPDATE tobatminta_hdr SET min_close=? WHERE min_nomor=?`,
            [statusClose, idPermintaan],
          );
        }
      }

      if (StatusPin === "ACC" && PinUrut) {
        await connection.query(
          `UPDATE tspk_pin5 SET pin_dipakai='Y' WHERE pin_trs='REALISASI MINTA OBAT' AND pin_nomor=? AND pin_urut=?`,
          [Nomor, PinUrut],
        );
      }

      // -------------------------------------------------------
      // JALUR 2: GUDANG WH-16 (LOGIKA MMT ASLI)
      // -------------------------------------------------------
    } else {
      if (!isUpdate && (!Nomor || Nomor === "AUTO")) {
        Nomor = await exports.getNewNomor();
      }

      if (isUpdate) {
        await connection.query(
          `UPDATE tminta_mmt_hdr SET 
                    mnt_gdg_kode=?, mnt_lokasiproduksi=?, mnt_tanggal=?, 
                    mnt_keterangan=?, mnt_permintaan=?, user_modified=?, date_modified=? 
                 WHERE mnt_nomor=?`,
          [
            Gudang,
            LokasiProduksi,
            Tanggal,
            Keterangan,
            idPermintaan,
            activeUser,
            serverTime,
            Nomor,
          ],
        );
        await connection.query(
          "DELETE FROM tminta_mmt_dtl WHERE mntd_mnt_nomor = ?",
          [Nomor],
        );
      } else {
        await connection.query(
          `INSERT INTO tminta_mmt_hdr 
                    (mnt_nomor, mnt_gdg_kode, mnt_lokasiproduksi, mnt_tanggal, mnt_keterangan, mnt_permintaan, user_create, date_create) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            Nomor,
            Gudang,
            LokasiProduksi,
            Tanggal,
            Keterangan,
            idPermintaan,
            activeUser,
            serverTime,
          ],
        );
      }

      if (Details && Details.length > 0) {
        const detailValues = Details.map((d, index) => [
          Nomor,
          d.nourut || index + 1,
          d.sku,
          d.qty,
          d.satuan,
          null,
          d.spk || "0",
          d.keterangan || "",
          d.barcode,
          Number(d.panjang) || 0, // Mengambil dari normalizedDetails
          Number(d.lebar) || 0, // Mengambil dari normalizedDetails
        ]);

        await connection.query(
          `INSERT INTO tminta_mmt_dtl 
                    (mntd_mnt_nomor, mntd_nourut, mntd_brg_kode, mntd_qty, mntd_brg_satuan, mntd_operator, mntd_spk_nomor, mntd_keterangan, mntd_barcode, mntd_panjang, mntd_lebar) 
                 VALUES ?`,
          [detailValues],
        );
      }
    }

    await connection.commit();
    return { success: true, nomor: Nomor };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};
