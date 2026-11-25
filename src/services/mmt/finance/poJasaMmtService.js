// backend/src/services/mmt/finance/poJasaMmtService.js
const pool = require("../../../config/database");
const { getDataMode } = require("../../../config/database");

/**
 * Mendapatkan daftar PO Jasa MMT dari tabel mandiri: tpojasa_mmt_hdr
 */
const getPoJasaBrowse = async (startDate, endDate, userCab) => {
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

  const sql = `
    SELECT x.*,
      IFNULL((
        SELECT 
          IF(pin_acc = '' AND pin_dipakai = '', 'WAIT',
          IF(pin_acc = 'Y' AND pin_dipakai = '', 'ACC',
          IF(pin_acc = 'Y' AND pin_dipakai = 'Y', '',
          IF(pin_acc = 'N', 'TOLAK', ''))))
        FROM tspk_pin5 
        WHERE pin_trs = "PO JASA MMT" AND pin_nomor = x.Nomor 
        ORDER BY pin_urut DESC LIMIT 1
      ), "") AS Ngedit
    FROM (
      SELECT 
        h.poe_nomor AS Nomor, h.poe_tanggal AS Tanggal, h.poe_dateline AS DateLinePO,
        h.poe_cab AS Cab, h.poe_spk_nomor AS SPK, s.spk_nama AS NamaSPK,
        h.poe_sup AS KdSup, u.Sup_nama AS Supplier, h.poe_jumlah AS QtyPO,
        (SELECT IFNULL(SUM(hh.bpe_jumlah), 0) FROM tbpbpoexternal_hdr hh WHERE hh.bpe_po = h.poe_nomor) AS QtyBPB,
        h.poe_bahansendiri AS BahanSendiri,
        IFNULL(h.poe_potongan_bahan, 0) AS PotonganBahan,
        IFNULL(h.poe_total_bersih, (h.poe_total - IFNULL(h.poe_potongan_bahan, 0))) AS TagihanBersih,
        (
          SELECT IFNULL(SUM(b.poeb_selisih), 0) 
          FROM tpojasa_mmt_dtl_bahan b 
          WHERE b.poeb_nomor = h.poe_nomor
        ) AS SelisihBahan,
        h.poe_total AS Nominal,
        (SELECT IFNULL(SUM(c.poed2_nominal), 0) FROM tpojasa_mmt_dtl2 c WHERE c.poed2_nomor = h.poe_nomor) AS DP,
        (SELECT IFNULL(SUM(v.voud_total), 0) FROM tvoucher_dtl v WHERE v.voud_nota = h.poe_nomor) AS Voucher,
        h.poe_status AS Status, h.user_create AS Usr, h.date_create AS Created
      FROM tpojasa_mmt_hdr h
      LEFT JOIN tspk s ON s.spk_nomor = h.poe_spk_nomor
      LEFT JOIN tsupplier u ON u.Sup_kode = h.poe_sup
      WHERE 1=1
      ${dateConds.length ? "AND " + dateConds.join(" AND ") : ""}
      AND h.poe_cab IN ('P02', 'P04', 'P05', 'MT1')
      ${userCab ? "AND h.poe_cab = ?" : ""}
    ) x
    ORDER BY x.Nomor DESC
  `;

  if (userCab) params.push(userCab);

  const [rows] = await pool.query(sql, params);
  return rows;
};

/**
 * Logika Hapus PO Jasa (tpojasa_mmt_*)
 */
const deletePoJasa = async (nomor, userCab) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      `SELECT poe_tanggal, poe_status, poe_cab,
        (SELECT IFNULL(SUM(bpe_jumlah), 0) FROM tbpbpoexternal_hdr WHERE bpe_po = poe_nomor) as QtyBPB,
        (SELECT IFNULL(SUM(voud_total), 0) FROM tvoucher_dtl WHERE voud_nota = poe_nomor) as Voucher
       FROM tpojasa_mmt_hdr WHERE poe_nomor = ?`,
      [nomor],
    );

    if (rows.length === 0) throw new Error("Data PO Jasa tidak ditemukan");
    const data = rows[0];

    if (userCab && data.poe_cab !== userCab) {
      throw new Error("Bukan data cabang anda");
    }

    const tgl = new Date(data.poe_tanggal);
    const limitClose = new Date(tgl.getFullYear(), tgl.getMonth() + 1, 25);
    if (new Date() > limitClose) {
      throw new Error("Transaksi tsb sudah close periode. Tidak bisa dihapus.");
    }

    if (data.poe_status !== "OPEN") {
      throw new Error("PO Jasa sudah diproses/close. Tidak bisa dihapus.");
    }
    if (Number(data.QtyBPB) > 0) {
      throw new Error("PO Jasa sudah ada Penerimaan (BPB). Tidak bisa dihapus.");
    }
    if (Number(data.Voucher) > 0) {
      throw new Error("PO Jasa sudah ada dibuatkan Voucher pembayaran. Tidak bisa dihapus.");
    }

    await connection.query("DELETE FROM tpojasa_mmt_dtl_alokasi WHERE poeda_nomor = ?", [nomor]);
    await connection.query("DELETE FROM tpojasa_mmt_dtl2 WHERE poed2_nomor = ?", [nomor]);
    await connection.query("DELETE FROM tpojasa_mmt_custom WHERE poed_nomor = ?", [nomor]);
    await connection.query("DELETE FROM tpojasa_mmt_dtl_bahan WHERE poeb_nomor = ?", [nomor]);
    await connection.query("DELETE FROM tpojasa_mmt_hdr WHERE poe_nomor = ?", [nomor]);

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
 * Pengajuan Perubahan Data (PIN)
 */
const ajukanPerubahan = async (nomor, alasan, currentUser) => {
  const [rowsPin] = await pool.query(
    'SELECT pin_urut, pin_dipakai FROM tspk_pin5 WHERE pin_trs="PO JASA MMT" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1',
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
    "SELECT poe_tanggal, poe_spk_nomor FROM tpojasa_mmt_hdr WHERE poe_nomor=?",
    [nomor],
  );
  if (rowsHeader.length === 0) throw new Error("Header PO Jasa tidak ditemukan");

  const sql = `
    INSERT INTO tspk_pin5 
    (pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan)
    VALUES ("PO JASA MMT", ?, ?, ?, ?, NOW(), ?, ?)
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

/**
 * Lookup PO Jasa untuk BPB
 */
const getLookupPoForBpb = async (keyword) => {
  try {
    let sql = `
      SELECT 
        h.poe_nomor AS Nomor, 
        h.poe_tanggal AS Tanggal, 
        h.poe_sup AS KodeSup, 
        u.Sup_nama AS Supplier,
        h.poe_spk_nomor AS SPK,
        h.poe_status AS Status,
        h.poe_jumlah AS TotalQtyPO,
        IFNULL(h.poe_potongan_bahan, 0) AS PotonganBahan,
        (SELECT IFNULL(SUM(bpe_jumlah), 0) FROM tbpbpoexternal_hdr WHERE bpe_po = h.poe_nomor) AS TotalQtyBPB
      FROM tpojasa_mmt_hdr h
      LEFT JOIN tsupplier u ON u.Sup_kode = h.poe_sup
      WHERE 1=1
    `;

    const params = [];
    if (keyword) {
      sql += ` AND (h.poe_nomor LIKE ? OR u.Sup_nama LIKE ? OR h.poe_spk_nomor LIKE ?)`;
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    sql += ` ORDER BY h.poe_nomor DESC LIMIT 100`;

    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (error) {
    throw new Error("Gagal mengambil lookup PO Jasa: " + error.message);
  }
};

/**
 * Detail PO Jasa untuk BPB
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
      FROM tpojasa_mmt_hdr h
      LEFT JOIN tspk s ON s.spk_nomor = h.poe_spk_nomor
      LEFT JOIN tdivisi v ON v.kode = s.spk_divisi
      LEFT JOIN tjenisorder j ON j.jo_kode = s.spk_jo_kode
      LEFT JOIN tsupplier u ON u.Sup_kode = h.poe_sup
      WHERE h.poe_nomor = ?
    `;

    const [rows] = await pool.query(sql, [noPo]);
    if (rows.length === 0) return null;

    const header = rows[0];

    const [alokasi] = await pool.query(
      `SELECT poeda_nomor AS NomorPO, poeda_nourut AS NoUrut, 
              poeda_kota AS KodeBrg, poeda_kota AS NamaBrg, 
              poeda_jumlah AS QtyPO 
       FROM tpojasa_mmt_dtl_alokasi 
       WHERE poeda_nomor = ? ORDER BY poeda_nourut`,
      [noPo],
    );

    const [bahanList] = await pool.query(
      `SELECT * FROM tpojasa_mmt_dtl_bahan WHERE poeb_nomor = ? ORDER BY poeb_nourut`,
      [noPo],
    );

    return {
      ...header,
      alokasi,
      bahanList,
      details: alokasi,
    };
  } catch (error) {
    console.error("Database Error (getPoDetailForBpb):", error);
    throw error;
  }
};

/**
 * Total yang sudah diterima
 */
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
 * Simpan / Ubah PO Jasa MMT (tpojasa_mmt_*)
 */
const savePoJasa = async (payload, currentUser) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const userAktif = currentUser || payload.currentUser || "SYSTEM";
    let nomorPo = payload.poe_nomor;
    const isEditMode = Boolean(payload.isEditMode);

    // 1. Cek pembayaran voucher
    if (isEditMode && nomorPo) {
      const [voucherCheck] = await connection.query(
        `SELECT 1 FROM tvoucher_dtl WHERE voud_nota = ? LIMIT 1`,
        [nomorPo],
      );
      if (voucherCheck.length > 0) {
        throw new Error(
          "PO Jasa tersebut sudah ada pembayaran. Transaksi tidak bisa disimpan / diubah.",
        );
      }
    }

    // 2. Generate Nomor Otomatis POJ.<tahun><urut 5 digit>
    if (!isEditMode || !nomorPo || nomorPo === "AUTO") {
      const currentYear = new Date(payload.poe_tanggal).getFullYear();
      const isTrial = getDataMode() === "trial";
      const prefix = isTrial ? `TRL.POJ.${currentYear}` : `POJ.${currentYear}`;

      const [maxRows] = await connection.query(
        `SELECT IFNULL(MAX(CAST(SUBSTRING(poe_nomor, ?) AS UNSIGNED)), 0) AS max_urut 
         FROM tpojasa_mmt_hdr 
         WHERE LEFT(poe_nomor, ?) = ? FOR UPDATE`,
        [prefix.length + 1, prefix.length, prefix],
      );

      const nextUrut = (Number(maxRows[0]?.max_urut) || 0) + 1;
      nomorPo = `${prefix}${String(nextUrut).padStart(5, "0")}`;
    }

    // Hitung total potongan dan selisih bahan
    const bahanArray = Array.isArray(payload.bahanList) ? payload.bahanList : [];
    let totPotonganBahan = 0;
    let totSelisihBahan = 0;
    bahanArray.forEach((b) => {
      const k = Number(b.qtyKeluar || b.poeb_qty_keluar || 0);
      const m = Number(b.qtyKembali || b.poeb_qty_kembali || 0);
      const diff = Math.max(0, k - m);
      const harga = Number(b.hargaSatuan || b.poeb_harga || 0);
      totSelisihBahan += diff;
      totPotonganBahan += Math.round(diff * harga);
    });

    const totalHeader = Number(payload.poe_total) || 0;
    const totalBersih = Math.max(0, totalHeader - totPotonganBahan);

    // 3. UPSERT Header tpojasa_mmt_hdr
    const sqlHeader = `
      INSERT INTO tpojasa_mmt_hdr (
        poe_nomor, poe_tanggal, poe_dateline, poe_spk_nomor, poe_cab, 
        poe_sup, poe_ket, poe_finishing, poe_jumlah, poe_tarif, 
        poe_total, poe_potongan_bahan, poe_total_bersih, poe_selisih_bahan,
        poe_bahansendiri, poe_status, user_create, date_create,
        poe_tipe_hitung
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, NOW(), ?)
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
        poe_potongan_bahan = VALUES(poe_potongan_bahan),
        poe_total_bersih = VALUES(poe_total_bersih),
        poe_selisih_bahan = VALUES(poe_selisih_bahan),
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
      totalHeader,
      totPotonganBahan,
      totalBersih,
      totSelisihBahan,
      payload.poe_bahansendiri || "Y",
      userAktif,
      payload.poe_tipe_hitung === "pcs" ? "pcs" : "meter",
      userAktif,
    ]);

    // 4. Bersihkan detail lama
    await connection.query("DELETE FROM tpojasa_mmt_dtl_alokasi WHERE poeda_nomor = ?", [nomorPo]);
    await connection.query("DELETE FROM tpojasa_mmt_dtl2 WHERE poed2_nomor = ?", [nomorPo]);
    await connection.query("DELETE FROM tpojasa_mmt_custom WHERE poed_nomor = ?", [nomorPo]);
    await connection.query("DELETE FROM tpojasa_mmt_dtl_bahan WHERE poeb_nomor = ?", [nomorPo]);

    // 5. Simpan Rincian Penggunaan Bahan (tpojasa_mmt_dtl_bahan)
    if (bahanArray.length > 0) {
      const validBahan = bahanArray.filter(
        (b) => (b.nama || b.poeb_nama) && (b.nama || b.poeb_nama).trim() !== "",
      );

      if (validBahan.length > 0) {
        const valuesBahan = validBahan.map((b, idx) => {
          const keluar = Number(b.qtyKeluar || b.poeb_qty_keluar || 0);
          const kembali = Number(b.qtyKembali || b.poeb_qty_kembali || 0);
          const diff = Math.max(0, keluar - kembali);
          const harga = Number(b.hargaSatuan || b.poeb_harga || 0);
          const pot = Math.round(diff * harga);

          return [
            nomorPo,
            idx + 1,
            b.kode || b.poeb_kode || "",
            (b.nama || b.poeb_nama || "").trim(),
            b.satuan || b.poeb_satuan || "m²",
            Number(b.estPakai || b.poeb_est_pakai || 0),
            keluar,
            kembali,
            diff,
            harga,
            pot,
            b.keterangan || b.poeb_ket || "",
          ];
        });

        await connection.query(
          `INSERT INTO tpojasa_mmt_dtl_bahan 
           (poeb_nomor, poeb_nourut, poeb_kode, poeb_nama, poeb_satuan, 
            poeb_est_pakai, poeb_qty_keluar, poeb_qty_kembali, poeb_selisih, 
            poeb_harga, poeb_potongan, poeb_ket) 
           VALUES ?`,
          [valuesBahan],
        );
      }
    }

    // 6. Simpan Detail Alokasi Kota (tpojasa_mmt_dtl_alokasi)
    if (Array.isArray(payload.alokasi) && payload.alokasi.length > 0) {
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
          index + 1,
        ]);

        await connection.query(
          `INSERT INTO tpojasa_mmt_dtl_alokasi 
           (poeda_nomor, poeda_kota, poeda_jumlah, poeda_nourut) 
           VALUES ?`,
          [valuesAlokasi],
        );
      }
    }

    // 7. Simpan Detail DP (tpojasa_mmt_dtl2)
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
          `INSERT INTO tpojasa_mmt_dtl2 
           (poed2_nomor, poed2_tanggal, poed2_nominal, poed2_akun, poed2_link) 
           VALUES ?`,
          [valuesDp],
        );
      }
    }

    // 8. Simpan Detail Custom Item (tpojasa_mmt_custom)
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
          `INSERT INTO tpojasa_mmt_custom 
           (poed_nomor, poed_nama, poed_panjang, poed_lebar, poed_jumlah, poed_harga, poed_total) 
           VALUES ?`,
          [valuesCustom],
        );
      }
    }

    // 9. Update Status Lock PIN Approval jika ACC
    if (payload.xminta5 === "ACC" && Number(payload.xurut5) > 0) {
      await connection.query(
        `UPDATE tspk_pin5 
         SET pin_dipakai = "Y" 
         WHERE pin_trs = "PO JASA MMT" AND pin_nomor = ? AND pin_urut = ?`,
        [nomorPo, payload.xurut5],
      );
    }

    await connection.commit();
    return { success: true, nomor: nomorPo };
  } catch (error) {
    await connection.rollback();
    console.error("Error pada savePoJasa Service:", error);
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Detail PO Jasa berdasarkan Nomor (tpojasa_mmt_*)
 */
const getPoJasaById = async (nomorPo) => {
  try {
    const sqlHeader = `
      SELECT h.*, 
        s.spk_nama, s.spk_kain, s.spk_ukuran, s.spk_jumlah, s.spk_jo_kode, 
        s.spk_divisi, s.spk_panjang, s.spk_lebar, s.spk_memo,
        v.divisi, 
        j.jo_nama,
        u.Sup_nama, u.Sup_alamat, u.Sup_kota
      FROM tpojasa_mmt_hdr h
      LEFT JOIN tspk s ON s.spk_nomor = h.poe_spk_nomor
      LEFT JOIN tdivisi v ON v.kode = s.spk_divisi
      LEFT JOIN tjenisorder j ON j.jo_kode = s.spk_jo_kode
      LEFT JOIN tsupplier u ON u.Sup_kode = h.poe_sup
      WHERE h.poe_nomor = ?
    `;
    const [headerRows] = await pool.query(sqlHeader, [nomorPo]);
    if (headerRows.length === 0) return null;

    const headerData = headerRows[0];

    const [alokasiRows] = await pool.query(
      `SELECT poeda_kota, poeda_jumlah 
       FROM tpojasa_mmt_dtl_alokasi 
       WHERE poeda_nomor = ? ORDER BY poeda_nourut`,
      [nomorPo],
    );

    const [customRows] = await pool.query(
      `SELECT poed_nama, poed_panjang, poed_lebar, poed_jumlah, poed_harga, poed_total 
       FROM tpojasa_mmt_custom 
       WHERE poed_nomor = ? ORDER BY poed_nourut`,
      [nomorPo],
    );

    const [dpRows] = await pool.query(
      `SELECT d.poed2_tanggal, d.poed2_nominal, d.poed2_akun, d.poed2_link, r.rek_nama
       FROM tpojasa_mmt_dtl2 d
       LEFT JOIN finance.trekening r ON r.rek_kode = d.poed2_akun
       WHERE d.poed2_nomor = ? ORDER BY d.poed2_nomor`,
      [nomorPo],
    );

    const [bahanRows] = await pool.query(
      `SELECT poeb_kode, poeb_nama, poeb_satuan, poeb_est_pakai, 
              poeb_qty_keluar, poeb_qty_kembali, poeb_selisih, 
              poeb_harga, poeb_potongan, poeb_ket
       FROM tpojasa_mmt_dtl_bahan 
       WHERE poeb_nomor = ? ORDER BY poeb_nourut`,
      [nomorPo],
    );

    return {
      header: headerData,
      alokasi: alokasiRows,
      custom: customRows,
      dp: dpRows,
      bahanList: bahanRows,
      bahan: bahanRows,
    };
  } catch (error) {
    console.error("Database Error (getPoJasaById):", error);
    throw error;
  }
};

/**
 * Sinkronisasi Data SPK lengkap & otomatis match Kode Barang MMT
 */
const syncSpk = async (nomorSpk) => {
  const cleanNomor = String(nomorSpk || "").trim();
  if (!cleanNomor) throw new Error("Nomor SPK tidak boleh kosong.");

  // 1. Ambil Header Data SPK dari tspk / tmemospk
  const sqlSpk = `
    SELECT 
      t.spk_nomor AS SPK,
      t.spk_nama AS Nama,
      DATE_FORMAT(t.spk_tanggal, '%Y-%m-%d') AS Tanggal,
      DATE_FORMAT(t.spk_dateline, '%Y-%m-%d') AS Deadline,
      t.spk_divisi AS Divisi,
      t.spk_cab AS Cabang,
      t.spk_kain AS Bahan,
      t.spk_ukuran AS Ukuran,
      IFNULL(t.spk_panjang, 0) AS Panjang,
      IFNULL(t.spk_lebar, 0) AS Lebar,
      IFNULL(t.spk_jumlah, 0) AS Jumlah,
      t.spk_finishing AS Finishing,
      IFNULL(t.spk_statuskerja, '') AS Kepentingan,
      IFNULL(t.spk_desain, 'N') AS design_done,
      IFNULL(t.spk_newdesign, 'N') AS design_baru,
      IFNULL(t.spk_jo_kode, '') AS jo_kode
    FROM tspk t
    WHERE t.spk_nomor = ?
    UNION ALL
    SELECT 
      m.mspk_nomor AS SPK,
      m.mspk_nama AS Nama,
      DATE_FORMAT(m.mspk_tanggal, '%Y-%m-%d') AS Tanggal,
      DATE_FORMAT(m.mspk_dateline, '%Y-%m-%d') AS Deadline,
      m.mspk_divisi AS Divisi,
      m.mspk_cab AS Cabang,
      m.mspk_kain AS Bahan,
      m.mspk_ukuran AS Ukuran,
      IFNULL(m.mspk_panjang, 0) AS Panjang,
      IFNULL(m.mspk_lebar, 0) AS Lebar,
      IFNULL(m.mspk_jumlah, 0) AS Jumlah,
      m.mspk_finishing AS Finishing,
      'INTERNAL' AS Kepentingan,
      'Y' AS design_done,
      'N' AS design_baru,
      IFNULL(m.mspk_jo_kode, '') AS jo_kode
    FROM tmemospk m
    WHERE m.mspk_nomor = ?
    LIMIT 1
  `;
  const [rowsSpk] = await pool.query(sqlSpk, [cleanNomor, cleanNomor]);
  if (!rowsSpk.length) {
    throw new Error(`Data SPK '${cleanNomor}' tidak ditemukan.`);
  }
  const spk = rowsSpk[0];

  // 2. Ambil data alokasi kota dari talokasi / tspk_alokasi
  let alokasi = [];
  try {
    const [rowsAlokasi] = await pool.query(
      `SELECT IFNULL(kota, '') AS kota, IFNULL(jumlah, 0) AS jumlah
       FROM talokasi WHERE spk_nomor = ? ORDER BY urut ASC`,
      [cleanNomor],
    );
    if (rowsAlokasi.length > 0) {
      alokasi = rowsAlokasi;
    } else {
      const [rowsAlokasiFallback] = await pool.query(
        `SELECT IFNULL(spka_kota, '') AS kota, IFNULL(spka_jumlah, 0) AS jumlah
         FROM tspk_alokasi WHERE spka_spk_nomor = ? ORDER BY spka_urut ASC`,
        [cleanNomor],
      );
      alokasi = rowsAlokasiFallback;
    }
  } catch (_) {}

  // 3. Cari Kode Barang / Master Bahan Otomatis dari tbarang_mmt
  let matchedBahan = null;

  // Prioritas A: Cek riwayat transaksi bahan riil dari SPK ini
  try {
    const [rowsMinta] = await pool.query(
      `SELECT d.mntd_brg_kode AS kode, TRIM(b.brg_nama) AS nama, b.brg_satuan AS satuan,
              COALESCE(b.brg_satuan_harga, b.brg_hrgbeli, 0) AS harga
       FROM tminta_mmt_dtl d
       JOIN tbarang_mmt b ON b.brg_kode = d.mntd_brg_kode
       WHERE d.mntd_spk_nomor = ? AND d.mntd_brg_kode <> ''
       LIMIT 1`,
      [cleanNomor],
    );
    if (rowsMinta.length > 0) {
      matchedBahan = rowsMinta[0];
    }
  } catch (_) {}

  if (!matchedBahan) {
    try {
      const [rowsMintaBahan] = await pool.query(
        `SELECT d.mbd_brg_kode AS kode, TRIM(b.brg_nama) AS nama, b.brg_satuan AS satuan,
                COALESCE(b.brg_satuan_harga, b.brg_hrgbeli, 0) AS harga
         FROM tmintabahan_mmt_dtl d
         JOIN tbarang_mmt b ON b.brg_kode = d.mbd_brg_kode
         WHERE d.mbd_spk_nomor = ? AND d.mbd_brg_kode <> ''
         LIMIT 1`,
        [cleanNomor],
      );
      if (rowsMintaBahan.length > 0) {
        matchedBahan = rowsMintaBahan[0];
      }
    } catch (_) {}
  }

  if (!matchedBahan) {
    try {
      const [rowsMutasi] = await pool.query(
        `SELECT d.mutd_brg_kode AS kode, TRIM(b.brg_nama) AS nama, b.brg_satuan AS satuan,
                COALESCE(b.brg_satuan_harga, b.brg_hrgbeli, 0) AS harga
         FROM tmutasi_intern_dtl d
         JOIN tbarang_mmt b ON b.brg_kode = d.mutd_brg_kode
         WHERE d.mutd_spk_nomor = ? AND d.mutd_brg_kode <> ''
         LIMIT 1`,
        [cleanNomor],
      );
      if (rowsMutasi.length > 0) {
        matchedBahan = rowsMutasi[0];
      }
    } catch (_) {}
  }

  if (!matchedBahan) {
    try {
      const [rowsLhk] = await pool.query(
        `SELECT t1.lbahan AS kode, TRIM(b.brg_nama) AS nama, b.brg_satuan AS satuan,
                COALESCE(b.brg_satuan_harga, b.brg_hrgbeli, 0) AS harga
         FROM tlhk_mesin_hdr t1
         JOIN tbarang_mmt b ON b.brg_kode = t1.lbahan
         WHERE t1.lspk_nomor = ? AND t1.lbahan <> ''
         LIMIT 1`,
        [cleanNomor],
      );
      if (rowsLhk.length > 0) {
        matchedBahan = rowsLhk[0];
      }
    } catch (_) {}
  }

  if (!matchedBahan) {
    try {
      const [rowsKomp] = await pool.query(
        `SELECT k.sk_kode AS kode, TRIM(b.bhn_name) AS nama, b.bhn_satuan AS satuan,
                COALESCE(b.bhn_hargabeli, 0) AS harga
         FROM tspk_komponen_potong k
         JOIN tbahan b ON b.bhn_kode = k.sk_kode
         WHERE k.sk_nomorspk = ? AND k.sk_kode <> ''
         LIMIT 1`,
        [cleanNomor],
      );
      if (rowsKomp.length > 0) {
        matchedBahan = rowsKomp[0];
      }
    } catch (_) {}
  }

  // Prioritas B: Match teks spk.Bahan (spk_kain) ke tbarang_mmt
  const namaBahanSpk = String(spk.Bahan || "").trim();
  if (!matchedBahan && namaBahanSpk) {
    // B.1: Exact match kode atau nama
    const [rowsExact] = await pool.query(
      `SELECT brg_kode AS kode, TRIM(brg_nama) AS nama, brg_satuan AS satuan,
              COALESCE(b.brg_satuan_harga, b.brg_hrgbeli, 0) AS harga
       FROM tbarang_mmt b
       WHERE b.brg_kode = ? OR LOWER(TRIM(b.brg_nama)) = LOWER(?)
       LIMIT 1`,
      [namaBahanSpk, namaBahanSpk],
    );
    if (rowsExact.length > 0) {
      matchedBahan = rowsExact[0];
    } else {
      // B.2: LIKE match nama bahan
      const [rowsLike] = await pool.query(
        `SELECT brg_kode AS kode, TRIM(brg_nama) AS nama, brg_satuan AS satuan,
                COALESCE(b.brg_satuan_harga, b.brg_hrgbeli, 0) AS harga
         FROM tbarang_mmt b
         WHERE b.brg_nama LIKE ? OR b.brg_kode LIKE ?
         ORDER BY 
           CASE 
             WHEN b.brg_nama LIKE ? THEN 1 
             ELSE 2 
           END,
           LENGTH(b.brg_nama) ASC
         LIMIT 1`,
        [`%${namaBahanSpk}%`, `%${namaBahanSpk}%`, `${namaBahanSpk}%`],
      );
      if (rowsLike.length > 0) {
        matchedBahan = rowsLike[0];
      }
    }
  }

  // Prioritas C: Fallback match ke tbahan (jika bahan konveksi / kain umum)
  if (!matchedBahan && namaBahanSpk) {
    try {
      const [rowsBhn] = await pool.query(
        `SELECT bhn_kode AS kode, TRIM(bhn_name) AS nama, bhn_satuan AS satuan,
                COALESCE(bhn_hargabeli, 0) AS harga
         FROM tbahan
         WHERE bhn_kode = ? OR LOWER(TRIM(bhn_name)) = LOWER(?)
            OR bhn_name LIKE ?
         ORDER BY LENGTH(bhn_name) ASC
         LIMIT 1`,
        [namaBahanSpk, namaBahanSpk, `%${namaBahanSpk}%`],
      );
      if (rowsBhn.length > 0) {
        matchedBahan = rowsBhn[0];
      }
    } catch (_) {}
  }

  // 4. Kalkulasi estimasi pemakaian bahan
  const p = Number(spk.Panjang || 0);
  const l = Number(spk.Lebar || 0);
  const qty = Number(spk.Jumlah || 1);
  let estPakai = 0;
  if (p > 0 && l > 0) {
    estPakai = Number((p * l * qty).toFixed(2));
  } else if (p > 0) {
    estPakai = Number((p * qty).toFixed(2));
  } else {
    estPakai = qty;
  }

  return {
    spk,
    alokasi,
    bahan: {
      kode: matchedBahan?.kode || "",
      nama: matchedBahan?.nama || namaBahanSpk || "Bahan Utama SPK",
      satuan: matchedBahan?.satuan || "m²",
      hargaSatuan: Number(matchedBahan?.harga || 0),
      estPakai,
    },
  };
};

module.exports = {
  getPoJasaBrowse,
  deletePoJasa,
  ajukanPerubahan,
  getLookupPoForBpb,
  getPoDetailForBpb,
  getSudahTerima,
  savePoJasa,
  getPoJasaById,
  syncSpk,
};
