const fs = require("fs");
const path = require("path");
const db = require("../../config/database");

const IMAGE_DIR = path.join(process.cwd(), "public/images");
if (!fs.existsSync(IMAGE_DIR)) {
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
}

/**
 * Opsi Cabang — replikasi FormCreate: sama pola PO Paperprint.
 */
const getCabangOptions = (user) => {
  const cab = user.cabang || "";
  if (cab !== "" && cab !== "HO-") return [cab];
  return ["P01", "P02", "P04", "P05"];
};

/**
 * Validasi Supplier manual-blur — replikasi edtSupExit PERSIS, termasuk
 * ambil sup_kode_kaosan (field baru, tidak ada di PO Paperprint).
 */
const resolveSupplier = async (kode) => {
  const [rows] = await db.query(
    `SELECT sup_kode AS kode, sup_nama AS nama, sup_alamat AS alamat,
       sup_kode_kaosan AS kodeKaosan
     FROM tsupplier WHERE sup_kode = ?`,
    [kode],
  );
  if (rows.length === 0) return null;
  return rows[0];
};

/**
 * Resolve SPK manual-type (loadspk) — ⚠️ query LEBIH SEDERHANA dari
 * PO Paperprint: cuma Nomor+Nama, TIDAK fetch ukuran/bahan sama sekali
 * (field itu selalu manual di modul ini, tidak ada logic P05).
 */
const resolveSpkManual = async (nomor) => {
  const q = `
    SELECT * FROM (
      SELECT spk_nomor AS Nomor, spk_nama AS Nama FROM tspk WHERE spk_aktif = "Y"
      UNION ALL
      SELECT mspk_nomor AS Nomor, mspk_nama AS Nama FROM tmemospk
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
 * loaddetail — ambil header + detail utk edit/print.
 */
const getFormData = async (nomor) => {
  const qHeader = `
    SELECT h.pjh_nomor, h.pjh_tanggal, h.pjh_dateline, h.pjh_sup_kode,
      h.pjh_kode_kaosan, h.pjh_ket, h.pjh_cab, s.sup_nama, s.sup_alamat
    FROM tpodtf_hdr h
    LEFT JOIN tsupplier s ON s.sup_kode = h.pjh_sup_kode
    WHERE h.pjh_nomor = ?
  `;
  const [headerRows] = await db.query(qHeader, [nomor]);
  if (headerRows.length === 0) return null;

  const qDetail = `
    SELECT pjd_spk AS spk, pjd_nama AS nama, pjd_ukuran AS ukuran,
      pjd_bahan AS bahan, pjd_qty AS jumlah, pjd_qtyl AS jmlLayout,
      pjd_harga AS harga, pjd_ket AS ket, pjd_idgambar AS idgambar
    FROM tpodtf_dtl WHERE pjd_nomor = ?
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
    `SELECT IFNULL(MAX(RIGHT(pjh_nomor, 4)), 0) AS mx FROM tpodtf_hdr
     WHERE MID(pjh_nomor, 4, 6) = ? FOR UPDATE`,
    [yyyymm],
  );
  const next = Number(rows[0].mx) + 1;
  return `PD.${yyyymm}.${String(next).padStart(4, "0")}`;
};

/**
 * simpandata — replikasi persis, PLUS handle gambar per baris (pola
 * sama seperti PO Paperprint).
 */
const saveData = async (payload, filesByField, user, isEdit) => {
  const {
    nomor,
    tanggal,
    dateline,
    supKode,
    kodeKaosan,
    keterangan,
    cabang,
    details,
  } = payload;

  if (!supKode || !supKode.trim()) {
    throw new Error("Supplier harus diisi.");
  }

  const validDetails = (details || []).filter((d) => d.spk && d.spk.trim());
  if (validDetails.length === 0) {
    throw new Error("Detail harus diisi.");
  }
  // Validasi Jumlah (Jml Cetak / pjd_qty) wajib != 0 — jmlLayout (jmll)
  // TIDAK divalidasi (free text, boleh kosong, sesuai source)
  for (const d of validDetails) {
    if (!d.jumlah || Number(d.jumlah) === 0) {
      throw new Error("Jumlah harus diisi.");
    }
  }

  const conn = await db.getConnection();
  const filesToDelete = [];
  const filesToWrite = [];

  try {
    await conn.beginTransaction();

    let finalNomor = nomor;

    if (isEdit) {
      const [rows] = await conn.query(
        `SELECT pjh_nomor FROM tpodtf_hdr WHERE pjh_nomor = ? FOR UPDATE`,
        [nomor],
      );
      if (rows.length === 0) throw new Error("Data tidak ditemukan.");

      await conn.query(
        `UPDATE tpodtf_hdr SET pjh_tanggal = ?, pjh_dateline = ?,
           pjh_sup_kode = ?, pjh_kode_kaosan = ?, pjh_ket = ?, pjh_cab = ?,
           user_modified = ?, date_modified = NOW()
         WHERE pjh_nomor = ?`,
        [
          tanggal,
          dateline,
          supKode,
          kodeKaosan || "",
          keterangan || "",
          cabang,
          user.kode,
          nomor,
        ],
      );
    } else {
      finalNomor = await getMaxNomor(conn, tanggal);

      await conn.query(
        `INSERT INTO tpodtf_hdr
           (pjh_nomor, pjh_tanggal, pjh_dateline, pjh_sup_kode, pjh_kode_kaosan, pjh_ket, pjh_cab, user_create, date_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          finalNomor,
          tanggal,
          dateline,
          supKode,
          kodeKaosan || "",
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

    await conn.query(`DELETE FROM tpodtf_dtl WHERE pjd_nomor = ?`, [
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
        `INSERT INTO tpodtf_dtl
           (pjd_nomor, pjd_spk, pjd_nama, pjd_ukuran, pjd_bahan, pjd_qty, pjd_harga, pjd_qtyl, pjd_ket, pjd_idgambar)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          finalNomor,
          d.spk,
          d.nama,
          d.ukuran || "",
          d.bahan || "",
          d.jumlah,
          d.harga || 0,
          d.jmlLayout || "",
          d.ket || "",
          finalIdGambar,
        ],
      );
    }

    await conn.commit();

    for (const f of filesToWrite) {
      fs.copyFileSync(f.tmpPath, path.join(IMAGE_DIR, f.finalName));
      fs.unlinkSync(f.tmpPath);
    }
    for (const filename of filesToDelete) {
      const fp = path.join(IMAGE_DIR, filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }

    return { nomor: finalNomor };
  } catch (error) {
    await conn.rollback();
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
  resolveSupplier,
  resolveSpkManual,
  getFormData,
  saveData,
};
