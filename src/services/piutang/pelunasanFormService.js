const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

const generateNomorPelunasan = async (cabang, tanggal) => {
  const tahun = new Date(tanggal).getFullYear().toString().slice(-2);
  const prefix = `${cabang}${tahun}`;

  const sql = `SELECT MAX(RIGHT(nomor, 5)) AS nomerator 
               FROM piutang_kredit_header 
               WHERE LEFT(nomor, 4) = ?`;
  const [rows] = await db.query(sql, [prefix]);

  let urut = 1;
  if (rows.length > 0 && rows[0].nomerator) {
    urut = parseInt(rows[0].nomerator, 10) + 1;
  }
  return `${prefix}${urut.toString().padStart(5, "0")}`;
};

// ── 1. FORM EDIT ──
const getFormEditData = async (nomor) => {
  const [headerRows] = await db.query(
    `SELECT 
      a.nomor, 
      a.cabang, 
      c.perush_nama                          AS namacabang,
      DATE_FORMAT(a.tanggal, "%Y-%m-%d")     AS tanggal,
      a.notes
     FROM piutang_kredit_header a
     INNER JOIN tperusahaan c ON a.cabang = c.perush_kode
     WHERE a.nomor = ?`,
    [nomor],
  );
  if (!headerRows.length) throw new Error("Nomor Pelunasan tidak ditemukan.");

  const header = headerRows[0];

  // Detail — ambil sekalian info invoice per nota untuk tampil di frontend
  const [detailRows] = await db.query(
    `SELECT
      d.nota,
      d.kode,
      d.no_bukti,
      d.kredit,
      d.notes                                      AS notesdetail,
      -- Info invoice
      i.inv_cus_kode,
      c.cus_nama,
      DATE_FORMAT(i.inv_tanggal, "%Y-%m-%d")       AS inv_tanggal,
      DATE_FORMAT(i.inv_tanggal_tempo, "%Y-%m-%d") AS inv_tanggal_tempo,
      IFNULL((
        SELECT SUM(f.invd_harga * f.invd_jumlah *
          IF(i.inv_sts_ppn = 1, ((100 + i.inv_ppn) / 100), 1))
        FROM tinv_dtl f
        WHERE f.invd_inv_nomor = i.inv_nomor
      ), 0)                                        AS nilai_piutang,
      IFNULL((
        SELECT SUM(kredit) FROM piutang_debet WHERE nota = d.nota
      ), 0)                                        AS terbayar
     FROM piutang_kredit_detail d
     LEFT JOIN tinv_hdr i ON i.inv_nomor = d.nota
     LEFT JOIN tcustomer c ON c.cus_kode = i.inv_cus_kode
     WHERE d.nomor = ?`,
    [nomor],
  );

  // Hitung saldo per nota
  const details = detailRows.map((d) => ({
    ...d,
    saldo_piutang: Number(d.nilai_piutang) - Number(d.terbayar),
  }));

  // ── TAMBAHAN: CEK STATUS PENGAJUAN PIN 5 (Ngedit) ──
  const [pinRows] = await db.query(
    `SELECT 
      IFNULL(
        IF(pin_acc = "" AND pin_dipakai = "", "WAIT",
          IF(pin_acc = "Y" AND pin_dipakai = "", "ACC",
            IF(pin_acc = "Y" AND pin_dipakai = "Y", "",
              IF(pin_acc = "N", "TOLAK", "")
            )
          )
        ), 
      "") AS statusEdit
    FROM tspk_pin5 
    WHERE pin_trs = "PELUNASAN PIUTANG" AND pin_nomor = ? 
    ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );
  header.statusEdit = pinRows.length > 0 ? pinRows[0].statusEdit : "";

  // ── TAMBAHAN: CEK STATUS TUTUP BUKU ──
  const tglTrs = new Date(header.tanggal);
  const zMonth = tglTrs.getMonth();
  const zYear = tglTrs.getFullYear();

  let ztglclose = 0;
  const [verRows] = await db.query(
    `SELECT tgl_close FROM tversi WHERE aplikasi = "MANKSI" LIMIT 1`,
  );
  if (verRows.length > 0) ztglclose = parseInt(verRows[0].tgl_close, 10) || 0;

  const limitDate = new Date(zYear, zMonth + 1, ztglclose);
  limitDate.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const zCloseManual =
    await tutupBukuService.getManualTutupBuku("PELUNASAN PIUTANG");

  let isTutupBuku = false;
  if (zCloseManual) {
    zCloseManual.setHours(0, 0, 0, 0);
    if (tglTrs < zCloseManual) isTutupBuku = true;
  } else {
    // Sama seperti Delphi: EncodeDate(zYear, zMonth, ztglclose) < cgetcurdate
    if (limitDate < today) isTutupBuku = true;
  }

  header.isTutupBuku = isTutupBuku;

  return { header, details };
};

// ── 2. INFO INVOICE (loaddatadetail Delphi) ──
const getInfoInvoice = async (nota) => {
  const [rows] = await db.query(
    `SELECT
      a.inv_nomor,
      a.inv_cus_kode,
      d.cus_nama,
      DATE_FORMAT(a.inv_tanggal, "%Y-%m-%d")       AS inv_tanggal,
      DATE_FORMAT(a.inv_tanggal_tempo, "%Y-%m-%d")  AS inv_tanggal_tempo,
      SUM(f.invd_harga * f.invd_jumlah *
        IF(a.inv_sts_ppn = 1, ((100 + a.inv_ppn) / 100), 1)) AS nilai
     FROM tinv_hdr a
     INNER JOIN tinv_dtl f  ON a.inv_nomor    = f.invd_inv_nomor
     INNER JOIN tcustomer d ON a.inv_cus_kode = d.cus_kode
     WHERE a.inv_nomor = ?
     GROUP BY a.inv_nomor`,
    [nota],
  );
  if (!rows.length) throw new Error("Nota/Invoice tidak ditemukan.");

  const invoice = rows[0];

  const [bayarRows] = await db.query(
    `SELECT IFNULL(SUM(kredit), 0) AS total_terbayar 
     FROM piutang_debet 
     WHERE nota = ?`,
    [nota],
  );

  const terbayar = Number(bayarRows[0].total_terbayar);
  const nilai = Number(invoice.nilai);
  const saldoPiutang = nilai - terbayar;

  return { ...invoice, terbayar, saldoPiutang };
};

// ── 3. INFO PEMBAYARAN (Loaddatabayar Delphi) ──
const getInfoPembayaran = async (noPembayaran, cabang) => {
  const isRetur = noPembayaran.substring(0, 3).toUpperCase() === "RET";

  if (isRetur) {
    const [rows] = await db.query(
      `SELECT
        a.retj_nomor                               AS nomor_bayar,
        DATE_FORMAT(a.retj_tanggal, "%Y-%m-%d")   AS tanggal,
        a.retj_cus_kode                            AS customer,
        b.cus_nama                                 AS nama_customer,
        (
          SELECT SUM(retjd_harga * retjd_jumlah *
            IF(a.retj_sts_ppn = 1, ((100 + a.retj_ppn) / 100), 1))
          FROM tretj_dtl
          WHERE retjd_retj_nomor = a.retj_nomor
        )                                          AS total_bayar,
        0                                          AS total_kredit,
        a.retj_keterangan                          AS keterangan,
        "RT"                                       AS kode_bayar
       FROM tretj_hdr a
       INNER JOIN tcustomer b ON a.retj_cus_kode = b.cus_kode
       WHERE a.retj_nomor = ?
         AND a.retj_perush_kode = ?`,
      [noPembayaran, cabang],
    );
    if (!rows.length)
      throw new Error("Data Retur tidak ditemukan atau beda cabang.");
    return rows[0];
  } else {
    const [rows] = await db.query(
      `SELECT
        a.nomor                              AS nomor_bayar,
        DATE_FORMAT(a.tanggal, "%Y-%m-%d")  AS tanggal,
        a.customer,
        b.cus_nama                           AS nama_customer,
        a.debet                              AS total_bayar,
        IFNULL((
          SELECT SUM(kredit)
          FROM piutang_kredit_detail
          WHERE no_bukti = a.nomor
        ), 0)                                AS total_kredit,
        a.notes                              AS keterangan,
        a.kode                               AS kode_bayar
       FROM terima_bayar_debet a
       LEFT JOIN tcustomer b
         ON b.cus_kode = SUBSTRING_INDEX(a.customer, ';', 1)
       WHERE a.nomor = ?
         AND a.cabang = ?`,
      [noPembayaran, cabang],
    );
    if (!rows.length)
      throw new Error("Nomor Pembayaran tidak ditemukan atau beda cabang.");
    return rows[0];
  }
};

// ── 4. SIMPAN ──
const saveFormPelunasan = async (payload, userKode) => {
  const { isEdit, nomor, cabang, tanggal, notes, details } = payload;
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    let savedNomor = nomor;

    if (isEdit) {
      await conn.query(
        `UPDATE piutang_kredit_header 
         SET cabang = ?, tanggal = ?, notes = ? 
         WHERE nomor = ?`,
        [cabang, tanggal, notes || "", nomor],
      );
      await conn.query(`DELETE FROM piutang_kredit_detail WHERE nomor = ?`, [
        nomor,
      ]);
    } else {
      savedNomor = await generateNomorPelunasan(cabang, tanggal);
      await conn.query(
        `INSERT INTO piutang_kredit_header 
         (nomor, cabang, tanggal, kodeuser, notes) 
         VALUES (?, ?, ?, ?, ?)`,
        [savedNomor, cabang, tanggal, userKode, notes || ""],
      );
    }

    if (details && details.length > 0) {
      for (const d of details) {
        if (!d.nota) continue;
        await conn.query(
          `INSERT INTO piutang_kredit_detail 
           (nomor, nota, kode, no_bukti, kredit, notes) 
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            savedNomor,
            d.nota,
            d.kode || "",
            d.no_bukti || "",
            parseFloat(d.kredit) || 0,
            d.notesdetail || "",
          ],
        );
      }
    }

    await conn.commit();
    return { nomor: savedNomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

const getPrintData = async (nomor) => {
  const sql = `
    SELECT 
      a.nomor AS Nomor,
      DATE_FORMAT(a.tanggal, '%d/%m/%Y') AS Tanggal,
      a.notes AS KeteranganHeader,
      c.perush_nama AS PerusahaanNama,
      c.perush_alamat AS PerusahaanAlamat,
      c.perush_telp AS PerusahaanTelp,
      b.nota AS Nota,
      b.no_bukti AS NoBukti,
      b.kredit AS Nilai,
      b.notes AS KeteranganDetail,
      e.cus_nama AS Customer
    FROM piutang_kredit_header a
    INNER JOIN piutang_kredit_detail b ON a.nomor = b.nomor
    INNER JOIN tperusahaan c ON a.cabang = c.perush_kode
    LEFT JOIN tinv_hdr d ON b.nota = d.INV_nomor
    LEFT JOIN tcustomer e ON d.inv_cus_kode = e.cus_kode
    WHERE a.nomor = ?
    ORDER BY b.nota ASC
  `;

  const [rows] = await db.query(sql, [nomor]);
  if (rows.length === 0)
    throw new Error("Data pelunasan tidak ditemukan untuk dicetak.");

  // Strukturkan data agar lebih mudah di-render di Vue
  const header = {
    Nomor: rows[0].Nomor,
    Tanggal: rows[0].Tanggal,
    Keterangan: rows[0].KeteranganHeader,
    PerusahaanNama: rows[0].PerusahaanNama,
    PerusahaanAlamat: rows[0].PerusahaanAlamat,
    PerusahaanTelp: rows[0].PerusahaanTelp,
  };

  const details = rows.map((r) => ({
    Nota: r.Nota,
    NoBukti: r.NoBukti,
    Nilai: r.Nilai,
    Keterangan: r.KeteranganDetail,
    Customer: r.Customer,
  }));

  return { header, details };
};

module.exports = {
  getFormEditData,
  getInfoInvoice,
  getInfoPembayaran,
  saveFormPelunasan,
  getPrintData,
};
