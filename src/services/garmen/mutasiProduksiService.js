const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// ─────────────────────────────────────────────────────────
// HELPER: subquery status PIN5
// Dipakai di browse untuk kolom Ngedit dan hapus
// ─────────────────────────────────────────────────────────
const PIN5_NGEDIT = `
  IFNULL((
    SELECT IFNULL(
      IF(pin_acc='' AND pin_dipakai='', 'WAIT',
      IF(pin_acc='Y' AND pin_dipakai='', 'ACC',
      IF(pin_acc='Y' AND pin_dipakai='Y', '',
      IF(pin_acc='N', 'TOLAK', '')))), '')
    FROM tspk_pin5
    WHERE pin_trs = 'MUTASI PRODUKSI'
      AND pin_nomor = a.mph_nomor
    ORDER BY pin_urut DESC
    LIMIT 1
  ), '') AS Ngedit
`;

const PIN5_HAPUS = `
  IFNULL((
    SELECT 'Y'
    FROM tspk_pin5
    WHERE pin_acc = ''
      AND pin_trs = 'MUTASI PRODUKSI HAPUS'
      AND pin_nomor = a.mph_nomor
    ORDER BY pin_urut DESC
    LIMIT 1
  ), '') AS hapus
`;

// ─────────────────────────────────────────────────────────
// STATUS APPROVAL "MUTASI PRODUKSI TANPA PLANNING PPIC" (MENU_ID 266)
// pin_urut selalu 1 (satu approval record per nomor mutasi)
// ─────────────────────────────────────────────────────────
const PIN5_NOPLAN = `
  IFNULL((
    SELECT IF(pin_acc = 'Y', 'ACC', IF(pin_acc = 'N', 'TOLAK', 'MINTA'))
    FROM tspk_pin5
    WHERE pin_trs = 'MUTASI PRODUKSI NOPLAN'
      AND pin_nomor = a.mph_nomor
      AND pin_urut = 1
    LIMIT 1
  ), '') AS NoPlanStatus
`;

// ─────────────────────────────────────────────────────────
// GET BROWSE (MASTER)
// Sesuai Delphi btnRefreshClick SQLMaster
//
// Filter:
//   - tanggal antara tglAwal s.d. tglAkhir
//   - cabang (optional, 'ALL' = semua)
//   - lini / gudang asal (LIKE kode%)
//
// Kolom BabaranActual & SelisihBabaran dihitung di DB
// sesuai logika Delphi (kondisi mph_sat_berat)
// ─────────────────────────────────────────────────────────
const getBrowse = async ({ tglAwal, tglAkhir, cab = "ALL", lini = "" }) => {
  let query = `
    SELECT
      a.mph_nomor                                          AS Nomor,
      a.mph_nomor_opr                                     AS NoLHKProduksi,
      a.mph_cab                                           AS Cab,
      DATE_FORMAT(a.mph_tanggal, '%Y-%m-%d')             AS Tanggal,
      -- Strip 6 karakter prefix dari nama gudang (sesuai Delphi right(nama, length-6))
      SUBSTRING(b.gdgp_nama, 7)                          AS Asal,
      SUBSTRING(c.gdgp_nama, 7)                          AS Tujuan,
      a.mph_keterangan                                    AS Keterangan,
      a.mph_spk_nomor                                     AS Spk,
      DATE_FORMAT(x.TglSPK, '%Y-%m-%d')                 AS TglSPK,
      x.NamaSPK,
      a.mph_jumlah                                        AS Jumlah,
      x.JmlSPK,
      x.Jadi,
      x.Kirim,
      -- Status: Selesai jika Jadi atau Kirim = JmlSPK, else Proses
      IF(x.Jadi = x.JmlSPK, 'Selesai',
        IF(x.Kirim = x.JmlSPK, 'Selesai', 'Proses'))    AS stat,
      a.mph_jumlah                                        AS QtyLhk,
      a.mph_qty_berat                                     AS QtyTerpakai,
      a.mph_sat_berat                                     AS Satuan,
      IFNULL(k.spkb_babaran, 0)                          AS BabaranStandar,
      -- BabaranActual: jika KG → jumlah/qty_berat, else qty_berat/jumlah
      IF(a.mph_sat_berat = 'KG',
        IF(a.mph_qty_berat > 0, a.mph_jumlah / a.mph_qty_berat, 0),
        IF(a.mph_jumlah > 0, a.mph_qty_berat / a.mph_jumlah, 0)
      )                                                   AS BabaranActual,
      -- SelisihBabaran: jika KG → actual - standar, else standar - actual
      IF(a.mph_sat_berat = 'KG',
        IF(a.mph_qty_berat > 0, a.mph_jumlah / a.mph_qty_berat, 0) - IFNULL(k.spkb_babaran, 0),
        IFNULL(k.spkb_babaran, 0) - IF(a.mph_jumlah > 0, a.mph_qty_berat / a.mph_jumlah, 0)
      )                                                   AS SelisihBabaran,
      a.mph_apv                                          AS Approval,
      a.mph_alasan                                       AS Alasan,
      ${PIN5_NGEDIT},
      ${PIN5_HAPUS},
      ${PIN5_NOPLAN},
      a.user_create                                      AS Usr,
      DATE_FORMAT(a.date_create, '%Y-%m-%d %H:%i:%s')   AS created
    FROM tmutasiproduksi_hdr a
    INNER JOIN tgudangproduksi b ON b.gdgp_kode = a.mph_gdgasal
    INNER JOIN tgudangproduksi c ON c.gdgp_kode = a.mph_gdgtujuan
    LEFT JOIN (
      SELECT
        s.spk_nomor           AS spk,
        s.spk_tanggal         AS TglSPK,
        s.spk_nama            AS NamaSPK,
        s.spk_jumlah          AS JmlSPK,
        s.spk_jumlah_jadi     AS Jadi,
        s.spk_jumlah_kirim    AS Kirim
      FROM tspk s
      UNION ALL
      SELECT
        i.spgi_spk            AS spk,
        j.spg_tanggal         AS TglSPK,
        i.spgi_nama           AS NamaSPK,
        0                     AS JmlSPK,
        0                     AS Jadi,
        0                     AS Kirim
      FROM tspk_gudangitem i
      INNER JOIN tspk_gudang j ON j.spg_nomor = i.spgi_nomor
    ) x ON x.spk = a.mph_spk_nomor
    LEFT JOIN tspk_babaran k
      ON k.spkb_nomor = a.mph_spk_nomor
      AND k.spkb_komponen = a.mph_komponen
    WHERE a.mph_tanggal BETWEEN ? AND ?
      AND a.mph_gdgasal LIKE ?
  `;

  const params = [tglAwal, tglAkhir, `${lini}%`];

  if (cab && cab !== "ALL") {
    query += ` AND a.mph_cab = ?`;
    params.push(cab);
  }

  query += ` ORDER BY a.date_create`;

  const [rows] = await db.query(query, params);
  return rows;
};

// ─────────────────────────────────────────────────────────
// GET DETAIL (per nomor — untuk expand row)
// Sesuai Delphi SQLDetail
// ─────────────────────────────────────────────────────────
const getDetail = async (nomor) => {
  const nomors = Array.isArray(nomor) ? nomor : [nomor];
  const placeholders = nomors.map(() => "?").join(",");

  const query = `
    SELECT
      d.mpd_mph_nomor   AS Nomor,
      d.mpd_bhn_kode    AS Kode,
      d.mpd_nama        AS Nama,
      d.mpd_satuan      AS Satuan,
      d.mpd_size        AS Size,
      d.mpd_lhk         AS Lhk,
      d.mpd_jumlah      AS Jumlah,
      d.mpd_jumlah_bs   AS BS_Sablon,
      d.mpd_jumlah_sablon AS BS_Kain_Sablon,
      d.mpd_jumlah_kain AS BS_Kain,
      d.mpd_gantibs     AS GantiBs,
      d.mpd_panjang     AS Panjang,
      d.mpd_lebar       AS Lebar
    FROM tmutasiproduksi_dtl d
    INNER JOIN tmutasiproduksi_hdr h ON h.mph_nomor = d.mpd_mph_nomor
    WHERE d.mpd_mph_nomor IN (${placeholders})
    ORDER BY h.mph_nomor, d.mpd_bhn_kode
  `;
  const [rows] = await db.query(query, nomors);
  return rows;
};

// ─────────────────────────────────────────────────────────
// GET DETAIL BY FILTER (untuk export detail)
// ─────────────────────────────────────────────────────────
const getDetailByFilter = async ({
  tglAwal,
  tglAkhir,
  cab = "ALL",
  lini = "",
}) => {
  let query = `
    SELECT
      d.mpd_mph_nomor   AS Nomor,
      d.mpd_bhn_kode    AS Kode,
      d.mpd_nama        AS Nama,
      d.mpd_satuan      AS Satuan,
      d.mpd_size        AS Size,
      d.mpd_lhk         AS Lhk,
      d.mpd_jumlah      AS Jumlah,
      d.mpd_jumlah_bs   AS BS_Sablon,
      d.mpd_jumlah_sablon AS BS_Kain_Sablon,
      d.mpd_jumlah_kain AS BS_Kain,
      d.mpd_gantibs     AS GantiBs,
      d.mpd_panjang     AS Panjang,
      d.mpd_lebar       AS Lebar
    FROM tmutasiproduksi_dtl d
    INNER JOIN tmutasiproduksi_hdr h ON h.mph_nomor = d.mpd_mph_nomor
    WHERE h.mph_tanggal BETWEEN ? AND ?
      AND h.mph_gdgasal LIKE ?
  `;

  const params = [tglAwal, tglAkhir, `${lini}%`];

  if (cab && cab !== "ALL") {
    query += ` AND h.mph_cab = ?`;
    params.push(cab);
  }

  query += ` ORDER BY h.mph_nomor`;
  const [rows] = await db.query(query, params);
  return rows;
};

// ─────────────────────────────────────────────────────────
// GET LOOKUP GUDANG PRODUKSI (untuk filter lini)
// Sesuai Delphi edtGudangKeyDown: gdgp_aktif=0, bukan Mitra
// Filter per CAB jika P01 atau P04
// ─────────────────────────────────────────────────────────
const getListGudangProduksi = async (cab = "") => {
  let query = `
    SELECT gdgp_kode AS Kode, gdgp_nama AS Nama
    FROM tgudangproduksi
    WHERE gdgp_aktif = 0
      AND gdgp_nama NOT LIKE '%Mitra%'
  `;
  const params = [];

  if (cab === "P01" || cab === "P04") {
    query += ` AND gdgp_cab = ?`;
    params.push(cab);
  }

  query += ` ORDER BY gdgp_nama`;
  const [rows] = await db.query(query, params);
  return rows;
};

// ─────────────────────────────────────────────────────────
// GET LIST CABANG (untuk dropdown filter)
// ─────────────────────────────────────────────────────────
const getListCabang = async () => {
  const [rows] = await db.query(
    `SELECT DISTINCT mph_cab AS cab
     FROM tmutasiproduksi_hdr
     WHERE mph_cab <> ''
     ORDER BY mph_cab`,
  );
  return rows.map((r) => r.cab);
};

// ─────────────────────────────────────────────────────────
// DELETE
// Validasi Delphi cxButton4Click:
//   1. Cek kepemilikan cabang
//   2. Cek date_create = hari ini → bisa hapus langsung
//      Kalau bukan hari ini → wajib Pengajuan Hapus (error)
//   3. Hapus hanya header (detail cascade atau trigger DB)
// ─────────────────────────────────────────────────────────
const deleteData = async (nomor, userKode, userCab) => {
  // Ambil data
  const [[row]] = await db.query(
    `SELECT mph_nomor, mph_cab, DATE(date_create) AS tgl_create
     FROM tmutasiproduksi_hdr
     WHERE mph_nomor = ?`,
    [nomor],
  );

  if (!row) throw new Error("Data tidak ditemukan.");

  // Validasi kepemilikan cabang (jika user punya cab spesifik)
  if (userCab && userCab !== "ALL" && row.mph_cab !== userCab) {
    throw new Error(`Data tsb bukan cabang anda.`);
  }

  // Cek date_create = hari ini (CURDATE() di server)
  const [[dateRow]] = await db.query(
    `SELECT IF(DATE(date_create) = CURDATE(), 'Y', 'N') AS sama
     FROM tmutasiproduksi_hdr
     WHERE mph_nomor = ?`,
    [nomor],
  );

  if (dateRow.sama !== "Y") {
    throw new Error(
      "Perlu Pengajuan Hapus Data. Data ini sudah melewati tanggal input.",
    );
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    // Hapus detail dulu (antisipasi tidak ada FK cascade)
    await conn.query(
      `DELETE FROM tmutasiproduksi_dtl WHERE mpd_mph_nomor = ?`,
      [nomor],
    );
    await conn.query(`DELETE FROM tmutasiproduksi_hdr WHERE mph_nomor = ?`, [
      nomor,
    ]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────
// PENGAJUAN UBAH DATA (PIN5)
// Sesuai Delphi btnAjukkanClick + PengajuanPerubahanData1Click
// pin_trs = "MUTASI PRODUKSI"
// ─────────────────────────────────────────────────────────
const pengajuanUbah = async (nomor, userKode, alasan, urut) => {
  // Ambil info header untuk pin_tgl_trs dan pin_ket
  const [[hdr]] = await db.query(
    `SELECT mph_tanggal, mph_keterangan FROM tmutasiproduksi_hdr WHERE mph_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");

  await db.query(
    `INSERT INTO tspk_pin5
       (pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket,
        pin_tgl_minta, pin_user_minta, pin_alasan)
     VALUES ('MUTASI PRODUKSI', ?, ?, ?, ?, NOW(), ?, ?)
     ON DUPLICATE KEY UPDATE
       pin_tgl_trs = VALUES(pin_tgl_trs),
       pin_ket = VALUES(pin_ket),
       pin_acc = '',
       pin_tgl_minta = NOW(),
       pin_user_minta = VALUES(pin_user_minta),
       pin_alasan = VALUES(pin_alasan)`,
    [nomor, urut, hdr.mph_tanggal, hdr.mph_keterangan, userKode, alasan],
  );
};

// ─────────────────────────────────────────────────────────
// PENGAJUAN HAPUS DATA (PIN5)
// Sesuai Delphi PengajuanPenghapusanData1Click
// pin_trs = "HAPUS MUTASI PRODUKSI", pin_jenis = "HAPUS"
// ─────────────────────────────────────────────────────────
const pengajuanHapus = async (nomor, userKode, alasan, urut) => {
  const [[hdr]] = await db.query(
    `SELECT mph_tanggal, mph_keterangan FROM tmutasiproduksi_hdr WHERE mph_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");

  await db.query(
    `INSERT INTO tspk_pin5
       (pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_jenis,
        pin_tgl_minta, pin_user_minta, pin_alasan)
     VALUES ('HAPUS MUTASI PRODUKSI', ?, ?, ?, ?, 'HAPUS', NOW(), ?, ?)
     ON DUPLICATE KEY UPDATE
       pin_tgl_trs = VALUES(pin_tgl_trs),
       pin_ket = VALUES(pin_ket),
       pin_acc = '',
       pin_tgl_minta = NOW(),
       pin_user_minta = VALUES(pin_user_minta),
       pin_alasan = VALUES(pin_alasan)`,
    [nomor, urut, hdr.mph_tanggal, hdr.mph_keterangan, userKode, alasan],
  );
};

// ─────────────────────────────────────────────────────────
// GET PIN5 STATUS (untuk cek urut sebelum pengajuan)
// Return: urut berikutnya, alasan terakhir
// Sesuai Delphi PengajuanPerubahanData1Click & PengajuanPenghapusanData1Click
// ─────────────────────────────────────────────────────────
const getPin5Status = async (nomor, jenis = "MUTASI PRODUKSI") => {
  const [rows] = await db.query(
    `SELECT pin_urut, pin_dipakai, pin_alasan
     FROM tspk_pin5
     WHERE pin_trs = ? AND pin_nomor = ?
     ORDER BY pin_urut DESC
     LIMIT 1`,
    [jenis, nomor],
  );

  if (rows.length === 0) {
    return { urut: 1, alasan: "" };
  }

  const last = rows[0];
  if (last.pin_dipakai === "") {
    // Masih aktif — pakai urut yang sama, isi alasan terakhir
    return { urut: last.pin_urut, alasan: last.pin_alasan };
  } else {
    // Sudah dipakai — increment urut
    return { urut: last.pin_urut + 1, alasan: "" };
  }
};

// ─────────────────────────────────────────────────────────
// CEK APAKAH TRANSAKSI PERLU PENGAJUAN
// Sesuai Delphi PengajuanPerubahanData1Click:
//   - Ambil zclose dari getDateClose('MUTASI PRODUKSI')
//   - Jika tanggal transaksi < tutup buku → perlu pengajuan
//   - Jika tidak → tidak perlu pengajuan (edit biasa)
// ─────────────────────────────────────────────────────────
const cekPerluPengajuan = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT mph_tanggal FROM tmutasiproduksi_hdr WHERE mph_nomor = ?`,
    [nomor],
  );
  if (!row) throw new Error("Data tidak ditemukan.");

  const tglTransaksi = new Date(row.mph_tanggal);

  // Cek tutup buku manual untuk modul ini
  const zClose = await tutupBukuService.getManualTutupBuku("MUTASI PRODUKSI");

  if (zClose) {
    // Ada tutup buku manual → perlu pengajuan jika tanggal transaksi < zclose
    return tglTransaksi < zClose;
  } else {
    // Tidak ada tutup buku manual → gunakan tutup buku otomatis
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Perlu pengajuan jika tanggal transaksi sudah melewati periode
    // (bulan transaksi < bulan tutup buku)
    return tglTransaksi < zdtClose;
  }
};

module.exports = {
  getBrowse,
  getDetail,
  getDetailByFilter,
  getListGudangProduksi,
  getListCabang,
  deleteData,
  pengajuanUbah,
  pengajuanHapus,
  getPin5Status,
  cekPerluPengajuan,
};
