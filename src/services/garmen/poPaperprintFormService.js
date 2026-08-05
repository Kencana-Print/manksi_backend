const fs = require("fs");
const path = require("path");
const db = require("../../config/database");

// ⚠️ BUKAN /mnt/image (folder lama sinkron desktop app / apathimage).
// Pakai public/images — sudah ada static route-nya di index.js
// (app.use("/images", express.static(path.join(process.cwd(), "public/images"))))
const IMAGE_DIR = path.join(process.cwd(), "public/images");
if (!fs.existsSync(IMAGE_DIR)) {
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
}

/**
 * Opsi Cabang — replikasi FormCreate: kalau user tanpa cabang home
 * (kosong/"HO-"), semua opsi P01/P02/P04/P05 muncul; kalau punya
 * cabang home, cuma cabang itu.
 */
const getCabangOptions = (user) => {
  const cab = user.cabang || "";
  if (cab !== "" && cab !== "HO-") return [cab];
  return ["P01", "P02", "P04", "P05"];
};

const getUkuranOptions = async () => {
  const [rows] = await db.query(
    `SELECT Ukuran FROM tpaper_ukuran ORDER BY Ukuran`,
  );
  return rows.map((r) => r.Ukuran);
};

const getBahanOptions = async () => {
  const [rows] = await db.query(
    `SELECT Bahan FROM tpaper_bahan ORDER BY Bahan`,
  );
  return rows.map((r) => r.Bahan);
};

// ⚠️ Finishing DIHAPUS dari sini — dikonfirmasi free-text, tidak ada
// dropdown/tabel sumber di source.

/**
 * Validasi Supplier manual-blur — replikasi edtSupExit persis.
 */
const resolveSupplier = async (kode) => {
  const [rows] = await db.query(
    `SELECT sup_kode AS kode, sup_nama AS nama, sup_alamat AS alamat
     FROM tsupplier WHERE sup_kode = ?`,
    [kode],
  );
  if (rows.length === 0) return null;
  return rows[0];
};

/**
 * Resolve SPK manual-type (loadspk) — ⚠️ TANPA filter cmo/divisi sama
 * sekali di cabang tmemospk, beda dari search-modal F1 (bantuanspk).
 */
const resolveSpkManual = async (nomor) => {
  const q = `
    SELECT * FROM (
      SELECT spk_nomor AS Nomor, spk_nama AS Nama, spk_ukuran AS ukuran,
        spk_kain AS bahan, spk_finishing AS finishing
      FROM tspk WHERE spk_aktif = "Y"
      UNION ALL
      SELECT mspk_nomor AS Nomor, mspk_nama AS Nama, mspk_ukuran AS ukuran,
        mspk_kain AS bahan, mspk_finishing AS finishing
      FROM tmemospk
    ) x WHERE x.Nomor = ?
  `;
  const [rows] = await db.query(q, [nomor]);
  if (rows.length === 0) return null;
  return rows[0];
};

const fileExists = (filename) => {
  try {
    return fs.existsSync(path.join(IMAGE_DIR, filename));
  } catch {
    return false;
  }
};

/**
 * loaddetail — ambil header + detail utk edit/print, sekalian cek
 * eksistensi file gambar fisik per baris.
 */
const getFormData = async (nomor) => {
  const qHeader = `
    SELECT h.pjh_nomor, h.pjh_tanggal, h.pjh_dateline, h.pjh_sup_kode,
      h.pjh_ket, h.pjh_cab, s.sup_nama, s.sup_alamat
    FROM tpopaper_hdr h
    LEFT JOIN tsupplier s ON s.sup_kode = h.pjh_sup_kode
    WHERE h.pjh_nomor = ?
  `;
  const [headerRows] = await db.query(qHeader, [nomor]);
  if (headerRows.length === 0) return null;

  const qDetail = `
    SELECT pjd_spk AS spk, pjd_nama AS nama, pjd_ukuran AS ukuran,
      pjd_bahan AS bahan, pjd_finishing AS finishing, pjd_qty AS jumlah,
      pjd_harga AS harga, pjd_ket AS ket, pjd_idgambar AS idgambar
    FROM tpopaper_dtl WHERE pjd_nomor = ?
  `;
  const [detailRows] = await db.query(qDetail, [nomor]);

  const details = detailRows.map((d) => ({
    ...d,
    hasImage: d.idgambar
      ? fileExists(`${nomor}${d.spk}${d.idgambar}.jpg`)
      : false,
    imageUrl: d.idgambar
      ? `/images/${encodeURIComponent(`${nomor}${d.spk}${d.idgambar}`)}.jpg`
      : null,
  }));

  return { ...headerRows[0], details };
};

const getMaxNomor = async (conn, tanggal) => {
  const yyyymm = (() => {
    const d = new Date(tanggal);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();
  const [rows] = await conn.query(
    `SELECT IFNULL(MAX(RIGHT(pjh_nomor, 4)), 0) AS mx FROM tpopaper_hdr
     WHERE MID(pjh_nomor, 4, 6) = ? FOR UPDATE`,
    [yyyymm],
  );
  const next = Number(rows[0].mx) + 1;
  return `PP.${yyyymm}.${String(next).padStart(4, "0")}`;
};

/**
 * simpandata — replikasi simpan header+detail, PLUS penanganan gambar
 * per-baris. File upload via multer (uploadMiddleware.js) sudah
 * tersimpan di /temp dengan nama unik — di sini tinggal MOVE ke
 * public/images dengan nama final {nomor}{spk}{idgambar}.jpg.
 */
const saveData = async (payload, filesByField, user, isEdit) => {
  const { nomor, tanggal, dateline, supKode, keterangan, cabang, details } =
    payload;

  if (!supKode || !supKode.trim()) {
    throw new Error("Supplier harus diisi.");
  }

  const validDetails = (details || []).filter((d) => d.spk && d.spk.trim());
  if (validDetails.length === 0) {
    throw new Error("Detail harus diisi.");
  }
  for (const d of validDetails) {
    if (!d.jumlah || Number(d.jumlah) === 0) {
      throw new Error("Jumlah harus diisi.");
    }
  }

  const conn = await db.getConnection();
  const filesToDelete = [];
  const filesToWrite = []; // { tmpPath, finalName }

  try {
    await conn.beginTransaction();

    let finalNomor = nomor;

    if (isEdit) {
      const [rows] = await conn.query(
        `SELECT pjh_nomor FROM tpopaper_hdr WHERE pjh_nomor = ? FOR UPDATE`,
        [nomor],
      );
      if (rows.length === 0) throw new Error("Data tidak ditemukan.");

      await conn.query(
        `UPDATE tpopaper_hdr SET pjh_tanggal = ?, pjh_dateline = ?,
           pjh_sup_kode = ?, pjh_ket = ?, pjh_cab = ?,
           user_modified = ?, date_modified = NOW()
         WHERE pjh_nomor = ?`,
        [
          tanggal,
          dateline,
          supKode,
          keterangan || "",
          cabang,
          user.kode,
          nomor,
        ],
      );
    } else {
      finalNomor = await getMaxNomor(conn, tanggal);

      await conn.query(
        `INSERT INTO tpopaper_hdr
           (pjh_nomor, pjh_tanggal, pjh_dateline, pjh_sup_kode, pjh_ket, pjh_cab, user_create, date_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          finalNomor,
          tanggal,
          dateline,
          supKode,
          keterangan || "",
          cabang,
          user.kode,
        ],
      );
    }

    let maxId = 0;
    for (const d of validDetails) {
      if (d.idgambar) {
        const n = parseInt(d.idgambar, 10);
        if (!isNaN(n) && n > maxId) maxId = n;
      }
    }

    await conn.query(`DELETE FROM tpopaper_dtl WHERE pjd_nomor = ?`, [
      finalNomor,
    ]);

    for (const d of validDetails) {
      let finalIdGambar = d.idgambar || "";

      if (d.newImageField && filesByField[d.newImageField]) {
        maxId += 1;
        finalIdGambar = String(maxId).padStart(2, "0");
        const finalName = `${finalNomor}${d.spk}${finalIdGambar}.jpg`;
        filesToWrite.push({
          tmpPath: filesByField[d.newImageField].path,
          finalName,
        });
      } else if (d.removeImage && d.idgambar) {
        filesToDelete.push(`${finalNomor}${d.spk}${d.idgambar}.jpg`);
        finalIdGambar = "";
      }

      await conn.query(
        `INSERT INTO tpopaper_dtl
           (pjd_nomor, pjd_spk, pjd_nama, pjd_ukuran, pjd_bahan, pjd_finishing, pjd_qty, pjd_harga, pjd_ket, pjd_idgambar)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          finalNomor,
          d.spk,
          d.nama,
          d.ukuran || "",
          d.bahan || "",
          d.finishing || "",
          d.jumlah,
          d.harga || 0,
          d.ket || "",
          finalIdGambar,
        ],
      );
    }

    await conn.commit();

    // File I/O SETELAH commit sukses — cegah file orphan kalau gagal DB
    for (const f of filesToWrite) {
      fs.copyFileSync(f.tmpPath, path.join(IMAGE_DIR, f.finalName));
      fs.unlinkSync(f.tmpPath); // bersihkan temp
    }
    for (const filename of filesToDelete) {
      const fp = path.join(IMAGE_DIR, filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }

    return { nomor: finalNomor };
  } catch (error) {
    await conn.rollback();
    // Bersihkan temp file yg terlanjur ke-upload multer meski save gagal
    for (const f of filesToWrite) {
      if (fs.existsSync(f.tmpPath)) fs.unlinkSync(f.tmpPath);
    }
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = {
  getCabangOptions,
  getUkuranOptions,
  getBahanOptions,
  resolveSupplier,
  resolveSpkManual,
  getFormData,
  saveData,
};
