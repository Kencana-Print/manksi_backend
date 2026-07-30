const db = require("../../../config/database");

// ─────────────────────────────────────────────────────────
// Replikasi ufrmLapRevisimemo.btnRefreshClick. Nampilin SELURUH
// riwayat revisi (termasuk dokumen original revisi_no=0) untuk setiap
// MAP yang PERNAH punya minimal 1 revisi — bukan cuma baris
// revisi_no>0. `Lama_Hari` = correlated subquery DATEDIFF ke tanggal
// dokumen referensi (self-join via mspk_referensi); NULL kalau
// mspk_referensi kosong (dokumen original tanpa referensi).
// ─────────────────────────────────────────────────────────
const getBrowse = async (startDate, endDate) => {
  const sql = `
    SELECT
      x.mspk_nomor AS Nomor,
      DATE_FORMAT(x.mspk_tanggal, '%Y-%m-%d') AS Tanggal,
      x.mspk_nama AS Nama,
      x.mspk_nama2 AS NamaAsli,
      v.divisi AS Divisi,
      x.mspk_revisi_no AS RevisiNo,
      DATEDIFF(
        x.mspk_tanggal,
        (SELECT r.mspk_tanggal FROM tmemospk r WHERE r.mspk_nomor = x.mspk_referensi)
      ) AS LamaHari,
      c.cus_nama AS Customer,
      x.mspk_aktif AS Aktif,
      x.mspk_referensi AS Referensi,
      x.mspk_keterangan AS Keterangan,
      x.mspk_revisi_note AS NoteRevisi,
      IF(x.mspk_tipe_revisi = 0, 'External', 'Internal') AS TipeRevisi,
      x.mspk_tipe AS Tipe
    FROM tmemospk x
    INNER JOIN tcustomer c ON c.cus_kode = x.mspk_cus_kode
    LEFT JOIN tdivisi v ON v.kode = x.mspk_divisi
    WHERE x.mspk_nama2 IN (
      SELECT mspk_nama2 FROM tmemospk WHERE mspk_revisi_no > 0
    )
      AND x.mspk_tanggal >= ? AND x.mspk_tanggal <= ?
    ORDER BY x.mspk_nama2, x.mspk_tanggal
  `;

  const [rows] = await db.query(sql, [startDate, endDate]);

  return rows.map((r) => ({
    ...r,
    RevisiNo: r.RevisiNo !== null ? Number(r.RevisiNo) : null,
    LamaHari: r.LamaHari !== null ? Number(r.LamaHari) : null,
  }));
};

module.exports = {
  getBrowse,
};
