const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// --- HELPER: CEK STATUS PIN 5 ---
const checkPinStatus = async (nomor, conn) => {
  const qPin = `SELECT pin_urut, pin_acc, pin_dipakai FROM tspk_pin5 WHERE pin_trs="MPPB" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1`;
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

// --- HELPER: GENERATE NOMOR MPPB ---
const generateNomor = async (tanggal, conn) => {
  const tahun = new Date(tanggal).getFullYear().toString();
  const prefix = `MPB.${tahun}`;

  const query = `
    SELECT IFNULL(MAX(CAST(RIGHT(mpb_nomor, 5) AS UNSIGNED)), 0) AS max_num 
    FROM tmpb 
    WHERE LEFT(mpb_nomor, 8) = ?
  `;

  const [rows] = await conn.query(query, [prefix]);
  const nextNum = parseInt(rows[0].max_num, 10) + 1;

  return `${prefix}${String(nextNum).padStart(5, "0")}`;
};

// --- GET DATA FORM ---
const getDetailForm = async (nomor) => {
  const qHdr = `
    SELECT 
      mpb_nomor, mpb_tanggal, mpb_divisi, mpb_nama, mpb_ukuran, 
      mpb_bahan, mpb_gramasi, mpb_jmlorder, mpb_ket, mpb_dokumen, 
      date_create, user_create
    FROM tmpb 
    WHERE mpb_nomor = ?
  `;
  const [hdrRows] = await db.query(qHdr, [nomor]);
  if (hdrRows.length === 0) throw new Error("Data MPPB tidak ditemukan.");
  const header = hdrRows[0];

  const pinInfo = await checkPinStatus(nomor, db);
  header.pin_status = pinInfo.status;

  return header;
};

// --- SIMPAN DATA FORM ---
const saveData = async (payload, user) => {
  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    let nomor = payload.nomor;
    const isEdit = !!nomor;
    const {
      tanggal,
      divisi,
      namaProduk,
      ukuran,
      bahan,
      gramasi,
      jumlahOrder,
      keterangan,
      noDokumen,
    } = payload;

    const tglTrs = new Date(tanggal);
    const dateModified = new Date()
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    let pinInfo = { status: "MINTA", urut: 0 };

    // 1. Validasi Tutup Buku
    if (isEdit) {
      pinInfo = await checkPinStatus(nomor, conn);
    }
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    if (zdtClose && tglTrs <= zdtClose && pinInfo.status !== "ACC") {
      throw new Error(
        "Anda tidak boleh input di tanggal periode yg sudah diclose.",
      );
    }

    // 2. Simpan atau Update
    if (isEdit) {
      await conn.query(
        `UPDATE tmpb SET 
         mpb_tanggal=?, mpb_divisi=?, mpb_nama=?, mpb_ukuran=?, mpb_bahan=?,
         mpb_gramasi=?, mpb_jmlorder=?, mpb_ket=?, mpb_dokumen=?, date_modified=?, user_modified=?
         WHERE mpb_nomor=?`,
        [
          tanggal,
          divisi,
          namaProduk,
          ukuran || "",
          bahan || "",
          gramasi || "",
          jumlahOrder || 0,
          keterangan || "",
          noDokumen || "",
          dateModified,
          user.kode,
          nomor,
        ],
      );
    } else {
      nomor = await generateNomor(tanggal, conn);

      await conn.query(
        `INSERT INTO tmpb 
         (mpb_nomor, mpb_tanggal, mpb_divisi, mpb_nama, mpb_ukuran, mpb_bahan, mpb_gramasi,
          mpb_jmlorder, mpb_ket, mpb_dokumen, date_create, user_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nomor,
          tanggal,
          divisi,
          namaProduk,
          ukuran || "",
          bahan || "",
          gramasi || "",
          jumlahOrder || 0,
          keterangan || "",
          noDokumen || "",
          dateModified,
          user.kode,
        ],
      );
    }

    // 3. Update PIN jika status ACC
    if (isEdit && pinInfo.status === "ACC") {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai="Y" WHERE pin_trs="MPPB" AND pin_nomor=? AND pin_urut=?`,
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
};
