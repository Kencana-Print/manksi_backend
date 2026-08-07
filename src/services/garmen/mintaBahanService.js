const db = require("../../config/database");

/**
 * Mendapatkan data utama Browse Permintaan Bahan
 */
const getBrowse = async (startDate, endDate, cabang) => {
  let query = `
    SELECT 
      x.Nomor, x.Tanggal, x.Jam, x.Cab, x.Divisi, v.Divisi AS DivisiSpk, 
      x.SPK, x.NamaSpk, x.JmlSpk, x.Keterangan, x.sts AS Status, x.AlasanClose,
      IF(x.totr=0, "", IF(x.totr>x.tota, "N", "Y")) AS Approve,
      x.ApvGudang, x.AlasanTolak_ApvGudang,
      x.ApvManager, x.AlasanTolak_ApvManager, x.Usr,
      IFNULL((
        SELECT IFNULL(
          IF(pin_acc="" AND pin_dipakai="", "WAIT",
          IF(pin_acc="Y" AND pin_dipakai="", "ACC",
          IF(pin_acc="Y" AND pin_dipakai="Y", "",
          IF(pin_acc="N", "TOLAK", "")))), "")
        FROM tspk_pin5 
        WHERE pin_trs="MINTA BAHAN" AND pin_nomor=x.Nomor 
        ORDER BY pin_urut DESC LIMIT 1
      ), "") AS Ngedit
    FROM (
      SELECT 
        h.min_nomor AS Nomor, h.min_tanggal AS Tanggal, h.min_divisi AS Divisi,
        DATE_FORMAT(h.date_create, "%H:%i:%s") AS Jam, h.user_create AS Usr, 
        h.min_cab AS Cab, h.min_spk_nomor AS SPK, 
        IFNULL(s.spk_divisi, m.mspk_divisi) AS kddiv,
        IFNULL(s.spk_nama, m.Mspk_nama) AS NamaSpk, 
        IFNULL(s.spk_jumlah, m.Mspk_jumlah) AS JmlSpk, 
        h.min_ket AS Keterangan,
        h.min_apv AS ApvGudang, h.min_apvalasan AS AlasanTolak_ApvGudang,
        h.min_apvmgr AS ApvManager, h.min_apvalasanmgr AS AlasanTolak_ApvManager,
        IF(h.min_close=0, "OPEN", 
           IF(h.min_close=1, "CLOSE", 
              IF(h.min_close=9, "DICLOSE", "ONPROSES"))) AS sts,
        h.min_alasanclose AS AlasanClose,
        IFNULL((SELECT COUNT(*) FROM tproduksiminta_hdr q WHERE q.promin_minta=h.min_nomor), 0) AS totr,
        IFNULL((SELECT COUNT(*) FROM tproduksiminta_hdr q WHERE q.promin_minta=h.min_nomor AND q.promin_apv IS NOT NULL), 0) AS tota
      FROM tmintabahan_hdr h
      LEFT JOIN tspk s ON s.spk_nomor = h.min_spk_nomor
      LEFT JOIN tmemospk m ON m.mspk_nomor = h.min_spk_nomor
      WHERE h.min_tanggal >= ? AND h.min_tanggal <= ?
  `;

  const params = [startDate, endDate];

  if (cabang && cabang !== "ALL") {
    query += ` AND h.min_cab = ?`;
    params.push(cabang);
  }

  query += ` ORDER BY h.min_nomor ) x LEFT JOIN tdivisi v ON v.kode = x.kddiv`;

  const [rows] = await db.query(query, params);
  return rows;
};

/**
 * Mendapatkan Detail Barang untuk suatu Nomor Minta Bahan
 */
const getDetailBahan = async (nomor) => {
  const query = `
    SELECT 
      d.mind_nomor AS Nomor, d.mind_bhn_kode AS Kode, b.Bhn_Name AS NamaBahan, 
      b.Bhn_satuan AS Satuan, d.mind_babaran AS Babaran, d.mind_pcs AS Pcs, d.mind_jumlah AS Jumlah,
      IFNULL((
        SELECT SUM(i.promind_Jumlah) 
        FROM tproduksiminta_dtl i 
        INNER JOIN tproduksiminta_hdr j ON j.promin_nomor = i.promind_promin_Nomor 
        WHERE j.promin_minta = h.min_nomor AND i.promind_kodem = d.mind_bhn_kode
      ), 0) AS Realisasi,
      d.mind_komponen AS Komponen, d.mind_ket AS Keterangan
    FROM tmintabahan_hdr h
    INNER JOIN tmintabahan_dtl d ON d.mind_nomor = h.min_nomor
    LEFT JOIN tbahan b ON b.Bhn_kode = d.mind_bhn_kode
    WHERE h.min_nomor = ?
    ORDER BY d.mind_bhn_kode
  `;
  const [rows] = await db.query(query, [nomor]);
  return rows;
};

/**
 * Mendapatkan Riwayat Realisasi untuk suatu Nomor Minta Bahan
 */
const getDetailRealisasi = async (nomor) => {
  const query = `
    SELECT 
      h.promin_nomor AS NomorRealisasi, 
      DATE_FORMAT(h.promin_tanggal, "%d-%m-%Y") AS TglRealisasi,
      IFNULL(DATE_FORMAT(h.promin_apv, "%d-%m-%Y %H:%i:%s"), "") AS WaktuApprove,
      SUM(d.promind_Jumlah) AS TotalJumlah, 
      h.promin_keterangan AS Keterangan
    FROM tproduksiminta_hdr h
    INNER JOIN tproduksiminta_dtl d ON d.promind_promin_Nomor = h.promin_nomor
    WHERE h.promin_minta = ?
    GROUP BY h.promin_nomor
    ORDER BY h.promin_nomor
  `;
  const [rows] = await db.query(query, [nomor]);
  return rows;
};

/**
 * Mendapatkan rincian barang untuk Riwayat Realisasi
 */
const getDetailRealisasiDtl = async (nomor) => {
  const query = `
    SELECT 
      h.promin_nomor AS NomorRealisasi,
      d.promind_bhn_kode AS Kode,
      b.Bhn_Name AS Nama,
      b.Bhn_satuan AS Satuan,
      d.promind_Jumlah AS Jumlah
    FROM tproduksiminta_hdr h
    INNER JOIN tproduksiminta_dtl d ON d.promind_promin_Nomor = h.promin_nomor
    LEFT JOIN tbahan b ON b.Bhn_kode = d.promind_bhn_kode
    WHERE h.promin_minta = ?
  `;
  const [rows] = await db.query(query, [nomor]);
  return rows;
};

/**
 * Validasi sebelum insert: Cek apakah ada realisasi lama yang belum diapprove
 */
const checkPendingApproval = async (cabang) => {
  let gdgFilter = "";
  if (cabang === "P04") gdgFilter = 'AND h.promin_gdgp_kode="GP001"';
  else if (cabang === "P01") gdgFilter = 'AND h.promin_gdgp_kode="GP015"';

  const query = `
    SELECT IFNULL(COUNT(*), 0) AS countPending
    FROM tproduksiminta_hdr h
    INNER JOIN tproduksiminta_dtl d ON d.promind_promin_Nomor = h.promin_nomor
    WHERE h.promin_minta <> "" 
      AND h.promin_apv IS NULL 
      AND h.promin_tanggal < DATE_ADD(CURDATE(), INTERVAL -1 DAY)
      ${gdgFilter}
  `;
  const [rows] = await db.query(query);
  return rows[0].countPending;
};

/**
 * Hapus Transaksi (Minta Bahan)
 */
const deleteMintaBahan = async (nomor) => {
  const [result] = await db.query(
    `DELETE FROM tmintabahan_hdr WHERE min_nomor = ?`,
    [nomor],
  );
  return result;
};

/**
 * Update Status Close Manual (min_close=9)
 */
const setCloseManual = async (nomor, alasan) => {
  const [result] = await db.query(
    `UPDATE tmintabahan_hdr SET min_close = 9, min_alasanclose = ? WHERE min_nomor = ?`,
    [alasan, nomor],
  );
  return result;
};

/**
 * Menyimpan approval realisasi (update field promin_apv)
 * Sesuai dengan logika (Key =VK_F7) di Delphi
 */
const saveApproveRealisasi = async (nomorRealisasi) => {
  // ── RAKIT WAKTU (WIB) MANUAL DARI NODE.JS ──
  const getLocalTime = () => {
    const d = new Date();
    // Konversi ke zona waktu Indonesia (WIB)
    const wibDate = new Date(
      d.toLocaleString("en-US", { timeZone: "Asia/Jakarta" }),
    );
    const pad = (n) => String(n).padStart(2, "0");

    // Format akhir: YYYY-MM-DD HH:mm:ss
    return `${wibDate.getFullYear()}-${pad(wibDate.getMonth() + 1)}-${pad(wibDate.getDate())} ${pad(wibDate.getHours())}:${pad(wibDate.getMinutes())}:${pad(wibDate.getSeconds())}`;
  };

  const exactTime = getLocalTime();

  const query = `
    UPDATE tproduksiminta_hdr 
    SET promin_apv = ? 
    WHERE promin_nomor = ?
  `;

  // Lempar exactTime hasil rakitan JS ke parameter kueri
  const [result] = await db.query(query, [exactTime, nomorRealisasi]);

  if (result.affectedRows === 0) {
    throw new Error("Data realisasi tidak ditemukan atau gagal diupdate.");
  }

  return result;
};

// Approve Gudang
const saveApproveGudang = async (nomor, capv, userKode, alasan) => {
  const query = `
    UPDATE tmintabahan_hdr 
    SET min_apv = ?, 
        min_apvusr = ?, 
        min_apvalasan = ? 
    WHERE min_nomor = ?
  `;
  const [result] = await db.query(query, [capv, userKode, alasan || "", nomor]);
  if (result.affectedRows === 0) {
    throw new Error("Data Permintaan Bahan tidak ditemukan.");
  }
  return result;
};

// Approve Manager
const saveApproveManager = async (nomor, capv, userKode, alasan) => {
  const query = `
    UPDATE tmintabahan_hdr 
    SET min_apvmgr = ?, 
        min_apvmgrusr = ?, 
        min_apvalasanmgr = ? 
    WHERE min_nomor = ?
  `;
  const [result] = await db.query(query, [capv, userKode, alasan || "", nomor]);
  if (result.affectedRows === 0) {
    throw new Error("Data Permintaan Bahan tidak ditemukan.");
  }
  return result;
};

// Ajukan Perubahan
const submitAjukanPerubahan = async (
  nomor,
  urut,
  tgl,
  spk,
  userKode,
  alasan,
) => {
  // Diasumsikan ada tabel log atau update ke header/detail
  const query = `
    INSERT INTO tproduksiminta_ubah (
      promin_nomor, urut, tgl_ubah, spk_ubah, user_ubah, alasan_ubah, tgl_input
    ) VALUES (?, ?, ?, ?, ?, ?, NOW())
  `;
  return await db.query(query, [nomor, urut, tgl, spk, userKode, alasan]);
};

module.exports = {
  getBrowse,
  getDetailBahan,
  getDetailRealisasi,
  getDetailRealisasiDtl,
  checkPendingApproval,
  deleteMintaBahan,
  setCloseManual,
  saveApproveRealisasi,
  saveApproveGudang,
  saveApproveManager,
  submitAjukanPerubahan,
};
