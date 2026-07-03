const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// ─────────────────────────────────────────────────────────
// BROWSE — sesuai Delphi btnRefreshClick
// ─────────────────────────────────────────────────────────
const getBrowse = async (tglAwal, tglAkhir, gudang = "") => {
  const [rows] = await db.query(
    `SELECT
       h.stbj_nomor       AS Nomor,
       DATE_FORMAT(h.stbj_tanggal, '%Y-%m-%d') AS Tanggal,
       h.stbj_keterangan  AS Keterangan,
       h.stbj_gdg_kode    AS GudangKode,
       g.gdg_nama         AS Gudang,
       gp.gdgp_nama       AS Dari,
       IFNULL(ts.ts_nomor, '')  AS NomorTerima,
       DATE_FORMAT(ts.ts_tanggal, '%Y-%m-%d') AS TglTerima,
       IFNULL((
         SELECT
           IFNULL(IF(p.pin_acc='' AND p.pin_dipakai='', 'WAIT',
                  IF(p.pin_acc='Y' AND p.pin_dipakai='', 'ACC',
                  IF(p.pin_acc='Y' AND p.pin_dipakai='Y', '',
                  IF(p.pin_acc='N', 'TOLAK', '')))), '')
         FROM tspk_pin5 p
         WHERE p.pin_trs = 'STBJ' AND p.pin_nomor = h.stbj_nomor
         ORDER BY p.pin_urut DESC LIMIT 1
       ), '') AS Ngedit,
       h.user_create AS Usr,
       h.date_create
     FROM tstbj_hdr h
     LEFT JOIN tgudang         g  ON g.gdg_kode   = h.stbj_gdg_kode
     LEFT JOIN tgudangproduksi gp ON gp.gdgp_kode = h.stbj_gdgp_kode
     LEFT JOIN retail.tdc_stbj_hdr ts ON ts.ts_stbj = h.stbj_nomor
     WHERE h.stbj_tanggal >= ? AND h.stbj_tanggal <= ?
       AND h.stbj_gdg_kode LIKE ?
     ORDER BY h.date_create`,
    [tglAwal, tglAkhir, `%${gudang}%`],
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// BROWSE DETAIL — sesuai Delphi SQLDetail
// ─────────────────────────────────────────────────────────
const getBrowseDetail = async (tglAwal, tglAkhir, gudang = "") => {
  const [rows] = await db.query(
    `SELECT
       h.stbj_nomor        AS Nomor,
       d.stbjd_spk_nomor   AS Spk_Nomor,
       IFNULL(sk.spk_nama, sgi.spgi_nama) AS Nama,
       sk.spk_ukuran       AS Ukuran,
       d.stbjd_size        AS Size,
       d.stbjd_jumlah      AS Jumlah,
       d.stbjd_koli        AS Koli,
       d.stbjd_keterangan  AS Keterangan
     FROM tstbj_hdr h
     INNER JOIN tstbj_dtl d  ON d.stbjd_stbj_nomor = h.stbj_nomor
     LEFT  JOIN tspk      sk ON sk.spk_nomor = d.stbjd_spk_nomor
     LEFT  JOIN tspk_gudangitem sgi ON sgi.spgi_spk = d.stbjd_spk_nomor
     WHERE h.stbj_tanggal >= ? AND h.stbj_tanggal <= ?
       AND h.stbj_gdg_kode LIKE ?
     ORDER BY h.stbj_nomor`,
    [tglAwal, tglAkhir, `%${gudang}%`],
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// GET BY NOMOR (untuk expand row di browse)
// ─────────────────────────────────────────────────────────
const getDetailByNomor = async (nomor) => {
  const [rows] = await db.query(
    `SELECT
       d.stbjd_spk_nomor   AS Spk_Nomor,
       IFNULL(sk.spk_nama, sgi.spgi_nama) AS Nama,
       sk.spk_ukuran       AS Ukuran,
       d.stbjd_size        AS Size,
       d.stbjd_jumlah      AS Jumlah,
       d.stbjd_koli        AS Koli,
       d.stbjd_keterangan  AS Keterangan
     FROM tstbj_dtl d
     LEFT JOIN tspk sk ON sk.spk_nomor = d.stbjd_spk_nomor
     LEFT JOIN tspk_gudangitem sgi ON sgi.spgi_spk = d.stbjd_spk_nomor
     WHERE d.stbjd_stbj_nomor = ?
     ORDER BY d.stbjd_spk_nomor`,
    [nomor],
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// CEK BISA HAPUS / UBAH
// Sesuai Delphi cxButton4Click + cxButton1Click:
// - Cek NomorTerima → sudah ada penerimaan
// - Cek tutup buku
// ─────────────────────────────────────────────────────────
const cekBisaHapusUbah = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT
       h.stbj_nomor,
       DATE_FORMAT(h.stbj_tanggal, '%Y-%m-%d') AS stbj_tanggal,
       h.stbj_gdg_kode,
       h.user_create,
       IFNULL(ts.ts_nomor, '') AS NomorTerima
     FROM tstbj_hdr h
     LEFT JOIN retail.tdc_stbj_hdr ts ON ts.ts_stbj = h.stbj_nomor
     WHERE h.stbj_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");

  if (hdr.NomorTerima !== "") {
    throw new Error(
      "STBJ ini sudah ada penerimaan, tidak bisa diubah/dihapus.",
    );
  }

  // Cek tutup buku
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  const zClose = await tutupBukuService.getManualTutupBuku("STBJ");
  const tglTrx = new Date(hdr.stbj_tanggal);
  const isClose = zClose ? tglTrx < zClose : tglTrx < zdtClose;

  if (isClose) {
    throw new Error("Transaksi tsb sudah close. Tidak bisa diubah/dihapus.");
  }

  return hdr;
};

// ─────────────────────────────────────────────────────────
// DELETE
// Sesuai Delphi cxButton4Click:
// - Semua validasi via cekBisaHapusUbah
// - Jika gudang WH003 → update retail.tpacking
// ─────────────────────────────────────────────────────────
const deleteData = async (nomor, userKode, userCab) => {
  const hdr = await cekBisaHapusUbah(nomor);

  // Cek ownership jika bukan HO
  if (userCab && !userCab.startsWith("HO")) {
    if (hdr.user_create !== userKode) {
      throw new Error(
        `Data ini milik ${hdr.user_create}. Anda tidak boleh menghapus.`,
      );
    }
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Hapus header (detail terhapus via CASCADE atau hapus manual)
    await conn.query(`DELETE FROM tstbj_hdr WHERE stbj_nomor = ?`, [nomor]);

    // Jika gudang WH003 → null-kan pack_nostbj di retail
    if (hdr.stbj_gdg_kode === "WH003") {
      await conn.query(
        `UPDATE retail.tpacking SET pack_nostbj = NULL
         WHERE pack_nostbj = ?`,
        [nomor],
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────
// PENGAJUAN UBAH (PIN5)
// Sesuai Delphi btnAjukkanClick + PengajuanPerubahanData1Click
// pin_trs = "STBJ"
// ─────────────────────────────────────────────────────────
const pengajuanUbah = async (nomor, alasan, userKode) => {
  // Ambil data untuk pin_tgl_trs dan pin_ket
  const [[hdr]] = await db.query(
    `SELECT stbj_tanggal, stbj_keterangan FROM tstbj_hdr WHERE stbj_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");

  // Cek tutup buku dulu
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  const zClose = await tutupBukuService.getManualTutupBuku("STBJ");
  const tglTrx = new Date(hdr.stbj_tanggal);
  const isClose = zClose ? tglTrx < zClose : tglTrx < zdtClose;
  if (!isClose) {
    throw new Error("Tidak perlu pengajuan perubahan data.");
  }

  if (!alasan?.trim()) throw new Error("Alasan harus diisi.");

  // Cek urut terakhir
  const [[lastPin]] = await db.query(
    `SELECT pin_urut, pin_dipakai FROM tspk_pin5
     WHERE pin_trs = 'STBJ' AND pin_nomor = ?
     ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );

  let urut = 1;
  if (lastPin) {
    urut =
      lastPin.pin_dipakai === ""
        ? lastPin.pin_urut // update existing
        : lastPin.pin_urut + 1; // buat baru
  }

  await db.query(
    `INSERT INTO tspk_pin5
       (pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket,
        pin_tgl_minta, pin_user_minta, pin_alasan)
     VALUES ('STBJ', ?, ?, ?, ?, NOW(), ?, ?)
     ON DUPLICATE KEY UPDATE
       pin_tgl_trs    = VALUES(pin_tgl_trs),
       pin_ket        = VALUES(pin_ket),
       pin_acc        = '',
       pin_tgl_minta  = NOW(),
       pin_user_minta = VALUES(pin_user_minta),
       pin_alasan     = VALUES(pin_alasan)`,
    [nomor, urut, hdr.stbj_tanggal, hdr.stbj_keterangan, userKode, alasan],
  );

  return { urut };
};

// ─────────────────────────────────────────────────────────
// GET EXPORT DATA (untuk tombol Export)
// ─────────────────────────────────────────────────────────
const getExportData = async (tglAwal, tglAkhir, gudang = "") => {
  return getBrowse(tglAwal, tglAkhir, gudang);
};

const getExportDetail = async (tglAwal, tglAkhir, gudang = "") => {
  return getBrowseDetail(tglAwal, tglAkhir, gudang);
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  getDetailByNomor,
  cekBisaHapusUbah,
  deleteData,
  pengajuanUbah,
  getExportData,
  getExportDetail,
};
