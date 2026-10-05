const db = require("../../config/database");
const fs = require("fs");
const path = require("path");

const UPLOAD_DIR = path.join(
  process.cwd(),
  "public",
  "uploads",
  "permintaan-desain",
);

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const addLampiran = async (nomor, files, userKode) => {
  if (!files || !files.length) throw new Error("Tidak ada file yang diupload.");
  const targetDir = path.join(UPLOAD_DIR, nomor);
  ensureDir(targetDir);

  const inserted = [];
  for (const file of files) {
    const destPath = path.join(targetDir, file.filename);
    fs.renameSync(file.path, destPath);
    const [result] = await db.query(
      `INSERT INTO tpermintaan_desain_lampiran
        (pd3_pd_nomor, pd3_filename, pd3_original_name, pd3_user_upload, pd3_date_upload)
       VALUES (?, ?, ?, ?, NOW())`,
      [nomor, file.filename, file.originalname, userKode],
    );
    inserted.push({
      id: result.insertId,
      filename: file.filename,
      originalName: file.originalname,
    });
  }
  return inserted;
};

const getLampiran = async (nomor) => {
  const [rows] = await db.query(
    `SELECT pd3_id, pd3_filename, pd3_original_name, pd3_user_upload, pd3_date_upload
     FROM tpermintaan_desain_lampiran WHERE pd3_pd_nomor = ? ORDER BY pd3_id`,
    [nomor],
  );
  return rows.map((r) => ({
    id: r.pd3_id,
    filename: r.pd3_filename,
    originalName: r.pd3_original_name,
    url: `/uploads/permintaan-desain/${nomor}/${r.pd3_filename}`,
    userUpload: r.pd3_user_upload,
    dateUpload: r.pd3_date_upload,
  }));
};

const deleteLampiran = async (pd3Id) => {
  const [[row]] = await db.query(
    `SELECT pd3_pd_nomor, pd3_filename FROM tpermintaan_desain_lampiran WHERE pd3_id = ?`,
    [pd3Id],
  );
  if (!row) throw new Error("Lampiran tidak ditemukan.");
  await db.query(`DELETE FROM tpermintaan_desain_lampiran WHERE pd3_id = ?`, [
    pd3Id,
  ]);
  const filePath = path.join(UPLOAD_DIR, row.pd3_pd_nomor, row.pd3_filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  return { deleted: true };
};

module.exports = { addLampiran, getLampiran, deleteLampiran };
