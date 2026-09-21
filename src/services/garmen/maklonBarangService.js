const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

const getBrowse = async ({ startDate, endDate, cab, keyword }) => {
  let sql = `
    SELECT h.mkl_nomor, h.mkl_tanggal, h.mkl_deadline, h.mkl_cab_asal, h.mkl_cab_tujuan,
           h.mkl_status, h.mkl_keterangan,
           h.mkl_tgl_kirim, h.mkl_tgl_selesai_dtf, h.mkl_tgl_otw_gudang, h.mkl_tgl_selesai,
           h.mkl_user_create, h.mkl_date_create,
           COUNT(d.mkld_id) AS JmlItem,
           SUM(d.mkld_qty_kirim) AS TotalKirim,
           SUM(d.mkld_qty_terima) AS TotalTerima,
           SUM(d.mkld_qty_bs) AS TotalBs,
           (SELECT sjk.sjk_nomor FROM tmaklon_sj_keluar_hdr sjk
            WHERE sjk.sjk_mkl_nomor = h.mkl_nomor ORDER BY sjk.sjk_nomor LIMIT 1) AS SjkNomorPertama
    FROM tmaklon_hdr h
    LEFT JOIN tmaklon_dtl d ON d.mkld_mkl_nomor = h.mkl_nomor
    WHERE h.mkl_tanggal BETWEEN ? AND ?
  `;
  const params = [startDate, endDate];

  if (cab) {
    sql += ` AND (h.mkl_cab_asal = ? OR h.mkl_cab_tujuan = ?)`;
    params.push(cab, cab);
  }

  if (keyword && keyword.trim() !== "") {
    sql += ` AND (h.mkl_nomor LIKE ? OR h.mkl_keterangan LIKE ?)`;
    params.push(`%${keyword.trim()}%`, `%${keyword.trim()}%`);
  }

  sql += ` GROUP BY h.mkl_nomor ORDER BY h.mkl_tanggal DESC, h.mkl_nomor DESC`;

  const [rows] = await db.query(sql, params);
  return rows;
};

// ─────────────────────────────────────────────────────────
// GET DETAIL (untuk expand row & form edit)
// ─────────────────────────────────────────────────────────
const getDetail = async (nomor) => {
  const [[header]] = await db.query(
    `SELECT h.*, ga.pab_nama AS NamaCabAsal, gt.pab_nama AS NamaCabTujuan
     FROM tmaklon_hdr h
     LEFT JOIN tpabrik ga ON ga.pab_kode = h.mkl_cab_asal
     LEFT JOIN tpabrik gt ON gt.pab_kode = h.mkl_cab_tujuan
     WHERE h.mkl_nomor = ?`,
    [nomor],
  );
  if (!header) throw new Error("Nomor Maklon tidak ditemukan.");

  const [details] = await db.query(
    `SELECT d.*,
            IF(d.mkld_is_freetext = 1, d.mkld_nama_polos_manual, b.brg_nama) AS NamaPolos
     FROM tmaklon_dtl d
     LEFT JOIN tgarmen_brg b ON b.brg_kode = d.mkld_kode_polos
     WHERE d.mkld_mkl_nomor = ?
     ORDER BY d.mkld_id`,
    [nomor],
  );

  for (const d of details) {
    const [targetJadi] = await db.query(
      `SELECT j.*, b.brg_nama AS NamaJadi
       FROM tmaklon_dtl_jadi j
       LEFT JOIN tgarmen_brg b ON b.brg_kode = j.mkldj_kode_jadi
       WHERE j.mkldj_mkld_id = ?
       ORDER BY j.mkldj_id`,
      [d.mkld_id],
    );
    for (const t of targetJadi) {
      const [gambar] = await db.query(
        `SELECT mklg_id, mklg_file_path, mklg_keterangan FROM tmaklon_gambar WHERE mklg_mkldj_id = ?`,
        [t.mkldj_id],
      );
      t.gambar = gambar;
    }
    d.target_jadi = targetJadi;
  }

  return { header, details };
};

// ─────────────────────────────────────────────────────────
// CEK BISA HAPUS / UBAH
// Beda dari STBJ: kuncinya "belum ada progress penerimaan sama
// sekali" (qty_terima & qty_bs semua baris masih 0), bukan soal
// "sudah ada dokumen terima" — karena stok & progress di sini
// sudah terikat trigger begitu SJ Maklon masuk.
// ─────────────────────────────────────────────────────────
const cekBisaHapusUbah = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT h.mkl_nomor, DATE_FORMAT(h.mkl_tanggal, '%Y-%m-%d') AS mkl_tanggal,
            h.mkl_cab_asal, h.mkl_user_create,
            (SELECT COUNT(*) FROM tmaklon_sj_keluar_hdr WHERE sjk_mkl_nomor = h.mkl_nomor) AS JmlSjKeluar
     FROM tmaklon_hdr h
     WHERE h.mkl_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");

  if (Number(hdr.JmlSjKeluar) > 0) {
    throw new Error(
      "SJ Keluar sudah dibuat untuk Maklon ini, tidak bisa diubah/dihapus.",
    );
  }

  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  const zClose = await tutupBukuService.getManualTutupBuku("MAKLON BARANG");
  const tglTrx = new Date(hdr.mkl_tanggal);
  const isClose = zClose ? tglTrx < zClose : tglTrx < zdtClose;

  if (isClose) {
    throw new Error("Transaksi tsb sudah close. Tidak bisa diubah/dihapus.");
  }

  return hdr;
};

// ─────────────────────────────────────────────────────────
// DELETE
// Hapus gambar → detail (trigger after_delete otomatis kembalikan
// stok polos yang sudah terlanjur keluar) → header.
// ─────────────────────────────────────────────────────────
const deleteData = async (nomor, userKode, userCab) => {
  const hdr = await cekBisaHapusUbah(nomor);

  if (userCab && !userCab.startsWith("HO")) {
    if (hdr.mkl_user_create !== userKode) {
      throw new Error(
        `Data ini milik ${hdr.mkl_user_create}. Anda tidak boleh menghapus.`,
      );
    }
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [dtlRows] = await conn.query(
      `SELECT mkld_id FROM tmaklon_dtl WHERE mkld_mkl_nomor = ?`,
      [nomor],
    );
    const dtlIds = dtlRows.map((r) => r.mkld_id);

    if (dtlIds.length) {
      await conn.query(`DELETE FROM tmaklon_gambar WHERE mkld_mkld_id IN (?)`, [
        dtlIds,
      ]);
      // Hapus baris SATU-PER-SATU (bukan bulk WHERE IN) supaya trigger
      // tmaklon_dtl_after_delete jalan per baris dan stok polos
      // dikembalikan dengan benar di tiap barisnya.
      for (const id of dtlIds) {
        await conn.query(`DELETE FROM tmaklon_dtl WHERE mkld_id = ?`, [id]);
      }
    }

    await conn.query(`DELETE FROM tmaklon_hdr WHERE mkl_nomor = ?`, [nomor]);

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────
// PENGAJUAN UBAH (PIN5) — pin_trs = 'MAKLON'
// ─────────────────────────────────────────────────────────
const pengajuanUbah = async (nomor, alasan, userKode) => {
  const [[hdr]] = await db.query(
    `SELECT mkl_tanggal, mkl_keterangan FROM tmaklon_hdr WHERE mkl_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");

  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  const zClose = await tutupBukuService.getManualTutupBuku("MAKLON BARANG");
  const tglTrx = new Date(hdr.mkl_tanggal);
  const isClose = zClose ? tglTrx < zClose : tglTrx < zdtClose;
  if (!isClose) {
    throw new Error("Tidak perlu pengajuan perubahan data.");
  }

  if (!alasan?.trim()) throw new Error("Alasan harus diisi.");

  const [[lastPin]] = await db.query(
    `SELECT pin_urut, pin_dipakai FROM tspk_pin5
     WHERE pin_trs = 'MAKLON' AND pin_nomor = ?
     ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );

  let urut = 1;
  if (lastPin) {
    urut = lastPin.pin_dipakai === "" ? lastPin.pin_urut : lastPin.pin_urut + 1;
  }

  await db.query(
    `INSERT INTO tspk_pin5
       (pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket,
        pin_tgl_minta, pin_user_minta, pin_alasan)
     VALUES ('MAKLON', ?, ?, ?, ?, NOW(), ?, ?)
     ON DUPLICATE KEY UPDATE
       pin_tgl_trs    = VALUES(pin_tgl_trs),
       pin_ket        = VALUES(pin_ket),
       pin_acc        = '',
       pin_tgl_minta  = NOW(),
       pin_user_minta = VALUES(pin_user_minta),
       pin_alasan     = VALUES(pin_alasan)`,
    [nomor, urut, hdr.mkl_tanggal, hdr.mkl_keterangan, userKode, alasan],
  );

  return { urut };
};

// ─────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────
const getExportData = async (tglAwal, tglAkhir, cab = "") => {
  return getBrowse({ startDate: tglAwal, endDate: tglAkhir, cab });
};

const getPrintData = async (nomor) => {
  const [[header]] = await db.query(
    `SELECT h.*, ga.pab_nama AS NamaCabAsal, gt.pab_nama AS NamaCabTujuan
     FROM tmaklon_hdr h
     LEFT JOIN tpabrik ga ON ga.pab_kode = h.mkl_cab_asal
     LEFT JOIN tpabrik gt ON gt.pab_kode = h.mkl_cab_tujuan
     WHERE h.mkl_nomor = ?`,
    [nomor],
  );
  if (!header) throw new Error("Nomor Maklon tidak ditemukan.");

  const [details] = await db.query(
    `SELECT d.mkld_id, d.mkld_kode_polos,
            IF(d.mkld_is_freetext = 1, d.mkld_nama_polos_manual, b.brg_nama) AS NamaPolos,
            d.mkld_qty_kirim, d.mkld_satuan_kirim, d.mkld_keterangan, d.mkld_is_freetext
     FROM tmaklon_dtl d
     LEFT JOIN tgarmen_brg b ON b.brg_kode = d.mkld_kode_polos
     WHERE d.mkld_mkl_nomor = ?
     ORDER BY d.mkld_id`,
    [nomor],
  );

  for (const d of details) {
    const [targetJadi] = await db.query(
      `SELECT j.mkldj_id, j.mkldj_kode_jadi, bj.brg_nama AS NamaJadi,
              j.mkldj_estimasi_qty, j.mkldj_dateline
       FROM tmaklon_dtl_jadi j
       LEFT JOIN tgarmen_brg bj ON bj.brg_kode = j.mkldj_kode_jadi
       WHERE j.mkldj_mkld_id = ?
       ORDER BY j.mkldj_id`,
      [d.mkld_id],
    );
    for (const t of targetJadi) {
      const [gambar] = await db.query(
        `SELECT mklg_file_path, mklg_keterangan FROM tmaklon_gambar WHERE mklg_mkldj_id = ?`,
        [t.mkldj_id],
      );
      t.gambar = gambar;
    }
    d.target_jadi = targetJadi;
  }

  return { header, details };
};

module.exports = {
  getBrowse,
  getDetail,
  cekBisaHapusUbah,
  deleteData,
  pengajuanUbah,
  getExportData,
  getPrintData,
};
