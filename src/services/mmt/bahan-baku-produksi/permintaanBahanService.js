const pool = require("../../../config/database");
const { format } = require("date-fns");

const throwDbError = (message, error) => {
  console.error(message, error.message);
  throw new Error(message + ": " + error.message);
};

exports.getInvoicePembelianData = async (startDate, endDate) => {
  try {
    const sqlMaster = `
            SELECT
                h.invp_nomor AS Nomor,
                DATE_FORMAT(h.invp_tanggal,'%d/%m/%Y') AS Tanggal,
                s.sup_nama AS Supplier,
                h.invp_status AS Status,
                IFNULL(SUM(d.invpd_jumlah * d.invpd_harga), 0) AS Total
            FROM tinvp_hdr h
            LEFT JOIN tsupplier s ON s.sup_kode = h.invp_sup_kode
            LEFT JOIN tinvp_dtl d ON d.invpd_inv_nomor = h.invp_nomor
            WHERE h.invp_tanggal BETWEEN ? AND ?
            GROUP BY h.invp_nomor, h.invp_tanggal, s.sup_nama, h.invp_status
            ORDER BY h.invp_tanggal DESC
        `;

    const [masterResults] = await pool.query(sqlMaster, [startDate, endDate]);

    // Jika tidak ada data, langsung kembalikan array kosong
    if (masterResults.length === 0) return [];

    // Ambil semua nomor invoice untuk filter detail
    const masterNomors = masterResults.map((row) => row.Nomor);

    // --- 2. Query Detail ---
    const sqlDetail = `
            SELECT
                invpd_inv_nomor AS Nomor,
                invpd_nourut AS NoUrut,
                invpd_brg_kode AS Kode,
                invpd_brg_nama AS Nama,
                invpd_satuan AS Satuan,
                invpd_jumlah AS Jumlah,
                invpd_harga AS Harga,
                (invpd_jumlah * invpd_harga) AS SubTotal
            FROM tinvp_dtl
            WHERE invpd_inv_nomor IN (?)
            ORDER BY invpd_inv_nomor, invpd_nourut
        `;

    const [detailResults] = await pool.query(sqlDetail, [masterNomors]);

    // --- 3. Mapping Data (Menggabungkan Master dan Detail) ---
    const dataMap = new Map();

    // Inisialisasi Map dengan data Header
    masterResults.forEach((item) => {
      dataMap.set(item.Nomor, {
        ...item,
        Detail: [],
      });
    });

    // Masukkan Detail ke dalam Header yang sesuai
    detailResults.forEach((detail) => {
      if (dataMap.has(detail.Nomor)) {
        // Hapus properti 'Nomor' dari objek detail agar tidak double di dalam array
        const { Nomor, ...detailContent } = detail;
        dataMap.get(Nomor).Detail.push(detailContent);
      }
    });

    // Kembalikan hasil sebagai array
    return Array.from(dataMap.values());
  } catch (error) {
    throwDbError("Gagal mengambil data Invoice Pembelian", error);
  }
};

// PERBAIKAN: Menambahkan parameter userBagian ke dalam fungsi
exports.getPermintaanBahanData = async (
  startDate,
  endDate,
  divisi,
  userManager,
  userBagian,
) => {
  try {
    let sqlMaster = "";
    let paramsMaster = [];

    // 1. Sub-query Agregasi untuk MMT (Tabel tmintabahan_mmt_dtl)
    const sqlAggMMT = `
            SELECT
                mbd_mb_nomor,
                SUM(CASE WHEN mbd_acc = 'Y' THEN mbd_qty ELSE 0 END) AS Total_Diminta,
                SUM(CASE WHEN mbd_acc = 'Y' THEN mbd_qty_po ELSE 0 END) AS Total_DiPO,
                SUM(CASE WHEN mbd_acc = 'Y' THEN mbd_qty_terima ELSE 0 END) AS Total_Diterima,
                COUNT(CASE WHEN mbd_acc = 'Y' THEN 1 END) AS Jml_Item_Acc,
                COUNT(*) AS Total_Baris_Detail
            FROM tmintabahan_mmt_dtl
            GROUP BY mbd_mb_nomor
        `;

    // 2. Sub-query Agregasi untuk TOBAT (Tabel tobatmintabeli_dtl)
    const sqlAggTobat = `
            SELECT
                mbd_nomor AS mbd_mb_nomor,
                SUM(mbd_jumlah) AS Total_Diminta,
                0 AS Total_DiPO, 
                0 AS Total_Diterima,
                COUNT(*) AS Jml_Item_Acc,
                COUNT(*) AS Total_Baris_Detail
            FROM tobatmintabeli_dtl
            GROUP BY mbd_nomor
        `;

    // Kolom tambahan untuk Estimasi & Realisasi
    const trackingColumns = `
            (SELECT DATE_FORMAT(MAX(po.po_dateline), '%Y-%m-%d') 
             FROM tpo_mmt_dtl pod 
             JOIN tpo_mmt_hdr po ON pod.pod_po_nomor = po.po_nomor
             WHERE pod.pod_mb_nomor = t1.mb_nomor) AS Estimasi_Kedatangan,

            (SELECT DATE_FORMAT(MAX(rec.rec_tanggal), '%Y-%m-%d')
             FROM trec_mmt_hdr rec
             INNER JOIN tpo_mmt_dtl pod ON rec.rec_memo = pod.pod_po_nomor
             WHERE pod.pod_mb_nomor = t1.mb_nomor) AS Tanggal_Datang
        `;

    // PERBAIKAN: Logika IF diubah agar admin, edp, finance dan audit bisa mengakses data MMT
    if (
      divisi == 0 ||
      divisi == 1 ||
      divisi == 5 ||
      (userManager == 1 && divisi != 4) ||
      userBagian === "finance" ||
      userBagian === "audit" ||
      userBagian === "edp" ||
      userBagian === "admin"
    ) {
      sqlMaster = `
                SELECT
                    t1.mb_nomor AS Nomor, t1.mb_gdg_kode AS Gudang, t3.gdg_nama AS Nama,
                    DATE_FORMAT(t1.mb_tanggal, '%Y-%m-%d') AS Tanggal,
                    t1.mb_keterangan AS Keterangan,
                    'MMT' AS Source,
                    ${trackingColumns},
                    CASE WHEN t1.mb_acc = 'Y' THEN 'Acc Manager' WHEN t1.mb_acc_req = 'Y' THEN 'Acc SPV' ELSE 'PENDING' END AS Status_Acc,
                    IFNULL(t2.Total_Diminta, 0) AS Total_Diminta,
                    IFNULL(t2.Total_DiPO, 0) AS Total_DiPO,
                    IFNULL(t2.Total_Diterima, 0) AS Total_Diterima,
                    CASE 
                        WHEN t2.Total_Baris_Detail IS NULL OR t2.Total_Baris_Detail = 0 THEN 'OPEN'
                        WHEN t1.mb_acc = 'Y' AND IFNULL(t2.Jml_Item_Acc, 0) = 0 THEN 'CLOSED'
                        WHEN t2.Jml_Item_Acc > 0 AND t2.Total_DiPO >= t2.Total_Diminta THEN 'CLOSED'
                        WHEN t2.Total_DiPO > 0 THEN 'ONPROSES' ELSE 'OPEN'
                    END AS Status_PO,
                    CASE
                        WHEN t2.Total_Baris_Detail IS NULL OR t2.Total_Baris_Detail = 0 THEN 'OPEN'
                        WHEN t1.mb_acc = 'Y' AND IFNULL(t2.Jml_Item_Acc, 0) = 0 THEN 'CLOSED'
                        WHEN t2.Jml_Item_Acc > 0 AND t2.Total_Diterima >= t2.Total_Diminta THEN 'CLOSED'
                        WHEN t2.Total_Diterima > 0 THEN 'ONPROSES' ELSE 'OPEN'
                    END AS Status_Diterima
                FROM tmintabahan_mmt_hdr t1
                LEFT JOIN (${sqlAggMMT}) t2 ON t2.mbd_mb_nomor = t1.mb_nomor
                LEFT JOIN tgudang t3 ON t3.gdg_kode = t1.mb_gdg_kode
                WHERE t1.mb_tanggal BETWEEN ? AND ?
                ORDER BY t1.mb_tanggal DESC
            `;
      paramsMaster = [startDate, endDate];
    } else if (divisi == 4) {
      sqlMaster = `
                SELECT
                    t1.mb_nomor AS Nomor, t1.mb_mintake AS Gudang, 'GUDANG OBAT' AS Nama,
                    DATE_FORMAT(t1.mb_tanggal, '%Y-%m-%d') AS Tanggal,
                    t1.mb_ket AS Keterangan,
                    'TOBAT' AS Source,
                    NULL AS Estimasi_Kedatangan,
                    NULL AS Tanggal_Datang,
                    CASE WHEN t1.mb_status = 'CLOSE' THEN 'Acc Manager' ELSE 'PENDING' END AS Status_Acc,
                    IFNULL(t2.Total_Diminta, 0) AS Total_Diminta,
                    0 AS Total_DiPO, 0 AS Total_Diterima,
                    'OPEN' AS Status_PO, 'OPEN' AS Status_Diterima
                FROM tobatmintabeli_hdr t1
                LEFT JOIN (${sqlAggTobat}) t2 ON t2.mbd_mb_nomor = t1.mb_nomor
                WHERE t1.mb_tanggal BETWEEN ? AND ?
                ORDER BY t1.mb_tanggal DESC
            `;
      paramsMaster = [startDate, endDate];
    } else {
      return [];
    }

    const [masterResults] = await pool.query(sqlMaster, paramsMaster);
    if (masterResults.length === 0) return [];

    const masterNomors = masterResults.map((row) => row.Nomor);

    // 3. Query Detail Gabungan
    const sqlDetail = `
            SELECT * FROM (
                SELECT 
                    d.mbd_mb_nomor AS Nomor, 
                    d.mbd_brg_kode AS Kode, 
                    d.mbd_qty AS Jumlah, 
                    d.mbd_qty_terima AS Total_Diterima, 
                    d.mbd_brg_satuan AS Satuan,
                    TRIM(b.brg_nama) AS Nama_Bahan, 
                    b.brg_panjang AS Panjang, 
                    b.brg_lebar AS Lebar, 
                    b.brg_satuan_harga AS Harga,
                    d.mbd_acc AS Is_Acc
                FROM tmintabahan_mmt_dtl d
                LEFT JOIN tbarang_mmt b ON d.mbd_brg_kode = b.brg_kode
                WHERE d.mbd_mb_nomor IN (?)
                
                UNION ALL
                
                SELECT 
                    d.mbd_nomor AS Nomor, 
                    d.mbd_o_kode AS Kode, 
                    d.mbd_jumlah AS Jumlah, 
                    0 AS Total_Diterima, 
                    'PCS' AS Satuan,
                    TRIM(t.brg_nama) AS Nama_Bahan, 
                    0 AS Panjang, 
                    0 AS Lebar, 
                    t.brg_harga AS Harga,
                    'Y' AS Is_Acc
                FROM tobatmintabeli_dtl d
                LEFT JOIN tgarmen_brg t ON d.mbd_o_kode = t.brg_kode
                WHERE d.mbd_nomor IN (?)
            ) AS combined_detail
        `;

    const [detailResults] = await pool.query(sqlDetail, [
      masterNomors,
      masterNomors,
    ]);

    return masterResults.map((master) => ({
      ...master,
      Detail: detailResults.filter((dtl) => dtl.Nomor === master.Nomor),
    }));
  } catch (error) {
    console.error("Error in getPermintaanBahanData:", error.message);
    throw new Error(`Database Error: ${error.message}`);
  }
};

// Fungsi Approval oleh SPV
exports.approveBySPV = async (nomor, userKD) => {
  const sql = `
        UPDATE tmintabahan_mmt_hdr 
        SET mb_acc_req = 'Y', mb_acc_req_user = ?, date_modified = NOW() 
        WHERE mb_nomor = ?
    `;
  const [result] = await pool.query(sql, [userKD, nomor]);
  return result.affectedRows > 0;
};

// Fungsi Approval Final oleh Manager

exports.getPermintaanBahanByNomor = async (nomor) => {
  try {
    // 1. Ambil Header Permintaan Bahan
    const sqlHeader = `
      SELECT
        mb_nomor AS Nomor, 
        mb_tanggal AS Tanggal, 
        mb_gdg_kode AS Gudang_Asal_Kode,
        tgudang.gdg_nama AS Gudang_Asal_Nama, 
        mb_keterangan AS Keterangan,
        mb_acc_req AS Req_ACC, 
        mb_acc_req_user AS Req_ACC_User, 
        mb_to_user AS Kepada, 
        mb_to_cab AS Cabang,
        mb_acc AS ACC, 
        mb_acc_user AS Acc_User
      FROM tmintabahan_mmt_hdr
      LEFT JOIN tgudang ON tgudang.gdg_kode = mb_gdg_kode
      WHERE mb_nomor = ?;
    `;
    const [headerResults] = await pool.query(sqlHeader, [nomor]);

    if (headerResults.length === 0) {
      throw new Error(
        `Transaksi Permintaan Bahan dengan nomor ${nomor} tidak ditemukan.`,
      );
    }

    const headerData = headerResults[0];

    // 2. Ambil Detail Permintaan Bahan + Data PO & Jumlah Datang
    const sqlDetail = `
      SELECT
        mbd.mbd_nourut AS NoUrut, 
        mbd.mbd_spk_nomor AS Nomor_SPK,
        (
          SELECT TRIM(spk_nama) FROM tspk WHERE spk_nomor = mbd.mbd_spk_nomor 
          UNION ALL 
          SELECT TRIM(mspk_nama) FROM tmemospk WHERE mspk_nomor = mbd.mbd_spk_nomor 
          LIMIT 1
        ) AS spk_nama,
        mbd.mbd_brg_kode AS Kode, 
        TRIM(b.brg_nama) AS Nama_Bahan,
        mbd.mbd_qty AS Jumlah,
        
        -- Total Qty yang sudah dibuatkan PO
        COALESCE((
          SELECT SUM(pod.pod_qty) 
          FROM tpo_mmt_dtl pod 
          WHERE pod.pod_mb_nomor = mbd.mbd_mb_nomor 
            AND pod.pod_brg_kode = mbd.mbd_brg_kode
        ), 0) AS Jumlah_PO,

        -- Total Qty Barang Datang / Diterima dari PO terkait
        COALESCE((
          SELECT SUM(pod.pod_qty_terima) 
          FROM tpo_mmt_dtl pod 
          WHERE pod.pod_mb_nomor = mbd.mbd_mb_nomor 
            AND pod.pod_brg_kode = mbd.mbd_brg_kode
        ), 0) AS Jumlah_Datang,

        -- Daftar Nomor PO yang memuat item ini (jika ada lebih dari 1 PO)
        (
          SELECT GROUP_CONCAT(DISTINCT pod.pod_po_nomor SEPARATOR ', ')
          FROM tpo_mmt_dtl pod
          WHERE pod.pod_mb_nomor = mbd.mbd_mb_nomor 
            AND pod.pod_brg_kode = mbd.mbd_brg_kode
        ) AS Nomor_PO,

        mbd.mbd_brg_satuan AS Satuan,
        b.brg_panjang AS Panjang, 
        b.brg_lebar AS Lebar,
        b.brg_satuan_harga,
        mbd.mbd_keterangan AS KeteranganItem,
        mbd.mbd_acc AS Is_Acc
      FROM tmintabahan_mmt_dtl mbd
      LEFT JOIN tbarang_mmt b ON mbd.mbd_brg_kode = b.brg_kode
      WHERE mbd.mbd_mb_nomor = ?
      ORDER BY mbd.mbd_nourut;
    `;
    const [detailResults] = await pool.query(sqlDetail, [nomor]);

    // 3. Gabungkan dan Kembalikan
    return {
      ...headerData,
      Detail: detailResults,
    };
  } catch (error) {
    throwDbError(`Gagal mengambil data Permintaan Bahan (${nomor})`, error);
  }
};

exports.getPermintaanBahanForLookup = async (
  startDate,
  endDate,
  status = "OPEN",
) => {
  try {
    const sqlMaster = `
SELECT
    h.mb_nomor AS Nomor,
    DATE_FORMAT(h.mb_tanggal, '%Y-%m-%d') AS Tanggal,
    h.mb_gdg_kode AS KodeGudang,
    g.gdg_nama AS NamaGudang,
    h.mb_keterangan AS Keterangan,
    h.mb_acc AS ACC,

    CASE
    WHEN IFNULL(a.Jml_Item_Acc,0) = 0 THEN 'OPEN'
    WHEN IFNULL(a.Jml_Item_PO,0) = 0 THEN 'OPEN'
    WHEN a.Jml_Item_Selesai = a.Jml_Item_Acc THEN 'CLOSE'
    ELSE 'PROGRESS'
END AS Status_Proses

FROM tmintabahan_mmt_hdr h
LEFT JOIN tgudang g ON g.gdg_kode = h.mb_gdg_kode

LEFT JOIN (
    SELECT
        mbd_mb_nomor,
        COUNT(CASE WHEN mbd_acc = 'Y' THEN 1 END) AS Jml_Item_Acc,
        COUNT(
            CASE
                WHEN mbd_acc = 'Y'
                 AND IFNULL(mbd_qty_po,0) > 0
                THEN 1
            END
        ) AS Jml_Item_PO,
        COUNT(
            CASE
                WHEN mbd_acc = 'Y'
                 AND IFNULL(mbd_qty_po,0) >= mbd_qty
                THEN 1
            END
        ) AS Jml_Item_Selesai

    FROM tmintabahan_mmt_dtl
    GROUP BY mbd_mb_nomor
) a ON a.mbd_mb_nomor = h.mb_nomor

ORDER BY h.mb_tanggal DESC, h.mb_nomor DESC
`;

    const filterStatus = status === "OPEN" || status === "PENDING" ? "N" : "Y";
    const [masterResults] = await pool.query(sqlMaster, [
      startDate,
      endDate,
      filterStatus,
    ]);

    // Jika tidak ada hasil header, segera kembalikan array kosong
    const masterNomors = masterResults.map((row) => row.Nomor);
    if (masterNomors.length === 0) return [];

    // --- 2. AMBIL DETAIL (Menggunakan IN (?)) ---
    const sqlDetail = `
    SELECT
        mbd_mb_nomor AS Nomor, 
        mbd_spk_nomor AS Nomor_SPK, 
        TRIM(spk_nama) AS spk_nama,
        brg_kode AS Kode, 
        TRIM(brg_nama) AS Nama_Bahan, 
        mbd_qty AS Jumlah,
        mbd_brg_satuan AS Satuan, 
        brg_panjang AS Panjang, 
        brg_lebar AS Lebar,
        brg_satuan_harga
    FROM tmintabahan_mmt_dtl
    LEFT JOIN tbarang_mmt ON mbd_brg_kode = brg_kode
            LEFT JOIN (SELECT spk_nomor, spk_nama FROM tspk UNION ALL SELECT mspk_nomor, mspk_nama from tmemospk) x ON x.spk_nomor=mbd_spk_nomor
            WHERE mbd_mb_nomor IN (?)
            
            ORDER BY mbd_mb_nomor, mbd_nourut;
        `;
    const [detailResults] = await pool.query(sqlDetail, [masterNomors]);

    // --- 3. GABUNGKAN HEADER DAN DETAIL ---
    const dataMap = new Map();
    // Isi map dengan data header, inisialisasi Detail[]
    masterResults.forEach((item) =>
      dataMap.set(item.Nomor, { ...item, Detail: [] }),
    );

    // Masukkan detail ke header yang sesuai
    detailResults.forEach((detail) => {
      if (dataMap.has(detail.Nomor)) {
        dataMap.get(detail.Nomor).Detail.push(detail);
      }
    });

    // Kembalikan array hasil gabungan
    return Array.from(dataMap.values());
  } catch (error) {
    throwDbError("Gagal mengambil data Permintaan Bahan untuk Lookup", error);
  }
};

exports.deletePermintaanBahan = async (nomor) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Hapus Detail
    await connection.query(
      "DELETE FROM tmintabahan_mmt_dtl WHERE mbd_mb_nomor = ?",
      [nomor],
    );

    // 2. Hapus Header
    const [result] = await connection.query(
      "DELETE FROM tmintabahan_mmt_hdr WHERE mb_nomor = ?",
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

exports.generateMaxKode = async (tanggal, gudangKode) => {
  // 1. Tentukan Prefix berdasarkan Gudang
  // Jika WH-20 maka MO, selain itu MMT.MB
  const NOMERATOR = gudangKode === "WH-20" ? "MO" : "MMT.MB";

  const yyMm = format(new Date(tanggal), "yyMM");
  const prefix = `${NOMERATOR}.${yyMm}.%`;

  // 2. Cari nomor terakhir dengan prefix tersebut
  const sql = `
        SELECT MAX(CAST(RIGHT(mb_nomor, 4) AS UNSIGNED)) AS max_num 
        FROM tmintabahan_mmt_hdr 
        WHERE mb_nomor LIKE ?
    `;

  const [rows] = await pool.query(sql, [prefix]);

  const maxNum = rows[0].max_num ? parseInt(rows[0].max_num) : 0;
  const nextNumber = maxNum + 1;
  const paddedNextNumber = String(nextNumber).padStart(4, "0");

  return `${NOMERATOR}.${yyMm}.${paddedNextNumber}`;
};
// ===================================
// SAVE (Insert / Update) - saveMintaMmt
// ===================================

exports.savePermintaanBahan = async (data, nomorToEdit, userLogin) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const serverTime = format(new Date(), "yyyy-MM-dd HH:mm:ss");
    const isUpdating = !!nomorToEdit;
    const isWH20 = data.GudangKode === "WH-20";

    // 1. GENERATE NOMOR
    let currentNomor = nomorToEdit;
    if (!isUpdating) {
      currentNomor = await exports.generateMaxKode(
        data.Tanggal,
        data.GudangKode,
      );
    }

    // 2. LOGIKA PENGAJUAN / MPPB (SINKRONISASI ACC STATUS)
    // 🚀 Solusi: Ambil nilai default dari payload frontend terlebih dahulu
    let accStatus = data.AccSpv === "Y" ? "Y" : "N";
    let accUser = data.AccSpvUser || null;

    // Jika ada referensi NoPengajuan, lakukan validasi database seperti biasa
    if (data.NoPengajuan) {
      const [rows] = await connection.query(
        `SELECT pp_acc_req, pp_acc_req_user FROM tpengajuan_permintaan_hdr WHERE pp_nomor = ? LIMIT 1`,
        [data.NoPengajuan],
      );
      if (rows.length && rows[0].pp_acc_req === "Y") {
        accStatus = "Y";
        accUser = rows[0].pp_acc_req_user;
      } else {
        accStatus = "N";
        accUser = null;
      }
    }

    // 3. SEPARASI PENYIMPANAN
    if (isWH20) {
      // --- LOGIKA TABEL TOBAT (WH-20) ---
      if (isUpdating) {
        await connection.query(
          `
                    UPDATE tobatmintabeli_hdr SET
                        mb_tanggal = ?, mb_ket = ?, mb_status = ?, mb_mintake = ?, 
                        date_modified = ?, user_modified = ?
                    WHERE mb_nomor = ?
                `,
          [
            data.Tanggal,
            data.Keterangan,
            "OPEN",
            data.PabrikKode || "",
            serverTime,
            userLogin,
            currentNomor,
          ],
        );

        await connection.query(
          "DELETE FROM tobatmintabeli_dtl WHERE mbd_nomor = ?",
          [currentNomor],
        );
      } else {
        await connection.query(
          `
                    INSERT INTO tobatmintabeli_hdr 
                    (mb_nomor, mb_tanggal, mb_ket, mb_status, mb_mintake, date_create, user_create) 
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `,
          [
            currentNomor,
            data.Tanggal,
            data.Keterangan,
            "OPEN",
            data.PabrikKode || "",
            serverTime,
            userLogin,
          ],
        );
      }

      if (Array.isArray(data.Detail) && data.Detail.length > 0) {
        const detailValues = data.Detail.filter((d) => d.SKU || d.KodeObat).map(
          (item, index) => [
            currentNomor,
            item.SKU || item.KodeObat,
            parseFloat(item.QTY || item.Jumlah) || 0,
            item.KeteranganItem || item.Keterangan || "",
            index + 1,
          ],
        );

        if (detailValues.length > 0) {
          await connection.query(
            `
                        INSERT INTO tobatmintabeli_dtl (mbd_nomor, mbd_o_kode, mbd_jumlah, mbd_ket, mbd_nourut) 
                        VALUES ?
                    `,
            [detailValues],
          );
        }
      }
    } else {
      // --- LOGIKA TABEL MMT (WH-16 / Lainnya) ---
      if (isUpdating) {
        await connection.query(
          `
                    UPDATE tmintabahan_mmt_hdr SET
                        mb_gdg_kode = ?, mb_tanggal = ?, mb_to_user = ?, mb_to_cab = ?,
                        mb_priority = ?, mb_keterangan = ?, mb_acc_req = ?, mb_acc_req_user = ?,
                        mb_pp_nomor = ?, date_modified = ?, user_modified = ?
                    WHERE mb_nomor = ?
                `,
          [
            data.GudangKode,
            data.Tanggal,
            data.Kepada,
            data.Cabang,
            data.Priority,
            data.Keterangan,
            accStatus,
            accUser,
            data.NoPengajuan || null,
            serverTime,
            userLogin,
            currentNomor,
          ],
        );

        await connection.query(
          "DELETE FROM tmintabahan_mmt_dtl WHERE mbd_mb_nomor = ?",
          [currentNomor],
        );
      } else {
        await connection.query(
          `
                    INSERT INTO tmintabahan_mmt_hdr 
                    (mb_nomor, mb_tanggal, mb_gdg_kode, mb_to_user, mb_to_cab, mb_priority, 
                     mb_keterangan, mb_pp_nomor, date_create, user_create, mb_acc_req, mb_acc_req_user) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
          [
            currentNomor,
            data.Tanggal,
            data.GudangKode,
            data.Kepada,
            data.Cabang,
            data.Priority,
            data.Keterangan,
            data.NoPengajuan || null,
            serverTime,
            userLogin,
            accStatus,
            accUser,
          ],
        );
      }

      // Simpan Detail MMT
      if (Array.isArray(data.Detail) && data.Detail.length > 0) {
        const detailValues = data.Detail.filter(
          (d) => d.SKU && (d.QTY || d.Jumlah) > 0,
        ).map((d, index) => [
          currentNomor,
          d.spk || d.SPK || null,
          d.sku || d.SKU,
          d.satuan || d.Satuan,
          parseFloat(d.qty || d.QTY || d.Jumlah),
          d.keterangan || d.KeteranganItem || null,
          index + 1,
          // 🚀 Solusi Detail: Jika NoPengajuan kosong, percayakan status IsAcc tiap baris item dari frontend payload
          data.NoPengajuan ? accStatus : d.IsAcc === "Y" ? "Y" : "N",
        ]);

        if (detailValues.length > 0) {
          await connection.query(
            `
                        INSERT INTO tmintabahan_mmt_dtl 
                        (mbd_mb_nomor, mbd_spk_nomor, mbd_brg_kode, mbd_brg_satuan, mbd_qty, mbd_keterangan, mbd_nourut, mbd_acc) 
                        VALUES ?
                    `,
            [detailValues],
          );
        }
      }
    }

    await connection.commit();
    return { success: true, Nomor: currentNomor };
  } catch (error) {
    await connection.rollback();
    console.error("Error in savePermintaanBahan Gabungan:", error);
    throw error;
  } finally {
    connection.release();
  }
};

exports.getPermintaanBahanForPrint = async (nomor) => {
  try {
    const sqlHeader = `
            SELECT
                t1.mb_nomor AS NoPermintaan,
                IFNULL(CONCAT(t1.mb_to_user, ' - ', t1.mb_to_cab), t1.mb_to_cab) AS Kepada,
                t1.mb_priority AS Priority,
                t1.mb_keterangan AS Keterangan,
                DATE_FORMAT(t1.mb_tanggal, '%d/%m/%Y') AS Tanggal, 
                
                -- MAPPING SESUAI REQUEST
                IFNULL(u1.user_nama, t1.user_create) AS Dibuat, 
                IFNULL(u2.user_nama, t1.mb_acc_req_user) AS Diketahui,
                IFNULL(u3.user_nama, t1.mb_acc_user) AS Disetujui
                
            FROM tmintabahan_mmt_hdr t1
            LEFT JOIN tuser u1 ON t1.user_create = u1.user_kode
            LEFT JOIN tuser u2 ON t1.mb_acc_req_user = u2.user_kode
            LEFT JOIN tuser u3 ON t1.mb_acc_user = u3.user_kode
            WHERE t1.mb_nomor = ?;
        `;

    const [headerResult] = await pool.query(sqlHeader, [nomor]);
    if (headerResult.length === 0) throw new Error("Data tidak ditemukan.");

    const header = headerResult[0];

    // Query Detail (Tetap sama seperti sebelumnya)
    const sqlDetail = `
            SELECT
                mbd_nourut AS No, mbd_spk_nomor AS SPK, 
                IF(brg_panjang IS NULL, TRIM(brg_nama), CONCAT(TRIM(brg_nama), ' (', brg_panjang, ' x ', brg_lebar, ')')) AS Jenis,
                mbd_keterangan AS Keterangan, mbd_acc AS Is_Acc,
                mbd_brg_satuan AS Satuan,
                mbd_qty AS QTY,
                CONCAT(mbd_qty, ' ', mbd_brg_satuan) AS Jumlah
            FROM tmintabahan_mmt_dtl
            LEFT JOIN tbarang_mmt ON mbd_brg_kode = brg_kode
            WHERE mbd_mb_nomor = ?
            ORDER BY mbd_nourut;
        `;
    const [detailResults] = await pool.query(sqlDetail, [nomor]);

    return {
      ...header,
      Details: detailResults,
      // Fallback jika nama kosong agar tampilan cetak rapi
      Dibuat: header.Dibuat || "................",
      Diketahui: header.Diketahui || "................",
      Disetujui: header.Disetujui || "................",
    };
  } catch (error) {
    throwDbError(`Gagal mengambil data cetak`, error);
  }
};

// backend/src/services/permintaanBahan.service.js

exports.approveByManager = async (nomor, userKD, itemApprovals) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Update Header: Set Manager ACC = 'Y'
    const sqlHeader = `
            UPDATE tmintabahan_mmt_hdr 
            SET mb_acc = 'Y', mb_acc_user = ?, date_modified = NOW() 
            WHERE mb_nomor = ? AND mb_acc_req = 'Y'
        `;
    const [headerResult] = await connection.query(sqlHeader, [userKD, nomor]);

    if (headerResult.affectedRows === 0) {
      throw new Error(
        "Gagal ACC Header. Pastikan SPV sudah melakukan ACC terlebih dahulu.",
      );
    }

    // 2. Update Detail: Loop melalui item yang dikirim dari frontend
    // itemApprovals diharapkan berisi: [{ sku: 'A', isAcc: true }, { sku: 'C', isAcc: false }]
    if (itemApprovals && itemApprovals.length > 0) {
      const queries = itemApprovals.map((item) => {
        return connection.query(
          `UPDATE tmintabahan_mmt_dtl 
                     SET mbd_acc = ? 
                     WHERE mbd_mb_nomor = ? AND mbd_brg_kode = ?`,
          [item.isAcc ? "Y" : "N", nomor, item.sku],
        );
      });
      await Promise.all(queries);
    }

    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};
