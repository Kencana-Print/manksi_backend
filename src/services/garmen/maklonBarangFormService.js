const db = require("../../config/database");
const path = require("path");
const fs = require("fs");
const tutupBukuService = require("../tutupBukuService");
const { recomputeStatus } = require("./maklonStatusService");

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "maklon");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ─────────────────────────────────────────────────────────
// GENERATE NOMOR — format MKL.YYYY.NNNNN
// ─────────────────────────────────────────────────────────
const generateNomor = async (conn) => {
  const year = new Date().getFullYear();
  const [[last]] = await conn.query(
    `SELECT mkl_nomor FROM tmaklon_hdr WHERE mkl_nomor LIKE ? ORDER BY mkl_nomor DESC LIMIT 1 FOR UPDATE`,
    [`MKL.${year}.%`],
  );
  const nextUrut = last ? parseInt(last.mkl_nomor.split(".")[2], 10) + 1 : 1;
  return `MKL.${year}.${String(nextUrut).padStart(5, "0")}`;
};

const generateSjNomor = async (conn) => {
  const year = new Date().getFullYear();
  const [[last]] = await conn.query(
    `SELECT sjk_nomor FROM tmaklon_sj_keluar_hdr WHERE sjk_nomor LIKE ? ORDER BY sjk_nomor DESC LIMIT 1 FOR UPDATE`,
    [`SJ-MKL.${year}.%`],
  );
  const nextUrut = last ? parseInt(last.sjk_nomor.split(".")[2], 10) + 1 : 1;
  return `SJ-MKL.${year}.${String(nextUrut).padStart(5, "0")}`;
};

// ─────────────────────────────────────────────────────────
// CABANG OPTIONS — untuk dropdown Cabang Asal/Tujuan
// ─────────────────────────────────────────────────────────
const getCabangOptions = async () => {
  const [rows] = await db.query(
    `SELECT pab_kode AS Kode, pab_nama AS Nama
     FROM tpabrik
     WHERE pab_kode IN ('P01','P02','P04','P05')
     ORDER BY pab_kode`,
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// CEK APAKAH BOLEH EDIT — sama seperti cekBisaHapusUbah di
// maklonBarangService (belum ada progress penerimaan sama sekali),
// TAPI di sini kalau sudah tutup buku, dicek juga approval PIN5
// yang sudah di-ACC (pola sama dengan soFormService untuk kasus
// TUTUPBUKU) — supaya edit tetap bisa lolos kalau memang sudah
// diajukan & disetujui.
// ─────────────────────────────────────────────────────────
const checkEditGate = async (conn, nomor) => {
  const [[sjkCount]] = await conn.query(
    `SELECT COUNT(*) AS Total FROM tmaklon_sj_keluar_hdr WHERE sjk_mkl_nomor = ?`,
    [nomor],
  );
  if (Number(sjkCount.Total) > 0) {
    throw new Error(
      "SJ Keluar sudah dibuat untuk Maklon ini, tidak bisa diubah lagi.",
    );
  }

  const [[hdr]] = await conn.query(
    `SELECT mkl_nomor, DATE_FORMAT(mkl_tanggal, '%Y-%m-%d') AS mkl_tanggal
     FROM tmaklon_hdr h WHERE h.mkl_nomor = ? FOR UPDATE`,
    [nomor],
  );
  if (!hdr) throw new Error("Nomor Maklon tidak ditemukan.");

  if (Number(hdr.TotalProgress) > 0) {
    throw new Error(
      "Maklon ini sudah ada penerimaan (SJ Maklon), tidak bisa diubah.",
    );
  }

  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  const zClose = await tutupBukuService.getManualTutupBuku("MAKLON BARANG");
  const tglTrx = new Date(hdr.mkl_tanggal);
  const isClose = zClose ? tglTrx < zClose : tglTrx < zdtClose;

  if (isClose) {
    const [[approvedPin]] = await conn.query(
      `SELECT pin_urut FROM tspk_pin5
       WHERE pin_trs='MAKLON' AND pin_nomor=? AND pin_acc='Y' AND pin_dipakai=''
       ORDER BY pin_urut DESC LIMIT 1`,
      [nomor],
    );
    if (!approvedPin) {
      throw new Error(
        "Transaksi sudah close. Ajukan Pengajuan Perubahan Data terlebih dahulu.",
      );
    }
    return approvedPin.pin_urut;
  }

  return null;
};

// ⬅ BARU: cek stok polos di cabang asal cukup untuk qty_kirim yang
// diminta. Dipanggil per baris SEBELUM insert apa pun — kalau ada
// satu saja yang kurang, seluruh saveData gagal (rollback total),
// bukan cuma baris itu yang ditolak.
const assertStokCukup = async (conn, cabAsal, kodePolos, qtyKirim) => {
  const [[row]] = await conn.query(
    `SELECT IFNULL(SUM(mst_stok_in - mst_stok_out), 0) AS Stok
     FROM tmasterstok_acc WHERE mst_brg_kode = ? AND mst_cab = ?`,
    [kodePolos, cabAsal],
  );
  const stok = Number(row.Stok) || 0;
  if (qtyKirim > stok) {
    const err = new Error(
      `Stok tidak cukup untuk ${kodePolos} di cabang ${cabAsal}. Tersedia: ${stok}, diminta: ${qtyKirim}.`,
    );
    err.statusCode = 400;
    throw err;
  }
};

// ⬅ BARU: extract logic pindah file temp→permanen jadi helper terpisah,
// supaya bisa dipanggil dari saveData (alur baru) maupun uploadGambar
// (alur lama, tetap dipertahankan untuk backward-compat).
const moveTempToPermanent = (tempFile) => {
  const finalName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(tempFile.originalname)}`;
  const finalPath = path.join(UPLOAD_DIR, finalName);
  fs.renameSync(tempFile.path, finalPath);
  return `/uploads/maklon/${finalName}`;
};

// ─────────────────────────────────────────────────────────
// SAVE — create baru atau update. DIUBAH: sekarang terima `files`
// (req.files dari multer) dan `pendingKeys` (array string, urutan-nya
// PERSIS sama dengan urutan file di-append di FormData frontend —
// files[i] berpasangan dengan pendingKeys[i]). Gambar yang baru dipilih
// user (preview blob, belum ada di server) dikirim dengan field
// `pendingKey` alih-alih `file_path`; di sini baru benar-benar
// dipindah ke folder permanen dan dapat file_path final-nya.
// ─────────────────────────────────────────────────────────
const saveData = async (payload, user, files = [], pendingKeys = []) => {
  const { header, details } = payload;
  if (!header.mkl_cab_asal || !header.mkl_cab_tujuan) {
    throw new Error("Cabang Asal dan Cabang Tujuan wajib diisi.");
  }
  if (header.mkl_cab_asal === header.mkl_cab_tujuan) {
    throw new Error("Cabang Asal dan Cabang Tujuan tidak boleh sama.");
  }
  if (!header.mkl_deadline) {
    throw new Error("Deadline wajib diisi.");
  }
  if (!details || !details.length) {
    throw new Error("Detail barang wajib diisi minimal 1 baris.");
  }

  // ⬅ BARU: map pendingKey -> file mentah, dari dua array sejajar
  const fileByPendingKey = {};
  pendingKeys.forEach((key, idx) => {
    if (files[idx]) fileByPendingKey[key] = files[idx];
  });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const isEdit = !!header.mkl_nomor;
    let approvedPinUrut = null;

    if (isEdit) {
      approvedPinUrut = await checkEditGate(conn, header.mkl_nomor);

      const [oldDtl] = await conn.query(
        `SELECT mkld_id FROM tmaklon_dtl WHERE mkld_mkl_nomor = ?`,
        [header.mkl_nomor],
      );
      for (const row of oldDtl) {
        const [oldJadi] = await conn.query(
          `SELECT mkldj_id FROM tmaklon_dtl_jadi WHERE mkldj_mkld_id = ?`,
          [row.mkld_id],
        );
        for (const j of oldJadi) {
          await conn.query(
            `DELETE FROM tmaklon_gambar WHERE mklg_mkldj_id = ?`,
            [j.mkldj_id],
          );
        }
        await conn.query(`DELETE FROM tmaklon_dtl_jadi WHERE mkld_id = ?`, [
          row.mkld_id,
        ]);
        await conn.query(`DELETE FROM tmaklon_dtl WHERE mkld_id = ?`, [
          row.mkld_id,
        ]);
      }

      await conn.query(
        `UPDATE tmaklon_hdr
         SET mkl_tanggal=?, mkl_cab_asal=?, mkl_cab_tujuan=?, mkl_keterangan=?, mkl_deadline=?
         WHERE mkl_nomor=?`,
        [
          header.mkl_tanggal,
          header.mkl_cab_asal,
          header.mkl_cab_tujuan,
          header.mkl_keterangan || "",
          header.mkl_deadline,
          header.mkl_nomor,
        ],
      );
    } else {
      header.mkl_nomor = await generateNomor(conn);
      await conn.query(
        `INSERT INTO tmaklon_hdr (mkl_nomor, mkl_tanggal, mkl_cab_asal, mkl_cab_tujuan, mkl_keterangan, mkl_deadline, mkl_status, mkl_user_create, mkl_date_create)
         VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, NOW())`,
        [
          header.mkl_nomor,
          header.mkl_tanggal,
          header.mkl_cab_asal,
          header.mkl_cab_tujuan,
          header.mkl_keterangan || "",
          header.mkl_deadline,
          user.kode,
        ],
      );
    }

    const totalQtyPerPolos = {};
    for (const d of details) {
      if (!d.kode_polos || !d.qty_kirim) continue;
      if (d.is_freetext) continue;
      totalQtyPerPolos[d.kode_polos] =
        (totalQtyPerPolos[d.kode_polos] || 0) + Number(d.qty_kirim);
    }
    for (const [kodePolos, totalQty] of Object.entries(totalQtyPerPolos)) {
      await assertStokCukup(conn, header.mkl_cab_asal, kodePolos, totalQty);
    }

    const sjItems = [];

    for (const d of details) {
      if (!d.kode_polos || !d.qty_kirim || Number(d.qty_kirim) <= 0) {
        throw new Error(
          "Kode Barang Polos dan Qty Kirim wajib diisi (> 0) di setiap baris.",
        );
      }
      if (d.is_freetext && !d.nama_polos_manual) {
        throw new Error(
          `Baris ${d.kode_polos}: Nama Barang wajib diisi untuk input manual.`,
        );
      }
      if (!d.target_jadi || !d.target_jadi.length) {
        throw new Error(
          `Baris ${d.kode_polos}: minimal 1 target Barang Jadi harus diisi.`,
        );
      }

      const [result] = await conn.query(
        `INSERT INTO tmaklon_dtl
           (mkld_mkl_nomor, mkld_kode_polos, mkld_qty_kirim, mkld_satuan_kirim,
            mkld_keterangan, mkld_is_freetext, mkld_nama_polos_manual)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          header.mkl_nomor,
          d.kode_polos,
          d.qty_kirim,
          d.satuan_kirim || "",
          d.keterangan || "",
          d.is_freetext ? 1 : 0,
          d.is_freetext ? d.nama_polos_manual || "" : null,
        ],
      );

      sjItems.push({ mkld_id: result.insertId, qty: Number(d.qty_kirim) });

      for (const t of d.target_jadi) {
        if (!t.kode_jadi)
          throw new Error(
            `Baris ${d.kode_polos}: Kode Barang Jadi wajib diisi.`,
          );
        const [jadiResult] = await conn.query(
          `INSERT INTO tmaklon_dtl_jadi (mkldj_mkld_id, mkldj_kode_jadi, mkldj_estimasi_qty, mkldj_dateline)
           VALUES (?, ?, ?, ?)`,
          [
            result.insertId,
            t.kode_jadi,
            Number(t.estimasi_qty) || 0,
            header.mkl_deadline,
          ],
        );

        if (t.gambar && t.gambar.length) {
          for (const g of t.gambar) {
            // ⬅ BARU: resolve file_path final — kalau gambar ini punya
            // pendingKey, berarti baru dipilih user & belum ada di server,
            // pindahkan dulu dari temp ke folder permanen. Kalau tidak
            // punya pendingKey (edit mode, gambar lama), file_path yang
            // dikirim sudah path server valid, pakai apa adanya.
            let finalFilePath = g.file_path;
            if (g.pendingKey) {
              const tempFile = fileByPendingKey[g.pendingKey];
              if (!tempFile) {
                throw new Error(
                  `File untuk gambar pending "${g.pendingKey}" tidak ditemukan di request.`,
                );
              }
              finalFilePath = moveTempToPermanent(tempFile);
            }

            await conn.query(
              `INSERT INTO tmaklon_gambar (mklg_mkldj_id, mklg_file_path, mklg_keterangan, mklg_user_upload, mklg_date_upload)
               VALUES (?, ?, ?, ?, NOW())`,
              [
                jadiResult.insertId,
                finalFilePath,
                g.keterangan || "",
                user.kode,
              ],
            );
          }
        }
      }
    }

    let sjkNomor = null;
    if (sjItems.length) {
      sjkNomor = await generateSjNomor(conn);
      await conn.query(
        `INSERT INTO tmaklon_sj_keluar_hdr (sjk_nomor, sjk_mkl_nomor, sjk_tanggal, sjk_user_create, sjk_date_create)
         VALUES (?, ?, ?, ?, NOW())`,
        [sjkNomor, header.mkl_nomor, header.mkl_tanggal, user.kode],
      );
      for (const item of sjItems) {
        await conn.query(
          `INSERT INTO tmaklon_sj_keluar_dtl (sjkd_sjk_nomor, sjkd_mkld_id, sjkd_qty_kirim)
           VALUES (?, ?, ?)`,
          [sjkNomor, item.mkld_id, item.qty],
        );
      }
    }

    if (sjkNomor) {
      await recomputeStatus(conn, header.mkl_nomor);
    }

    if (approvedPinUrut) {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai='Y' WHERE pin_trs='MAKLON' AND pin_nomor=? AND pin_urut=?`,
        [header.mkl_nomor, approvedPinUrut],
      );
    }

    await conn.commit();
    return { nomor: header.mkl_nomor, sjkNomor };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────
// UPLOAD GAMBAR — pindahkan file dari temp ke folder permanen,
// kembalikan path publiknya. Insert ke tmaklon_gambar dilakukan
// terpisah lewat saveData (di atas), bukan di sini — supaya
// gambar baru untuk baris yang belum punya mkld_id (baris baru
// di form) tetap bisa "menempel" sampai baris itu benar-benar
// tersimpan.
// ─────────────────────────────────────────────────────────
const uploadGambar = async (files) => {
  if (!files || !files.length) throw new Error("Tidak ada file yang diunggah.");
  const results = [];
  for (const file of files) {
    const finalName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    const finalPath = path.join(UPLOAD_DIR, finalName);
    fs.renameSync(file.path, finalPath);
    results.push({
      file_path: `/uploads/maklon/${finalName}`,
      original_name: file.originalname,
    });
  }
  return results;
};

module.exports = { getCabangOptions, saveData, uploadGambar };
