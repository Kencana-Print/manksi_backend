const db = require("../../config/database");

// ─────────────────────────────────────────────────────────
// MASTER — replikasi persis query btnRefreshClick
// ⚠️ Filter SPK & Komponen pakai EXACT MATCH (bukan LIKE) — sesuai
// source (`poi_spk_nomor=quot(...)`, `poid_bhn_kode=quot(...)`),
// meski di sisi input field-nya sendiri user "nyari" pakai
// LIKE/F1 modal buat resolve ke kode exact dulu sebelum filter jalan.
// ─────────────────────────────────────────────────────────
const getBrowseList = async (query, userCabang) => {
  const today = new Date();
  const defaultStart = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .substring(0, 10);
  const defaultEnd = today.toISOString().substring(0, 10);

  const startDate = query.startDate || defaultStart;
  const endDate = query.endDate || defaultEnd;
  const cabang = query.cabang || "ALL";
  const spkNomor = query.spkNomor || "";
  const komponenKode = query.komponenKode || "";

  const params = [startDate, endDate];
  let extraFilter = "";

  if (cabang && cabang !== "ALL") {
    extraFilter += ` AND h.poi_cab = ?`;
    params.push(cabang);
  }
  if (spkNomor) {
    extraFilter += ` AND h.poi_spk_nomor = ?`;
    params.push(spkNomor);
  }
  if (komponenKode) {
    extraFilter += ` AND d.poid_bhn_kode = ?`;
    params.push(komponenKode);
  }

  const sql = `
    SELECT
      x.Nomor,
      DATE_FORMAT(x.Tanggal, '%Y-%m-%d') AS Tanggal,
      DATE_FORMAT(x.Dateline, '%Y-%m-%d') AS Dateline,
      x.SPK,
      x.NamaSPK,
      x.Jasa,
      x.Cab,
      x.Tujuan,
      x.Keterangan,
      x.Jumlah,
      x.SJ,
      x.BS,
      (x.Jumlah - (x.SJ + x.BS)) AS Selisih,
      x.Closed
    FROM (
      SELECT
        h.poi_nomor AS Nomor,
        h.poi_tanggal AS Tanggal,
        h.poi_dateline AS Dateline,
        h.poi_spk_nomor AS SPK,
        IFNULL(so.so_nama, IFNULL(s.spk_nama, m.Mspk_nama)) AS NamaSPK,
        j.jasa_nama AS Jasa,
        h.poi_cab AS Cab,
        h.poi_sup AS Tujuan,
        h.poi_ket AS Keterangan,
        SUM(d.poid_jumlah) AS Jumlah,
        IFNULL((
          SELECT SUM(i.poisjd_jumlah)
          FROM tpointernalsj_hdr a
          INNER JOIN tpointernalsj_dtl i ON i.poisjd_nomor = a.poisj_nomor
          WHERE a.poisj_nomorpo = h.poi_nomor
        ), 0) AS SJ,
        IFNULL((
          SELECT SUM(i.poisjd_bs + i.poisjd_sablon + i.poisjd_kain)
          FROM tpointernalsj_hdr a
          INNER JOIN tpointernalsj_dtl i ON i.poisjd_nomor = a.poisj_nomor
          WHERE a.poisj_nomorpo = h.poi_nomor
        ), 0) AS BS,
        h.poi_close AS Closed
     FROM tpointernal_hdr h
      INNER JOIN tpointernal_dtl d ON d.poid_nomor = h.poi_nomor
      LEFT JOIN tsalesorder so ON so.so_nomor = h.poi_spk_nomor
      LEFT JOIN tspk s ON s.spk_nomor = h.poi_spk_nomor
      LEFT JOIN tmemospk m ON m.mspk_nomor = h.poi_spk_nomor
      LEFT JOIN tjasa j ON j.jasa_kode = h.poi_jasa_kode
      WHERE h.poi_tanggal >= ? AND h.poi_tanggal <= ?
        ${extraFilter}
      GROUP BY h.poi_nomor
    ) x
    ORDER BY x.Nomor
  `;

  const [rows] = await db.query(sql, params);
  return rows;
};

// ─────────────────────────────────────────────────────────
// DETAIL — dipanggil on-demand saat row di-expand
// ✅ FIX dibanding Delphi: fetch langsung by nomor PO (bukan preload
//    lintas-tanggal via master-detail grid binding) — sidestep kelas
//    bug yang sama kayak modul laporan/browse lain sebelumnya.
// ─────────────────────────────────────────────────────────
const getDetailByNomor = async (nomor) => {
  const sql = `
    SELECT
      x.Nomor,
      x.Kode,
      x.Komponen,
      x.Satuan,
      x.Size,
      x.Jumlah,
      x.SJ,
      x.BS,
      (x.Jumlah - (x.SJ + x.BS)) AS Selisih
    FROM (
      SELECT
        d.poid_nomor AS Nomor,
        d.poid_bhn_kode AS Kode,
        b.Bhn_Name AS Komponen,
        b.Bhn_satuan AS Satuan,
        d.poid_size AS Size,
        d.poid_jumlah AS Jumlah,
        IFNULL((
          SELECT SUM(i.poisjd_jumlah)
          FROM tpointernalsj_hdr a
          INNER JOIN tpointernalsj_dtl i ON i.poisjd_nomor = a.poisj_nomor
          WHERE a.poisj_nomorpo = h.poi_nomor
            AND i.poisjd_bhn_kode = d.poid_bhn_kode
            AND i.poisjd_size = d.poid_size
        ), 0) AS SJ,
        IFNULL((
          SELECT SUM(i.poisjd_bs + i.poisjd_sablon + i.poisjd_kain)
          FROM tpointernalsj_hdr a
          INNER JOIN tpointernalsj_dtl i ON i.poisjd_nomor = a.poisj_nomor
          WHERE a.poisj_nomorpo = h.poi_nomor
            AND i.poisjd_bhn_kode = d.poid_bhn_kode
            AND i.poisjd_size = d.poid_size
        ), 0) AS BS
      FROM tpointernal_dtl d
      LEFT JOIN tpointernal_hdr h ON h.poi_nomor = d.poid_nomor
      LEFT JOIN tbahan b ON b.Bhn_kode = d.poid_bhn_kode
      WHERE d.poid_nomor = ?
    ) x
    ORDER BY x.Kode
  `;
  const [rows] = await db.query(sql, [nomor]);
  return rows;
};

// ─────────────────────────────────────────────────────────
// Helper — ambil status PO buat validasi Ubah/Hapus (dihitung ulang
// server-side, gak percaya nilai dari client)
// ─────────────────────────────────────────────────────────
const getStatusForValidation = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT
       h.poi_cab AS Cab,
       h.poi_close AS Closed,
       IFNULL((
         SELECT SUM(i.poisjd_jumlah)
         FROM tpointernalsj_hdr a
         INNER JOIN tpointernalsj_dtl i ON i.poisjd_nomor = a.poisj_nomor
         WHERE a.poisj_nomorpo = h.poi_nomor
       ), 0) AS SJ
     FROM tpointernal_hdr h
     WHERE h.poi_nomor = ?`,
    [nomor],
  );
  return row || null;
};

// ✅ "HO-" diperlakukan sama kayak cabang kosong (lihat/akses semua
// cabang) — pola inferensi yang sama dipakai di modul lain
// berdasarkan bukti perilaku production.
const isHeadOffice = (userCabang) => !userCabang || userCabang === "HO-";

// ─────────────────────────────────────────────────────────
// CEK BOLEH DIUBAH/DIHAPUS — replikasi validasi cxButton1Click &
// cxButton4Click (cabang match, Closed, SJ<>0), TAPI dengan Closed
// di-CEK BENERAN ('Y') — bukan replikasi bug Delphi yang ngecek
// string 'YA' yang gak pernah match nilai asli 'Y'/'N'. Atas
// permintaan eksplisit user, validasi ini SENGAJA diperbaiki, bukan
// direplikasi apa adanya.
// ─────────────────────────────────────────────────────────
const checkModifiable = async (nomor, userCabang) => {
  const row = await getStatusForValidation(nomor);
  if (!row) return { allowed: false, message: "Data tidak ditemukan." };

  if (!isHeadOffice(userCabang) && row.Cab !== userCabang) {
    return { allowed: false, message: "Data tsb bukan cabang anda." };
  }
  if (row.Closed === "Y") {
    return {
      allowed: false,
      message: "PO tsb sudah close.\nTidak bisa diubah/dihapus.",
    };
  }
  if (Number(row.SJ) !== 0) {
    return {
      allowed: false,
      message: "PO tsb sudah jadi SJ.\nTidak bisa diubah/dihapus.",
    };
  }
  return { allowed: true, message: "" };
};

// ─────────────────────────────────────────────────────────
// DELETE — replikasi cxButton4Click (header only, sama pola modul
// lain — trigger diasumsikan handle cascade ke detail)
// ─────────────────────────────────────────────────────────
const deleteData = async (nomor, userCabang) => {
  const check = await checkModifiable(nomor, userCabang);
  if (!check.allowed) throw new Error(check.message);

  const [result] = await db.query(
    `DELETE FROM tpointernal_hdr WHERE poi_nomor = ?`,
    [nomor],
  );
  if (result.affectedRows === 0) throw new Error("Data tidak ditemukan.");
  return { nomor };
};

module.exports = {
  getBrowseList,
  getDetailByNomor,
  checkModifiable,
  deleteData,
};
