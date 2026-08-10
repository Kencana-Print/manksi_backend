const db = require("../../config/database");
const { resolveSoLocation } = require("../penjualan/salesOrderService");

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

  // Logic Pembedaan Piutang Umum (KP) dan Kaosan
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
        AND (p.debet - p.kredit) > 100
        AND p.nota NOT IN (SELECT x.inv_nomor FROM tinv_hdr x WHERE x.INV_Keterangan LIKE "%INV YG DIKIRIM%")
        AND p.tanggal >= "2021-01-01" 
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

  // Jika Kaosan, startdate tidak dipakai di kueri
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

    // ⚠️ FIX: sinkronisasi aktif harus target tabel yang benar
    // (tspk vs tsalesorder), termasuk kolom pinjo yang beda nama
    // (spk_pinjo vs so_pinjo).
    const loc = await resolveSoLocation(nomorSpk);
    if (loc) {
      const targetTable = loc === "new" ? "tsalesorder" : "tspk";
      const targetCol = loc === "new" ? "so_nomor" : "spk_nomor";
      const activeCol = loc === "new" ? "so_aktif" : "spk_aktif";
      const pinjoCol = loc === "new" ? "so_pinjo" : "spk_pinjo";

      if (statusAcc === "Y") {
        const [cekPinHarga] = await conn.query(
          `SELECT pin_acc FROM tspk_pin WHERE pin_nomor = ?`,
          [nomorSpk],
        );
        let amanUntukAktif = false;
        if (cekPinHarga.length > 0) {
          if (cekPinHarga[0].pin_acc === "Y") amanUntukAktif = true;
        } else {
          const [cekPinJo] = await conn.query(
            `SELECT ${pinjoCol} AS pinjo FROM ${targetTable} WHERE ${targetCol} = ?`,
            [nomorSpk],
          );
          if (
            cekPinJo.length > 0 &&
            (cekPinJo[0].pinjo === "MINTA" || cekPinJo[0].pinjo === "TOLAK")
          ) {
            amanUntukAktif = false;
          } else {
            amanUntukAktif = true;
          }
        }
        if (amanUntukAktif) {
          await conn.query(
            `UPDATE ${targetTable} SET ${activeCol} = "Y" WHERE ${targetCol} = ?`,
            [nomorSpk],
          );
        }
      } else if (statusAcc === "N") {
        await conn.query(
          `UPDATE ${targetTable} SET ${activeCol} = "N" WHERE ${targetCol} = ?`,
          [nomorSpk],
        );
      }
    }

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
    const targetTable = loc === "new" ? "tsalesorder" : "tspk";
    const targetCol = loc === "new" ? "so_nomor" : "spk_nomor";
    const activeCol = loc === "new" ? "so_aktif" : "spk_aktif";

    if (statusAcc === "Y") {
      const [cekPinCus] = await conn.query(
        `SELECT cusp_acc FROM tcustomer_pin WHERE cusp_nomor = ?`,
        [nomor],
      );
      let amanUntukAktif = false;
      if (cekPinCus.length > 0) {
        if (cekPinCus[0].cusp_acc === "Y") amanUntukAktif = true;
      } else {
        amanUntukAktif = true;
      }
      if (amanUntukAktif) {
        await conn.query(
          `UPDATE ${targetTable} SET ${activeCol} = "Y" WHERE ${targetCol} = ?`,
          [nomor],
        );
      }
    } else if (statusAcc === "N") {
      await conn.query(
        `UPDATE ${targetTable} SET ${activeCol} = "N" WHERE ${targetCol} = ?`,
        [nomor],
      );
    }

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

    // ⚠️ FIX: SPK/SO bisa tersimpan di tspk (legacy) ATAU tsalesorder
    // (baru) — tentukan tabel target yang benar sebelum UPDATE aktif,
    // sama pola dgn submitPembatalanSpkOtorisasi/submitNoPoOtorisasi.
    const loc = await resolveSoLocation(nomor);
    if (!loc) throw new Error("SPK/SO terkait tidak ditemukan.");
    const targetTable = loc === "new" ? "tsalesorder" : "tspk";
    const targetCol = loc === "new" ? "so_nomor" : "spk_nomor";
    const activeCol = loc === "new" ? "so_aktif" : "spk_aktif";

    if (statusAcc === "Y") {
      const [cekPinCus] = await conn.query(
        `SELECT cusp_acc FROM tcustomer_pin WHERE cusp_nomor = ?`,
        [nomor],
      );
      let amanUntukAktif = true;
      if (cekPinCus.length > 0 && cekPinCus[0].cusp_acc !== "Y") {
        amanUntukAktif = false;
      }
      if (amanUntukAktif) {
        await conn.query(
          `UPDATE ${targetTable} SET ${activeCol} = "Y" WHERE ${targetCol} = ?`,
          [nomor],
        );
      }
    } else if (statusAcc === "N") {
      await conn.query(
        `UPDATE ${targetTable} SET ${activeCol} = "N" WHERE ${targetCol} = ?`,
        [nomor],
      );
    }

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

  let sqlCondition = ` WHERE p.pin_jenis = "UBAH" AND DATE(p.pin_tgl_minta) >= ? AND DATE(p.pin_tgl_minta) <= ? `;

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

// --- EKSEKUSI OTORISASI PERUBAHAN DATA ---
const submitPerubahanDataOtorisasi = async (
  nomor,
  transaksi,
  urut,
  statusAcc,
  userKode,
) => {
  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    const updateSql = `
      UPDATE tspk_pin5 SET 
        pin_tgl_pin = NOW(),
        pin_user_pin = ?,
        pin_acc = ?
      WHERE pin_trs = ? AND pin_nomor = ? AND pin_urut = ? AND pin_jenis = "UBAH"
    `;
    await conn.query(updateSql, [userKode, statusAcc, transaksi, nomor, urut]);

    // Ambil nama peminta untuk alert
    const [userMinta] = await conn.query(
      `SELECT pin_user_minta FROM tspk_pin5 WHERE pin_trs = ? AND pin_nomor = ? AND pin_urut = ? AND pin_jenis = "UBAH" LIMIT 1`,
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
      } else if (trxType === "HAPUS BPB JASA") {
        await conn.query(`DELETE FROM tbpj_hdr WHERE bpj_Nomor = ?`, [nomor]);
      } else if (trxType === "HAPUS MUTASI PRODUKSI") {
        await conn.query(
          `DELETE FROM tmutasiproduksi_hdr WHERE mph_nomor = ?`,
          [nomor],
        );
      }
      // Note: Bisa ditambahkan jenis penghapusan lain di masa depan ke dalam if-else ini
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

// EKSEKUSI OTORISASI — sesuai Delphi cxButton5Click ✅
// Hanya update tspk_pin5, tidak menyentuh tspk/tsalesorder sama sekali
// (perubahan qty/kain aktual dilakukan manual terpisah setelah ACC).
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

  const [[pin]] = await db.query(
    `SELECT pin_user_minta FROM tspk_pin5
     WHERE pin_trs = ? AND pin_nomor = ? AND pin_urut = ? AND pin_jenis = "GANTI"`,
    [transaksi, nomor, urut],
  );
  if (!pin) throw new Error("Data pengajuan tidak ditemukan.");

  await db.query(
    `UPDATE tspk_pin5 SET
       pin_tgl_pin = NOW(),
       pin_user_pin = ?,
       pin_acc = ?
     WHERE pin_trs = ? AND pin_nomor = ? AND pin_urut = ? AND pin_jenis = "GANTI"`,
    [userKode, statusAcc, transaksi, nomor, urut],
  );

  return { nomor, transaksi, urut, peminta: pin.pin_user_minta };
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

// ⚠️ Safety check tambahan (bukan replikasi — desain baru): saat ACC,
// jangan aktifkan SO kalau masih ada blocking-pin lain yg pending
// (piutang, harga 0, prioritas, pinjo), supaya tidak override approval
// lain yang belum selesai.
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

    if (statusAcc === "Y") {
      if (jenis === "SO") {
        const [[so]] = await conn.query(
          `SELECT so_pinjo FROM tsalesorder WHERE so_nomor = ?`,
          [nomor],
        );
        const [[custPin]] = await conn.query(
          `SELECT cusp_acc FROM tcustomer_pin WHERE cusp_nomor = ? ORDER BY cusp_tgl_minta DESC LIMIT 1`,
          [nomor],
        );
        const [[hargaPin]] = await conn.query(
          `SELECT pin_acc FROM tspk_pin WHERE pin_nomor = ?`,
          [nomor],
        );
        const [[prioPin]] = await conn.query(
          `SELECT pin_acc FROM tspk_pin_prioritas WHERE pin_nomor = ?`,
          [nomor],
        );
        const blocked =
          (custPin && custPin.cusp_acc !== "Y") ||
          (hargaPin && hargaPin.pin_acc !== "Y") ||
          (prioPin && prioPin.pin_acc !== "Y") ||
          (so && ["MINTA", "TOLAK"].includes(so.so_pinjo));
        if (!blocked) {
          await conn.query(
            `UPDATE tsalesorder SET so_aktif = "Y" WHERE so_nomor = ?`,
            [nomor],
          );
        }
      } else {
        await conn.query(
          `UPDATE tmemospk SET mspk_aktif = "Y" WHERE mspk_nomor = ?`,
          [nomor],
        );
      }
      // ⚠️ FIX: pin_dipakai SENGAJA TIDAK di-set "Y" di sini.
      // Approval NOPO berbeda dari pola generik Perubahan Data/Hapus
      // Data — di sini "dipakai" berarti "approval ini sudah dikonsumsi
      // oleh siklus edit berikutnya yang butuh approval baru lagi",
      // BUKAN "baru saja di-ACC". Kalau di-set "Y" di sini, edit SO
      // berikutnya (PO masih kosong) akan salah mendeteksi approval
      // sebagai basi dan meminta approval ulang padahal SO belum
      // berubah kondisi — itulah bug yang dilaporkan.
    } else {
      const targetTable = jenis === "SO" ? "tsalesorder" : "tmemospk";
      const targetCol = jenis === "SO" ? "so_nomor" : "mspk_nomor";
      const activeCol = jenis === "SO" ? "so_aktif" : "mspk_aktif";
      await conn.query(
        `UPDATE ${targetTable} SET ${activeCol} = "N" WHERE ${targetCol} = ?`,
        [nomor],
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

module.exports = {
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
};
