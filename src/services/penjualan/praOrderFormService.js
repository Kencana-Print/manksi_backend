const db = require("../../config/database");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const tutupBukuService = require("../tutupBukuService");
const mintaHargaFormService = require("./mintaHargaFormService");

// --- GENERATE NOMOR PRA ORDER (pola identik generateNomor MH) ---
const generateNomor = async (tanggal) => {
  const d = new Date(tanggal);
  const tahun = d.getFullYear();

  const query = `
    SELECT IFNULL(MAX(CAST(RIGHT(pro_nomor, 5) AS UNSIGNED)), 0) AS max_val
    FROM tpraorder_hdr
    WHERE MID(pro_nomor, 5, 4) = ?
  `;
  const [[row]] = await db.query(query, [tahun]);

  const nextNum = parseInt(row.max_val, 10) + 1;
  const incrementStr = String(nextNum).padStart(5, "0");

  return `PRA.${tahun}.${incrementStr}`;
};

// --- INIT GRIDS (bahan + ukuran, untuk form baru) ---
const getInitGrids = async () => {
  const [bahan] = await db.query(
    `SELECT bj_kode AS Kode, bj_nama AS Nama
     FROM tbahan_jenis
     ORDER BY bj_kode ASC`,
  );

  const [sizes] = await db.query(
    `SELECT kode, ukuran FROM retail.tukuran
     WHERE kategori = ""
     ORDER BY CAST(kode AS UNSIGNED)`,
  );
  const ukuran = sizes.map((s) => ({ kode: s.kode, ukuran: s.ukuran, qty: 0 }));

  return { bahan, ukuran };
};

// --- GET BY ID (load data utk edit) ---
const getById = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT h.*, v.Divisi AS DivisiNama, s.sal_nama AS SalesNama
     FROM tpraorder_hdr h
     LEFT JOIN tdivisi v ON v.kode = h.pro_divisi
     LEFT JOIN tsales s ON s.sal_kode = h.pro_sal_kode
     WHERE h.pro_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Data Pra Order tidak ditemukan.");

  const [bahan] = await db.query(
    `SELECT b.*, m.bj_nama AS NamaBahan
     FROM tpraorder_bahan b
     LEFT JOIN tbahan_jenis m ON m.bj_kode = b.prob_bahan_kode
     WHERE b.prob_pro_nomor = ? ORDER BY b.prob_urut`,
    [nomor],
  );
  const [ukuran] = await db.query(
    `SELECT u.*, t.ukuran AS NamaUkuran
     FROM tpraorder_ukuran u
     LEFT JOIN retail.tukuran t ON t.kode = u.prou_ukuran AND t.kategori = ""
     WHERE u.prou_pro_nomor = ? ORDER BY u.prou_id`,
    [nomor],
  );
  const [gambar] = await db.query(
    `SELECT * FROM tpraorder_gambar WHERE prog_pro_nomor = ? ORDER BY prog_urut`,
    [nomor],
  );

  // Status PIN5 (sama pola StatusEdit di mintaHargaFormService.getById)
  const [pinRows] = await db.query(
    `SELECT pin_urut, pin_acc, pin_dipakai FROM tspk_pin5
     WHERE pin_trs = "PRA ORDER" AND pin_nomor = ? ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );
  let statusEdit = "";
  if (pinRows.length > 0) {
    const pin = pinRows[0];
    if (pin.pin_acc === "" && pin.pin_dipakai === "") statusEdit = "WAIT";
    else if (pin.pin_acc === "Y" && pin.pin_dipakai === "") statusEdit = "ACC";
    else if (pin.pin_acc === "N") statusEdit = "TOLAK";
    else if (pin.pin_acc === "Y" && pin.pin_dipakai === "Y") statusEdit = "";
  }

  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  const tglDokumen = new Date(hdr.pro_tanggal);
  const isTutupBuku = !!(zdtClose && tglDokumen < zdtClose);

  return { ...hdr, bahan, ukuran, gambar, StatusEdit: statusEdit, isTutupBuku };
};

// --- SAVE (create/update) ---
const save = async (data, userKode, isNewMode) => {
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  const tglInput = new Date(data.tanggal);
  if (zdtClose && tglInput < zdtClose) {
    throw new Error(
      "Anda tidak boleh input/edit di tanggal periode yang sudah diclose.",
    );
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const totalQty = (data.ukuran || []).reduce(
      (sum, u) => sum + (Number(u.qty) || 0),
      0,
    );

    let nomor = data.nomor;

    if (isNewMode) {
      nomor = await generateNomor(data.tanggal);
      await conn.query(
        `INSERT INTO tpraorder_hdr (
          pro_nomor, pro_tanggal, pro_cus_kode, pro_cus_nama, pro_sal_kode,
          pro_nama_pekerjaan, pro_divisi, pro_cabang, pro_cabkaos, pro_finishing,
          pro_spesifikasi, pro_sampel, pro_qty_rencana, pro_tgl_kirim,
          pro_catatan_deadline, pro_keterangan, user_create
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nomor,
          data.tanggal,
          data.cusKode || "",
          data.cusNama || "",
          data.salKode || "",
          data.namaPekerjaan,
          data.divisi,
          data.cabang,
          data.cabKaos || "",
          data.finishing || "",
          data.spesifikasi || "",
          data.sampel === "Y" ? "Y" : "N",
          totalQty,
          data.tglKirim,
          data.catatanDeadline || "",
          data.keterangan || "",
          userKode,
        ],
      );
    } else {
      // Lock baris header dulu — mencegah dua request save() yang overlap
      // saling menyisipkan sebelum salah satunya sempat DELETE, yang
      // menghasilkan duplikat baris ukuran/bahan.
      await conn.query(
        `SELECT pro_nomor FROM tpraorder_hdr WHERE pro_nomor = ? FOR UPDATE`,
        [nomor],
      );

      await conn.query(
        `UPDATE tpraorder_hdr SET
          pro_tanggal=?, pro_cus_kode=?, pro_cus_nama=?, pro_sal_kode=?, pro_nama_pekerjaan=?,
          pro_divisi=?, pro_finishing=?, pro_spesifikasi=?, pro_sampel=?, pro_qty_rencana=?,
          pro_tgl_kirim=?, pro_catatan_deadline=?, pro_keterangan=?, user_modified=?, date_modified=NOW()
        WHERE pro_nomor=?`,
        [
          data.tanggal,
          data.cusKode || "",
          data.cusNama || "",
          data.salKode || "",
          data.namaPekerjaan,
          data.divisi,
          data.finishing || "",
          data.spesifikasi || "",
          data.sampel === "Y" ? "Y" : "N",
          totalQty,
          data.tglKirim,
          data.catatanDeadline || "",
          data.keterangan || "",
          userKode,
          nomor,
        ],
      );

      if (data.StatusEdit === "ACC") {
        await conn.query(
          `UPDATE tspk_pin5 SET pin_dipakai="Y" WHERE pin_trs="PRA ORDER" AND pin_nomor=? AND pin_dipakai=""`,
          [nomor],
        );
      }

      await conn.query(`DELETE FROM tpraorder_bahan WHERE prob_pro_nomor = ?`, [
        nomor,
      ]);
      await conn.query(
        `DELETE FROM tpraorder_ukuran WHERE prou_pro_nomor = ?`,
        [nomor],
      );
    }

    for (const [idx, b] of (data.bahan || []).entries()) {
      await conn.query(
        `INSERT INTO tpraorder_bahan (prob_pro_nomor, prob_bahan_kode, prob_urut) VALUES (?, ?, ?)`,
        [nomor, b.kode, idx + 1],
      );
    }
    for (const u of data.ukuran || []) {
      if (Number(u.qty) > 0) {
        await conn.query(
          `INSERT INTO tpraorder_ukuran (prou_pro_nomor, prou_ukuran, prou_qty)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE prou_qty = VALUES(prou_qty)`,
          [nomor, u.kode, u.qty],
        );
      }
    }

    await conn.commit();
    return nomor;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// --- UPLOAD GAMBAR ---
const getNextGambarUrut = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT IFNULL(MAX(prog_urut), 0) AS maxUrut FROM tpraorder_gambar WHERE prog_pro_nomor = ?`,
    [nomor],
  );
  return row.maxUrut + 1;
};

const processGambar = async (tempFilePath, nomor, urut) => {
  if (!fs.existsSync(tempFilePath)) {
    throw new Error("File sumber sementara tidak ditemukan.");
  }
  const finalFileName = `${nomor}-${urut}.jpg`;
  const folderPath = path.join("/mnt", "image", "praorder");
  if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
  const finalPath = path.join(folderPath, finalFileName);

  try {
    await sharp(tempFilePath)
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .toFormat("jpeg")
      .jpeg({ quality: 90 })
      .toFile(finalPath);
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    return `/file-gambar/praorder/${finalFileName}`;
  } catch (error) {
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    console.error("Gagal memproses gambar Pra Order:", error);
    throw new Error("Gagal memproses gambar ke format JPG.");
  }
};

const addGambar = async (nomor, filePath, keterangan, urut) => {
  await db.query(
    `INSERT INTO tpraorder_gambar (prog_pro_nomor, prog_file_path, prog_keterangan, prog_urut) VALUES (?, ?, ?, ?)`,
    [nomor, filePath, keterangan || "", urut || 1],
  );
  return true;
};

// --- PPIC ACTIONS ---
const setStatusBahan = async (prob_id, status) => {
  await db.query(
    `UPDATE tpraorder_bahan SET prob_status_ready = ? WHERE prob_id = ?`,
    [status, prob_id],
  );
  return true;
};

const setStatusPpic = async (nomor, status, catatan, userKode) => {
  await db.query(
    `UPDATE tpraorder_hdr
     SET pro_status_ppic = ?, pro_catatan_ppic = ?, pro_user_ppic = ?, pro_tgl_ppic = NOW()
     WHERE pro_nomor = ?`,
    [status, catatan, userKode, nomor],
  );
  return true;
};

// --- COPY GAMBAR PERTAMA PRA ORDER KE FOLDER MINTA HARGA ---
// Diekstrak dari convertToMintaHarga supaya bisa dipakai juga oleh
// jalur "tarik Pra Order" manual di form Minta Harga (bukan cuma jalur
// convert otomatis via approval PPIC). Best-effort: kegagalan copy
// (file sumber tidak ketemu dsb) tidak melempar error ke caller.
const copyGambarPertamaKeMintaHarga = async (proNomor, mhNomor) => {
  const [[gambarPertama]] = await db.query(
    `SELECT prog_file_path FROM tpraorder_gambar
     WHERE prog_pro_nomor = ? ORDER BY prog_urut ASC LIMIT 1`,
    [proNomor],
  );
  if (!gambarPertama) return false;

  const sourceFileName = path.basename(gambarPertama.prog_file_path);
  const sourcePath = path.join("/mnt", "image", "praorder", sourceFileName);
  const destFolder = path.join("/mnt", "image", "mintaharga");
  const destPath = path.join(destFolder, `${mhNomor}.jpg`);
  try {
    if (fs.existsSync(sourcePath)) {
      if (!fs.existsSync(destFolder)) {
        fs.mkdirSync(destFolder, { recursive: true });
      }
      fs.copyFileSync(sourcePath, destPath);
      return true;
    }
  } catch (e) {
    console.error("Gagal menyalin gambar Pra Order ke Minta Harga:", e);
  }
  return false;
};

// --- KONVERSI KE PERMINTAAN HARGA ---
const convertToMintaHarga = async (nomor, userKode) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    // ⬅ DIUBAH: tambah JOIN tdivisi buat tahu nama divisi
    const [[hdr]] = await conn.query(
      `SELECT h.*, v.Divisi AS DivisiNama
       FROM tpraorder_hdr h
       LEFT JOIN tdivisi v ON v.kode = h.pro_divisi
       WHERE h.pro_nomor = ? FOR UPDATE`,
      [nomor],
    );
    if (!hdr) throw new Error("Data tidak ditemukan.");
    if (hdr.pro_status === "CLOSE") throw new Error("Sudah pernah dikonversi.");

    // ⬅ BARU: Divisi Spanduk & MMT tidak punya alur cek bahan
    // alternatif/PPIC (bahan alternatif memang cuma relevan untuk
    // Garmen) — jadi boleh langsung dikonversi tanpa syarat
    // pro_status_ppic = SANGGUP.
    const isDivisiTanpaCekPpic = ["SPANDUK", "MMT"].includes(
      (hdr.DivisiNama || "").toUpperCase(),
    );
    if (!isDivisiTanpaCekPpic && hdr.pro_status_ppic !== "SANGGUP")
      throw new Error("PPIC belum menyatakan sanggup.");

    const [ukuranRows] = await conn.query(
      `SELECT t.ukuran AS nama, pu.prou_qty
       FROM tpraorder_ukuran pu
       LEFT JOIN retail.tukuran t ON t.kode = pu.prou_ukuran AND t.kategori = ""
       WHERE pu.prou_pro_nomor = ?`,
      [nomor],
    );
    const ukuranStr = ukuranRows
      .map((u) => `${u.nama || "?"}:${u.prou_qty}`)
      .join(", ");

    const [bahanRows] = await conn.query(
      `SELECT m.bj_nama FROM tpraorder_bahan b
       LEFT JOIN tbahan_jenis m ON m.bj_kode = b.prob_bahan_kode
       WHERE b.prob_pro_nomor = ? ORDER BY b.prob_urut`,
      [nomor],
    );
    const kainStr = bahanRows
      .map((b) => b.bj_nama)
      .filter(Boolean)
      .join(" / ");

    const mhNomor = await mintaHargaFormService.generateNomor(hdr.pro_tanggal);

    await conn.query(
      `INSERT INTO tmintaharga (
        mh_nomor, mh_tanggal, mh_divisi, mh_cus_kode, mh_cus_nama, mh_sal_kode, mh_nama,
        mh_jmlorder, mh_kain, mh_ukuran, mh_finishing, mh_cabkaos, mh_ket, mh_status, mh_pro_nomor,
        date_create, user_create
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "MINTA", ?, NOW(), ?)`,
      [
        mhNomor,
        hdr.pro_tanggal,
        hdr.pro_divisi,
        hdr.pro_cus_kode,
        hdr.pro_cus_nama,
        hdr.pro_sal_kode,
        hdr.pro_nama_pekerjaan,
        hdr.pro_qty_rencana,
        kainStr,
        ukuranStr,
        hdr.pro_finishing,
        hdr.pro_cabkaos,
        hdr.pro_keterangan,
        nomor,
        userKode,
      ],
    );

    // Bawa gambar pertama Pra Order (prog_urut terkecil) jadi gambar utama
    // Minta Harga — mengikuti konvensi penyimpanan sentral yang sama dipakai
    // mintaHargaFormService.processImage(). Best-effort: kegagalan copy
    // (file tidak ketemu dsb) TIDAK membatalkan konversi.
    await copyGambarPertamaKeMintaHarga(nomor, mhNomor);

    await conn.query(
      `UPDATE tpraorder_hdr SET pro_status='CLOSE', pro_mh_nomor=?, user_modified=? WHERE pro_nomor=?`,
      [mhNomor, userKode, nomor],
    );

    await conn.commit();
    return mhNomor;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// --- GET KATALOG HISTORI PRA ORDER CUSTOMER (LAZY LOADING) ---
const getKatalogCustomer = async (
  cusKode,
  status = "",
  keyword = "",
  page = 1,
  limit = 20,
) => {
  const offset = (page - 1) * limit;

  let countQuery = `
    SELECT COUNT(*) AS total
    FROM tpraorder_hdr
    WHERE pro_cus_kode = ?
  `;
  const countParams = [cusKode];

  if (status && status !== "SEMUA") {
    countQuery += ` AND pro_status_ppic = ?`;
    countParams.push(status);
  }
  if (keyword) {
    countQuery += ` AND pro_nama_pekerjaan LIKE ?`;
    countParams.push(`%${keyword}%`);
  }

  const [countRows] = await db.query(countQuery, countParams);
  const totalData = countRows[0].total;

  let query = `
    SELECT
      h.pro_nomor,
      h.pro_nama_pekerjaan,
      h.pro_finishing,
      h.pro_qty_rencana,
      DATE_FORMAT(h.pro_tgl_kirim, '%d-%b-%Y') AS pro_tgl_kirim,
      h.pro_status_ppic,
      h.pro_status,
      h.pro_keterangan,
      (
        SELECT g.prog_file_path FROM tpraorder_gambar g
        WHERE g.prog_pro_nomor = h.pro_nomor
        ORDER BY g.prog_urut ASC LIMIT 1
      ) AS gambar_utama
    FROM tpraorder_hdr h
    WHERE h.pro_cus_kode = ?
  `;
  const params = [cusKode];

  if (status && status !== "SEMUA") {
    query += ` AND h.pro_status_ppic = ?`;
    params.push(status);
  }
  if (keyword) {
    query += ` AND h.pro_nama_pekerjaan LIKE ?`;
    params.push(`%${keyword}%`);
  }

  query += ` ORDER BY h.pro_tanggal DESC, h.pro_nomor DESC LIMIT ? OFFSET ?`;
  params.push(Number(limit), Number(offset));

  const [rows] = await db.query(query, params);

  // Bentuk ulang jadi { ...header, gambar: [{ prog_file_path }] } biar
  // konsisten dengan struktur getById().gambar yang dipakai frontend
  const items = rows.map((r) => ({
    ...r,
    gambar: r.gambar_utama ? [{ prog_file_path: r.gambar_utama }] : [],
  }));

  return { items, total: totalData };
};

// --- LOOKUP RINGKAS UNTUK AUTOFILL DI FORM MINTA HARGA ---
// Beda dari getById() — cuma field yang relevan untuk autofill, bukan
// seluruh payload form Pra Order (bahan detail, gambar, dst).
const getLookupData = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT h.pro_nomor, h.pro_cus_kode, h.pro_cus_nama, h.pro_sal_kode,
            h.pro_nama_pekerjaan, h.pro_divisi, h.pro_finishing,
            h.pro_qty_rencana, h.pro_mh_nomor, h.pro_keterangan,
            s.sal_nama AS SalesNama
     FROM tpraorder_hdr h
     LEFT JOIN tsales s ON s.sal_kode = h.pro_sal_kode
     WHERE h.pro_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Nomor Pra Order tidak ditemukan.");

  const [bahanRows] = await db.query(
    `SELECT m.bj_nama FROM tpraorder_bahan b
     LEFT JOIN tbahan_jenis m ON m.bj_kode = b.prob_bahan_kode
     WHERE b.prob_pro_nomor = ? ORDER BY b.prob_urut`,
    [nomor],
  );
  const kainStr = bahanRows
    .map((b) => b.bj_nama)
    .filter(Boolean)
    .join(" / ");

  const [ukuranRows] = await db.query(
    `SELECT t.ukuran AS nama, pu.prou_qty
     FROM tpraorder_ukuran pu
     LEFT JOIN retail.tukuran t ON t.kode = pu.prou_ukuran AND t.kategori = ""
     WHERE pu.prou_pro_nomor = ? AND pu.prou_qty > 0`,
    [nomor],
  );
  const ukuranStr = ukuranRows
    .map((u) => `${u.nama || "?"}:${u.prou_qty}`)
    .join(", ");

  // ⬅ BARU: gambar pertama Pra Order (prog_urut terkecil), sama sumber
  // yang dipakai convertToMintaHarga — dikembalikan sebagai referensi
  // URL sementara buat preview di form MH. File FISIK-nya belum di-copy
  // ke folder mintaharga di sini (baru terjadi saat form MH disimpan,
  // lihat copyGambarPertamaKeMintaHarga di bawah).
  const [[gambarPertama]] = await db.query(
    `SELECT prog_file_path FROM tpraorder_gambar
     WHERE prog_pro_nomor = ? ORDER BY prog_urut ASC LIMIT 1`,
    [nomor],
  );

  return {
    nomor: hdr.pro_nomor,
    cusKode: hdr.pro_cus_kode,
    cusNama: hdr.pro_cus_nama,
    salKode: hdr.pro_sal_kode,
    salNama: hdr.SalesNama || "",
    namaPekerjaan: hdr.pro_nama_pekerjaan,
    divisi: String(hdr.pro_divisi),
    finishing: hdr.pro_finishing,
    rencanaOrder: Number(hdr.pro_qty_rencana) || 0,
    kain: kainStr,
    ukuran: ukuranStr,
    keterangan: hdr.pro_keterangan || "", // ⬅ BARU
    imageUrl: gambarPertama ? gambarPertama.prog_file_path : null, // ⬅ BARU
    sudahDipakaiOleh:
      hdr.pro_mh_nomor && hdr.pro_mh_nomor.trim() !== ""
        ? hdr.pro_mh_nomor
        : null,
  };
};

// --- SEARCH PRA ORDER UNTUK MODAL LOOKUP DI FORM MINTA HARGA ---
const searchPraOrder = async (keyword = "", page = 1, limit = 20) => {
  const offset = (page - 1) * limit;
  let where = "WHERE 1=1";
  const params = [];
  if (keyword) {
    where += ` AND (h.pro_nomor LIKE ? OR h.pro_nama_pekerjaan LIKE ? OR h.pro_cus_nama LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM tpraorder_hdr h ${where}`,
    params,
  );

  const [rows] = await db.query(
    `SELECT
       h.pro_nomor AS Nomor,
       h.pro_nama_pekerjaan AS NamaPekerjaan,
       h.pro_cus_nama AS Customer,
       DATE_FORMAT(h.pro_tanggal, '%Y-%m-%d') AS Tanggal,
       h.pro_status AS Status
     FROM tpraorder_hdr h
     ${where}
     ORDER BY h.pro_tanggal DESC, h.pro_nomor DESC
     LIMIT ? OFFSET ?`,
    [...params, Number(limit), Number(offset)],
  );

  return { items: rows, total };
};

module.exports = {
  getInitGrids,
  getById,
  save,
  getNextGambarUrut,
  processGambar,
  addGambar,
  setStatusBahan,
  setStatusPpic,
  convertToMintaHarga,
  getKatalogCustomer,
  getLookupData,
  searchPraOrder,
  copyGambarPertamaKeMintaHarga,
};
