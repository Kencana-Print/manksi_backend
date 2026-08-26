const db = require("../../config/database");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const NOMERATOR = "KD";
const IMAGE_DIR_NEW = path.join(process.cwd(), "public", "images", "kendala");
const IMAGE_DIR_LEGACY = "/mnt/image";

// ─────────────────────────────────────────────
// RESOLVE PATH GAMBAR — dua sumber (baru dulu, fallback legacy),
// sama persis pola kendalaService (browse/export).
// ─────────────────────────────────────────────
const resolveImagePath = (nomor, suffix) => {
  const fileName = `${nomor}${suffix}.jpg`;
  const newPath = path.join(IMAGE_DIR_NEW, fileName);
  if (fs.existsSync(newPath))
    return { path: newPath, url: `/images/kendala/${fileName}` };
  const legacyPath = path.join(IMAGE_DIR_LEGACY, fileName);
  if (fs.existsSync(legacyPath))
    return { path: legacyPath, url: `/file-gambar/${fileName}` };
  return null;
};

// ─────────────────────────────────────────────
// GENERATE NOMOR — KD.{YYMM}.{seq4}, basis dari TANGGAL KENDALA
// (bukan tanggal hari ini), replikasi persis getmaxkode Delphi.
// Dipanggil FRESH saat save, bukan dari nomor yang sempat
// ditampilkan saat form pertama dibuka.
// ─────────────────────────────────────────────
const generateNomor = async (tanggal, conn) => {
  const d = new Date(tanggal);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const prefix = `${NOMERATOR}.${yy}${mm}.`;
  const [[row]] = await conn.query(
    `SELECT MAX(CAST(RIGHT(tk_nomor, 4) AS UNSIGNED)) AS maxNum
     FROM tkendala
     WHERE tk_nomor LIKE ?
     FOR UPDATE`,
    [`${prefix}%`],
  );
  const next = (row.maxNum || 0) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
};

// ─────────────────────────────────────────────
// GET DETAIL (mode edit) — header + resolusi URL gambar per slot
// ─────────────────────────────────────────────
const getDetail = async (nomor) => {
  const [rows] = await db.query(
    `SELECT
       tk_nomor AS Nomor,
       DATE_FORMAT(tk_date, '%Y-%m-%d') AS Tanggal,
       tk_description AS Kendala,
       tk_keterangan AS Keterangan
     FROM tkendala
     WHERE tk_nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) throw new Error("Kode tersebut belum ada.");
  const data = rows[0];
  const img1 = resolveImagePath(nomor, "-01");
  const img2 = resolveImagePath(nomor, "-02");
  const img3 = resolveImagePath(nomor, "-03");
  data.Image1Url = img1?.url || null;
  data.Image2Url = img2?.url || null;
  data.Image3Url = img3?.url || null;
  return data;
};

// ─────────────────────────────────────────────
// PROSES 1 GAMBAR — sama pola complainCustomerFormService:
// sharp, flatten background putih, convert JPEG quality 80.
// ─────────────────────────────────────────────
const processImage = async (tempFilePath, nomor, slot) => {
  if (!fs.existsSync(tempFilePath))
    throw new Error("File sumber sementara tidak ditemukan.");
  const finalFileName = `${nomor}-0${slot}.jpg`;
  if (!fs.existsSync(IMAGE_DIR_NEW)) {
    fs.mkdirSync(IMAGE_DIR_NEW, { recursive: true });
  }
  const finalPath = path.join(IMAGE_DIR_NEW, finalFileName);
  try {
    await sharp(tempFilePath)
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .toFormat("jpeg")
      .jpeg({ quality: 80 })
      .toFile(finalPath);
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    return finalFileName;
  } catch (error) {
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    throw new Error("Gagal memproses gambar ke format JPG.");
  }
};

// ─────────────────────────────────────────────
// SAVE — create & edit, SEKALIGUS proses upload sampai 3 gambar
// (kalau ada file baru di request). Replikasi persis simpandata
// Delphi:
//   - CREATE: nomor di-generate FRESH saat ini, berbasis tanggal
//     kendala yang diisi user (bukan tanggal saat form dibuka).
//   - EDIT: kolom tk_imageN HANYA disertakan di UPDATE kalau ada
//     file BARU untuk slot itu — slot yang tidak disentuh, nilai
//     lama TETAP, tidak ditimpa kosong.
// ─────────────────────────────────────────────
const saveData = async (nomorParam, payload, files, user) => {
  const { isEdit, tanggal, kendala, keterangan } = payload;
  if (!kendala || !kendala.trim()) {
    throw new Error("Kendala belum diisi.");
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    let nomor = nomorParam;
    if (!isEdit) {
      nomor = await generateNomor(tanggal, conn);
    }
    const imageFields = [
      { file: files?.image1?.[0], slot: 1, col: "tk_image1" },
      { file: files?.image2?.[0], slot: 2, col: "tk_image2" },
      { file: files?.image3?.[0], slot: 3, col: "tk_image3" },
    ];
    const newImageValues = {}; // hanya slot yang baru diupload
    for (const f of imageFields) {
      if (f.file) {
        const fileName = await processImage(f.file.path, nomor, f.slot);
        newImageValues[f.col] = fileName;
      }
    }
    if (isEdit) {
      const setParts = [
        "tk_description = ?",
        "tk_keterangan = ?",
        "tk_date = ?",
        "user_modified = ?",
      ];
      const params = [kendala, keterangan || "", tanggal, user.kode];
      for (const [col, val] of Object.entries(newImageValues)) {
        setParts.push(`${col} = ?`);
        params.push(val);
      }
      params.push(nomor);
      await conn.query(
        `UPDATE tkendala SET ${setParts.join(", ")} WHERE tk_nomor = ?`,
        params,
      );
    } else {
      await conn.query(
        `INSERT INTO tkendala
           (tk_nomor, tk_date, tk_description, tk_keterangan,
            tk_image1, tk_image2, tk_image3, user_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nomor,
          tanggal,
          kendala,
          keterangan || "",
          newImageValues.tk_image1 || "",
          newImageValues.tk_image2 || "",
          newImageValues.tk_image3 || "",
          user.kode,
        ],
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

// ─────────────────────────────────────────────
// RESET GAMBAR — hapus SEMUA 3 slot sekaligus (replikasi
// btreset1Click Delphi dari sisi file), TAPI dikoreksi: Delphi
// aslinya salah target UPDATE ke tcomplain (bukan tkendala) —
// jelas leftover copy-paste dari form Complain Customer. Di sini
// benar: bersihkan tk_image1/2/3 di tkendala, bukan tcomplain.
// Catatan: file LEGACY di /mnt/image sengaja TIDAK dihapus (folder
// itu read-only sebagai arsip histori lama).
// ─────────────────────────────────────────────
const resetImages = async (nomor) => {
  await db.query(
    `UPDATE tkendala SET tk_image1 = '', tk_image2 = '', tk_image3 = '' WHERE tk_nomor = ?`,
    [nomor],
  );
  for (let slot = 1; slot <= 3; slot++) {
    const filePath = path.join(IMAGE_DIR_NEW, `${nomor}-0${slot}.jpg`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  return { success: true };
};

module.exports = {
  generateNomor,
  getDetail,
  saveData,
  resetImages,
  resolveImagePath,
};
