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
      mpb_pen_nomor, mpb_pen_id,
      date_create, user_create
    FROM tmpb 
    WHERE mpb_nomor = ?
  `;
  const [hdrRows] = await db.query(qHdr, [nomor]);
  if (hdrRows.length === 0) throw new Error("Data MPPB tidak ditemukan.");
  const header = hdrRows[0];

  // Info Penawaran terhubung — read-only display, sumber sama dgn
  // searchPenawaranDetail di lookupService (field shape disamakan:
  // id, Nama, Bahan, Ukuran, Satuan, Qty, Harga, Total)
  if (header.mpb_pen_nomor && header.mpb_pen_id) {
    const [penRows] = await db.query(
      `SELECT d.pend_id AS id, d.pend_nama_barang AS Nama, d.pend_bahan AS Bahan,
              d.pend_ukuran AS Ukuran, d.pend_satuan AS Satuan, d.pend_qty AS Qty,
              d.pend_harga AS Harga, (d.pend_qty * d.pend_harga) AS Total,
              h.pen_tanggal AS TanggalPenawaran, c.cus_nama AS NamaCustomer
       FROM tpenawaran_dtl d
       INNER JOIN tpenawaran_hdr h ON h.pen_nomor = d.pend_pen_nomor
       LEFT JOIN tcustomer c ON c.cus_kode = h.pen_cus_kode
       WHERE d.pend_pen_nomor = ? AND d.pend_id = ?`,
      [header.mpb_pen_nomor, header.mpb_pen_id],
    );
    header.PenawaranDetail = penRows[0] || null;
  } else {
    header.PenawaranDetail = null;
  }

  const pinInfo = await checkPinStatus(nomor, db);
  header.pin_status = pinInfo.status;

  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  const tglDokumen = new Date(header.mpb_tanggal);
  header.isTutupBuku = false;
  if (zdtClose && tglDokumen <= zdtClose && pinInfo.status !== "ACC") {
    header.isTutupBuku = true;
  }

  return header;
};

// --- GET DETAIL MINTA HARGA (sumber auto-fill dari Penawaran) ---
const getMintaHargaDetail = async (nomorMintaHarga) => {
  const query = `
    SELECT h.mh_nomor, h.mh_divisi, h.mh_nama, h.mh_kain, h.mh_ukuran, 
           h.mh_gramasi, h.mh_jmlorder, h.mh_status, h.mh_ket
    FROM tmintaharga h
    WHERE h.mh_nomor = ?
  `;
  const [rows] = await db.query(query, [nomorMintaHarga]);
  if (rows.length === 0)
    throw new Error("Data Permintaan Harga tidak ditemukan.");
  return rows[0];
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
      penNomor,
      penId,
    } = payload;

    // ── Validasi wajib: MPPB harus link ke Penawaran ──
    if (!penNomor || !penId) {
      throw new Error("No. Penawaran wajib dipilih.");
    }

    const tglTrs = new Date(tanggal);
    const now = new Date();
    const dateModified =
      now.getFullYear() +
      "-" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(now.getDate()).padStart(2, "0") +
      " " +
      String(now.getHours()).padStart(2, "0") +
      ":" +
      String(now.getMinutes()).padStart(2, "0") +
      ":" +
      String(now.getSeconds()).padStart(2, "0");
    let pinInfo = { status: "MINTA", urut: 0 };

    if (isEdit) {
      pinInfo = await checkPinStatus(nomor, conn);
    }
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    if (zdtClose && tglTrs <= zdtClose && pinInfo.status !== "ACC") {
      throw new Error(
        "Anda tidak boleh input di tanggal periode yg sudah diclose.",
      );
    }

    if (isEdit) {
      await conn.query(
        `UPDATE tmpb SET 
         mpb_tanggal=?, mpb_divisi=?, mpb_nama=?, mpb_ukuran=?, mpb_bahan=?,
         mpb_gramasi=?, mpb_jmlorder=?, mpb_ket=?, mpb_dokumen=?,
         mpb_pen_nomor=?, mpb_pen_id=?,
         date_modified=?, user_modified=?
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
          penNomor,
          penId,
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
          mpb_jmlorder, mpb_ket, mpb_dokumen, mpb_pen_nomor, mpb_pen_id,
          date_create, user_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          penNomor,
          penId,
          dateModified,
          user.kode,
        ],
      );
    }

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

module.exports = { getDetailForm, saveData, getMintaHargaDetail };
