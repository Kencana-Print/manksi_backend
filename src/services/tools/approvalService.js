const db = require("../../config/database");
const { resolveSoLocation } = require("../penjualan/salesOrderService");
const realisasiBahanFormService = require("../garmen/realisasiBahanFormService");

// =========================================================================
// HELPER: HITUNG ULANG STATUS AKTIF SO/SPK SETELAH ADA APPROVAL
// Satu sumber kebenaran untuk semua fungsi otorisasi di bawah. SO/SPK
// dianggap PASIF ("N") selama masih ada approval yang pending/ditolak:
//   - tcustomer_pin      (piutang customer)
//   - tspk_pin           (harga 0 / Ket.PO)
//   - tspk_pin_prioritas (klien prioritas / TOP URGENT)
//   - tspk_pin5 NOPO     (SO tanpa Nomor PO, hanya SO baru)
//   - kolom pinjo        (MINTA ACC / MINTA / TOLAK)
// Kalau semuanya bersih -> "Y". Harus dipanggil di dalam transaksi,
// SETELAH baris approval yang bersangkutan sudah di-UPDATE.
// Mengembalikan "Y" / "N", atau null kalau nomor tidak ditemukan.
// =========================================================================
const refreshSoAktif = async (conn, nomor) => {
  const loc = await resolveSoLocation(nomor);
  if (!loc) return null;

  const isNew = loc === "new";
  const table = isNew ? "tsalesorder" : "tspk";
  const keyCol = isNew ? "so_nomor" : "spk_nomor";
  const activeCol = isNew ? "so_aktif" : "spk_aktif";
  const pinjoCol = isNew ? "so_pinjo" : "spk_pinjo";

  const ketbatalCol = isNew ? "so_ketbatal" : "spk_ketbatal";

  const [[row]] = await conn.query(
    `SELECT ${pinjoCol} AS pinjo, ${ketbatalCol} AS ketbatal
     FROM ${table} WHERE ${keyCol} = ?`,
    [nomor],
  );
  if (!row) return null;

  let pasif = false;

  // Pengajuan pembatalan yang masih menunggu: SO sengaja dipasifkan
  // oleh ajukanPembatalan, jangan diaktifkan lagi oleh approval lain.
  if (row.ketbatal === "PENGAJUAN") pasif = true;

  const [cust] = await conn.query(
    `SELECT cusp_acc FROM tcustomer_pin
     WHERE cusp_nomor = ? ORDER BY cusp_tgl_minta DESC LIMIT 1`,
    [nomor],
  );
  if (cust.length && cust[0].cusp_acc !== "Y") pasif = true;

  const [harga] = await conn.query(
    `SELECT pin_acc FROM tspk_pin WHERE pin_nomor = ? LIMIT 1`,
    [nomor],
  );
  if (harga.length && harga[0].pin_acc !== "Y") pasif = true;

  const [prio] = await conn.query(
    `SELECT pin_acc FROM tspk_pin_prioritas WHERE pin_nomor = ? LIMIT 1`,
    [nomor],
  );
  if (prio.length && prio[0].pin_acc !== "Y") pasif = true;

  if (isNew) {
    const [nopo] = await conn.query(
      `SELECT pin_acc FROM tspk_pin5
       WHERE pin_trs = "SO" AND pin_jenis = "NOPO" AND pin_nomor = ?
       ORDER BY pin_urut DESC LIMIT 1`,
      [nomor],
    );
    if (nopo.length && nopo[0].pin_acc !== "Y") pasif = true;
  }

  if (["MINTA ACC", "MINTA", "TOLAK"].includes(row.pinjo)) pasif = true;

  const aktif = pasif ? "N" : "Y";
  await conn.query(`UPDATE ${table} SET ${activeCol} = ? WHERE ${keyCol} = ?`, [
    aktif,
    nomor,
  ]);
  return aktif;
};

// --- 1. GET DATA MASTER (CUSTOMER YANG MINTA ACC) ---
const getApprovalPiutangMaster = async (query) => {
  const { startDate, endDate, belumAccSaja } = query;

  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  // Filter khusus checkbox "Tampilkan yang belum acc saja"
  const filterAcc =
    belumAccSaja === "true" || belumAccSaja === true
      ? ` AND i.cusp_acc = "" `
      : "";

  // Query UNION sesuai dengan yang ada di Delphi
  const sql = `
    SELECT c.Cus_kode AS Kode, c.Cus_nama AS Nama, c.Cus_alamat AS Alamat, "KP" AS Status
    FROM tcustomer c
    WHERE c.Cus_kode IN (
      SELECT DISTINCT i.cusp_kode 
      FROM tcustomer_pin i
      WHERE DATE(cusp_tgl_minta) >= ? AND DATE(cusp_tgl_minta) <= ? ${filterAcc}
    )
    UNION ALL
    SELECT k.Cus_kode AS Kode, k.Cus_nama AS Nama, k.Cus_alamat AS Alamat, "Kaosan" AS Status
    FROM retail.tcustomer k
    WHERE k.Cus_kode IN (
      SELECT DISTINCT i.cusp_kode 
      FROM tcustomer_pin i
      WHERE DATE(cusp_tgl_minta) >= ? AND DATE(cusp_tgl_minta) <= ? ${filterAcc}
    )
    ORDER BY Nama ASC
  `;

  const [rows] = await db.query(sql, [dStart, dEnd, dStart, dEnd]);
  return rows;
};

// --- 2. GET DAFTAR PENGAJUAN (HISTORY) PER CUSTOMER ---
const getPengajuanByCustomer = async (cusKode, query) => {
  const { startDate, endDate, belumAccSaja } = query;

  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);
  const filterAcc =
    belumAccSaja === "true" || belumAccSaja === true
      ? ` AND i.cusp_acc = "" `
      : "";

  const sql = `
    SELECT 
      i.cusp_kode AS Kode, 
      i.cusp_nomor AS SPK, 
      COALESCE(s.spk_divisi, so.so_divisi) AS Divisi, 
      DATE_FORMAT(i.cusp_tgl_minta, "%Y-%m-%d %H:%i:%s") AS TglMinta,
      i.cusp_user_minta AS Peminta, 
      DATE_FORMAT(i.cusp_tgl_pin, "%Y-%m-%d %H:%i:%s") AS TglAcc, 
      i.cusp_user_pin AS Otorisasi, 
      i.cusp_acc AS Acc,
      IF(i.cusp_user_pin <> "", "Sudah", "Belum") AS StatusPakai
    FROM tcustomer_pin i
    LEFT JOIN tspk s ON s.spk_nomor = i.cusp_nomor
    LEFT JOIN tsalesorder so ON so.so_nomor = i.cusp_nomor
    WHERE i.cusp_kode = ? 
      AND DATE(i.cusp_tgl_minta) >= ? 
      AND DATE(i.cusp_tgl_minta) <= ? 
      ${filterAcc}
    ORDER BY i.cusp_tgl_minta DESC
  `;

  const [rows] = await db.query(sql, [cusKode, dStart, dEnd]);
  return rows;
};

// --- 3. GET DETAIL INVOICE NUNGGAK (GRID BAWAH) ---
const getInvoiceNunggak = async (cusKode, status, dStart) => {
  let sql = "";

  if (status === "KP") {
    sql = `
      SELECT 
        p.nota AS Invoice, 
        DATE_FORMAT(p.Tanggal, "%d-%m-%Y") AS Tanggal, 
        DATE_FORMAT(p.tanggal_tempo, "%d-%m-%Y") AS Tempo,
        p.Debet, p.kredit AS Kredit, (p.Debet - p.kredit) AS Saldo,
        DATEDIFF(CURDATE(), p.Tanggal) AS Umur
      FROM piutang_debet p
      WHERE p.flag = 0 
        AND p.is_writeoff = 0
        AND (p.debet - p.kredit) > 100
        AND p.nota NOT IN (SELECT x.inv_nomor FROM tinv_hdr x WHERE x.INV_Keterangan LIKE "%INV YG DIKIRIM%")
        AND p.tanggal <= ? 
        AND p.customer = ?
      ORDER BY p.Tanggal ASC
    `;
  } else {
    sql = `
      SELECT 
        X.Invoice, 
        X.Tanggal, 
        X.Tempo, 
        X.Debet, 
        X.Kredit, 
        (X.Debet - X.Kredit) AS Saldo, 
        X.Umur
      FROM (
        SELECT 
          h.ph_inv_nomor AS Invoice, 
          DATE_FORMAT(h.ph_tanggal, "%d-%m-%Y") AS Tanggal, 
          DATE_FORMAT(DATE_ADD(h.ph_tanggal, INTERVAL h.ph_top DAY), "%d-%m-%Y") AS Tempo,
          h.ph_nominal AS Debet,
          IFNULL((SELECT SUM(d.pd_kredit) FROM retail.tpiutang_dtl d WHERE d.pd_ph_nomor=h.ph_nomor),0) AS Kredit,
          DATEDIFF(CURDATE(), h.ph_tanggal) AS Umur
        FROM retail.tpiutang_hdr h
        WHERE h.ph_cus_kode = ?
      ) X
      WHERE (X.Debet - X.Kredit) > 100
      ORDER BY X.Tanggal ASC
    `;
  }

  const params = status === "KP" ? [dStart, cusKode] : [cusKode];
  const [rows] = await db.query(sql, params);
  return rows;
};

// --- 4. EKSEKUSI OTORISASI (ACC / TOLAK) ---
const setOtorisasi = async (nomorSpk, statusAcc, userKode) => {
  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    await conn.query(
      `UPDATE tcustomer_pin SET 
        cusp_tgl_pin = NOW(), cusp_user_pin = ?, cusp_acc = ?
       WHERE cusp_nomor = ?`,
      [userKode, statusAcc, nomorSpk],
    );

    // ⬅ UBAH: status aktif dihitung ulang dari SEMUA approval terkait
    // (bukan cuma cek harga/pinjo seperti sebelumnya).
    await refreshSoAktif(conn, nomorSpk);

    const [userMinta] = await conn.query(
      `SELECT cusp_user_minta FROM tcustomer_pin WHERE cusp_nomor = ? LIMIT 1`,
      [nomorSpk],
    );
    await conn.commit();
    return {
      nomorSpk,
      peminta: userMinta.length > 0 ? userMinta[0].cusp_user_minta : "Unknown",
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// =========================================================================
// APPROVAL SPK HARGA 0 (MENU_ID: 257)
// =========================================================================

// --- GET DAFTAR SPK HARGA 0 (BROWSE) ---
const getHargaNolList = async (query) => {
  const { startDate, endDate, belumAccSaja } = query;
  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);
  let accFilter = "";
  if (belumAccSaja === "true" || belumAccSaja === true) {
    accFilter = ` AND p.pin_acc = "" `;
  }
  const sql = `
    SELECT * FROM (
      SELECT
        p.pin_nomor AS Nomor, s.spk_nama AS NamaSPK, s.spk_divisi AS Divisi,
        DATE_FORMAT(p.pin_tgl_minta, "%Y-%m-%d %H:%i:%s") AS TglMinta,
        p.pin_user_minta AS Peminta,
        DATE_FORMAT(p.pin_tgl_pin, "%Y-%m-%d %H:%i:%s") AS TglAcc,
        p.pin_user_pin AS Otorisasi, p.pin_acc AS Acc,
        s.spk_cus_kode AS KdCus, u.cus_nama AS Customer
      FROM tspk_pin p
      LEFT JOIN tspk s ON s.spk_nomor = p.pin_nomor
      LEFT JOIN tcustomer u ON u.cus_kode = s.spk_cus_kode
      WHERE p.pin_nomor NOT LIKE 'SO-%'
        AND DATE(p.pin_tgl_minta) >= ? AND DATE(p.pin_tgl_minta) <= ? ${accFilter}
      UNION ALL
      SELECT
        p.pin_nomor AS Nomor, s.so_nama AS NamaSPK, s.so_divisi AS Divisi,
        DATE_FORMAT(p.pin_tgl_minta, "%Y-%m-%d %H:%i:%s") AS TglMinta,
        p.pin_user_minta AS Peminta,
        DATE_FORMAT(p.pin_tgl_pin, "%Y-%m-%d %H:%i:%s") AS TglAcc,
        p.pin_user_pin AS Otorisasi, p.pin_acc AS Acc,
        s.so_cus_kode AS KdCus, u.cus_nama AS Customer
      FROM tspk_pin p
      LEFT JOIN tsalesorder s ON s.so_nomor = p.pin_nomor
      LEFT JOIN tcustomer u ON u.cus_kode = s.so_cus_kode
      WHERE p.pin_nomor LIKE 'SO-%'
        AND DATE(p.pin_tgl_minta) >= ? AND DATE(p.pin_tgl_minta) <= ? ${accFilter}
    ) x
    ORDER BY x.Nomor DESC
  `;
  const [rows] = await db.query(sql, [dStart, dEnd, dStart, dEnd]);
  return rows;
};

// --- GET DETAIL INFO MODAL OTORISASI HARGA 0 ---
const getHargaNolDetailInfo = async (nomor) => {
  const loc = await resolveSoLocation(nomor);
  if (!loc) throw new Error("Data SPK/SO tidak ditemukan.");

  const sql =
    loc === "new"
      ? `
      SELECT 
        x.so_nomor AS NomorSPK,
        DATE_FORMAT(x.so_tanggal,"%d-%m-%Y") AS TglBaru, 
        x.so_ketpo AS KetPO, 
        x.so_lama AS SPKLama,
        DATE_FORMAT(x.dtold,"%d-%m-%Y") AS TglLama, 
        IF(x.dtold IS NOT NULL, DATEDIFF(x.so_tanggal, x.dtold), 0) AS SelisihHari
      FROM (
        SELECT 
          s.so_nomor, s.so_tanggal, s.so_ketpo, s.so_lama,
          COALESCE(
            (SELECT so_tanggal FROM tsalesorder WHERE so_nomor = s.so_lama LIMIT 1),
            (SELECT spk_tanggal FROM tspk WHERE spk_nomor = s.so_lama LIMIT 1)
          ) AS dtold
        FROM tsalesorder s
        WHERE s.so_nomor = ?
      ) x
    `
      : `
      SELECT 
        x.spk_nomor AS NomorSPK,
        DATE_FORMAT(x.spk_tanggal,"%d-%m-%Y") AS TglBaru, 
        x.spk_ketpo AS KetPO, 
        x.spk_lama AS SPKLama,
        DATE_FORMAT(x.dtold,"%d-%m-%Y") AS TglLama, 
        IF(x.dtold IS NOT NULL, DATEDIFF(x.spk_tanggal, x.dtold), 0) AS SelisihHari
      FROM (
        SELECT 
          s.spk_nomor, s.spk_tanggal, s.spk_ketpo, s.spk_lama,
          COALESCE(
            (SELECT spk_tanggal FROM tspk WHERE spk_nomor = s.spk_lama LIMIT 1),
            (SELECT so_tanggal FROM tsalesorder WHERE so_nomor = s.spk_lama LIMIT 1)
          ) AS dtold
        FROM tspk s
        WHERE s.spk_nomor = ?
      ) x
    `;

  const [rows] = await db.query(sql, [nomor]);
  if (rows.length === 0) throw new Error("Data detail SPK tidak ditemukan.");
  return rows[0];
};

// --- EKSEKUSI OTORISASI HARGA 0 ---
const submitHargaNolOtorisasi = async (nomor, statusAcc, userKode) => {
  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    const updatePinSql = `
      UPDATE tspk_pin SET 
        pin_tgl_pin = NOW(), pin_user_pin = ?, pin_acc = ?
      WHERE pin_nomor = ?
    `;
    await conn.query(updatePinSql, [userKode, statusAcc, nomor]);

    const loc = await resolveSoLocation(nomor);
    if (!loc) throw new Error("SPK/SO terkait tidak ditemukan.");

    // ⬅ UBAH: hitung ulang dari semua approval terkait
    await refreshSoAktif(conn, nomor);

    const [userMinta] = await conn.query(
      `SELECT pin_user_minta FROM tspk_pin WHERE pin_nomor = ? LIMIT 1`,
      [nomor],
    );
    await conn.commit();
    return {
      nomor,
      peminta: userMinta.length > 0 ? userMinta[0].pin_user_minta : "Unknown",
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// =========================================================================
// APPROVAL SPK KLIEN PRIORITAS (MENU_ID: 258)
// =========================================================================

// --- GET DAFTAR SPK PRIORITAS (BROWSE) ---
const getPrioritasList = async (query) => {
  const { startDate, endDate, belumAccSaja } = query;
  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);
  let accFilter = "";
  if (belumAccSaja === "true" || belumAccSaja === true) {
    accFilter = ` AND p.pin_acc = "" `;
  }
  // ⚠️ FIX: sebelumnya LEFT JOIN tspk saja — nomor ber-prefix SO-
  // (tersimpan di tsalesorder, bukan tspk) selalu balik NamaSPK/Divisi/
  // Customer kosong. Sekarang UNION dua sumber, sama pola dgn getNoPoList.
  const sql = `
    SELECT * FROM (
      SELECT
        p.pin_nomor AS Nomor, s.spk_nama AS NamaSPK, s.spk_divisi AS Divisi,
        DATE_FORMAT(p.pin_tgl_minta, "%Y-%m-%d %H:%i:%s") AS TglMinta,
        p.pin_user_minta AS Peminta,
        DATE_FORMAT(p.pin_tgl_pin, "%Y-%m-%d %H:%i:%s") AS TglAcc,
        p.pin_user_pin AS Otorisasi, p.pin_acc AS Acc,
        s.spk_cus_kode AS KdCus, u.cus_nama AS Customer
      FROM tspk_pin_prioritas p
      LEFT JOIN tspk s ON s.spk_nomor = p.pin_nomor
      LEFT JOIN tcustomer u ON u.cus_kode = s.spk_cus_kode
      WHERE p.pin_nomor NOT LIKE 'SO-%'
        AND DATE(p.pin_tgl_minta) >= ? AND DATE(p.pin_tgl_minta) <= ? ${accFilter}
      UNION ALL
      SELECT
        p.pin_nomor AS Nomor, s.so_nama AS NamaSPK, s.so_divisi AS Divisi,
        DATE_FORMAT(p.pin_tgl_minta, "%Y-%m-%d %H:%i:%s") AS TglMinta,
        p.pin_user_minta AS Peminta,
        DATE_FORMAT(p.pin_tgl_pin, "%Y-%m-%d %H:%i:%s") AS TglAcc,
        p.pin_user_pin AS Otorisasi, p.pin_acc AS Acc,
        s.so_cus_kode AS KdCus, u.cus_nama AS Customer
      FROM tspk_pin_prioritas p
      LEFT JOIN tsalesorder s ON s.so_nomor = p.pin_nomor
      LEFT JOIN tcustomer u ON u.cus_kode = s.so_cus_kode
      WHERE p.pin_nomor LIKE 'SO-%'
        AND DATE(p.pin_tgl_minta) >= ? AND DATE(p.pin_tgl_minta) <= ? ${accFilter}
    ) x
    ORDER BY x.Nomor DESC
  `;
  const [rows] = await db.query(sql, [dStart, dEnd, dStart, dEnd]);
  return rows;
};

// --- EKSEKUSI OTORISASI PRIORITAS ---
const submitPrioritasOtorisasi = async (nomor, statusAcc, userKode) => {
  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    const updatePinSql = `
      UPDATE tspk_pin_prioritas SET 
        pin_tgl_pin = NOW(), pin_user_pin = ?, pin_acc = ?
       WHERE pin_nomor = ?
    `;
    await conn.query(updatePinSql, [userKode, statusAcc, nomor]);

    const loc = await resolveSoLocation(nomor);
    if (!loc) throw new Error("SPK/SO terkait tidak ditemukan.");

    // ⬅ UBAH: hitung ulang dari semua approval terkait (sebelumnya
    // hanya cek tcustomer_pin, sehingga harga/NOPO pending bisa
    // ikut teraktifkan tanpa sengaja).
    await refreshSoAktif(conn, nomor);

    const [userMinta] = await conn.query(
      `SELECT pin_user_minta FROM tspk_pin_prioritas WHERE pin_nomor = ? LIMIT 1`,
      [nomor],
    );
    await conn.commit();
    return {
      nomor,
      peminta: userMinta.length > 0 ? userMinta[0].pin_user_minta : "Unknown",
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// =========================================================================
// APPROVAL INVOICE BELUM BUAT SJ (MENU_ID: 260)
// =========================================================================

// --- GET DAFTAR INVOICE (BROWSE) ---
const getInvoiceBlmSjList = async (query) => {
  const { startDate, endDate, belumAccSaja } = query;

  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  let sqlCondition = ` WHERE p.pin_jenis = "INVBLMSJ" AND DATE(p.pin_tgl_minta) >= ? AND DATE(p.pin_tgl_minta) <= ? `;

  if (belumAccSaja === "true" || belumAccSaja === true) {
    sqlCondition += ` AND p.pin_acc = "" `;
  }

  const sql = `
    SELECT 
      p.pin_nomor AS Nomor, 
      DATE_FORMAT(h.INV_tanggal, "%d-%m-%Y") AS TglInvoice, 
      h.INV_cus_kode AS KdCus, 
      u.cus_nama AS Customer,
      DATE_FORMAT(p.pin_tgl_minta, "%Y-%m-%d %H:%i:%s") AS TglMinta, 
      p.pin_user_minta AS Peminta, 
      DATE_FORMAT(p.pin_tgl_pin, "%Y-%m-%d %H:%i:%s") AS TglAcc, 
      p.pin_user_pin AS Otorisasi, 
      p.pin_acc AS Acc
    FROM tapprove p
    INNER JOIN tinv_hdr h ON h.INV_nomor = p.pin_nomor
    LEFT JOIN tcustomer u ON u.cus_kode = h.INV_cus_kode
    ${sqlCondition}
    ORDER BY p.pin_nomor DESC
  `;

  const [rows] = await db.query(sql, [dStart, dEnd]);
  return rows;
};

// --- EKSEKUSI OTORISASI INVOICE ---
const submitInvoiceBlmSjOtorisasi = async (nomor, statusAcc, userKode) => {
  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    // 1. Update status Acc di tabel tapprove
    const updateApproveSql = `
      UPDATE tapprove SET 
        pin_tgl_pin = NOW(),
        pin_user_pin = ?,
        pin_acc = ?
      WHERE pin_jenis = "INVBLMSJ" AND pin_nomor = ?
    `;
    await conn.query(updateApproveSql, [userKode, statusAcc, nomor]);

    // 2. Update status Inv & Piutang Sesuai Delphi
    if (statusAcc === "Y") {
      // Delphi menggunakan FormatDateTime('dd-mm-yyyy hh:nn:ss', Now)
      // Karena ini Javascript, kita buat string sesuai format yang diminta Delphi
      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const dtStr = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

      await conn.query(
        `UPDATE tinv_hdr SET inv_flag = 0, inv_apvnosj = ? WHERE inv_nomor = ?`,
        [dtStr, nomor],
      );
      await conn.query(`UPDATE piutang_debet SET flag = 0 WHERE nota = ?`, [
        nomor,
      ]);
    } else if (statusAcc === "N") {
      await conn.query(
        `UPDATE tinv_hdr SET inv_apvnosj = "T" WHERE inv_nomor = ?`,
        [nomor],
      );
    }

    // Ambil nama peminta untuk alert
    const [userMinta] = await conn.query(
      `SELECT pin_user_minta FROM tapprove WHERE pin_jenis = "INVBLMSJ" AND pin_nomor = ? LIMIT 1`,
      [nomor],
    );

    await conn.commit();
    return {
      nomor,
      peminta: userMinta.length > 0 ? userMinta[0].pin_user_minta : "Unknown",
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// =========================================================================
// APPROVAL PERUBAHAN DATA (MENU_ID: 259)
// =========================================================================

// --- GET DAFTAR PERUBAHAN DATA (BROWSE) ---
const getPerubahanDataList = async (query) => {
  const { startDate, endDate, belumAccSaja } = query;

  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  // ⬅ UBAH: sekarang mencakup 2 jenis — "UBAH" (SPK PPIC turunan
  // closed) dan "TUTUPBUKU" (SO/SPK yang tanggalnya sudah lewat
  // periode tutup buku). Keduanya sama-sama alur "Pengajuan Perubahan
  // Data" di menu 259, dibedakan lewat kolom Jenis yang di-return.
  let sqlCondition = ` WHERE p.pin_jenis IN ("UBAH", "TUTUPBUKU") AND DATE(p.pin_tgl_minta) >= ? AND DATE(p.pin_tgl_minta) <= ? `;

  if (belumAccSaja === "true" || belumAccSaja === true) {
    sqlCondition += ` AND p.pin_acc = "" `;
  }

  const sql = `
    SELECT 
      IF(p.pin_program = "", "MANKSI", p.pin_program) AS Program,
      p.pin_trs AS Transaksi,
      p.pin_jenis AS Jenis,
      p.pin_nomor AS Nomor,
      DATE_FORMAT(p.pin_tgl_trs, "%d-%m-%Y") AS Tanggal,
      p.pin_ket AS Keterangan,
      p.pin_urut AS AjuanKe,
      DATE_FORMAT(p.pin_tgl_minta, "%Y-%m-%d %H:%i:%s") AS TglMinta,
      p.pin_user_minta AS Peminta,
      DATE_FORMAT(p.pin_tgl_pin, "%Y-%m-%d %H:%i:%s") AS TglAcc,
      p.pin_user_pin AS Otorisasi,
      p.pin_acc AS Acc,
      p.pin_dipakai AS Dipakai,
      p.pin_alasan AS Alasan
    FROM tspk_pin5 p
    ${sqlCondition}
    ORDER BY p.pin_trs, p.pin_nomor
  `;

  const [rows] = await db.query(sql, [dStart, dEnd]);
  return rows;
};

// --- EKSEKUSI OTORISASI PERUBAHAN DATA ---
const submitPerubahanDataOtorisasi = async (
  nomor,
  transaksi,
  urut,
  jenis, // ⬅ BARU: "UBAH" atau "TUTUPBUKU"
  statusAcc,
  userKode,
) => {
  if (!["UBAH", "TUTUPBUKU"].includes(jenis)) {
    throw new Error("Jenis approval tidak dikenal.");
  }

  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    const updateSql = `
      UPDATE tspk_pin5 SET 
        pin_tgl_pin = NOW(),
        pin_user_pin = ?,
        pin_acc = ?
      WHERE pin_trs = ? AND pin_nomor = ? AND pin_urut = ? AND pin_jenis = ?
    `;
    await conn.query(updateSql, [
      userKode,
      statusAcc,
      transaksi,
      nomor,
      urut,
      jenis,
    ]);

    // ⬅ BARU: setelah Perubahan Data (UBAH) di-ACC, SO/SPK dihitung
    // ulang -> aktif kembali kalau tidak ada approval lain yang pending.
    // Hanya saat ACC; kalau ditolak, status aktif dibiarkan apa adanya.
    if (jenis === "UBAH" && statusAcc === "Y") {
      await refreshSoAktif(conn, nomor);
    }

    const [userMinta] = await conn.query(
      `SELECT pin_user_minta FROM tspk_pin5 WHERE pin_trs = ? AND pin_nomor = ? AND pin_urut = ? AND pin_jenis = ? LIMIT 1`,
      [transaksi, nomor, urut, jenis],
    );

    await conn.commit();
    return {
      nomor,
      transaksi,
      urut,
      jenis,
      peminta: userMinta.length > 0 ? userMinta[0].pin_user_minta : "Unknown",
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// =========================================================================
// APPROVAL HAPUS DATA (MENU_ID: 261)
// =========================================================================

// --- GET DAFTAR HAPUS DATA (BROWSE) ---
const getHapusDataList = async (query) => {
  const { startDate, endDate, belumAccSaja } = query;

  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  // Filter jenis HAPUS
  let sqlCondition = ` WHERE p.pin_jenis = "HAPUS" AND DATE(p.pin_tgl_minta) >= ? AND DATE(p.pin_tgl_minta) <= ? `;

  if (belumAccSaja === "true" || belumAccSaja === true) {
    sqlCondition += ` AND p.pin_acc = "" `;
  }

  const sql = `
    SELECT 
      IF(p.pin_program = "", "MANKSI", p.pin_program) AS Program,
      p.pin_trs AS Transaksi,
      p.pin_nomor AS Nomor,
      DATE_FORMAT(p.pin_tgl_trs, "%d-%m-%Y") AS Tanggal,
      p.pin_ket AS Keterangan,
      p.pin_urut AS AjuanKe,
      DATE_FORMAT(p.pin_tgl_minta, "%Y-%m-%d %H:%i:%s") AS TglMinta,
      p.pin_user_minta AS Peminta,
      DATE_FORMAT(p.pin_tgl_pin, "%Y-%m-%d %H:%i:%s") AS TglAcc,
      p.pin_user_pin AS Otorisasi,
      p.pin_acc AS Acc,
      p.pin_dipakai AS Dipakai,
      p.pin_alasan AS Alasan
    FROM tspk_pin5 p
    ${sqlCondition}
    ORDER BY p.pin_trs, p.pin_nomor
  `;

  const [rows] = await db.query(sql, [dStart, dEnd]);
  return rows;
};

// --- EKSEKUSI OTORISASI HAPUS DATA ---
const submitHapusDataOtorisasi = async (
  nomor,
  transaksi,
  urut,
  statusAcc,
  userKode,
) => {
  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    // 1. Update status Otorisasi di tspk_pin5
    const updateSql = `
      UPDATE tspk_pin5 SET 
        pin_tgl_pin = NOW(),
        pin_user_pin = ?,
        pin_acc = ?
      WHERE pin_trs = ? AND pin_nomor = ? AND pin_urut = ? AND pin_jenis = "HAPUS"
    `;
    await conn.query(updateSql, [userKode, statusAcc, transaksi, nomor, urut]);

    // 2. EKSEKUSI PENGHAPUSAN FISIK DATA (Jika ACC = 'Y')
    if (statusAcc === "Y") {
      const trxType = String(transaksi).toUpperCase();

      if (trxType === "HAPUS PO JASA") {
        await conn.query(`DELETE FROM tpojasa_hdr WHERE pojh_nomor = ?`, [
          nomor,
        ]);
      } else if (trxType === "BPB JASA HAPUS") {
        // ⬅ FIX: samakan urutan kata dengan yang tersimpan
        await conn.query(`DELETE FROM tbpj_hdr WHERE bpj_Nomor = ?`, [nomor]);
      } else if (trxType === "HAPUS MUTASI PRODUKSI") {
        await conn.query(
          `DELETE FROM tmutasiproduksi_hdr WHERE mph_nomor = ?`,
          [nomor],
        );
      }
    }

    // Ambil nama peminta untuk alert frontend
    const [userMinta] = await conn.query(
      `SELECT pin_user_minta FROM tspk_pin5 WHERE pin_trs = ? AND pin_nomor = ? AND pin_urut = ? AND pin_jenis = "HAPUS" LIMIT 1`,
      [transaksi, nomor, urut],
    );

    await conn.commit();
    return {
      nomor,
      transaksi,
      urut,
      peminta: userMinta.length > 0 ? userMinta[0].pin_user_minta : "Unknown",
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// =========================================================================
// APPROVAL PLAFON CUSTOMER (MENU_ID: 262 = Manager, 263 = Direksi)
// =========================================================================

// --- GET DAFTAR PLAFON PENDING (BROWSE) ---
const getPlafonList = async (query) => {
  const { startDate, endDate, belumAccSaja, jenis } = query;

  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  const jenisFilter = jenis || "PENDING_MANAGER";

  // Tentukan range plafon berdasarkan jenis
  // Manager = plafon <= 20jt, Direksi = plafon > 20jt
  const plafonClause =
    jenisFilter === "PENDING_MANAGER"
      ? `AND c.cus_plafon <= 20000000`
      : `AND c.cus_plafon > 20000000`;

  let statusClause = "";
  if (belumAccSaja === "true" || belumAccSaja === true) {
    statusClause = `AND c.cus_plafon_acc = ?`;
  } else {
    // Tampilkan semua status tapi tetap filter by range plafon
    statusClause = `AND c.cus_plafon_acc IN (?, 'ACC', 'TOLAK')`;
  }

  const sql = `
    SELECT
      c.Cus_kode AS KdCus,
      c.Cus_nama AS Nama,
      c.Cus_alamat AS Alamat,
      c.Cus_kota AS Kota,
      c.cus_plafon AS Plafon,
      c.cus_plafon_acc AS PlafonAcc,
      DATE_FORMAT(c.cus_plafon_tgl_minta, "%Y-%m-%d %H:%i:%s") AS TglMinta,
      c.cus_plafon_user_minta AS Peminta,
      DATE_FORMAT(c.cus_plafon_tgl_acc, "%Y-%m-%d %H:%i:%s") AS TglAcc,
      c.cus_plafon_user_acc AS Otorisasi
    FROM tcustomer c
    WHERE DATE(c.cus_plafon_tgl_minta) >= ?
      AND DATE(c.cus_plafon_tgl_minta) <= ?
      AND c.cus_plafon > 0
      ${plafonClause}
      ${statusClause}
    ORDER BY c.cus_plafon_tgl_minta DESC
  `;

  const [rows] = await db.query(sql, [dStart, dEnd, jenisFilter]);
  return rows;
};

// --- EKSEKUSI OTORISASI PLAFON ---
const approvalPlafon = async (cusKode, statusAcc, userKode, userBagian) => {
  const [[cus]] = await db.query(
    `SELECT cus_plafon, cus_plafon_acc FROM tcustomer WHERE Cus_kode = ?`,
    [cusKode],
  );
  if (!cus) throw new Error("Customer tidak ditemukan.");

  const bagianUpper = String(userBagian).toUpperCase();

  // Validasi hak akses berdasarkan status pending
  if (
    cus.cus_plafon_acc === "PENDING_DIREKSI" &&
    !["DIREKSI", "OWNER"].includes(bagianUpper)
  ) {
    throw new Error("Hanya Direksi/Owner yang bisa ACC plafon > 20 juta.");
  }

  const newPlafonAcc = statusAcc === "Y" ? "ACC" : "TOLAK";
  const newAktif = statusAcc === "Y" ? 0 : 1; // 0 = aktif di DB Delphi

  await db.query(
    `UPDATE tcustomer SET
       cus_plafon_acc = ?,
       cus_plafon_tgl_acc = NOW(),
       cus_plafon_user_acc = ?,
       cus_aktif = ?
     WHERE Cus_kode = ?`,
    [newPlafonAcc, userKode, newAktif, cusKode],
  );

  // Ambil peminta untuk notifikasi frontend
  const [[cusData]] = await db.query(
    `SELECT cus_plafon_user_minta AS peminta FROM tcustomer WHERE Cus_kode = ?`,
    [cusKode],
  );

  return {
    cusKode,
    plafonAcc: newPlafonAcc,
    peminta: cusData?.peminta || "Unknown",
  };
};

// =========================================================================
// APPROVAL MUTASI PRODUKSI TANPA PLANNING PPIC (MENU_ID: 266)
// =========================================================================
const getMutasiNoPlanList = async (query) => {
  const { startDate, endDate, belumAccSaja } = query;
  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  let sqlCondition = ` WHERE p.pin_trs = 'MUTASI PRODUKSI NOPLAN' AND DATE(p.pin_tgl_minta) >= ? AND DATE(p.pin_tgl_minta) <= ? `;
  if (belumAccSaja === "true" || belumAccSaja === true) {
    sqlCondition += ` AND p.pin_acc = "" `;
  }

  const sql = `
    SELECT
      p.pin_nomor          AS Nomor,
      h.mph_spk_nomor      AS NomorSpk,
      IFNULL(s.spk_nama, m.mspk_nama) AS NamaSpk,
      h.mph_gdgasal        AS GdgAsal,
      h.mph_gdgtujuan      AS GdgTujuan,
      DATE_FORMAT(h.mph_tanggal, "%d-%m-%Y") AS Tanggal,
      p.pin_ket             AS Keterangan,
      DATE_FORMAT(p.pin_tgl_minta, "%Y-%m-%d %H:%i:%s") AS TglMinta,
      p.pin_user_minta      AS Peminta,
      DATE_FORMAT(p.pin_tgl_pin, "%Y-%m-%d %H:%i:%s")   AS TglAcc,
      p.pin_user_pin        AS Otorisasi,
      p.pin_acc             AS Acc
    FROM tspk_pin5 p
    LEFT JOIN tmutasiproduksi_hdr h ON h.MPH_nomor = p.pin_nomor
    LEFT JOIN tspk s     ON s.spk_nomor  = h.mph_spk_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = h.mph_spk_nomor
    ${sqlCondition}
    ORDER BY p.pin_tgl_minta DESC
  `;
  const [rows] = await db.query(sql, [dStart, dEnd]);
  return rows;
};

const submitMutasiNoPlanOtorisasi = async (nomor, statusAcc, userKode) => {
  await db.query(
    `UPDATE tspk_pin5 SET
       pin_tgl_pin = NOW(),
       pin_user_pin = ?,
       pin_acc = ?
     WHERE pin_trs = 'MUTASI PRODUKSI NOPLAN' AND pin_nomor = ? AND pin_urut = 1`,
    [userKode, statusAcc, nomor],
  );
  const [userMinta] = await db.query(
    `SELECT pin_user_minta FROM tspk_pin5
     WHERE pin_trs = 'MUTASI PRODUKSI NOPLAN' AND pin_nomor = ? AND pin_urut = 1 LIMIT 1`,
    [nomor],
  );
  return {
    nomor,
    peminta: userMinta.length > 0 ? userMinta[0].pin_user_minta : "Unknown",
  };
};

// =========================================================================
// APPROVAL CETAK SPK > 1 KALI (MENU_ID: 267)
// =========================================================================
const getSpkCetakUlangList = async (query) => {
  const { startDate, endDate, belumAccSaja } = query;
  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  let sqlCondition = ` WHERE p.pin_trs = 'SPK CETAK ULANG' AND DATE(p.pin_tgl_minta) >= ? AND DATE(p.pin_tgl_minta) <= ? `;
  if (belumAccSaja === "true" || belumAccSaja === true) {
    sqlCondition += ` AND p.pin_acc = "" `;
  }

  const sql = `
    SELECT
      p.pin_nomor          AS Nomor,
      s.spk_nama           AS NamaSpk,
      s.spk_cetak_count     AS SudahCetak,
      DATE_FORMAT(p.pin_tgl_trs, "%d-%m-%Y") AS Tanggal,
      p.pin_alasan          AS Alasan,
      DATE_FORMAT(p.pin_tgl_minta, "%Y-%m-%d %H:%i:%s") AS TglMinta,
      p.pin_user_minta      AS Peminta,
      DATE_FORMAT(p.pin_tgl_pin, "%Y-%m-%d %H:%i:%s")   AS TglAcc,
      p.pin_user_pin        AS Otorisasi,
      p.pin_acc             AS Acc
    FROM tspk_pin5 p
    LEFT JOIN tspk s ON s.spk_nomor = p.pin_nomor
    ${sqlCondition}
    ORDER BY p.pin_tgl_minta DESC
  `;
  const [rows] = await db.query(sql, [dStart, dEnd]);
  return rows;
};

const submitSpkCetakUlangOtorisasi = async (nomor, statusAcc, userKode) => {
  await db.query(
    `UPDATE tspk_pin5 SET
       pin_tgl_pin = NOW(), pin_user_pin = ?, pin_acc = ?
     WHERE pin_trs = 'SPK CETAK ULANG' AND pin_nomor = ?
       AND pin_urut = (
         SELECT max_urut FROM (
           SELECT MAX(pin_urut) AS max_urut FROM tspk_pin5
           WHERE pin_trs = 'SPK CETAK ULANG' AND pin_nomor = ?
         ) t
       )`,
    [userKode, statusAcc, nomor, nomor],
  );
  const [userMinta] = await db.query(
    `SELECT pin_user_minta FROM tspk_pin5
     WHERE pin_trs = 'SPK CETAK ULANG' AND pin_nomor = ? ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );
  return {
    nomor,
    peminta: userMinta.length > 0 ? userMinta[0].pin_user_minta : "Unknown",
  };
};

// =========================================================================
// APPROVAL PEMBATALAN SPK/SO (MENU_ID: 262)
// =========================================================================

const getPembatalanSpkList = async (query) => {
  const { startDate, endDate, belumAccSaja } = query;
  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  let sqlCondition = ` WHERE DATE(f.fb_tanggal) >= ? AND DATE(f.fb_tanggal) <= ? `;
  if (belumAccSaja === "true" || belumAccSaja === true) {
    sqlCondition += ` AND f.fb_apv_user = "" `;
  }

  const sql = `
    SELECT
      f.fb_nomor      AS Nomor,
      DATE_FORMAT(f.fb_tanggal, "%d-%m-%Y") AS TglPengajuan,
      f.fb_spk        AS Spk,
      COALESCE(s1.spk_nama, s2.so_nama)     AS NamaSpk,
      COALESCE(s1.spk_jumlah, s2.so_jumlah) AS JmlSpk,
      f.fb_user_create AS Dibuat,
      DATE_FORMAT(f.fb_date_create, "%Y-%m-%d %H:%i:%s") AS Created,
      f.fb_apv        AS Approved,
      f.fb_apv_user   AS ApvUser,
      DATE_FORMAT(f.fb_apv_tgl, "%Y-%m-%d %H:%i:%s") AS ApvTgl,
      COALESCE(s1.spk_cus_kode, s2.so_cus_kode) AS KdCus,
      c.Cus_nama      AS Customer
    FROM tspk_formbatal f
    LEFT JOIN tspk s1 ON s1.spk_nomor = f.fb_spk
    LEFT JOIN tsalesorder s2 ON s2.so_nomor = f.fb_spk
    LEFT JOIN tcustomer c ON c.Cus_kode = COALESCE(s1.spk_cus_kode, s2.so_cus_kode)
    ${sqlCondition}
    ORDER BY f.fb_nomor
  `;
  const [rows] = await db.query(sql, [dStart, dEnd]);
  return rows;
};

// EKSEKUSI OTORISASI — sesuai Delphi simpandata() cabang APV=true
// ⚠️ DIPERBAIKI: source Delphi asli update tspk pakai fb_nomor (bug —
// harusnya pakai spk_nomor asli / fb_spk). Di sini pakai fb_spk yang benar.
const submitPembatalanSpkOtorisasi = async (fbNomor, statusAcc, userKode) => {
  if (!["Y", "N"].includes(statusAcc)) {
    throw new Error("Status ACC harus Y atau N.");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[fb]] = await conn.query(
      `SELECT fb_spk, fb_user_create FROM tspk_formbatal WHERE fb_nomor = ? FOR UPDATE`,
      [fbNomor],
    );
    if (!fb) throw new Error("Data pengajuan tidak ditemukan.");

    await conn.query(
      `UPDATE tspk_formbatal SET fb_apv = ?, fb_apv_user = ?, fb_apv_tgl = NOW()
       WHERE fb_nomor = ?`,
      [statusAcc, userKode, fbNomor],
    );

    const loc = await resolveSoLocation(fb.fb_spk);
    if (!loc) throw new Error("SPK/SO terkait tidak ditemukan.");

    if (statusAcc === "Y") {
      if (loc === "new") {
        await conn.query(
          `UPDATE tsalesorder SET so_close = 1, so_ketbatal = "APPROVAL" WHERE so_nomor = ?`,
          [fb.fb_spk],
        );
      } else {
        await conn.query(
          `UPDATE tspk SET spk_close = 1, spk_ketbatal = "APPROVAL" WHERE spk_nomor = ?`,
          [fb.fb_spk],
        );
      }
    } else {
      if (loc === "new") {
        await conn.query(
          `UPDATE tsalesorder SET so_aktif = "Y", so_ketbatal = "TOLAK" WHERE so_nomor = ?`,
          [fb.fb_spk],
        );
      } else {
        await conn.query(
          `UPDATE tspk SET spk_aktif = "Y", spk_ketbatal = "TOLAK" WHERE spk_nomor = ?`,
          [fb.fb_spk],
        );
      }
    }

    await conn.commit();
    return { fbNomor, spkNomor: fb.fb_spk, peminta: fb.fb_user_create };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// =========================================================================
// APPROVAL SPK GANTI QTY & JENIS KAIN (MENU_ID: 265)
// ⚠️ sesuai Delphi ufrmBrowPinSpkGantiQty.pas: browse murni dari tspk_pin5,
// TIDAK join ke tspk/customer (beda dengan Pembatalan SPK yang join).
// pin_trs tidak difilter (bisa "SPK" legacy atau "SO" konvensi web).
// =========================================================================
const getGantiQtyKainList = async (query) => {
  const { startDate, endDate, belumAccSaja } = query;
  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  let sqlCondition = ` WHERE p.pin_jenis = "GANTI" AND DATE(p.pin_tgl_minta) >= ? AND DATE(p.pin_tgl_minta) <= ? `;
  if (belumAccSaja === "true" || belumAccSaja === true) {
    sqlCondition += ` AND p.pin_acc = "" `;
  }

  const sql = `
    SELECT
      IF(p.pin_program = "", "MANKSI", p.pin_program) AS Program,
      p.pin_trs AS Transaksi,
      p.pin_nomor AS Nomor,
      DATE_FORMAT(p.pin_tgl_trs, "%d-%m-%Y") AS Tanggal,
      p.pin_ket AS Keterangan,
      p.pin_urut AS AjuanKe,
      DATE_FORMAT(p.pin_tgl_minta, "%Y-%m-%d %H:%i:%s") AS TglMinta,
      p.pin_user_minta AS Peminta,
      DATE_FORMAT(p.pin_tgl_pin, "%Y-%m-%d %H:%i:%s") AS TglAcc,
      p.pin_user_pin AS Otorisasi,
      p.pin_acc AS Acc,
      p.pin_dipakai AS Dipakai,
      p.pin_alasan AS Alasan
    FROM tspk_pin5 p
    ${sqlCondition}
    ORDER BY p.pin_trs, p.pin_nomor
  `;
  const [rows] = await db.query(sql, [dStart, dEnd]);
  return rows;
};

// EKSEKUSI OTORISASI — sesuai Delphi cxButton5Click.
// ⬅ UBAH: sekarang dalam transaksi, dan saat ACC status aktif SO/SPK
// dihitung ulang (refreshSoAktif). Perubahan qty/kain aktual tetap
// dilakukan manual terpisah setelah ACC.
const submitGantiQtyKainOtorisasi = async (
  nomor,
  transaksi,
  urut,
  statusAcc,
  userKode,
) => {
  if (!["Y", "N"].includes(statusAcc)) {
    throw new Error("Status ACC harus Y atau N.");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[pin]] = await conn.query(
      `SELECT pin_user_minta FROM tspk_pin5
       WHERE pin_trs = ? AND pin_nomor = ? AND pin_urut = ? AND pin_jenis = "GANTI"
       FOR UPDATE`,
      [transaksi, nomor, urut],
    );
    if (!pin) throw new Error("Data pengajuan tidak ditemukan.");

    await conn.query(
      `UPDATE tspk_pin5 SET
         pin_tgl_pin = NOW(),
         pin_user_pin = ?,
         pin_acc = ?
       WHERE pin_trs = ? AND pin_nomor = ? AND pin_urut = ? AND pin_jenis = "GANTI"`,
      [userKode, statusAcc, transaksi, nomor, urut],
    );

    if (statusAcc === "Y") {
      await refreshSoAktif(conn, nomor);
    }

    await conn.commit();
    return { nomor, transaksi, urut, peminta: pin.pin_user_minta };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// =========================================================================
// APPROVAL SO/MAP TANPA NOMOR PO (MENU_ID: 268)
// ⚠️ 1 menu approval yang sama menaungi 2 sumber transaksi (SO & MAP),
// dibedakan lewat kolom "Jenis" hasil UNION — pin_trs tetap "SO"/"MAP"
// terpisah di tspk_pin5 (supaya urut/dipakai per transaksi tetap aman),
// tapi ditampilkan sebagai 1 daftar gabungan di UI approval.
// =========================================================================
const getNoPoList = async (query) => {
  const { startDate, endDate, belumAccSaja } = query;
  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  let accFilter = "";
  if (belumAccSaja === "true" || belumAccSaja === true) {
    accFilter = ` AND p.pin_acc = "" `;
  }

  const sql = `
    SELECT * FROM (
      SELECT
        'SO' AS Jenis,
        p.pin_nomor AS Nomor,
        s.so_nama AS Nama,
        s.so_divisi AS Divisi,
        s.so_jumlah AS Jumlah,
        s.so_cus_kode AS KdCus,
        c.Cus_nama AS Customer,
        DATE_FORMAT(p.pin_tgl_trs, "%d-%m-%Y") AS Tanggal,
        p.pin_ket AS Keterangan,
        DATE_FORMAT(p.pin_tgl_minta, "%Y-%m-%d %H:%i:%s") AS TglMinta,
        p.pin_user_minta AS Peminta,
        DATE_FORMAT(p.pin_tgl_pin, "%Y-%m-%d %H:%i:%s") AS TglAcc,
        p.pin_user_pin AS Otorisasi,
        p.pin_acc AS Acc
      FROM tspk_pin5 p
      LEFT JOIN tsalesorder s ON s.so_nomor = p.pin_nomor
      LEFT JOIN tcustomer c ON c.Cus_kode = s.so_cus_kode
      WHERE p.pin_trs = "SO" AND p.pin_jenis = "NOPO"
        AND DATE(p.pin_tgl_minta) >= ? AND DATE(p.pin_tgl_minta) <= ?
        ${accFilter}
      UNION ALL
      SELECT
        'MAP' AS Jenis,
        p.pin_nomor AS Nomor,
        m.mspk_nama AS Nama,
        m.mspk_divisi AS Divisi,
        m.mspk_jumlah AS Jumlah,
        m.mspk_cus_kode AS KdCus,
        c.Cus_nama AS Customer,
        DATE_FORMAT(p.pin_tgl_trs, "%d-%m-%Y") AS Tanggal,
        p.pin_ket AS Keterangan,
        DATE_FORMAT(p.pin_tgl_minta, "%Y-%m-%d %H:%i:%s") AS TglMinta,
        p.pin_user_minta AS Peminta,
        DATE_FORMAT(p.pin_tgl_pin, "%Y-%m-%d %H:%i:%s") AS TglAcc,
        p.pin_user_pin AS Otorisasi,
        p.pin_acc AS Acc
      FROM tspk_pin5 p
      LEFT JOIN tmemospk m ON m.mspk_nomor = p.pin_nomor
      LEFT JOIN tcustomer c ON c.Cus_kode = m.mspk_cus_kode
      WHERE p.pin_trs = "MAP" AND p.pin_jenis = "NOPO"
        AND DATE(p.pin_tgl_minta) >= ? AND DATE(p.pin_tgl_minta) <= ?
        ${accFilter}
    ) x
    ORDER BY x.TglMinta DESC
  `;
  const [rows] = await db.query(sql, [dStart, dEnd, dStart, dEnd]);
  return rows;
};

// ⬅ UBAH: cabang SO memakai refreshSoAktif (semua blocking-pin dicek
// lewat satu helper), bukan lagi daftar cek manual di sini.
const submitNoPoOtorisasi = async (nomor, statusAcc, userKode) => {
  if (!["Y", "N"].includes(statusAcc)) {
    throw new Error("Status ACC harus Y atau N.");
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[pin]] = await conn.query(
      `SELECT pin_trs, pin_urut, pin_user_minta FROM tspk_pin5
       WHERE pin_trs IN ("SO", "MAP") AND pin_jenis = "NOPO" AND pin_nomor = ?
       ORDER BY pin_urut DESC LIMIT 1 FOR UPDATE`,
      [nomor],
    );
    if (!pin) throw new Error("Data pengajuan tidak ditemukan.");
    const jenis = pin.pin_trs;

    await conn.query(
      `UPDATE tspk_pin5 SET pin_tgl_pin = NOW(), pin_user_pin = ?, pin_acc = ?
       WHERE pin_trs = ? AND pin_jenis = "NOPO" AND pin_nomor = ? AND pin_urut = ?`,
      [userKode, statusAcc, jenis, nomor, pin.pin_urut],
    );

    if (jenis === "SO") {
      // Baris NOPO sudah di-UPDATE di atas, jadi helper langsung
      // membaca status terbarunya (ACC -> bersih, TOLAK -> pasif).
      await refreshSoAktif(conn, nomor);
      // ⚠️ pin_dipakai SENGAJA TIDAK di-set "Y" di sini. Approval NOPO
      // berbeda dari pola generik Perubahan Data/Hapus Data — "dipakai"
      // berarti "sudah dikonsumsi siklus edit berikutnya", BUKAN "baru
      // saja di-ACC". Kalau di-set "Y" di sini, edit SO berikutnya
      // (PO masih kosong) salah mendeteksi approval sebagai basi.
    } else {
      const activeValue = statusAcc === "Y" ? "Y" : "N";
      await conn.query(
        `UPDATE tmemospk SET mspk_aktif = ? WHERE mspk_nomor = ?`,
        [activeValue, nomor],
      );
    }

    await conn.commit();
    return { nomor, peminta: pin.pin_user_minta };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// =========================================================================
// APPROVAL REALISASI MINTA BAHAN BEDA DENGAN MKB/PERMINTAAN (MENU_ID: 269)
// ⚠️ pin_trs SENGAJA dibedakan ('REALISASI BEDA BAHAN') dari pin_trs yang
// sudah dipakai di tproduksimintaService ('REALISASI MINTA BAHAN' untuk
// approval edit setelah tutup buku). Kalau disamakan, subquery
// "ORDER BY pin_urut DESC LIMIT 1" di getDetailRealisasi bisa salah ambil
// baris pin yang bukan miliknya.
// Row pending dibuat oleh tproduksimintaService.saveData() saat mendeteksi
// kode bahan hasil scan != kode bahan sesuai MKB/Minta Bahan, lalu
// promin_aktif di-set 'N' (pasif) sampai baris ini di-ACC.
// =========================================================================

// --- GET DAFTAR REALISASI BEDA BAHAN (BROWSE) ---
const getRealisasiBedaBahanList = async (query) => {
  const { startDate, endDate, belumAccSaja } = query;
  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  let sqlCondition = ` WHERE p.pin_trs = 'REALISASI BEDA BAHAN' AND DATE(p.pin_tgl_minta) >= ? AND DATE(p.pin_tgl_minta) <= ? `;
  if (belumAccSaja === "true" || belumAccSaja === true) {
    sqlCondition += ` AND p.pin_acc = "" `;
  }

  const sql = `
    SELECT
      p.pin_nomor            AS Nomor,
      h.promin_minta         AS NomorMinta,
      h.promin_spk_nomor     AS NomorSpk,
      IFNULL(s.spk_nama, m.mspk_nama) AS NamaSpk,
      h.promin_gdgp_kode     AS GdgProduksi,
      h.promin_aktif         AS StatusAktif,
      DATE_FORMAT(h.promin_tanggal, "%d-%m-%Y") AS TglRealisasi,
      p.pin_ket               AS Keterangan,
      DATE_FORMAT(p.pin_tgl_minta, "%Y-%m-%d %H:%i:%s") AS TglMinta,
      p.pin_user_minta        AS Peminta,
      DATE_FORMAT(p.pin_tgl_pin, "%Y-%m-%d %H:%i:%s")   AS TglAcc,
      p.pin_user_pin           AS Otorisasi,
      p.pin_acc                AS Acc
    FROM tspk_pin5 p
    LEFT JOIN tproduksiminta_hdr h ON h.promin_nomor = p.pin_nomor
    LEFT JOIN tspk s     ON s.spk_nomor  = h.promin_spk_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = h.promin_spk_nomor
    ${sqlCondition}
    ORDER BY p.pin_tgl_minta DESC
  `;
  const [rows] = await db.query(sql, [dStart, dEnd]);
  return rows;
};

// --- DETAIL SELISIH (barang yang discan vs yang seharusnya) ---
const getRealisasiBedaBahanDetail = async (nomor) => {
  const sql = `
    SELECT
      d.promind_kodem   AS KodeDiscan,
      cm.Bhn_Name       AS NamaDiscan,
      d.promind_bhn_kode AS KodeSeharusnya,
      cb.Bhn_Name       AS NamaSeharusnya,
      d.promind_jumlah  AS Jumlah
    FROM tproduksiminta_dtl d
    LEFT JOIN tbahan cm ON cm.Bhn_kode = d.promind_kodem
    LEFT JOIN tbahan cb ON cb.Bhn_kode = d.promind_bhn_kode
    WHERE d.promind_promin_nomor = ?
      AND d.promind_kodem <> d.promind_bhn_kode
  `;
  const [rows] = await db.query(sql, [nomor]);
  return rows;
};

// --- EKSEKUSI OTORISASI REALISASI BEDA BAHAN ---
const submitRealisasiBedaBahanOtorisasi = async (
  nomor,
  statusAcc,
  userKode,
) => {
  if (!["Y", "N"].includes(statusAcc)) {
    throw new Error("Status ACC harus Y atau N.");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[pin]] = await conn.query(
      `SELECT pin_user_minta, pin_acc FROM tspk_pin5
       WHERE pin_trs = 'REALISASI BEDA BAHAN' AND pin_nomor = ? AND pin_urut = 1 FOR UPDATE`,
      [nomor],
    );
    if (!pin) throw new Error("Data pengajuan tidak ditemukan.");
    if (pin.pin_acc) throw new Error("Pengajuan ini sudah pernah diotorisasi.");

    if (statusAcc === "Y") {
      // ⚠️ GATE WAJIB: approval saja TIDAK CUKUP untuk mengaktifkan.
      // MKB terkait harus sudah diubah dulu (kode bahan di tmkb_dtl
      // disesuaikan ke kode yang benar-benar discan) — baru setelah
      // itu realisasi ini boleh diaktifkan & memotong stok.
      const [[hdr]] = await conn.query(
        `SELECT promin_mkb FROM tproduksiminta_hdr WHERE promin_nomor = ?`,
        [nomor],
      );
      if (!hdr?.promin_mkb) {
        throw new Error(
          "Realisasi ini tidak terhubung ke MKB manapun — tidak bisa diverifikasi.",
        );
      }

      const [mismatchRows] = await conn.query(
        `SELECT DISTINCT promind_bhn_kode, promind_kodem
         FROM tproduksiminta_dtl
         WHERE promind_promin_nomor = ? AND promind_kodem <> promind_bhn_kode`,
        [nomor],
      );

      for (const m of mismatchRows) {
        const [[mkbCheck]] = await conn.query(
          `SELECT COUNT(*) AS cnt FROM tmkb_dtl
           WHERE mkbd_mkb_nomor = ? AND mkbd_bhn_kode = ?`,
          [hdr.promin_mkb, m.promind_bhn_kode],
        );
        if (!mkbCheck || mkbCheck.cnt === 0) {
          throw new Error(
            `MKB ${hdr.promin_mkb} belum diubah — kode bahan "${m.promind_kodem}" ` +
              `perlu diganti ke "${m.promind_bhn_kode}" (sesuai yang discan) ` +
              `di form MKB terlebih dahulu, sebelum realisasi ini bisa di-ACC.`,
          );
        }
      }
    }

    await conn.query(
      `UPDATE tspk_pin5 SET pin_tgl_pin = NOW(), pin_user_pin = ?, pin_acc = ?
       WHERE pin_trs = 'REALISASI BEDA BAHAN' AND pin_nomor = ? AND pin_urut = 1`,
      [userKode, statusAcc, nomor],
    );

    if (statusAcc === "Y") {
      await conn.query(
        `UPDATE tproduksiminta_hdr SET promin_aktif = "Y" WHERE promin_nomor = ?`,
        [nomor],
      );
      await realisasiBahanFormService.applyStokKeluar(nomor, conn);

      // ⬅ BARU: approval beda bahan = keputusan bisnis "substitusi
      // diterima" — Permintaan Bahan terkait langsung di-close,
      // supaya tidak nyangkut PARTIAL selamanya (baris kode asli
      // permanen netto=0 karena barangnya discan sebagai kode lain).
      const [[realisasiHdr]] = await conn.query(
        `SELECT promin_minta FROM tproduksiminta_hdr WHERE promin_nomor = ?`,
        [nomor],
      );
      if (realisasiHdr?.promin_minta) {
        await conn.query(
          `UPDATE tmintabahan_hdr SET min_close = 1 WHERE min_nomor = ?`,
          [realisasiHdr.promin_minta],
        );
      }
    }

    await conn.commit();
    return { nomor, peminta: pin.pin_user_minta };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

module.exports = {
  refreshSoAktif,
  getApprovalPiutangMaster,
  getPengajuanByCustomer,
  getInvoiceNunggak,
  setOtorisasi,
  getHargaNolList,
  getHargaNolDetailInfo,
  submitHargaNolOtorisasi,
  getPrioritasList,
  submitPrioritasOtorisasi,
  getInvoiceBlmSjList,
  submitInvoiceBlmSjOtorisasi,
  getPerubahanDataList,
  submitPerubahanDataOtorisasi,
  getHapusDataList,
  submitHapusDataOtorisasi,
  getPlafonList,
  approvalPlafon,
  getMutasiNoPlanList,
  submitMutasiNoPlanOtorisasi,
  getSpkCetakUlangList,
  submitSpkCetakUlangOtorisasi,
  getPembatalanSpkList,
  submitPembatalanSpkOtorisasi,
  getGantiQtyKainList,
  submitGantiQtyKainOtorisasi,
  getNoPoList,
  submitNoPoOtorisasi,
  getRealisasiBedaBahanList,
  getRealisasiBedaBahanDetail,
  submitRealisasiBedaBahanOtorisasi,
};
