const db = require("../../config/database");
const {
  getTanggalTutupBuku,
  getManualTutupBuku,
  getTanggalTutupBukuUntukTanggal,
} = require("../tutupBukuService");

const MODUL_NAMA = "KOREKSI BAHAN"; // pin_trs, dan cid utk getManualTutupBuku

// ─────────────────────────────────────────────────────────
// BROWSE — list header + status approval (Ngedit)
// ─────────────────────────────────────────────────────────
const getBrowseList = async (query) => {
  const today = new Date();
  const defaultStart = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .substring(0, 10);
  const defaultEnd = today.toISOString().substring(0, 10);

  const startDate = query.startDate || defaultStart;
  const endDate = query.endDate || defaultEnd;

  // ✅ Replikasi persis filter g.gdg_bahan=4 dari Delphi — modul ini
  // cuma nampilin koreksi stok utk gudang tipe "bahan baku".
  const sql = `
    SELECT
      h.KOR_NOMOR AS nomor,
      h.KOR_TANGGAL AS tanggal,
      h.KOR_GDG_KODE AS kode,
      g.gdg_nama AS nama,
      h.KOR_ket AS keterangan,
      h.user_create AS usr,
      IFNULL((
        SELECT
          IFNULL(IF(pin_acc="" AND pin_dipakai="","WAIT",
            IF(pin_acc="Y" AND pin_dipakai="","ACC",
            IF(pin_acc="Y" AND pin_dipakai="Y","",
            IF(pin_acc="N","TOLAK","")))),"")
        FROM tspk_pin5
        WHERE pin_trs = ? AND pin_nomor = h.KOR_NOMOR
        ORDER BY pin_urut DESC LIMIT 1
      ), "") AS ngedit
    FROM tkor_hdr h
    LEFT JOIN tgudang g ON g.gdg_kode = h.KOR_GDG_KODE
    WHERE g.gdg_bahan = 4
      AND h.KOR_TANGGAL >= ?
      AND h.KOR_TANGGAL <= ?
    ORDER BY h.KOR_NOMOR DESC
  `;
  const [rows] = await db.query(sql, [MODUL_NAMA, startDate, endDate]);
  return rows;
};

// ─────────────────────────────────────────────────────────
// DETAIL — dipanggil on-demand saat row di-expand
// ─────────────────────────────────────────────────────────
const getDetailByNomor = async (nomor) => {
  const sql = `
    SELECT
      d.KORD_KOR_NOMOR AS nomor,
      d.KORD_BRG_KODE AS kode,
      s.Bhn_Name AS nama,
      s.bhn_SATUAN AS satuan,
      d.KORD_STOK AS stok,
      d.kord_QTY AS jumlah,
      d.kord_selisih AS selisih
    FROM tkor_dtl d
    LEFT JOIN tbahan s ON s.Bhn_kode = d.KORD_BRG_KODE
    WHERE d.KORD_KOR_NOMOR = ?
    ORDER BY d.KORD_BRG_KODE
  `;
  const [rows] = await db.query(sql, [nomor]);
  return rows;
};

// ─────────────────────────────────────────────────────────
// DELETE — replikasi cxButton4Click
// ⚠️ Cuma dicek closing OTOMATIS (ztglclose), TIDAK ada opsi
// pengajuan/override manual buat delete — beda dari edit.
// ⚠️ Cuma hapus tkor_hdr, tkor_dtl dibiarkan (ada trigger DB).
// ─────────────────────────────────────────────────────────
const deleteKoreksi = async (nomor) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[header]] = await conn.query(
      `SELECT KOR_NOMOR AS nomor, KOR_TANGGAL AS tanggal
       FROM tkor_hdr WHERE KOR_NOMOR = ? FOR UPDATE`,
      [nomor],
    );
    if (!header) throw new Error("Data tidak ditemukan.");

    const boundary = await getTanggalTutupBukuUntukTanggal(header.tanggal);
    const now = new Date();
    if (now > boundary) {
      throw new Error("Transaksi tsb sudah close. Tidak bisa dihapus.");
    }

    await conn.query(`DELETE FROM tkor_hdr WHERE KOR_NOMOR = ?`, [nomor]);

    await conn.commit();
    return { nomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────
// REQUEST PIN (Pengajuan Perubahan Data) — replikasi gabungan
// PengajuanPerubahanData1Click + btnAjukkanClick Delphi.
// Backend yang mutusin perlu/gak perlu pengajuan (bukan endpoint
// cek terpisah), biar sesuai pola BpbBahanService yang udah jalan.
// ⚠️ pin_jenis="UBAH" ditambahkan (gak ada di source Delphi asli)
// biar konsisten sama halaman Approval Perubahan Data (MENU_ID 259).
// ─────────────────────────────────────────────────────────
const requestPin = async (nomor, alasan, userKode) => {
  if (!alasan || !alasan.trim()) {
    throw new Error("Alasan pengajuan wajib diisi.");
  }

  const [[header]] = await db.query(
    `SELECT KOR_NOMOR AS nomor, KOR_TANGGAL AS tanggal, KOR_ket AS keterangan
     FROM tkor_hdr WHERE KOR_NOMOR = ?`,
    [nomor],
  );
  if (!header) throw new Error("Data tidak ditemukan.");

  // ── Cek perlu pengajuan atau tidak (auto + manual close) ──
  const manualClose = await getManualTutupBuku(MODUL_NAMA);
  const tanggalTrx = new Date(header.tanggal);

  let perluPengajuan;
  if (manualClose === null) {
    const autoBoundary = await getTanggalTutupBukuUntukTanggal(header.tanggal);
    perluPengajuan = new Date() > autoBoundary;
  } else {
    perluPengajuan = tanggalTrx < manualClose;
  }

  if (!perluPengajuan) {
    throw new Error("Tidak perlu pengajuan perubahan data.");
  }

  // ── Tentuin pin_urut (reuse kalau ada pengajuan lama yg masih
  // nunggu/gak dipakai, atau incremental kalau udah dipakai) ──
  const [existing] = await db.query(
    `SELECT pin_urut, pin_dipakai
     FROM tspk_pin5
     WHERE pin_trs = ? AND pin_nomor = ? AND pin_jenis = "UBAH"
     ORDER BY pin_urut DESC LIMIT 1`,
    [MODUL_NAMA, nomor],
  );

  let urut = 1;
  if (existing.length > 0) {
    urut =
      existing[0].pin_dipakai === ""
        ? existing[0].pin_urut
        : existing[0].pin_urut + 1;
  }

  const sql = `
    INSERT INTO tspk_pin5
      (pin_trs, pin_nomor, pin_urut, pin_jenis, pin_tgl_trs, pin_ket,
       pin_tgl_minta, pin_user_minta, pin_alasan)
    VALUES (?, ?, ?, "UBAH", ?, ?, NOW(), ?, ?)
    ON DUPLICATE KEY UPDATE
      pin_tgl_trs = VALUES(pin_tgl_trs),
      pin_ket = VALUES(pin_ket),
      pin_acc = "",
      pin_tgl_minta = NOW(),
      pin_user_minta = VALUES(pin_user_minta),
      pin_alasan = VALUES(pin_alasan)
  `;
  await db.query(sql, [
    MODUL_NAMA,
    nomor,
    urut,
    header.tanggal,
    header.keterangan,
    userKode,
    alasan,
  ]);

  return { nomor, urut };
};

// ─────────────────────────────────────────────────────────
// CETAK — data header + detail utk print view
// ─────────────────────────────────────────────────────────
const getDataCetak = async (nomor) => {
  const [[header]] = await db.query(
    `SELECT h.KOR_NOMOR AS nomor, h.KOR_TANGGAL AS tanggal,
            h.KOR_GDG_KODE AS kode, g.gdg_nama AS nama,
            h.KOR_ket AS keterangan, h.user_create AS usr
     FROM tkor_hdr h
     LEFT JOIN tgudang g ON g.gdg_kode = h.KOR_GDG_KODE
     WHERE h.KOR_NOMOR = ?`,
    [nomor],
  );
  if (!header) throw new Error("Data tidak ditemukan.");

  const detail = await getDetailByNomor(nomor);
  return { header, detail };
};

module.exports = {
  getBrowseList,
  getDetailByNomor,
  deleteKoreksi,
  requestPin,
  getDataCetak,
};
