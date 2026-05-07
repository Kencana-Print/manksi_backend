const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// --- HELPER: CEK STATUS PIN 5 ---
const checkPinStatus = async (nomor, conn) => {
  const qPin = `SELECT pin_urut, pin_acc, pin_dipakai FROM tspk_pin5 WHERE pin_trs="INV PROFORMA" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1`;
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

// --- HELPER: GENERATE NOMOR INVOICE ---
const generateNomor = async (kodePerush, tanggal, conn) => {
  const tahun = new Date(tanggal).getFullYear().toString();
  const prefix = `ING/${kodePerush}`;

  let query = `
    SELECT IFNULL(MAX(CAST(MID(inv_nomor, 8, 5) AS UNSIGNED)), 0) AS max_num 
    FROM tinv_hdr 
    WHERE LEFT(inv_nomor, 6) = ? AND RIGHT(inv_nomor, 4) = ?
  `;

  // LOGIKA QUIRK DELPHI: Lewati nomor tertentu jika ING/JA tahun 2025
  if (prefix === "ING/JA" && tahun === "2025") {
    query += ` AND (MID(inv_nomor, 8, 5) < 1453 OR MID(inv_nomor, 8, 5) > 1473)`;
  }

  const [rows] = await conn.query(query, [prefix, tahun]);
  let nextNum = parseInt(rows[0].max_num, 10) + 1;

  // Pastikan saat ditambah 1 tidak masuk ke dalam rentang terlarang
  if (prefix === "ING/JA" && tahun === "2025") {
    while (nextNum >= 1453 && nextNum <= 1473) {
      nextNum++;
    }
  }

  return `${prefix}/${String(nextNum).padStart(5, "0")}/${tahun}`;
};

// --- GET UANG MUKA ---
const getUangMuka = async (nomor) => {
  if (!nomor) return 0;
  const query = `SELECT IFNULL(kredit, 0) AS kredit FROM piutang_debet WHERE nota = ?`;
  const [rows] = await db.query(query, [nomor]);
  return rows.length > 0 ? parseFloat(rows[0].kredit) : 0;
};

// --- LOAD DATA UNTUK EDIT (loaddataall) ---
const getDetailForm = async (nomor) => {
  const qHdr = `
    SELECT 
      a.inv_nomor, a.inv_tanggal, a.inv_divisi, a.inv_tanggal_tempo, 
      a.inv_keterangan, a.inv_perush_kode, a.inv_rekening, a.inv_sts_ppn, a.inv_ppn,
      p.perush_nama, pd.perushd_bank, pd.perushd_atasnama, 
      a.inv_cus_kode, c.cus_nama, a.inv_cus_alamat, c.cus_alamat, c.cus_kota
    FROM tinv_hdr a
    INNER JOIN tperusahaan p ON p.perush_kode = a.inv_perush_kode
    INNER JOIN tcustomer c ON c.cus_kode = a.inv_cus_kode
    LEFT JOIN tperusahaan_dtl pd ON pd.perushd_perush_kode = p.perush_kode AND pd.perushd_rekening = a.inv_rekening
    WHERE a.inv_nomor = ?
  `;
  const [hdrRows] = await db.query(qHdr, [nomor]);
  if (hdrRows.length === 0) throw new Error("Data Invoice tidak ditemukan.");
  const header = hdrRows[0];

  const qDtl = `
    SELECT 
      d.invd_spk_nomor AS kode, 
      b.brg_name AS nama, 
      d.invd_ukuran AS ukuran, 
      d.invd_jumlah AS jumlah, 
      d.invd_harga AS harga
    FROM tinv_dtl d
    INNER JOIN tbarang b ON d.invd_spk_nomor = b.brg_kode
    WHERE d.invd_inv_nomor = ?
    ORDER BY d.invd_nourut
  `;
  const [details] = await db.query(qDtl, [nomor]);

  const uangMuka = await getUangMuka(nomor);
  const pinInfo = await checkPinStatus(nomor, db);
  header.pin_status = pinInfo.status;
  header.uang_muka = uangMuka;

  return { header, details };
};

// --- SIMPAN DATA (simpandata) ---
const saveData = async (payload, user) => {
  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    let nomor = payload.nomor;
    const isEdit = !!nomor;
    const {
      divisi,
      tanggal,
      keterangan,
      kodePerush,
      cusKode,
      alamatCus,
      tanggalTempo,
      rekBank,
      stsPpn,
      ppnPersen,
      details,
    } = payload;

    const tglTrs = new Date(tanggal);
    const dateModified = new Date()
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    let pinInfo = { status: "MINTA", urut: 0 };

    // 1. Validasi Detail
    const validDetails = details.filter((d) => d.kode && d.nama);
    if (validDetails.length === 0)
      throw new Error("Tidak ada detail barang, tidak dapat disimpan.");

    // 2. Validasi Tutup Buku
    if (isEdit) {
      pinInfo = await checkPinStatus(nomor, conn);
    }
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    if (tglTrs <= zdtClose && pinInfo.status !== "ACC") {
      throw new Error(
        "Anda tidak boleh input di tanggal periode yg sudah diclose.",
      );
    }

    // 3. Simpan Header
    if (isEdit) {
      await conn.query(
        `UPDATE tinv_hdr SET 
         inv_tanggal=?, inv_keterangan=?, inv_perush_kode=?, inv_cus_kode=?, inv_cus_alamat=?,
         inv_sts_ppn=?, inv_ppn=?, inv_tanggal_tempo=?, inv_rekening=?, date_modified=?, user_modified=?
         WHERE inv_nomor=?`,
        [
          tanggal,
          keterangan || "",
          kodePerush,
          cusKode,
          alamatCus,
          stsPpn,
          ppnPersen || 0,
          tanggalTempo,
          rekBank || "",
          dateModified,
          user.kode,
          nomor,
        ],
      );
    } else {
      nomor = await generateNomor(kodePerush, tanggal, conn);

      await conn.query(
        `INSERT INTO tinv_hdr 
         (inv_nomor, inv_divisi, inv_tanggal, inv_keterangan, inv_perush_kode, inv_cus_kode, inv_cus_alamat,
          inv_tanggal_tempo, inv_sts_pro, inv_rekening, inv_sts_ppn, inv_ppn, date_create, user_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`, // inv_sts_pro = 1 (Proforma)
        [
          nomor,
          divisi,
          tanggal,
          keterangan || "",
          kodePerush,
          cusKode,
          alamatCus,
          tanggalTempo,
          rekBank || "",
          stsPpn,
          ppnPersen || 0,
          dateModified,
          user.kode,
        ],
      );
    }

    // 4. Simpan Detail
    await conn.query(`DELETE FROM tinv_dtl WHERE invd_inv_nomor=?`, [nomor]);
    const detailValues = [];
    let noUrut = 1;

    for (const d of validDetails) {
      detailValues.push([
        nomor,
        d.kode,
        d.ukuran || "",
        parseFloat(d.jumlah) || 0,
        parseFloat(d.harga) || 0,
        noUrut,
      ]);
      noUrut++;
    }

    if (detailValues.length > 0) {
      await conn.query(
        `INSERT INTO tinv_dtl (invd_inv_nomor, invd_spk_nomor, invd_ukuran, invd_jumlah, invd_harga, invd_nourut) VALUES ?`,
        [detailValues],
      );
    }

    // 5. Update PIN
    if (isEdit && pinInfo.status === "ACC") {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai="Y" WHERE pin_trs="INV PROFORMA" AND pin_nomor=? AND pin_urut=?`,
        [nomor, pinInfo.urut],
      );
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
  getDetailForm,
  saveData,
  getUangMuka,
};
