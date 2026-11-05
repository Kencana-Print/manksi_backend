// backend/src/services/poExternal.service.js
const pool = require("../../../config/database");
const { getDataMode } = require("../../../config/database");

/**
 * Mendapatkan daftar PO dengan logika warna/status seperti di Delphi
 */
const getPoExternalBrowse = async (startDate, endDate, userCab) => {
  // Guard: tanggal kosong/invalid TIDAK boleh jadi klausa zero-date —
  // filter tanggal di-skip (tanpa filter) bila tidak valid.
  const isDateStr = (v) =>
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    !Number.isNaN(Date.parse(v));
  const dateConds = [];
  const params = [];
  if (isDateStr(startDate)) {
    dateConds.push("h.poe_tanggal >= ?");
    params.push(startDate);
  }
  if (isDateStr(endDate)) {
    dateConds.push("h.poe_tanggal <= ?");
    params.push(endDate);
  }
  // Menyelaraskan query asli Delphi menggunakan klause IF() bertingkat pada tspk_pin5
  const sql = `
        SELECT x.*,
        IFNULL((
            SELECT 
                IF(pin_acc = '' AND pin_dipakai = '', 'WAIT',
                IF(pin_acc = 'Y' AND pin_dipakai = '', 'ACC',
                IF(pin_acc = 'Y' AND pin_dipakai = 'Y', '',
                IF(pin_acc = 'N', 'TOLAK', ''))))
            FROM tspk_pin5 
            WHERE pin_trs = "PO EXT MMT" AND pin_nomor = x.Nomor 
            ORDER BY pin_urut DESC LIMIT 1
        ), "") AS Ngedit
        FROM (
            SELECT 
                h.poe_nomor AS Nomor, h.poe_tanggal AS Tanggal, h.poe_dateline AS DateLinePO,
                h.poe_cab AS Cab, h.poe_spk_nomor AS SPK, s.spk_nama AS NamaSPK,
                h.poe_sup AS KdSup, u.Sup_nama AS Supplier, h.poe_jumlah AS QtyPO,
                (SELECT IFNULL(SUM(hh.bpe_jumlah), 0) FROM tbpbpoexternal_hdr hh WHERE hh.bpe_po = h.poe_nomor) AS QtyBPB,
                h.poe_total AS Nominal,
                (SELECT IFNULL(SUM(c.poed2_nominal), 0) FROM tpoexternal_dtl2 c WHERE c.poed2_nomor = h.poe_nomor) AS DP,
                (SELECT IFNULL(SUM(v.voud_total), 0) FROM tvoucher_dtl v WHERE v.voud_nota = h.poe_nomor) AS Voucher,
                h.poe_status AS Status, h.user_create AS Usr, h.date_create AS Created
            FROM tpoexternal_hdr h
            LEFT JOIN tspk s ON s.spk_nomor = h.poe_spk_nomor
            LEFT JOIN tsupplier u ON u.Sup_kode = h.poe_sup
            WHERE 1=1
            ${dateConds.length ? "AND " + dateConds.join(" AND ") : ""}
            AND h.poe_cab IN ('P02', 'P05', 'MT1')
            ${userCab ? "AND h.poe_cab = ?" : ""}
        ) x
        ORDER BY x.Nomor DESC
    `;

  if (userCab) params.push(userCab);

  const [rows] = await pool.query(sql, params);
  return rows;
};

/**
 * Logika Hapus dengan Proteksi Ketat (Sama dengan cxButton4Click di Delphi)
 */
const deletePoExternal = async (nomor, userCab) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Ambil data Header & Sub-query status relasi transaksional
    const [rows] = await connection.query(
      `SELECT poe_tanggal, poe_status, poe_cab,
            (SELECT IFNULL(SUM(bpe_jumlah), 0) FROM tbpbpoexternal_hdr WHERE bpe_po = poe_nomor) as QtyBPB,
            (SELECT IFNULL(SUM(voud_total), 0) FROM tvoucher_dtl WHERE voud_nota = poe_nomor) as Voucher
            FROM tpoexternal_hdr WHERE poe_nomor = ?`,
      [nomor],
    );

    if (rows.length === 0) throw new Error("Data tidak ditemukan");
    const data = rows[0];

    // 2. Validasi Hak Otoritas Cabang
    if (userCab && data.poe_cab !== userCab)
      throw new Error("Bukan data cabang anda");

    // 3. Validasi Batas Penguncian Periode (Closing Aturan Bulanan Delphi)
    const tgl = new Date(data.poe_tanggal);
    const limitClose = new Date(tgl.getFullYear(), tgl.getMonth() + 1, 25);
    if (new Date() > limitClose)
      throw new Error("Transaksi tsb sudah close. Tidak bisa dihapus.");

    // 4. Cek Status Alur Dokumen Kerja
    if (data.poe_status !== "OPEN")
      throw new Error("PO tsb sudah di proses/close. Tidak bisa dihapus.");
    if (Number(data.QtyBPB) > 0)
      throw new Error("PO tsb sudah ada Penerimaan. Tidak bisa dihapus.");
    if (Number(data.Voucher) > 0)
      throw new Error(
        "PO tsb sudah ada dibuatkan Voucher pembayaran. Tidak bisa dihapus.",
      );

    // 5. Eksekusi Penghapusan Data Cascading Manual (Menghindari kendala foreign-key)
    await connection.query(
      "DELETE FROM tpoexternal_dtl_alokasi WHERE poeda_nomor = ?",
      [nomor],
    );
    await connection.query("DELETE FROM tpoexternal_hdr WHERE poe_nomor = ?", [
      nomor,
    ]);

    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Logika Pengajuan Perubahan Data (PIN / Approval)
 */
const ajukanPerubahan = async (nomor, alasan, currentUser) => {
  // PERBAIKAN: Mengambil destructuring array baris hasil query secara presisi
  const [rowsPin] = await pool.query(
    'SELECT pin_urut, pin_dipakai FROM tspk_pin5 WHERE pin_trs="PO EXT MMT" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1',
    [nomor],
  );

  let urut = 1;
  if (rowsPin.length > 0) {
    const lastRecord = rowsPin[0];
    urut =
      lastRecord.pin_dipakai === ""
        ? lastRecord.pin_urut
        : lastRecord.pin_urut + 1;
  }

  const [rowsHeader] = await pool.query(
    "SELECT poe_tanggal, poe_spk_nomor FROM tpoexternal_hdr WHERE poe_nomor=?",
    [nomor],
  );
  if (rowsHeader.length === 0) throw new Error("Header PO tidak ditemukan");

  const sql = `
        INSERT INTO tspk_pin5 
        (pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan)
        VALUES ("PO EXT MMT", ?, ?, ?, ?, NOW(), ?, ?)
        ON DUPLICATE KEY UPDATE 
        pin_acc="", pin_tgl_minta=NOW(), pin_user_minta=VALUES(pin_user_minta), pin_alasan=VALUES(pin_alasan)
    `;

  await pool.query(sql, [
    nomor,
    urut,
    rowsHeader[0].poe_tanggal,
    rowsHeader[0].poe_spk_nomor,
    currentUser,
    alasan,
  ]);

  return { status: "WAIT", urut };
};

const getLookupPoForBpb = async (keyword) => {
  try {
    let sql = `
            SELECT 
                h.poe_nomor AS Nomor, 
                h.poe_tanggal AS Tanggal, 
                h.poe_sup AS KodeSup, 
                u.Sup_nama AS Supplier,
                h.poe_status AS Status,
                h.poe_jumlah AS TotalQtyPO,
                (SELECT IFNULL(SUM(bpe_jumlah), 0) FROM tbpbpoexternal_hdr WHERE bpe_po = h.poe_nomor) AS TotalQtyBPB
            FROM tpoexternal_hdr h
            LEFT JOIN tsupplier u ON u.Sup_kode = h.poe_sup
            WHERE 1=1
        `;

    const params = [];
    if (keyword) {
      sql += ` AND (h.poe_nomor LIKE ? OR u.Sup_nama LIKE ?)`;
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    sql += ` ORDER BY h.poe_nomor DESC LIMIT 100`;

    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (error) {
    throw new Error("Gagal mengambil lookup PO: " + error.message);
  }
};

/**
 * Lookup Detail PO: Digunakan untuk menarik item-item setelah PO dipilih
 */
const getPoDetailForBpb = async (noPo) => {
  try {
    const sql = `
            SELECT h.*, 
                   s.spk_nama, s.spk_kain, s.spk_ukuran, s.spk_jumlah, s.spk_jo_kode, 
                   s.spk_divisi, s.spk_panjang, s.spk_lebar,
                   v.divisi AS nama_divisi, 
                   j.jo_nama,
                   u.Sup_nama, u.Sup_alamat, u.Sup_kota,
                   (SELECT IFNULL(SUM(bh.bpe_jumlah), 0) 
                    FROM tbpbpoexternal_hdr bh 
                    WHERE bh.bpe_po = h.poe_nomor) AS totalTerima,
                    (SELECT IFNULL(SUM(bh.bpe_finishing), 0)
                     FROM tbpbpoexternal_hdr bh
                     WHERE bh.bpe_po = h.poe_nomor) AS totalFinishing
            FROM tpoexternal_hdr h
            LEFT JOIN tspk s ON s.spk_nomor = h.poe_spk_nomor
            LEFT JOIN tdivisi v ON v.kode = s.spk_divisi
            LEFT JOIN tjenisorder j ON j.jo_kode = s.spk_jo_kode
            LEFT JOIN tsupplier u ON u.Sup_kode = h.poe_sup
            WHERE h.poe_nomor = ?
        `;

    const [rows] = await pool.query(sql, [noPo]);
    if (rows.length === 0) return null;

    const header = rows[0];

    // Ambil Data Alokasi (Grid Detail) - Disamakan ke tpoexternal_dtl_alokasi
    const [alokasi] = await pool.query(
      `SELECT poeda_nomor AS NomorPO, poeda_nourut AS NoUrut, 
                    poeda_kota AS KodeBrg, poeda_kota AS NamaBrg, 
                    poeda_jumlah AS QtyPO 
             FROM tpoexternal_dtl_alokasi 
             WHERE poeda_nomor = ? ORDER BY poeda_nourut`,
      [noPo],
    );

    return {
      ...header,
      details: alokasi,
    };
  } catch (error) {
    console.error("Database Error (getPoDetailForBpb):", error);
    throw error;
  }
};

const getSudahTerima = async (noPo) => {
  const sql = `
        SELECT IFNULL(SUM(h.bpe_jumlah), 0) AS totalTerima
        FROM tbpbpoexternal_hdr h
        WHERE h.bpe_po = ?
    `;
  const [rows] = await pool.query(sql, [noPo]);
  return rows[0].totalTerima;
};

/**
 * Logika Simpan / Edit Data PO External MMT
 * Menyelaraskan 100% aturan validasi bisnis dan database dari Delphi (VK_F10 / simpandata)
 */

const savePoExternal = async (payload, currentUser) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const userAktif = currentUser || payload.currentUser || "SYSTEM";

    let nomorPo = payload.poe_nomor;
    const isEditMode = Boolean(payload.isEditMode);

    // 1. Validasi Pembayaran
    if (isEditMode && nomorPo) {
      const [voucherCheck] = await connection.query(
        `SELECT 1 FROM tvoucher_dtl WHERE voud_nota = ? LIMIT 1`,
        [nomorPo],
      );
      if (voucherCheck.length > 0) {
        throw new Error(
          "PO tersebut sudah ada pembayaran. Transaksi tidak bisa disimpan / diubah.",
        );
      }
    }

    // 2. Generate Nomor Otomatis
    //    REAL  : POE.<tahun><urut 5 digit>      -> POE.202600001
    //    TRIAL : TRL.POE.<tahun><urut 5 digit> -> TRL.POE.202600001
    //    Prefix TRL membuat data latihan langsung terlihat bedanya.
    if (!isEditMode || !nomorPo) {
      const currentYear = new Date(payload.poe_tanggal).getFullYear();
      const isTrial = getDataMode() === "trial";
      const prefix = isTrial ? `TRL.POE.${currentYear}` : `POE.${currentYear}`;

      const [maxRows] = await connection.query(
        `SELECT IFNULL(MAX(CAST(SUBSTRING(poe_nomor, ?) AS UNSIGNED)), 0) AS max_urut 
         FROM tpoexternal_hdr 
         WHERE LEFT(poe_nomor, ?) = ? FOR UPDATE`,
        [prefix.length + 1, prefix.length, prefix],
      );

      const nextUrut = (Number(maxRows[0]?.max_urut) || 0) + 1;
      nomorPo = `${prefix}${String(nextUrut).padStart(5, "0")}`;
    }

    // 3. UPSERT Header dengan user_create & user_modified dinamis
    const sqlHeader = `
      INSERT INTO tpoexternal_hdr (
        poe_nomor, poe_tanggal, poe_dateline, poe_spk_nomor, poe_cab, 
        poe_sup, poe_ket, poe_finishing, poe_jumlah, poe_tarif, 
        poe_total, poe_bahansendiri, poe_status, user_create, date_create,
        poe_tipe_hitung
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, NOW(), ?)
      ON DUPLICATE KEY UPDATE
        poe_tanggal = VALUES(poe_tanggal),
        poe_dateline = VALUES(poe_dateline),
        poe_spk_nomor = VALUES(poe_spk_nomor),
        poe_cab = VALUES(poe_cab),
        poe_sup = VALUES(poe_sup),
        poe_ket = VALUES(poe_ket),
        poe_finishing = VALUES(poe_finishing),
        poe_jumlah = VALUES(poe_jumlah),
        poe_tarif = VALUES(poe_tarif),
        poe_total = VALUES(poe_total),
        poe_bahansendiri = VALUES(poe_bahansendiri),
        poe_tipe_hitung = VALUES(poe_tipe_hitung),
        user_modified = ?,
        date_modified = NOW()
    `;

    await connection.query(sqlHeader, [
      nomorPo,
      payload.poe_tanggal,
      payload.poe_dateline,
      payload.poe_spk_nomor,
      payload.poe_cab || "P05",
      payload.poe_sup || "",
      payload.poe_ket || "",
      payload.poe_finishing || "",
      Number(payload.poe_jumlah) || 0,
      Number(payload.poe_tarif) || 0,
      Number(payload.poe_total) || 0,
      payload.poe_bahansendiri || "N",
      userAktif, // <-- masuk ke user_create saat INSERT baru
      payload.poe_tipe_hitung === "pcs" ? "pcs" : "meter",
      userAktif, // <-- masuk ke user_modified saat UPDATE
    ]);

    // ------------------------------------------------------------
    // PEMBERSIHAN DETAIL LAMA (Delete-Insert Pattern)
    // Dijalankan agar detail lama bersih jika record PO sudah pernah ada
    // ------------------------------------------------------------
    await connection.query(
      "DELETE FROM tpoexternal_dtl_alokasi WHERE poeda_nomor = ?",
      [nomorPo],
    );
    await connection.query(
      "DELETE FROM tpoexternal_dtl2 WHERE poed2_nomor = ?",
      [nomorPo],
    );
    await connection.query(
      "DELETE FROM tpoexternal_custom WHERE poed_nomor = ?",
      [nomorPo],
    );

    // ------------------------------------------------------------
    // LANGKAH 4: SIMPAN DETAIL ALOKASI KOTA (tpoexternal_dtl_alokasi)
    // ------------------------------------------------------------
    if (Array.isArray(payload.alokasi) && payload.alokasi.length > 0) {
      // Filter hanya item yang dicentang alokasi dan kota tidak kosong
      const validAlokasi = payload.alokasi.filter(
        (item) =>
          (item.alokasi === true || item.alokasi === "Y") &&
          item.kota &&
          item.kota.trim() !== "",
      );

      if (validAlokasi.length > 0) {
        const valuesAlokasi = validAlokasi.map((item, index) => [
          nomorPo,
          item.kota.trim(),
          Number(item.jumlah) || 0,
          index + 1, // poeda_nourut
        ]);

        await connection.query(
          `INSERT INTO tpoexternal_dtl_alokasi 
           (poeda_nomor, poeda_kota, poeda_jumlah, poeda_nourut) 
           VALUES ?`,
          [valuesAlokasi],
        );
      }
    }

    // ------------------------------------------------------------
    // LANGKAH 5: SIMPAN DETAIL DP (tpoexternal_dtl2)
    // ------------------------------------------------------------
    if (Array.isArray(payload.dp) && payload.dp.length > 0) {
      const validDp = payload.dp.filter(
        (item) => item.tanggal && Number(item.nominal) > 0,
      );

      if (validDp.length > 0) {
        const valuesDp = validDp.map((item) => [
          nomorPo,
          item.tanggal,
          Number(item.nominal) || 0,
          item.akun || "",
          item.link || "",
        ]);

        await connection.query(
          `INSERT INTO tpoexternal_dtl2 
           (poed2_nomor, poed2_tanggal, poed2_nominal, poed2_akun, poed2_link) 
           VALUES ?`,
          [valuesDp],
        );
      }
    }

    // ------------------------------------------------------------
    // LANGKAH 6: SIMPAN DETAIL CUSTOM ITEM (tpoexternal_custom)
    // ------------------------------------------------------------
    if (Array.isArray(payload.custom) && payload.custom.length > 0) {
      const validCustom = payload.custom.filter(
        (item) =>
          item.nama && item.nama.trim() !== "" && Number(item.total) !== 0,
      );

      if (validCustom.length > 0) {
        const valuesCustom = validCustom.map((item) => [
          nomorPo,
          item.nama.trim(),
          Number(item.panjang) || 0,
          Number(item.lebar) || 0,
          Number(item.jumlah) || 0,
          Number(item.harga) || 0,
          Number(item.total) || 0,
        ]);

        await connection.query(
          `INSERT INTO tpoexternal_custom 
           (poed_nomor, poed_nama, poed_panjang, poed_lebar, poed_jumlah, poed_harga, poed_total) 
           VALUES ?`,
          [valuesCustom],
        );
      }
    }

    // ------------------------------------------------------------
    // LANGKAH 7: UPDATE STATUS LOCK PIN APPROVAL (tspk_pin5)
    // ------------------------------------------------------------
    if (payload.xminta5 === "ACC" && Number(payload.xurut5) > 0) {
      await connection.query(
        `UPDATE tspk_pin5 
         SET pin_dipakai = "Y" 
         WHERE pin_trs = "PO EXT MMT" AND pin_nomor = ? AND pin_urut = ?`,
        [nomorPo, payload.xurut5],
      );
    }

    await connection.commit();
    return { success: true, nomor: nomorPo };
  } catch (error) {
    await connection.rollback();
    console.error("Error pada savePoExternal Service:", error);
    throw error;
  } finally {
    connection.release();
  }
};

const getPoExternalById = async (nomorPo) => {
  try {
    // 1. Ambil Data Header PO beserta Join Master SPK (termasuk spk_memo) & Supplier
    const sqlHeader = `
            SELECT h.*, 
                   s.spk_nama, s.spk_kain, s.spk_ukuran, s.spk_jumlah, s.spk_jo_kode, 
                   s.spk_divisi, s.spk_panjang, s.spk_lebar, s.spk_memo,
                   v.divisi, 
                   j.jo_nama,
                   u.Sup_nama, u.Sup_alamat, u.Sup_kota
            FROM tpoexternal_hdr h
            LEFT JOIN tspk s ON s.spk_nomor = h.poe_spk_nomor
            LEFT JOIN tdivisi v ON v.kode = s.spk_divisi
            LEFT JOIN tjenisorder j ON j.jo_kode = s.spk_jo_kode
            LEFT JOIN tsupplier u ON u.Sup_kode = h.poe_sup
            WHERE h.poe_nomor = ?
        `;
    const [headerRows] = await pool.query(sqlHeader, [nomorPo]);
    if (headerRows.length === 0) return null;

    const headerData = headerRows[0];

    // 2. Ambil Detail Alokasi Kota (tpoexternal_dtl_alokasi)
    const [alokasiRows] = await pool.query(
      `SELECT poeda_kota, poeda_jumlah 
             FROM tpoexternal_dtl_alokasi 
             WHERE poeda_nomor = ? ORDER BY poeda_nourut`,
      [nomorPo],
    );

    // 3. Ambil Detail Item Custom (tpoexternal_custom)
    const [customRows] = await pool.query(
      `SELECT poed_nama, poed_panjang, poed_lebar, poed_jumlah, poed_harga, poed_total 
             FROM tpoexternal_custom 
             WHERE poed_nomor = ? ORDER BY poed_nourut`,
      [nomorPo],
    );

    // 4. Ambil Detail Uang Muka / DP (tpoexternal_dtl2) beserta Nama Bank
    const [dpRows] = await pool.query(
      `SELECT d.poed2_tanggal, d.poed2_nominal, d.poed2_akun, d.poed2_link, r.rek_nama
             FROM tpoexternal_dtl2 d
             LEFT JOIN finance.trekening r ON r.rek_kode = d.poed2_akun
             WHERE d.poed2_nomor = ? ORDER BY d.poed2_nomor`,
      [nomorPo],
    );

    // 5. Kembalikan data dalam format payload tunggal yang siap dibongkar di Vue
    return {
      header: headerData,
      alokasi: alokasiRows,
      custom: customRows,
      dp: dpRows,
    };
  } catch (error) {
    console.error("Database Error (getPoExternalById):", error);
    throw error;
  }
};

module.exports = {
  getPoExternalBrowse,
  deletePoExternal,
  ajukanPerubahan,
  getLookupPoForBpb,
  getPoDetailForBpb,
  getSudahTerima,
  savePoExternal,
  getPoExternalById,
};
