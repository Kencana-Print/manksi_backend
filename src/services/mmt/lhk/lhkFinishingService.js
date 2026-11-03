// backend/services/lhkFinishing.service.js
const pool = require("../../../config/database");
const { format } = require("date-fns");

/**
 * Mengambil daftar master LHK Finishing
 * Menggunakan proteksi format tanggal seperti lhkCetak
 */
const getAllHeaders = async (startDate, endDate) => {
  try {
    const defaultStart = new Date();
    defaultStart.setDate(defaultStart.getDate() - 30);
    const tglMulai = startDate ? format(new Date(startDate), "yyyy-MM-dd") : format(defaultStart, "yyyy-MM-dd");
    const tglSelesai = endDate ? format(new Date(endDate), "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");
    const sql = `
            SELECT 
                t1.lfh_nomor AS Nomor, 
                DATE_FORMAT(t1.lfh_tanggal, '%Y-%m-%d') AS Tanggal, 
                t1.lfh_gdg_prod AS Gudang, 
                t2.gdg_nama AS Nama_Gudang, 
                t1.lfh_shift AS Shift,
                t1.lfh_user_create AS Operator,
                -- PERBAIKAN LOGIKA DI SINI:
                -- Jika lfh_acc sudah ada isinya, maka PASTI 'Y' (Lengkap).
                -- Jika belum ada lfh_acc, baru cek apakah ada data yang 'bad_items'.
                IF(t1.lfh_acc IS NOT NULL AND t1.lfh_acc != '', 'Y', 
                    IF(bad_items.lfd_lfh_nomor IS NOT NULL, 'N', 'Y')
                ) AS Lengkap
            FROM tlhk_finishingmmt_hdr t1
            LEFT JOIN tgudang t2 ON (t2.gdg_kode = t1.lfh_gdg_prod)
            LEFT JOIN (
                SELECT DISTINCT lfd_lfh_nomor 
                FROM tlhk_finishingmmt_dtl 
                WHERE 
                    (lfd_j_mataayam > 0 AND (lfd_mataayam_qty IS NULL OR lfd_mataayam_qty = 0)) 
                    OR (lfd_xbanner_qty > 0 AND (lfd_xbanner_qty IS NULL OR lfd_xbanner_qty = 0))
            ) AS bad_items ON t1.lfh_nomor = bad_items.lfd_lfh_nomor
            WHERE t1.lfh_tanggal BETWEEN ? AND ?
            ORDER BY t1.lfh_tanggal DESC, t1.lfh_nomor DESC
        `;

    const [rows] = await pool.query(sql, [tglMulai, tglSelesai]);
    return rows;
  } catch (error) {
    console.error("Error in getAllHeaders Finishing:", error);
    throw error;
  }
};

const searchSpkProgress = async (keyword) => {
  try {
    const searchPattern = `%${keyword}%`;
    const sql = `
            SELECT 
                s.spk_nomor AS Nomor_SPK,
                s.spk_nama AS Nama_SPK,
                IFNULL(s.spk_jumlah, 0) AS Qty_Order,
                IFNULL(SUM(d.lfd_j_potong), 0) AS Total_Potong,
                IFNULL(SUM(d.lfd_j_seaming), 0) AS Total_Seaming,
                IFNULL(SUM(d.lfd_j_mataayam), 0) AS Total_MataAyam,
                IFNULL(SUM(d.lfd_j_coly), 0) AS Total_Coly,
                IFNULL(SUM(d.lfd_j_bs), 0) AS Total_BS,
                -- Perhitungan Sisa (Qty Order - Total Coly/Finishing)
                (IFNULL(s.spk_jumlah, 0) - IFNULL(SUM(d.lfd_j_coly), 0)) AS Sisa_Kurang
            FROM (
                SELECT spk_nomor, spk_nama, spk_jumlah FROM tspk
                UNION ALL
                SELECT mspk_nomor AS spk_nomor, mspk_nama AS spk_nama, mspk_jumlah AS spk_jumlah FROM tmemospk
            ) s
            LEFT JOIN tlhk_finishingmmt_dtl d ON d.lfd_spk_nomor = s.spk_nomor
            WHERE s.spk_nomor LIKE ? OR s.spk_nama LIKE ?
            GROUP BY s.spk_nomor, s.spk_nama, s.spk_jumlah
            LIMIT 50
        `;

    const [rows] = await pool.query(sql, [searchPattern, searchPattern]);
    return rows;
  } catch (error) {
    console.error("Error searchSpkProgress:", error);
    throw error;
  }
};

const generateLhkNomor = async (conn, tanggal) => {
  const date = new Date(tanggal);
  const yearMonth = format(date, "yyMM"); // Hasil: 2512 (untuk Des 2025)
  const prefix = `MMT-LHK-F.${yearMonth}.`;

  // Cari nomor terakhir yang memiliki prefix yang sama
  const [lastNomor] = await conn.query(
    `SELECT lfh_nomor FROM tlhk_finishingmmt_hdr 
         WHERE lfh_nomor LIKE ? 
         ORDER BY lfh_nomor DESC LIMIT 1`,
    [`${prefix}%`],
  );

  let nextNumber = 1;
  if (lastNomor.length > 0) {
    // Ambil 4 digit terakhir dan tambah 1
    const lastFullNomor = lastNomor[0].lfh_nomor;
    const lastSequence = lastFullNomor.split(".").pop();
    nextNumber = parseInt(lastSequence) + 1;
  }

  // Format menjadi 4 digit (0010)
  const formattedSequence = nextNumber.toString().padStart(4, "0");
  return `${prefix}${formattedSequence}`;
};

/**
 * Modifikasi finalizeBundling untuk menggunakan penomoran otomatis
 */
const finalizeBundling = async (headerData, detailItems, userLogin) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const tglLhk = headerData.lfh_tanggal;
    let lfh_nomor = "";

    // 1. CEK ATAU BUAT HEADER (1 Hari 1 Nomor)
    const [existingHdr] = await conn.query(
      `SELECT lfh_nomor FROM tlhk_finishingmmt_hdr WHERE lfh_tanggal = ? LIMIT 1`,
      [tglLhk],
    );

    if (existingHdr.length > 0) {
      lfh_nomor = existingHdr[0].lfh_nomor;
    } else {
      lfh_nomor = await generateLhkNomor(conn, tglLhk);

      // Destructuring untuk menghapus field temporary dari frontend
      const { lfh_total_ma, lfh_total_koli, ...headerToInsert } = headerData;

      // Masukkan lfh_nomor dan lfh_user_create secara eksplisit
      const finalHeader = {
        ...headerToInsert,
        lfh_nomor: lfh_nomor,
        lfh_user_create: userLogin || headerData.lfh_user_create || "ADMIN",
      };

      await conn.query(`INSERT INTO tlhk_finishingmmt_hdr SET ?`, [
        finalHeader,
      ]);
    }

    const allOriginalIds = [];

    // 2. LOOP DETAIL ITEMS
    for (const item of detailItems) {
      const kategori = (item.proses_kategori || "")
        .toUpperCase()
        .replace(/\s+/g, "_");

      // PERBAIKAN: Pastikan ID yang di-push berupa tipe data Number/Integer agar query IN (?) tidak gagal
      if (item.ids) {
        const splitIds = String(item.ids)
          .split(",")
          .map((id) => Number(id.trim()))
          .filter((id) => !isNaN(id));
        allOriginalIds.push(...splitIds);
      } else if (item.id) {
        allOriginalIds.push(Number(item.id));
      }

      // Tentukan kolom mana yang akan diupdate berdasarkan kategori proses
      let kolomTarget = "";
      if (kategori === "POTONG") kolomTarget = "lfd_j_potong";
      else if (kategori === "SEAMING") kolomTarget = "lfd_j_seaming";
      else if (kategori === "MATA_AYAM") kolomTarget = "lfd_j_mataayam";
      else if (kategori === "KOLI") kolomTarget = "lfd_j_coly";
      else if (kategori === "X_BANNER") kolomTarget = "lfd_xbanner_qty";
      else if (kategori === "ROLLUP_BANNER")
        kolomTarget = "lfd_rollupbanner_qty";

      const qtyHasil = Number(item.qty_hasil) || 0;
      const qtyBs = Number(item.qty_bs) || 0;
      const qtyMa =
        kategori === "MATA_AYAM" ? Number(item.jml_mata_ayam) || 0 : 0;
      const qtyKr = kategori === "KOLI" ? Number(item.jml_koli) || 0 : 0;

      // 3. CEK APAKAH SPK INI SUDAH ADA DI DETAIL LHK TERSEBUT
      const [existingDtl] = await conn.query(
        `SELECT lfd_spk_nomor FROM tlhk_finishingmmt_dtl 
                 WHERE lfd_lfh_nomor = ? AND lfd_spk_nomor = ?`,
        [lfh_nomor, item.spk_nomor],
      );

      if (existingDtl.length > 0) {
        // --- JIKA SUDAH ADA: UPDATE ---
        // Pastikan kolomTarget valid sebelum digabungkan ke query string untuk menghindari SQL Injection
        const setKolomTarget = kolomTarget
          ? `${kolomTarget} = ${kolomTarget} + ?,`
          : "";

        const sqlUpdate = `
                    UPDATE tlhk_finishingmmt_dtl 
                    SET ${setKolomTarget}
                        lfd_j_bs = lfd_j_bs + ?,
                        lfd_mataayam_qty = lfd_mataayam_qty + ?,
                        lfd_karung_qty = lfd_karung_qty + ?
                    WHERE lfd_lfh_nomor = ? AND lfd_spk_nomor = ?
                `;

        const updateValues = [];
        if (kolomTarget) updateValues.push(qtyHasil);
        updateValues.push(qtyBs, qtyMa, qtyKr, lfh_nomor, item.spk_nomor);

        await conn.query(sqlUpdate, updateValues);
      } else {
        // --- JIKA BELUM ADA: INSERT BARU ---
        const [lastSeq] = await conn.query(
          `SELECT MAX(lfd_no_urut) as last_urut FROM tlhk_finishingmmt_dtl WHERE lfd_lfh_nomor = ?`,
          [lfh_nomor],
        );
        const nextUrut = (lastSeq[0].last_urut || 0) + 1;

        const sqlInsert = `
                    INSERT INTO tlhk_finishingmmt_dtl (
                        lfd_lfh_nomor, lfd_spk_nomor, lfd_j_potong, lfd_j_seaming, 
                        lfd_j_mataayam, lfd_j_coly, lfd_xbanner_qty, lfd_rollupbanner_qty, 
                        lfd_j_bs, lfd_no_urut, lfd_mataayam_qty, lfd_karung_qty
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;

        const values = [
          lfh_nomor,
          item.spk_nomor,
          kategori === "POTONG" ? qtyHasil : 0,
          kategori === "SEAMING" ? qtyHasil : 0,
          kategori === "MATA_AYAM" ? qtyHasil : 0,
          kategori === "KOLI" ? qtyHasil : 0,
          kategori === "X_BANNER" ? qtyHasil : 0,
          kategori === "ROLLUP_BANNER" ? qtyHasil : 0,
          qtyBs,
          nextUrut,
          qtyMa,
          qtyKr,
        ];
        await conn.query(sqlInsert, values);
      }

      // 4. LOGIKA POTONG STOK (Mata Ayam / Karung Koli)
      let qtyPakaiStok =
        kategori === "MATA_AYAM" ? qtyMa : kategori === "KOLI" ? qtyKr : 0;
      if (qtyPakaiStok > 0 && item.material_kode) {
        const dataStokOut = {
          mst_brg_kode: item.material_kode, // Menggunakan prefix brg_ sesuai standardisasi backend baru
          mst_gdg_kode: "GPM",
          mst_barcode: "-",
          mst_stok_in: 0,
          mst_stok_out: qtyPakaiStok,
          mst_spk_nomor: item.spk_nomor,
          mst_noreferensi: lfh_nomor,
          mst_tanggal: tglLhk,
          date_create: new Date(),
        };
        await conn.query(`INSERT INTO tmasterstok_mmt SET ?`, [dataStokOut]);
      }

      // OPTIONAL: Jika proses Cetak/Potong menghasilkan BS dan mengurangi bahan MMT utama,
      // Anda bisa menyisipkan query potong stok tambahan untuk `qtyBs` di sini apabila diperlukan.
    }

    // 5. UPDATE STATUS DI TABEL PRA-LHK
    if (allOriginalIds.length > 0) {
      await conn.query(
        `UPDATE tpra_lhk_finishing SET is_bundled = 1, lfh_nomor = ? WHERE id IN (?)`,
        [lfh_nomor, allOriginalIds],
      );
    }

    await conn.commit();
    return { success: true, nomor: lfh_nomor };
  } catch (error) {
    if (conn) await conn.rollback();
    console.error("Error Finalize Finishing:", error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
};
/**
 * Mengambil detail item LHK Finishing
 */
const getDetailsByNomor = async (nomor) => {
  try {
    const sql = `
            SELECT 
                a.lfd_lfh_nomor AS Nomor, 
                a.lfd_spk_nomor AS Nomor_SPK,
                s.spk_nama AS Nama_SPK, 
                IFNULL(s.spk_panjang, 0) AS Panjang, 
                IFNULL(s.spk_lebar, 0) AS Lebar, 
                IFNULL(s.spk_jumlah, 0) AS J_Order,
                a.lfd_j_seaming AS J_Seaming,
                a.lfd_j_mataayam AS J_MataAyam,
                a.lfd_j_coly AS J_Coly,
                a.lfd_j_bs AS J_Bs,
                a.lfd_j_lebihcetak AS J_LebihCetak,
                a.lfd_mataayam_qty AS Mata_Ayam,
                a.lfd_xbanner_qty AS XBanner,
                a.lfd_plastik_qty AS Plastik,
                a.lfd_karung_qty AS karung,
                a.lfd_rollupbanner_qty AS Rullup_Banner,
                a.lfd_no_urut AS No_Urut
            FROM tlhk_finishingmmt_dtl a
            LEFT JOIN (
                SELECT spk_nomor, spk_nama, spk_jumlah, spk_panjang, spk_lebar FROM tspk
                UNION ALL
                SELECT mspk_nomor, mspk_nama, mspk_jumlah, mspk_panjang, mspk_lebar FROM tmemospk
            ) s ON (s.spk_nomor = a.lfd_spk_nomor)
            WHERE a.lfd_lfh_nomor = ?
            ORDER BY a.lfd_no_urut ASC
        `;

    const [rows] = await pool.query(sql, [nomor]);
    return rows;
  } catch (error) {
    console.error("Error getDetailsByNomor Finishing:", error);
    throw new Error(`Gagal mengambil detail Finishing: ${error.message}`);
  }
};

const getLhkFinishingByNomor = async (nomor) => {
  try {
    // 1. Ambil Data Header
    const sqlHeader = `
            SELECT 
                t1.lfh_nomor AS Nomor, 
                t1.lfh_tanggal AS Tanggal, 
                t1.lfh_gdg_prod AS Gudang_Kode, 
                t2.gdg_nama AS Nama_Gudang, 
                t1.lfh_shift AS Shift,
                t1.lfh_user_create AS Operator,
                t1.lfh_acc AS Acc_User,
                t1.lfh_date_acc AS Acc_Date
            FROM tlhk_finishingmmt_hdr t1
            LEFT JOIN tgudang t2 ON (t2.gdg_kode = t1.lfh_gdg_prod)
            WHERE t1.lfh_nomor = ?;
        `;
    const [headerResults] = await pool.query(sqlHeader, [nomor]);

    if (headerResults.length === 0) {
      throw new Error(`LHK Finishing dengan nomor ${nomor} tidak ditemukan.`);
    }

    const headerData = headerResults[0];

    // 2. Ambil Data Detail
    const sqlDetail = `
            SELECT 
                a.lfd_no_urut AS NoUrut,
                a.lfd_spk_nomor AS Nomor_SPK,
                (SELECT TRIM(spk_nama) FROM tspk WHERE spk_nomor = a.lfd_spk_nomor 
                 UNION ALL 
                 SELECT TRIM(mspk_nama) FROM tmemospk WHERE mspk_nomor = a.lfd_spk_nomor) AS Nama_SPK,
                (SELECT spk_panjang FROM tspk WHERE spk_nomor = a.lfd_spk_nomor 
                 UNION ALL 
                 SELECT mspk_panjang FROM tmemospk WHERE mspk_nomor = a.lfd_spk_nomor) AS Panjang,
                (SELECT spk_lebar FROM tspk WHERE spk_nomor = a.lfd_spk_nomor 
                 UNION ALL 
                 SELECT mspk_lebar FROM tmemospk WHERE mspk_nomor = a.lfd_spk_nomor) AS Lebar,
                (SELECT spk_jumlah FROM tspk WHERE spk_nomor = a.lfd_spk_nomor 
                 UNION ALL 
                 SELECT mspk_jumlah FROM tmemospk WHERE mspk_nomor = a.lfd_spk_nomor) AS J_Order,
                a.lfd_j_potong AS J_Potong,
                a.lfd_j_seaming AS J_Seaming,
                a.lfd_j_mataayam AS J_MataAyam,
                a.lfd_j_coly AS J_Coly,
                a.lfd_j_bs AS J_Bs,
                a.lfd_mataayam_qty AS Mata_Ayam,
                a.lfd_xbanner_qty AS XBanner,
                a.lfd_plastik_qty AS Plastik,
                a.lfd_karung_qty AS Karung,
                a.lfd_rollupbanner_qty AS Rollup_Banner
            FROM tlhk_finishingmmt_dtl a
            WHERE a.lfd_lfh_nomor = ?
            ORDER BY a.lfd_no_urut;
        `;
    const [detailResults] = await pool.query(sqlDetail, [nomor]);

    // 3. Gabungkan dan Kembalikan
    return {
      ...headerData,
      Detail: detailResults,
    };
  } catch (error) {
    console.error(`Error in getLhkFinishingByNomor (${nomor}):`, error);
    throw error;
  }
};

/**
 * Menghapus data LHK Finishing
 */
const deleteLhk = async (nomor) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      "DELETE FROM tlhk_finishingmmt_dtl WHERE lfd_lfh_nomor = ?",
      [nomor],
    );
    const [resHdr] = await conn.query(
      "DELETE FROM tlhk_finishingmmt_hdr WHERE lfh_nomor = ?",
      [nomor],
    );

    if (resHdr.affectedRows === 0) {
      throw new Error("Data tidak ditemukan.");
    }

    await conn.commit();
    return { success: true, message: "Berhasil dihapus." };
  } catch (error) {
    if (conn) await conn.rollback();
    throw error;
  } finally {
    if (conn) conn.release();
  }
};

const savePraLhk = async (details, userLogin) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const sql = `
            INSERT INTO tpra_lhk_finishing (
                spk_nomor, 
                spk_nama, 
                proses_kategori, 
                qty_hasil, 
                qty_bs, 
                jml_mata_ayam,
                jml_koli,
                material_kode, 
                tgl_input, 
                shift_input, 
                input_by, 
                is_bundled
            ) VALUES ?
        `;

    // Map data dari frontend ke format array of arrays
    const values = details.map((d) => [
      d.spk_nomor,
      d.spk_nama,
      d.proses_kategori,
      d.qty_hasil || 0,
      d.qty_bs || 0,
      d.jml_mata_ayam || 0,
      d.jml_koli || 0,
      d.material_kode || null,
      d.tgl_input,
      d.shift_input,
      userLogin, // Menggunakan variabel userLogin dari parameter fungsi
      false,
    ]);

    if (values.length > 0) {
      await conn.query(sql, [values]);
    }

    await conn.commit();

    return {
      success: true,
      message: `${details.length} data berhasil disimpan ke Pra-LHK`,
    };
  } catch (error) {
    if (conn) await conn.rollback();
    console.error("Error savePraLhk:", error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
};

const getUnassignedPraLhk = async (tanggal, shift, proses) => {
  try {
    let sql = `
            SELECT 
                GROUP_CONCAT(id) as ids, 
                spk_nomor, 
                spk_nama, 
                proses_kategori, 
                SUM(qty_hasil) as qty_hasil, 
                SUM(qty_bs) as qty_bs, 
                MAX(material_kode) as material_kode,
                SUM(jml_mata_ayam) as jml_mata_ayam, -- TAMBAHKAN INI
                SUM(jml_koli) as jml_koli, 
                tgl_input, 
                shift_input
            FROM tpra_lhk_finishing
            WHERE is_bundled = 0
        `;

    const params = [];
    if (tanggal) {
      sql += ` AND tgl_input = ?`;
      params.push(tanggal);
    }
    if (shift) {
      sql += ` AND shift_input = ?`;
      params.push(shift);
    }
    if (proses) {
      sql += ` AND proses_kategori = ?`;
      params.push(proses);
    }

    // PERBAIKAN: Masukkan SEMUA kolom non-agregat ke dalam GROUP BY
    sql += ` GROUP BY 
                    spk_nomor, 
                    spk_nama, 
                    proses_kategori, 
                    tgl_input, 
                    shift_input`;

    sql += ` ORDER BY spk_nomor ASC`;

    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (error) {
    console.error("Error getUnassignedPraLhk:", error);
    throw error;
  }
};
/**
 * Menghapus data pra-lhk jika ada kesalahan input (sebelum bundling)
 */
const deletePraLhk = async (id) => {
  try {
    const [res] = await pool.query(
      "DELETE FROM tpra_lhk_finishing WHERE id = ? AND is_bundled = 0",
      [id],
    );
    if (res.affectedRows === 0)
      throw new Error("Data tidak ditemukan atau sudah di-bundling.");
    return { success: true };
  } catch (error) {
    throw error;
  }
};

const getPendingPotong = async (targetProses) => {
  try {
    // Query yang lebih sederhana namun tetap akurat
    const sql = `
            SELECT 
                p.spk_nomor, 
                p.spk_nama, 
                p.qty_hasil, 
                s.spk_panjang as panjang,
                s.spk_lebar as lebar,
                s.spk_jumlah as qty_order
            FROM tpra_lhk_finishing p
            LEFT JOIN (
                SELECT spk_nomor, spk_panjang, spk_lebar, spk_jumlah FROM tspk
                UNION ALL
                SELECT mspk_nomor, mspk_panjang, mspk_lebar, mspk_jumlah FROM tmemospk
            ) s ON p.spk_nomor = s.spk_nomor
            WHERE p.proses_kategori = 'POTONG' 
            AND p.is_bundled = 0 
            AND NOT EXISTS (
                SELECT 1 FROM tpra_lhk_finishing p2 
                WHERE p2.spk_nomor = p.spk_nomor 
                AND p2.proses_kategori = ? 
                AND p2.is_bundled = 0
            )
        `;

    const [rows] = await pool.query(sql, [targetProses]);
    return rows;
  } catch (error) {
    console.error("Error getPendingPotong:", error);
    throw error;
  }
};

const approveAcc = async (nomor, detailItems, userLogin) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Update Header: Isi kolom lfh_acc dengan user yang login
    // Diasumsikan kolom lfh_acc ada di tabel hdr
    const sqlHeader = `
            UPDATE tlhk_finishingmmt_hdr 
            SET lfh_acc = ?, 
                lfh_date_acc = NOW() 
            WHERE lfh_nomor = ?
        `;
    await conn.query(sqlHeader, [userLogin, nomor]);

    // 2. Update Detail: Hapus detail lama dan insert yang baru hasil verifikasi
    // Cara ini lebih aman jika ada penambahan SPK baru saat proses ACC
    await conn.query(
      `DELETE FROM tlhk_finishingmmt_dtl WHERE lfd_lfh_nomor = ?`,
      [nomor],
    );

    const sqlInsertDtl = `
            INSERT INTO tlhk_finishingmmt_dtl (
                lfd_lfh_nomor, lfd_spk_nomor, lfd_j_potong, lfd_j_seaming, 
                lfd_j_mataayam, lfd_j_coly, lfd_j_bs, 
                lfd_no_urut, lfd_mataayam_qty, lfd_xbanner_qty, lfd_plastik_qty, lfd_karung_qty, lfd_rollupbanner_qty
            ) VALUES ?
        `;

    const detailValues = detailItems.map((d, index) => [
      nomor,
      d.spk_nomor,
      Number(d.j_potong) || 0,
      Number(d.j_seaming) || 0,
      Number(d.j_mataayam) || 0,
      Number(d.j_coly) || 0,
      Number(d.j_bs) || 0,
      index + 1,
      Number(d.mata_ayam_qty) || 0,
      Number(d.xbanner_qty) || 0,
      Number(d.plastik_qty) || 0,
      Number(d.karung_qty) || 0,
      Number(d.rollupbanner_qty) || 0,
    ]);

    if (detailValues.length > 0) {
      await conn.query(sqlInsertDtl, [detailValues]);
    }

    await conn.commit();
    return { success: true, message: `LHK ${nomor} berhasil di-ACC.` };
  } catch (error) {
    if (conn) await conn.rollback();
    console.error("Error in approveAcc Service:", error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
};

const updateLhk = async (nomor, detailItems, userLogin) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // LOGGING UNTUK DEBUG (Opsional, hapus jika sudah jalan)
    console.log("Updating Nomor:", nomor);

    // 1. Hapus detail lama
    await conn.query(
      `DELETE FROM tlhk_finishingmmt_dtl WHERE lfd_lfh_nomor = ?`,
      [nomor],
    );

    // 2. Siapkan data baru
    // Pastikan variabel 'nomor' (parameter fungsi) digunakan di index pertama [nomor, ...]
    const detailValues = detailItems.map((d, index) => [
      nomor, // <--- INI HARUS TERISI
      d.spk_nomor,
      Number(d.j_potong) || 0,
      Number(d.j_seaming) || 0,
      Number(d.j_mataayam) || 0,
      Number(d.j_coly) || 0,
      Number(d.j_bs) || 0,
      index + 1,
      Number(d.mata_ayam_qty) || 0,
      Number(d.xbanner_qty) || 0,
      Number(d.plastik_qty) || 0,
      Number(d.karung_qty) || 0,
      Number(d.rollupbanner_qty) || 0,
    ]);

    if (detailValues.length > 0) {
      const sqlInsertDtl = `
                INSERT INTO tlhk_finishingmmt_dtl (
                    lfd_lfh_nomor, lfd_spk_nomor, lfd_j_potong, lfd_j_seaming, 
                    lfd_j_mataayam, lfd_j_coly, lfd_j_bs, 
                    lfd_no_urut, lfd_mataayam_qty, lfd_xbanner_qty, lfd_plastik_qty, lfd_karung_qty, lfd_rollupbanner_qty
                ) VALUES ?
            `;
      await conn.query(sqlInsertDtl, [detailValues]);
    }

    await conn.commit();
    return { success: true, message: `LHK ${nomor} berhasil diupdate.` };
  } catch (error) {
    if (conn) await conn.rollback();
    throw error;
  } finally {
    if (conn) conn.release();
  }
};

module.exports = {
  getAllHeaders,
  getDetailsByNomor,
  searchSpkProgress,
  deleteLhk,
  savePraLhk,
  getUnassignedPraLhk,
  deletePraLhk,
  finalizeBundling,
  getPendingPotong,
  getLhkFinishingByNomor,
  approveAcc,
  updateLhk,
};
