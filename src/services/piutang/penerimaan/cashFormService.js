const db = require("../../../config/database");
const tutupBukuService = require("../../tutupBukuService");

// --- HELPER: CEK STATUS PIN 5 ---
const checkPinStatus = async (nomor, conn) => {
  const qPin = `SELECT pin_urut, pin_acc, pin_dipakai FROM tspk_pin5 WHERE pin_trs="PENERIMAAN CASH" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1`;
  const [rows] = await conn.query(qPin, [nomor]);

  if (rows.length === 0) return { status: "MINTA", urut: 0 };
  const pin = rows[0];

  if (pin.pin_acc === "" && pin.pin_dipakai === "")
    return { status: "WAIT", urut: pin.pin_urut };
  if (pin.pin_acc === "Y" && pin.pin_dipakai === "")
    return { status: "ACC", urut: pin.pin_urut };
  if (pin.pin_acc === "N") return { status: "TOLAK", urut: pin.pin_urut };

  return { status: "MINTA", urut: pin.pin_urut };
};

// --- HELPER: GENERATE NOMOR AUTOMATIS ---
const generateNomor = async (cabang, tanggal, conn) => {
  // Format: MD/CS/202600001
  const tahun = new Date(tanggal).getFullYear().toString();
  const kodeAwal = `${cabang}/CS`;

  const query = `
    SELECT IFNULL(MAX(RIGHT(nomor, 5)), 0) AS max_num
    FROM terima_bayar_debet
    WHERE LEFT(nomor, 5) = ? AND MID(nomor, 7, 4) = ?
  `;
  const [rows] = await conn.query(query, [kodeAwal, tahun]);

  const nextNum = parseInt(rows[0].max_num, 10) + 1;
  const numStr = String(nextNum).padStart(5, "0");

  return `${kodeAwal}/${tahun}${numStr}`;
};

// --- GET DETAIL FORM (Untuk Mode Edit) ---
const getDetail = async (nomor) => {
  if (!nomor) return null;

  const sql = `
    SELECT 
      a.kode, c.tt_nama AS namatt, a.nomor, a.tanggal, a.tanggal_tempo, 
      a.cabang, a.customer, a.account, a.debet, a.notes, 
      a.tb_rek_kode, r.rek_nama, r.rek_rekening, p.perush_nama 
    FROM terima_bayar_debet a  
    LEFT JOIN Tkode_tt c ON a.kode = c.tt_kode 
    LEFT JOIN finance.trekening r ON r.rek_kode = a.tb_rek_kode
    LEFT JOIN tperusahaan p ON p.perush_kode = a.cabang
    WHERE a.nomor = ?
  `;
  const [rows] = await db.query(sql, [nomor]);
  if (rows.length === 0) throw new Error("Data Cash tidak ditemukan.");

  const header = rows[0];
  const pinInfo = await checkPinStatus(nomor, db);
  header.pin_status = pinInfo.status;

  // Cek Status Tutup Buku
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  const tglTrs = new Date(header.tanggal);
  tglTrs.setHours(0, 0, 0, 0);
  if (zdtClose) zdtClose.setHours(0, 0, 0, 0);

  header.is_tutup_buku = zdtClose && tglTrs <= zdtClose;

  // Ekstrak List Customer
  const dtlCustomer = [];
  if (header.customer) {
    const custCodes = header.customer.split(";").filter((k) => k.trim() !== "");
    for (let i = 0; i < custCodes.length; i++) {
      const code = custCodes[i];
      const [custRows] = await db.query(
        `SELECT cus_kode, cus_nama, cus_alamat, cus_kota FROM tcustomer WHERE cus_kode = ?`,
        [code],
      );
      if (custRows.length > 0) {
        dtlCustomer.push({
          no: i + 1,
          kode: custRows[0].cus_kode,
          nama: custRows[0].cus_nama,
          alamat: custRows[0].cus_alamat,
          kota: custRows[0].cus_kota,
        });
      }
    }
  }

  return { header, dtlCustomer };
};

// --- SAVE DATA FORM ---
const saveData = async (payload, user) => {
  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    let {
      isEdit,
      nomor,
      kodeBayar,
      cabang,
      tanggal,
      tanggalTempo,
      account,
      rekKode,
      debet,
      notes,
      dtlCustomer,
    } = payload;
    const tglTrs = new Date(tanggal);
    let pinInfo = { status: "MINTA", urut: 0 };

    // 1. Validasi Tutup Buku
    if (isEdit) pinInfo = await checkPinStatus(nomor, conn);
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    if (zdtClose && tglTrs <= zdtClose && pinInfo.status !== "ACC") {
      throw new Error(
        "Anda tidak boleh input di tanggal periode yg sudah diclose.",
      );
    }

    // 2. Validasi Tahun Antara Tanggal Lama vs Baru
    if (isEdit && payload.tanggalLama) {
      const yearBaru = new Date(tanggal).getFullYear();
      const yearLama = new Date(payload.tanggalLama).getFullYear();
      if (yearBaru !== yearLama) {
        throw new Error("Tanggal harus di tahun yang sama.");
      }
    }

    // 3. Bangun string customer
    let customerString = "";
    if (dtlCustomer && dtlCustomer.length > 0) {
      customerString = dtlCustomer.map((c) => c.kode).join(";") + ";";
    }

    // 4. Proses Simpan / Update
    if (isEdit) {
      const updateQuery = `
        UPDATE terima_bayar_debet SET 
          cabang = ?, customer = ?, tanggal = ?, tanggal_tempo = ?, 
          account = ?, tb_rek_kode = ?, debet = ROUND(?, 2), notes = ?
        WHERE nomor = ?
      `;
      await conn.query(updateQuery, [
        cabang,
        customerString,
        tanggal,
        tanggalTempo,
        account || "",
        rekKode || "",
        parseFloat(debet || 0),
        notes || "",
        nomor,
      ]);

      if (pinInfo.status === "ACC") {
        await conn.query(
          `UPDATE tspk_pin5 SET pin_dipakai = "Y" WHERE pin_trs = "PENERIMAAN CASH" AND pin_nomor = ? AND pin_urut = ?`,
          [nomor, pinInfo.urut],
        );
      }
    } else {
      // MODE BARU: Generate Nomor
      nomor = await generateNomor(cabang, tanggal, conn);

      const insertQuery = `
        INSERT INTO terima_bayar_debet 
        (nomor, kode, cabang, customer, account, tb_rek_kode, tanggal, tanggal_tempo, debet, kredit, kodeuser, notes) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ROUND(?, 2), 0, ?, ?)
      `;
      await conn.query(insertQuery, [
        nomor,
        kodeBayar || "CS",
        cabang,
        customerString,
        account || "",
        rekKode || "",
        tanggal,
        tanggalTempo,
        parseFloat(debet || 0),
        user.kode,
        notes || "",
      ]);
    }

    await conn.commit();
    return { nomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = {
  getDetail,
  saveData,
};
