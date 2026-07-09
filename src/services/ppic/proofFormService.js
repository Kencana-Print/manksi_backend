const db = require("../../config/database");

// ============================================================
// PROOF GARMEN — FORM SERVICE
// Migrasi dari ufrmProofGarmen.pas
// ============================================================

const LINI_OPTIONS = ["POTONG", "CETAK", "SUBLIM", "BORDIR", "JAHIT"];

// Kolom yang toggle visibility per Lini — 8 kolom dasar (Kode, Nama,
// Size, JenisKain, WarnaKain, Jumlah, Waktu) SELALU tampil, tidak
// pernah di-toggle oleh cbLiniChange Delphi, jadi tidak dimasukkan
// ke sini (frontend render selalu).
const LINI_COLUMN_VISIBILITY = {
  POTONG: ["gramasi", "seting", "satuan", "babaran"],
  CETAK: [
    "plangkan",
    "kesutan",
    "jeniscat",
    "dpnbahu",
    "blkleher",
    "lengankiri",
    "lengankanan",
    "dpnsamping",
    "blksamping",
  ],
  SUBLIM: ["jeniskertas", "dtf", "jeniscat", "suhu", "ukuran"],
  BORDIR: ["warnabenang", "jenisbenang", "kodebenang", "sttich"],
  JAHIT: ["stepjahit"],
};

// --- GENERATE NOMOR: PRF/NNNN/YYYY (4 digit, beda dari SJ 5 digit) ---
const generateNomor = async (tahun, conn = db) => {
  const [rows] = await conn.query(
    `SELECT IFNULL(MAX(CAST(SUBSTR(pf_nomor, 5, 4) AS UNSIGNED)), 0) AS jumlah
     FROM tproofgarmen_hdr
     WHERE LEFT(pf_nomor, 3) = 'PRF' AND RIGHT(pf_nomor, 4) = ?
     FOR UPDATE`,
    [String(tahun)],
  );
  const next = rows[0].jumlah + 1;
  return `PRF/${String(next).padStart(4, "0")}/${tahun}`;
};

// ============================================================
// GET DETAIL — mode Ubah (loaddataall)
// ============================================================
const getDetail = async (nomor) => {
  const [hdrRows] = await db.query(
    `SELECT h.pf_nomor, h.pf_tanggal, h.pf_jam, h.pf_cab, h.pf_lini,
            h.pf_spk_nomor, h.pf_petugas,
            x.spk_nama AS NamaSpk, x.spk_jumlah AS JumlahSpk
     FROM tproofgarmen_hdr h
     LEFT JOIN (
       SELECT spk_nomor, spk_nama, spk_jumlah FROM tspk WHERE spk_aktif = 'Y'
       UNION ALL
       SELECT mspk_nomor, mspk_nama, mspk_jumlah FROM tmemospk
       UNION ALL
       SELECT so_nomor, so_nama, so_jumlah FROM tsalesorder WHERE so_aktif = 'Y'
     ) x ON x.spk_nomor = h.pf_spk_nomor
     WHERE h.pf_nomor = ?`,
    [nomor],
  );
  if (hdrRows.length === 0) throw new Error("Nomor tersebut belum ada.");
  const header = hdrRows[0];

  const [dtlRows] = await db.query(
    `SELECT d.pfd_kode AS kode, b.Bhn_Name AS nama, d.pfd_size AS size,
            d.pfd_jenis_kain AS jeniskain, d.pfd_warna_kain AS warnakain,
            d.pfd_gramasi AS gramasi, d.pfd_seting AS seting, d.pfd_satuan AS satuan,
            d.pfd_babaran AS babaran, d.pfd_plangkan AS plangkan, d.pfd_kesutan AS kesutan,
            d.pfd_jeniskertas AS jeniskertas, d.pfd_dtf AS dtf, d.pfd_jeniscat AS jeniscat,
            d.pfd_suhu AS suhu, d.pfd_dpn_bahu AS dpnbahu, d.pfd_blk_leher AS blkleher,
            d.pfd_lengan_kiri AS lengankiri, d.pfd_lengan_kanan AS lengankanan,
            d.pfd_dpn_samping AS dpnsamping, d.pfd_blk_samping AS blksamping,
            d.pfd_sttich AS sttich, d.pfd_warna_benang AS warnabenang,
            d.pfd_jenis_benang AS jenisbenang, d.pfd_kode_benang AS kodebenang,
            d.pfd_ukuran AS ukuran, d.pfd_step_jahit AS stepjahit,
            d.pfd_jumlah AS jumlah, d.pfd_waktu AS waktu
     FROM tproofgarmen_dtl d
     LEFT JOIN tbahan b ON b.Bhn_kode = d.pfd_kode
     WHERE d.pfd_nomor = ?`,
    [nomor],
  );

  return { header, detail: dtlRows };
};

// ============================================================
// VALIDASI SPK/MAP saat blur — sesuai edtNomorSPKExit Delphi.
// TIDAK ada filter divisi (beda dari F1 search), hanya cek
// exist + status CMO approval.
// ============================================================
const getSpkInfoForBlur = async (nomor) => {
  const [rows] = await db.query(
    `SELECT x.nomor, x.nama, x.jml, x.cmo FROM (
       SELECT mspk_nomor AS nomor, mspk_nama AS nama, mspk_jumlah AS jml, mspk_cmo AS cmo
       FROM tmemospk
       UNION ALL
       SELECT spk_nomor, spk_nama, spk_jumlah, spk_cmo FROM tspk WHERE spk_aktif = 'Y'
       UNION ALL
       SELECT so_nomor, so_nama, so_jumlah, so_cmo FROM tsalesorder WHERE so_aktif = 'Y'
     ) x WHERE x.nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) {
    return { found: false };
  }
  const row = rows[0];
  if (!row.cmo) {
    return { found: true, approved: false };
  }
  return { found: true, approved: true, nama: row.nama, jumlah: row.jml };
};

// --- Cek duplikat Lini+SPK — sesuai pengecekan di edtNomorSPKExit & F10 ---
const checkDuplikatLiniSpk = async (lini, spkNomor, excludeNomor = "") => {
  const [rows] = await db.query(
    `SELECT pf_nomor FROM tproofgarmen_hdr WHERE pf_lini = ? AND pf_spk_nomor = ?`,
    [lini, spkNomor],
  );
  if (rows.length > 0 && rows[0].pf_nomor !== excludeNomor) {
    return { duplikat: true, nomorLain: rows[0].pf_nomor };
  }
  return { duplikat: false };
};

// ============================================================
// SEARCH SPK/MAP untuk F1 modal — filter divisi (3,4,6) + cmo<>''
// sesuai FormKeyDown F1 pada edtnomorspk
// ============================================================
const searchSpk = async (q = "") => {
  const like = `%${q}%`;
  const [rows] = await db.query(
    `SELECT x.* FROM (
       SELECT mspk_nomor AS Nomor, mspk_nama AS Nama, mspk_tanggal AS Tanggal,
              mspk_jumlah AS Jumlah, mspk_ukuran AS Ukuran, mspk_kain AS Kain,
              mspk_finishing AS Finishing
       FROM tmemospk
       WHERE mspk_divisi IN (3,4,6) AND mspk_cmo <> ''
       UNION ALL
       SELECT spk_nomor, spk_nama, spk_tanggal, spk_jumlah, spk_ukuran, spk_kain, spk_finishing
       FROM tspk
       WHERE spk_divisi IN (3,4,6) AND spk_aktif = 'Y' AND spk_cmo <> ''
       UNION ALL
       SELECT so_nomor, so_nama, so_tanggal, so_jumlah, so_ukuran, so_kain, so_finishing
       FROM tsalesorder
       WHERE so_divisi IN (3,4,6) AND so_aktif = 'Y' AND so_cmo <> ''
     ) x
     WHERE x.Nomor LIKE ? OR x.Nama LIKE ?
     ORDER BY x.Tanggal DESC
     LIMIT 50`,
    [like, like],
  );
  return rows;
};

// ============================================================
// SEARCH NOMOR PROOF (F1 pada edtNomor) — filter cabang aktif form
// ============================================================
const searchNomorProof = async (cab, q = "") => {
  let sql = `SELECT h.pf_nomor AS Nomor, h.pf_tanggal AS Tanggal, h.pf_cab AS Cab,
                    h.pf_spk_nomor AS MAP, h.pf_petugas AS Petugas
             FROM tproofgarmen_hdr h WHERE h.pf_cab = ?`;
  const params = [cab];
  if (q) {
    sql += ` AND (h.pf_nomor LIKE ? OR h.pf_spk_nomor LIKE ?)`;
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ` ORDER BY h.pf_nomor DESC LIMIT 100`;
  const [rows] = await db.query(sql, params);
  return rows;
};

// ============================================================
// SEARCH/LOAD BAHAN — sesuai loadkode & F1 modal cxGrdMasterEditKeyDown.
// Filter bhn_bordir=1 HANYA jika Lini='BORDIR'; lini lain TIDAK
// filter flag bordir sama sekali (bukan bhn_bordir=0).
// ============================================================
const loadBahanByKode = async (kode, lini) => {
  let sql = `SELECT bhn_kode AS Kode, bhn_name AS Nama
             FROM tbahan WHERE bhn_jb_kode = 'LL' AND bhn_aktif = 0`;
  if (lini === "BORDIR") sql += ` AND bhn_bordir = 1`;
  sql += ` AND bhn_kode LIKE ? LIMIT 1`;
  const [rows] = await db.query(sql, [`%${kode}%`]);
  return rows[0] || null;
};

const searchBahan = async (lini, q = "") => {
  let sql = `SELECT bhn_kode AS Kode, bhn_name AS Nama
             FROM tbahan WHERE bhn_jb_kode = 'LL' AND bhn_aktif = 0`;
  if (lini === "BORDIR") sql += ` AND bhn_bordir = 1`;
  const params = [];
  if (q) {
    sql += ` AND (bhn_kode LIKE ? OR bhn_name LIKE ?)`;
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ` ORDER BY bhn_name LIMIT 100`;
  const [rows] = await db.query(sql, params);
  return rows;
};

// ============================================================
// DROPDOWN OPTIONS — jenis kain, warna kain, gramasi, setting, satuan
// ============================================================
const getDropdownOptions = async () => {
  const [[jenisKain], [warnaKain], [gramasi], [setting], [satuan]] =
    await Promise.all([
      db.query(`SELECT bj_nama AS nama FROM tbahan_jenis ORDER BY bj_nama`),
      db.query(`SELECT bw_nama AS nama FROM tbahan_warna ORDER BY bw_nama`),
      db.query(`SELECT bg_nama AS nama FROM tbahan_gramasi ORDER BY bg_nama`),
      db.query(`SELECT bs_nama AS nama FROM tbahan_setting ORDER BY bs_nama`),
      db.query(
        `SELECT Satuan AS nama FROM tbahan_satuan WHERE Satuan <> 'YARD'`,
      ),
    ]);
  return {
    jenisKain: jenisKain.map((r) => r.nama),
    warnaKain: warnaKain.map((r) => r.nama),
    gramasi: gramasi.map((r) => r.nama),
    setting: setting.map((r) => r.nama),
    satuan: satuan.map((r) => r.nama),
  };
};

// ============================================================
// SAVE DATA — sesuai simpandata Delphi
// ============================================================
const saveData = async (payload, userKode) => {
  const {
    pf_nomor,
    pf_tanggal,
    pf_jam,
    pf_cab,
    pf_lini,
    pf_spk_nomor,
    pf_petugas,
    detail = [],
    isEdit,
  } = payload;

  // --- Validasi dasar sesuai F10 Delphi ---
  if (!pf_spk_nomor) {
    throw new Error("Nama MAP belum di isi.");
  }
  const validDetail = detail.filter((d) => d.nama && d.nama.trim());
  if (validDetail.length === 0) {
    throw new Error("Tidak ada detail, tidak dapat di simpan.");
  }

  // --- Cek duplikat Lini+SPK (redundant safety, sama seperti Delphi) ---
  const dup = await checkDuplikatLiniSpk(
    pf_lini,
    pf_spk_nomor,
    isEdit ? pf_nomor : "",
  );
  if (dup.duplikat) {
    throw new Error(
      `MAP/SPK sudah di input di Lini tsb dgn nomor transaksi: ${dup.nomorLain}`,
    );
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomor;
    if (isEdit) {
      nomor = pf_nomor;
      await conn.query(
        `UPDATE tproofgarmen_hdr SET
           pf_tanggal = ?, pf_jam = ?, pf_cab = ?, pf_lini = ?,
           pf_petugas = ?, pf_spk_nomor = ?,
           date_modified = NOW(), user_modified = ?
         WHERE pf_nomor = ?`,
        [
          pf_tanggal,
          pf_jam,
          pf_cab,
          pf_lini,
          pf_petugas || "",
          pf_spk_nomor,
          userKode,
          nomor,
        ],
      );
    } else {
      const tahun = new Date(pf_tanggal).getFullYear();
      nomor = await generateNomor(tahun, conn);
      await conn.query(
        `INSERT INTO tproofgarmen_hdr
           (pf_nomor, pf_tanggal, pf_jam, pf_cab, pf_lini, pf_spk_nomor,
            pf_petugas, date_create, user_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
        [
          nomor,
          pf_tanggal,
          pf_jam,
          pf_cab,
          pf_lini,
          pf_spk_nomor,
          pf_petugas || "",
          userKode,
        ],
      );
    }

    await conn.query(`DELETE FROM tproofgarmen_dtl WHERE pfd_nomor = ?`, [
      nomor,
    ]);

    for (const d of validDetail) {
      // Defensif: recompute waktu untuk lini BORDIR di server, sesuai
      // clsttichPropertiesEditValueChanged (waktu = sttich/15000, atau
      // 0 kalau sttich=0) — jangan percaya blind nilai dari client.
      let waktu = Number(d.waktu) || 0;
      if (pf_lini === "BORDIR") {
        const sttich = Number(d.sttich) || 0;
        waktu = sttich === 0 ? 0 : sttich / 15000;
      }

      await conn.query(
        `INSERT INTO tproofgarmen_dtl
           (pfd_nomor, pfd_kode, pfd_size, pfd_jenis_kain, pfd_warna_kain,
            pfd_gramasi, pfd_seting, pfd_satuan, pfd_babaran,
            pfd_plangkan, pfd_kesutan, pfd_jeniskertas, pfd_dtf, pfd_jeniscat,
            pfd_suhu, pfd_dpn_bahu, pfd_blk_leher, pfd_lengan_kiri, pfd_lengan_kanan,
            pfd_dpn_samping, pfd_blk_samping, pfd_sttich, pfd_warna_benang,
            pfd_jenis_benang, pfd_kode_benang, pfd_ukuran, pfd_step_jahit,
            pfd_jumlah, pfd_waktu)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nomor,
          d.kode || "",
          d.size || "",
          d.jeniskain || "",
          d.warnakain || "",
          d.gramasi || "",
          d.seting || "",
          d.satuan || "",
          Number(d.babaran) || 0,
          d.plangkan || "",
          Number(d.kesutan) || 0,
          d.jeniskertas || "",
          d.dtf || "",
          d.jeniscat || "",
          d.suhu || "",
          Number(d.dpnbahu) || 0,
          Number(d.blkleher) || 0,
          Number(d.lengankiri) || 0,
          Number(d.lengankanan) || 0,
          Number(d.dpnsamping) || 0,
          Number(d.blksamping) || 0,
          Number(d.sttich) || 0,
          d.warnabenang || "",
          d.jenisbenang || "",
          d.kodebenang || "",
          d.ukuran || "",
          Number(d.stepjahit) || 0,
          Number(d.jumlah) || 0,
          waktu,
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

module.exports = {
  LINI_OPTIONS,
  LINI_COLUMN_VISIBILITY,
  generateNomor,
  getDetail,
  getSpkInfoForBlur,
  checkDuplikatLiniSpk,
  searchSpk,
  searchNomorProof,
  loadBahanByKode,
  searchBahan,
  getDropdownOptions,
  saveData,
};
