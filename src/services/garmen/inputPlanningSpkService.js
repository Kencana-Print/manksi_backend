const db = require("../../config/database");

// ─────────────────────────────────────────────────────────
// MASTER — replikasi persis query btnRefreshClick (union tspk + tmemospk)
// tsalesorder SENGAJA tidak diikutkan — modul ini murni scope produksi
// garmen (SPK/MAP), tsalesorder (SO retail/kaosan) tidak berkaitan
// dengan alur planning produksi ini.
// ─────────────────────────────────────────────────────────
const getBrowseList = async (query) => {
  const today = new Date();
  const defaultStart = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .substring(0, 10);
  const defaultEnd = today.toISOString().substring(0, 10);

  const startDate = query.startDate || defaultStart;
  const endDate = query.endDate || defaultEnd;

  const JO_EXCLUDE = `("", "SD", "BR", "PL", "SB", "KS", "DP", "TG")`;

  const sql = `
    SELECT
      x.Nomor, x.Tanggal, x.Dateline, x.Divisi, x.Tipe, x.Cab, x.Kepentingan,
      x.KdCus, x.NamaSPK, x.JumlahSPK, x.Kain, x.Finishing, x.Sablon, x.Sublim,
      x.Bordir, x.RPB,
      IF(x.datang = 0, 1,
        IF(x.cutting = 0, 2,
          IF(x.cetak = 0, 3,
            IF(x.qbordir = 0, 4,
              IF(x.jahit = 0, 5,
                IF(x.qfinishing = 0, 6,
                  IF(x.kirim = 0, 7, 0)
                )
              )
            )
          )
        )
      ) AS Belum
    FROM (
      -- Sumber 1: tspk (SPK garmen) — SourceOrder=1, tampil duluan
      SELECT
        1 AS SourceOrder, s.date_create AS DateCreate,
        s.spk_nomor AS Nomor, s.spk_tanggal AS Tanggal, s.spk_dateline AS Dateline,
        s.spk_divisi AS Divisi, s.spk_tipe AS Tipe, s.spk_cab AS Cab,
        s.spk_statuskerja AS Kepentingan, s.spk_cus_kode AS KdCus,
        s.spk_nama AS NamaSPK, s.spk_jumlah AS JumlahSPK, s.spk_kain AS Kain,
        s.spk_finishing AS Finishing, s.spk_sablon AS Sablon, s.spk_sublim AS Sublim,
        s.spk_bordir AS Bordir,
        (SELECT IFNULL(SUM(p.plan_datang), 0) FROM tplanningspk p WHERE p.plan_spk = s.spk_nomor) AS datang,
        (SELECT IFNULL(SUM(p.plan_cutting), 0) FROM tplanningspk p WHERE p.plan_spk = s.spk_nomor) AS cutting,
        (SELECT IFNULL(SUM(p.plan_cetak + p.plan_sublim), 0) FROM tplanningspk p WHERE p.plan_spk = s.spk_nomor) AS cetak,
        (SELECT IFNULL(SUM(p.plan_bordir), 0) FROM tplanningspk p WHERE p.plan_spk = s.spk_nomor) AS qbordir,
        (SELECT IFNULL(SUM(p.plan_jahit), 0) FROM tplanningspk p WHERE p.plan_spk = s.spk_nomor) AS jahit,
        (SELECT IFNULL(SUM(p.plan_finishing), 0) FROM tplanningspk p WHERE p.plan_spk = s.spk_nomor) AS qfinishing,
        (SELECT IFNULL(SUM(p.plan_kirim), 0) FROM tplanningspk p WHERE p.plan_spk = s.spk_nomor) AS kirim,
        IFNULL((SELECT IF(COUNT(r.promin_spk_nomor) > 0, "SUDAH", "BELUM")
                FROM tproduksiminta_hdr r WHERE r.promin_spk_nomor = s.spk_nomor), 0) AS RPB
      FROM tspk s
      WHERE s.spk_cmo <> "" AND s.spk_aktif = "Y" AND s.spk_divisi IN (3, 4, 6)
        AND s.spk_jo_kode NOT IN ("", "SD", "BR", "PL", "SB", "KS", "DP", "TG")
        AND DATE(s.spk_tanggal) BETWEEN ? AND ?

      UNION ALL

      -- Sumber 2: tmemospk (MAP) — SourceOrder=2, SELALU tampil di bawah
      -- blok SPK di atas, berapa pun tanggalnya (replikasi persis
      -- perilaku Delphi: tanpa ORDER BY level luar, UNION ALL preserve
      -- urutan blok subquery, tspk selalu duluan lalu tmemospk).
      SELECT
        2 AS SourceOrder, s.date_create AS DateCreate,
        s.mspk_nomor AS Nomor, s.mspk_tanggal AS Tanggal, s.mspk_dateline AS Dateline,
        s.mspk_divisi AS Divisi, s.mspk_tipe AS Tipe, s.mspk_cab AS Cab,
        s.mspk_statuskerja AS Kepentingan, s.mspk_cus_kode AS KdCus,
        s.mspk_nama AS NamaSPK, s.mspk_jumlah AS JumlahSPK, s.mspk_kain AS Kain,
        s.mspk_finishing AS Finishing, s.mspk_sablon AS Sablon, s.mspk_sublim AS Sublim,
        s.mspk_bordir AS Bordir,
        (SELECT IFNULL(SUM(p.plan_datang), 0) FROM tplanningspk p WHERE p.plan_spk = s.mspk_nomor) AS datang,
        (SELECT IFNULL(SUM(p.plan_cutting), 0) FROM tplanningspk p WHERE p.plan_spk = s.mspk_nomor) AS cutting,
        (SELECT IFNULL(SUM(p.plan_cetak + p.plan_sublim), 0) FROM tplanningspk p WHERE p.plan_spk = s.mspk_nomor) AS cetak,
        (SELECT IFNULL(SUM(p.plan_bordir), 0) FROM tplanningspk p WHERE p.plan_spk = s.mspk_nomor) AS qbordir,
        (SELECT IFNULL(SUM(p.plan_jahit), 0) FROM tplanningspk p WHERE p.plan_spk = s.mspk_nomor) AS jahit,
        (SELECT IFNULL(SUM(p.plan_finishing), 0) FROM tplanningspk p WHERE p.plan_spk = s.mspk_nomor) AS qfinishing,
        (SELECT IFNULL(SUM(p.plan_kirim), 0) FROM tplanningspk p WHERE p.plan_spk = s.mspk_nomor) AS kirim,
        IFNULL((SELECT IF(COUNT(r.promin_spk_nomor) > 0, "SUDAH", "BELUM")
                FROM tproduksiminta_hdr r WHERE r.promin_spk_nomor = s.mspk_nomor), 0) AS RPB
      FROM tmemospk s
      WHERE s.mspk_cmo <> "" AND s.mspk_aktif = "Y" AND s.mspk_divisi IN (3, 4, 6)
        AND s.mspk_jo_kode NOT IN ("", "SD", "BR", "PL", "SB", "KS", "DP", "TG")
        AND DATE(s.mspk_tanggal) BETWEEN ? AND ?
    ) x
    ORDER BY x.SourceOrder ASC, x.DateCreate ASC
  `;

  const [rows] = await db.query(sql, [startDate, endDate, startDate, endDate]);

  // Cast defensif — mysql2 kadang return SUM/aggregate turunan sebagai string
  return rows.map((r) => ({
    ...r,
    JumlahSPK: Number(r.JumlahSPK) || 0,
    Belum: Number(r.Belum) || 0,
  }));
};

// ─────────────────────────────────────────────────────────
// DETAIL — dipanggil on-demand saat row di-expand (lazy-load,
// sesuai konvensi BaseBrowse project). Replikasi persis SQLDetail
// Delphi: SELECT dari tplanningspk WHERE plan_spk=nomor, order by tanggal.
// ─────────────────────────────────────────────────────────
const getDetailByNomor = async (nomor) => {
  const [rows] = await db.query(
    `SELECT
       p.plan_spk AS Nomor,
       p.plan_tanggal AS TglEstimasi,
       p.plan_datang AS KedatanganBahan,
       p.plan_cutting AS Cutting,
       p.plan_cetak AS Cetak,
       p.plan_sublim AS Sublim,
       p.plan_bordir AS Bordir,
       p.plan_jahit AS Jahit,
       p.plan_finishing AS Finishing,
       p.plan_kirim AS Kirim
     FROM tplanningspk p
     WHERE p.plan_spk = ?
     ORDER BY p.plan_tanggal`,
    [nomor],
  );
  return rows;
};

module.exports = {
  getBrowseList,
  getDetailByNomor,
};
