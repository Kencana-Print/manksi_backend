const db = require("../../config/database");

// Urutan status: PENDING/CANCEL manual > CLOSE (alur lama: pm_date_close; alur
// baru: semua SPK ber-LHK dan semua tanda terima sudah divalidasi pembuat
// permintaan) > DONE (semua SPK punya baris LHK Marker) > PROSES (sudah diambil
// PIC atau sebagian SPK sudah ber-LHK) > OPEN.
const hitungStatus = (row) => {
  if (row.statusManual) return row.statusManual;
  if (row.dateClose) return "CLOSE";
  const semuaSpkSelesai = row.jmlSpk > 0 && row.jmlSpkSelesai >= row.jmlSpk;
  if (semuaSpkSelesai && row.jmlTt > 0 && row.jmlTtTerima >= row.jmlTt) {
    return "CLOSE";
  }
  if (semuaSpkSelesai) return "DONE";
  if (row.pic || row.jmlSpkSelesai > 0) return "PROSES";
  return "OPEN";
};

const SELECT_HEADER = `
  SELECT
    h.pm_nomor AS nomor,
    DATE_FORMAT(h.pm_tanggal, '%Y-%m-%d') AS tanggal,
    DATE_FORMAT(h.pm_deadline, '%Y-%m-%d') AS deadline,
    DATEDIFF(h.pm_deadline, CURDATE()) AS sisaHari,
    h.pm_keterangan AS keterangan,
    h.pm_asal_nomor AS asalNomor,
    h.pm_status_manual AS statusManual,
    h.pm_status_keterangan AS statusKeterangan,
    h.pm_pic AS pic,
    IFNULL(u.user_nama, h.pm_pic) AS picNama,
    h.pm_pic_asal AS picAsal,
    IFNULL(ua.user_nama, h.pm_pic_asal) AS picAsalNama,
    DATE_FORMAT(h.pm_tgl_ambil, '%Y-%m-%d %H:%i') AS tglAmbil,
    DATE_FORMAT(h.pm_tgl_kerja, '%Y-%m-%d %H:%i') AS tglDikerjakan,
    DATE_FORMAT(lk.tglLhk, '%Y-%m-%d %H:%i') AS tglLhk,
    DATE_FORMAT(tt.tglMutasi, '%Y-%m-%d %H:%i') AS tglMutasi,
    DATE_FORMAT(tt.tglTerima, '%Y-%m-%d %H:%i') AS tglTerima,
    IFNULL(tt.jmlTt, 0) AS jmlTt,
    IFNULL(tt.jmlTtTerima, 0) AS jmlTtTerima,
    h.pm_user_close AS userClose,
    DATE_FORMAT(h.pm_date_close, '%Y-%m-%d %H:%i') AS dateClose,
    h.pm_user_create AS userCreate,
    h.pm_date_create AS dateCreate,
    IFNULL(x.jmlBaris, 0) AS jmlBaris,
    IFNULL(x.totalJml, 0) AS totalJml,
    IFNULL(x.jmlSpk, 0) AS jmlSpk,
    x.spkNomor AS spkNomor,
    (SELECT GROUP_CONCAT(DISTINCT IFNULL(s.spk_nama, m.mspk_nama)
                         ORDER BY d.pm2_spk_nomor SEPARATOR ', ')
       FROM tpermintaan_marker_detail d
       LEFT JOIN tspk s ON s.spk_nomor = d.pm2_spk_nomor
       LEFT JOIN tmemospk m ON m.mspk_nomor = d.pm2_spk_nomor
      WHERE d.pm2_pm_nomor = h.pm_nomor) AS spkNama,
    (SELECT COUNT(DISTINCT d.pm2_spk_nomor)
       FROM tpermintaan_marker_detail d
      WHERE d.pm2_pm_nomor = h.pm_nomor
        AND EXISTS (
          SELECT 1 FROM tlhkpola_marker_dtl l
           WHERE l.ldm_pm_nomor = h.pm_nomor
             AND l.ldm_spk_nomor = d.pm2_spk_nomor
        )) AS jmlSpkSelesai
  FROM tpermintaan_marker h
  LEFT JOIN tuser u ON u.user_kode = h.pm_pic
  LEFT JOIN tuser ua ON ua.user_kode = h.pm_pic_asal
  LEFT JOIN (
    SELECT pm2_pm_nomor,
           COUNT(*) AS jmlBaris,
           SUM(pm2_jml) AS totalJml,
           COUNT(DISTINCT pm2_spk_nomor) AS jmlSpk,
           GROUP_CONCAT(DISTINCT pm2_spk_nomor ORDER BY pm2_spk_nomor SEPARATOR ', ') AS spkNomor
      FROM tpermintaan_marker_detail
     GROUP BY pm2_pm_nomor
  ) x ON x.pm2_pm_nomor = h.pm_nomor
  LEFT JOIN (
    SELECT tt_pm_nomor,
           COUNT(*) AS jmlTt,
           COUNT(tt_date_terima) AS jmlTtTerima,
           MAX(tt_date_mutasi) AS tglMutasi,
           MAX(tt_date_terima) AS tglTerima
      FROM tpermintaan_marker_tt
     GROUP BY tt_pm_nomor
  ) tt ON tt.tt_pm_nomor = h.pm_nomor
  LEFT JOIN (
    SELECT l.ldm_pm_nomor AS pm, MAX(hh.date_create) AS tglLhk
      FROM tlhkpola_marker_dtl l
      INNER JOIN tlhkpola_hdr hh ON hh.lhkp_nomor = l.ldm_nomor
     WHERE l.ldm_pm_nomor IS NOT NULL
     GROUP BY l.ldm_pm_nomor
  ) lk ON lk.pm = h.pm_nomor`;

const ambilHeader = async (where, params, orderBy) => {
  const [rows] = await db.query(
    `${SELECT_HEADER} ${where} ORDER BY ${orderBy}`,
    params,
  );
  return rows.map((r) => ({ ...r, status: hitungStatus(r) }));
};

const getBrowse = async ({ startDate, endDate, status }) => {
  const data = await ambilHeader(
    `WHERE h.pm_tanggal BETWEEN ? AND ?`,
    [startDate, endDate],
    `h.pm_tanggal DESC, h.pm_nomor DESC`,
  );
  return status ? data.filter((r) => r.status === status) : data;
};

// Ready = stok kode bahan di tmasterstok_barcode > 0
// (kode bahan = mst_brg_kode tanpa 7 karakter terakhir, sama dengan laporanStokBahanBarcodeService)
const STOK_MIN_READY = 0;
const CHUNK_KODE = 100;
const kunciKode = (k) =>
  String(k || "")
    .trim()
    .toUpperCase();

const getStokBahan = async (executor, kodeList) => {
  const kodes = [
    ...new Set(
      (kodeList || []).map((k) => String(k || "").trim()).filter(Boolean),
    ),
  ];
  const peta = new Map(kodes.map((k) => [kunciKode(k), 0]));
  for (let i = 0; i < kodes.length; i += CHUNK_KODE) {
    const bagian = kodes.slice(i, i + CHUNK_KODE);
    // 7 underscore = tepat 7 karakter barcode di belakang kode bahan
    const pola = bagian.map((k) => `${k.replace(/[\\%_]/g, "\\$&")}_______`);
    const [rows] = await executor.query(
      `SELECT LEFT(mst_brg_kode, LENGTH(mst_brg_kode) - 7) AS kode,
              SUM(mst_stok_in - mst_stok_out) AS stok
         FROM tmasterstok_barcode
        WHERE mst_aktif = 'Y'
          AND mst_tanggal <= CURDATE()
          AND (${pola.map(() => "mst_brg_kode LIKE ?").join(" OR ")})
        GROUP BY LEFT(mst_brg_kode, LENGTH(mst_brg_kode) - 7)`,
      pola,
    );
    for (const r of rows) peta.set(kunciKode(r.kode), Number(r.stok));
  }
  return peta;
};

const statusBahanDari = (jmlBahan, belumReady) => {
  if (jmlBahan === 0 || belumReady.length >= jmlBahan) return "BELUM";
  return belumReady.length === 0 ? "READY" : "SEBAGIAN";
};

// Map pmNomor -> { jmlBahan, belumReady: [{ kode, nama, stok }], statusBahan }
// jmlBahan = jumlah kode bahan berbeda di permintaan itu
const getStatusBahan = async (executor, nomorList) => {
  const hasil = new Map();
  if (!nomorList.length) return hasil;
  const [rows] = await executor.query(
    `SELECT DISTINCT d.pm2_pm_nomor AS pm, d.pm2_bhn_kode AS kode,
            IFNULL(b.Bhn_Name, '') AS nama
       FROM tpermintaan_marker_detail d
       LEFT JOIN tbahan b ON b.Bhn_kode = d.pm2_bhn_kode
      WHERE d.pm2_pm_nomor IN (?)`,
    [nomorList],
  );
  const stok = await getStokBahan(
    executor,
    rows.map((r) => r.kode),
  );
  for (const nomor of nomorList) {
    hasil.set(nomor, { jmlBahan: 0, belumReady: [], statusBahan: "BELUM" });
  }
  for (const r of rows) {
    const h = hasil.get(r.pm);
    h.jmlBahan += 1;
    const s = stok.get(kunciKode(r.kode)) ?? 0;
    if (!(s > STOK_MIN_READY)) {
      h.belumReady.push({ kode: r.kode, nama: r.nama, stok: s });
    }
  }
  for (const h of hasil.values()) {
    h.statusBahan = statusBahanDari(h.jmlBahan, h.belumReady);
  }
  return hasil;
};

// Antrean PIC: siap diambil (belum dipegang), dikerjakan saya, dikerjakan PIC lain
const getAntrean = async (user) => {
  const kode = String(user?.kode || "").trim();
  const rows = await ambilHeader(
    `WHERE h.pm_status_manual = '' AND h.pm_date_close IS NULL
       AND EXISTS (
         SELECT 1 FROM tpermintaan_marker_detail d
          WHERE d.pm2_pm_nomor = h.pm_nomor
            AND NOT EXISTS (
              SELECT 1 FROM tlhkpola_marker_dtl l
               WHERE l.ldm_pm_nomor = h.pm_nomor
                 AND l.ldm_spk_nomor = d.pm2_spk_nomor
            )
       )`,
    [],
    `h.pm_deadline, h.pm_nomor`,
  );
  // Daftar SPK + nama per permintaan (hanya untuk antrean)
  const nomors = rows.map((r) => r.nomor);
  const byPm = new Map();
  if (nomors.length) {
    const [spkRows] = await db.query(
      `SELECT DISTINCT d.pm2_pm_nomor AS pm, d.pm2_spk_nomor AS nomor,
              IFNULL(s.spk_nama, m.mspk_nama) AS nama
         FROM tpermintaan_marker_detail d
         LEFT JOIN tspk s ON s.spk_nomor = d.pm2_spk_nomor
         LEFT JOIN tmemospk m ON m.mspk_nomor = d.pm2_spk_nomor
        WHERE d.pm2_pm_nomor IN (?)
        ORDER BY d.pm2_pm_nomor, d.pm2_spk_nomor`,
      [nomors],
    );
    for (const s of spkRows) {
      const arr = byPm.get(s.pm) || [];
      arr.push({ nomor: s.nomor, nama: s.nama });
      byPm.set(s.pm, arr);
    }
  }
  const statusBahan = await getStatusBahan(db, nomors);

  const siap = [];
  const saya = [];
  const lain = [];
  for (const r of rows) {
    if (r.status !== "OPEN" && r.status !== "PROSES") continue;
    r.spkList = byPm.get(r.nomor) || [];
    const sb = statusBahan.get(r.nomor);
    r.jmlBahan = sb ? sb.jmlBahan : 0;
    r.bahanBelumReady = sb ? sb.belumReady : [];
    r.statusBahan = sb ? sb.statusBahan : "BELUM";
    if (!r.pic) siap.push(r);
    else if (r.pic === kode) saya.push(r);
    else lain.push(r);
  }
  return { siap, saya, lain };
};

// Detail seluruh permintaan dalam rentang tanggal (untuk expand dan Export Detail)
const getDetail = async ({ startDate, endDate }) => {
  const [rows] = await db.query(
    `SELECT d.pm2_pm_nomor AS nomor,
            d.pm2_id AS id,
            d.pm2_spk_nomor AS spkNomor,
            IFNULL(s.spk_nama, m.mspk_nama) AS spkNama,
            d.pm2_bhn_kode AS kode,
            IFNULL(b.Bhn_Name, '') AS namaBahan,
            IFNULL(b.Bhn_satuan, '') AS satuan,
            d.pm2_setting AS setting,
            d.pm2_jml AS jml,
            IFNULL(d.pm2_alasan, '') AS alasan,
            IFNULL((
              SELECT GROUP_CONCAT(DISTINCT l.ldm_nomor ORDER BY l.ldm_nomor SEPARATOR ', ')
                FROM tlhkpola_marker_dtl l
               WHERE l.ldm_pm_nomor = d.pm2_pm_nomor
                 AND l.ldm_spk_nomor = d.pm2_spk_nomor
            ), '') AS lhkNomor
       FROM tpermintaan_marker_detail d
       INNER JOIN tpermintaan_marker h ON h.pm_nomor = d.pm2_pm_nomor
       LEFT JOIN tspk s ON s.spk_nomor = d.pm2_spk_nomor
       LEFT JOIN tmemospk m ON m.mspk_nomor = d.pm2_spk_nomor
       LEFT JOIN tbahan b ON b.Bhn_kode = d.pm2_bhn_kode
      WHERE h.pm_tanggal BETWEEN ? AND ?
      ORDER BY h.pm_tanggal DESC, h.pm_nomor DESC, d.pm2_spk_nomor, d.pm2_id`,
    [startDate, endDate],
  );
  return rows;
};

const deleteData = async (nomor) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[hdr]] = await conn.query(
      `SELECT pm_nomor FROM tpermintaan_marker WHERE pm_nomor = ? FOR UPDATE`,
      [nomor],
    );
    if (!hdr) {
      const err = new Error("Permintaan Marker tidak ditemukan.");
      err.statusCode = 404;
      throw err;
    }

    const [[lhk]] = await conn.query(
      `SELECT COUNT(*) AS jml FROM tlhkpola_marker_dtl WHERE ldm_pm_nomor = ?`,
      [nomor],
    );
    if (lhk.jml > 0) {
      const err = new Error(
        "Permintaan sudah punya LHK Marker, tidak bisa dihapus.",
      );
      err.statusCode = 400;
      throw err;
    }

    const [[pengganti]] = await conn.query(
      `SELECT pm_nomor FROM tpermintaan_marker WHERE pm_asal_nomor = ? LIMIT 1`,
      [nomor],
    );
    if (pengganti) {
      const err = new Error(
        `Permintaan ini menjadi asal revisi ${pengganti.pm_nomor}, tidak bisa dihapus.`,
      );
      err.statusCode = 400;
      throw err;
    }

    await conn.query(
      `DELETE FROM tpermintaan_marker_detail WHERE pm2_pm_nomor = ?`,
      [nomor],
    );
    await conn.query(`DELETE FROM tpermintaan_marker WHERE pm_nomor = ?`, [
      nomor,
    ]);

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// Permintaan buatan user yang tanda terimanya sudah diserahkan (Mutasi terisi)
// tetapi belum divalidasi; tanpa batas tanggal.
const getMenungguValidasi = async (user) => {
  const kode = String(user?.kode || "").trim();
  return ambilHeader(
    `WHERE h.pm_user_create = ?
       AND EXISTS (
         SELECT 1 FROM tpermintaan_marker_tt t
          WHERE t.tt_pm_nomor = h.pm_nomor
            AND t.tt_date_mutasi IS NOT NULL
            AND t.tt_date_terima IS NULL
       )`,
    [kode],
    `h.pm_deadline, h.pm_nomor`,
  );
};

module.exports = {
  hitungStatus,
  getBrowse,
  getAntrean,
  getDetail,
  deleteData,
  getMenungguValidasi,
  getStatusBahan,
};
