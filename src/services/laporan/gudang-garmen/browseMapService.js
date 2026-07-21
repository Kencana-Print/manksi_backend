const db = require("../../../config/database");

// ─────────────────────────────────────────────
// MASTER — browse MAP aktif divisi garmen (3,4,6) dalam periode.
// Flat query, tidak ada master-detail.
// ✅ FIX (sesuai konfirmasi): join ke tspk yang gak dipakai kolomnya
// dihapus — mencegah baris MAP terduplikasi kalau 1 MAP referensi
// >1 SPK (spk_memo=mspk_nomor).
// Quirk `if(Tanggal_Buat=NULL,...)` di Delphi disederhanakan jadi
// DATEDIFF langsung — hasilnya identik (kondisi itu di Delphi selalu
// FALSE karena "=NULL" bukan "IS NULL", jadi cabang DATEDIFF yang
// selalu jalan; DATEDIFF sendiri otomatis NULL kalau salah satu
// argumennya NULL, jadi outputnya sama persis tanpa perlu IF).
// ─────────────────────────────────────────────
const getBrowse = async (startDate, endDate) => {
  const sql = `
    SELECT
      m.mspk_nomor AS Nomor,
      DATE_FORMAT(m.mspk_tanggal, '%Y-%m-%d') AS Tanggal,
      DATE_FORMAT(m.mspk_dateline, '%Y-%m-%d') AS Dateline,
      m.mspk_tipe AS Tipe,
      m.mspk_divisi AS Divisi,
      m.mspk_cab AS Cab,
      m.mspk_workshop AS Workshop,
      CONCAT(m.mspk_cab2, ' ', m.mspk_workshop2) AS WorkshopSPK,
      m.mspk_nama AS Nama,
      (
        SELECT IF(COUNT(*) > 1, 'Sudah', 'Belum')
        FROM tkesesuaianMAP WHERE mspk_nomor = m.mspk_nomor
      ) AS BeritaAcara,
      m.mspk_kendala AS Kendala,
      (
        SELECT DATE_FORMAT(DATE_CREATE, '%Y-%m-%d %H:%i:%s')
        FROM tkesesuaianMAP
        WHERE mspk_nomor = m.mspk_nomor AND DATE_CREATE IS NOT NULL
        LIMIT 1
      ) AS TanggalBuat,
      DATEDIFF(
        (
          SELECT DATE_CREATE FROM tkesesuaianMAP
          WHERE mspk_nomor = m.mspk_nomor AND DATE_CREATE IS NOT NULL
          LIMIT 1
        ),
        m.mspk_tanggal
      ) AS WaktuProses,
      (
        SELECT sjd.sjd_sj_nomor FROM tsj_dtl_memo sjd
        INNER JOIN tsj_hdr_memo sjh ON sjh.sj_nomor = sjd.sjd_sj_nomor
        WHERE sjd.sjd_mspk_nomor = m.mspk_nomor
        ORDER BY sjh.sj_tanggal DESC LIMIT 1
      ) AS SuratJalan,
      m.mspk_ukuran AS Ukuran,
      m.mspk_panjang AS Panjang,
      m.mspk_lebar AS Lebar,
      m.mspk_gramasi AS Gramasi,
      m.mspk_kain AS Kain,
      m.mspk_finishing AS Finishing,
      m.mspk_jumlah AS Jumlah,
      m.mspk_jumlah_kirim AS Kirim,
      m.mspk_rencana_order AS Rencana,
      s.sal_nama AS Salesman
    FROM tmemospk m
    INNER JOIN tcustomer c ON m.mspk_cus_kode = c.cus_kode
    LEFT JOIN tsales s ON m.mspk_sal_kode = s.sal_kode
    WHERE m.mspk_divisi IN (3, 4, 6) AND m.mspk_cmo <> ''
      AND m.mspk_tanggal >= ? AND m.mspk_tanggal <= ?
    ORDER BY m.mspk_nama
  `;
  const [rows] = await db.query(sql, [startDate, endDate]);
  return rows;
};

// ─────────────────────────────────────────────
// CETAK BAST — data buat print Berita Acara Kesesuaian MAP.
// Hanya boleh kalau BeritaAcara sudah 'Sudah' (persis Delphi
// cxButton5Click: cek dulu, kalau belum → tolak).
// ─────────────────────────────────────────────
const getBastData = async (nomor) => {
  const sql = `
    SELECT a.*, b.*, c.*
    FROM tkesesuaianmap a
    INNER JOIN tkesesuaian b ON a.kode_sesuai = b.kode_sesuai
    INNER JOIN tmemospk c ON c.mspk_nomor = a.mspk_nomor
    WHERE a.mspk_nomor = ?
  `;
  const [rows] = await db.query(sql, [nomor]);
  return rows;
};

const checkBeritaAcaraStatus = async (nomor) => {
  const sql = `
    SELECT IF(COUNT(*) > 1, 'Sudah', 'Belum') AS Status
    FROM tkesesuaianMAP WHERE mspk_nomor = ?
  `;
  const [rows] = await db.query(sql, [nomor]);
  return rows[0]?.Status || "Belum";
};

module.exports = {
  getBrowse,
  getBastData,
  checkBeritaAcaraStatus,
};
