const db = require("../../../config/database");
const { validasiPeriode } = require("../../spanduk/lhk/lhkCommon");

const dua = (n) => Math.round((Number(n) || 0) * 100) / 100;

// 15 ukuran plangkan (master); dicocokkan lewat nilai x 100 supaya aman dari selisih float
const UKURAN = [
  { alias: "U050", nilai: 0.5 },
  { alias: "U100", nilai: 1 },
  { alias: "U120", nilai: 1.2 },
  { alias: "U150", nilai: 1.5 },
  { alias: "U180", nilai: 1.8 },
  { alias: "U230", nilai: 2.3 },
  { alias: "U250", nilai: 2.5 },
  { alias: "U280", nilai: 2.8 },
  { alias: "U350", nilai: 3.5 },
  { alias: "U400", nilai: 4 },
  { alias: "U450", nilai: 4.5 },
  { alias: "U550", nilai: 5.5 },
  { alias: "U580", nilai: 5.8 },
  { alias: "U650", nilai: 6.5 },
  { alias: "U750", nilai: 7.5 },
];

// Urutan jalan cetak: lprd_u1 .. lprd_u10 (alias Warna1 .. Warna10)
const JUMLAH_WARNA = 10;
const NOMOR_WARNA = Array.from({ length: JUMLAH_WARNA }, (_, i) => i + 1);

// Semua nilai di bawah berasal dari konstanta di atas, bukan input user
const SQL_PIVOT_UKURAN = UKURAN.map(
  (u) =>
    `SUM(CASE WHEN ROUND(lprd2_up_kode * 100) = ${Math.round(u.nilai * 100)} THEN lprd2_qty ELSE 0 END) AS ${u.alias}`,
).join(",\n        ");

const SQL_KOLOM_UKURAN = UKURAN.map(
  (u) => `IFNULL(u.${u.alias}, 0) AS ${u.alias}`,
).join(",\n      ");

const SQL_KOLOM_WARNA = NOMOR_WARNA.map(
  (n) => `IFNULL(d.lprd_u${n}, '') AS Warna${n}`,
).join(",\n      ");

const getMonitoringHasilProof = async (tglAwal, tglAkhir) => {
  validasiPeriode(tglAwal, tglAkhir);

  const [rows] = await db.query(
    `
    SELECT
      ELT(WEEKDAY(h.lpr_tanggal) + 1,
          'Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Minggu')   AS Hari,
      DATE_FORMAT(h.lpr_tanggal, '%Y-%m-%d')                           AS Tanggal,
      h.lpr_nomor                                                      AS Nomor_LHK,
      x.spk_nama                                                       AS Nama,
      x.spk_panjang                                                    AS Panjang,
      x.spk_lebar                                                      AS Lebar,
      d.lprd_spk_nomor                                                 AS Nomor,
      CONCAT(h.lpr_nomor, '|', d.lprd_spk_nomor)                       AS Kunci,
      ${SQL_KOLOM_UKURAN},
      IF(u.Jumlah_Plangkan IS NULL, IFNULL(d.lprd_j_plangkan, 0), u.Jumlah_Plangkan) AS J_Plangkan,
      ${SQL_KOLOM_WARNA},
      IFNULL(d.lprd_j_proof, 0)                                        AS J_Proof,
      x.spk_kain                                                       AS Kain,
      IFNULL(x.spk_panjang, 0) * IFNULL(d.lprd_j_proof, 0)             AS Meter_Bahan,
      IFNULL(u.Jumlah_Meter, 0)                                        AS Jumlah_Meter
    FROM kencanaprint.tlhk_proof_hdr h
    INNER JOIN kencanaprint.tlhk_proof_dtl d ON d.lprd_lpr_nomor = h.lpr_nomor
    LEFT JOIN (
      SELECT spk_nomor, spk_nama, spk_kain,
             IFNULL(spk_panjang, 0) AS spk_panjang,
             IFNULL(spk_lebar, 0)   AS spk_lebar
      FROM kencanaprint.tspk
      UNION ALL
      SELECT mspk_nomor, mspk_nama, mspk_kain,
             IFNULL(mspk_panjang, 0),
             IFNULL(mspk_lebar, 0)
      FROM kencanaprint.tmemospk
    ) x ON x.spk_nomor = d.lprd_spk_nomor
    LEFT JOIN (
      SELECT lprd2_lpr_nomor, lprd2_spk_nomor,
        ${SQL_PIVOT_UKURAN},
        SUM(lprd2_qty) AS Jumlah_Plangkan,
        SUM(lprd2_up_kode * lprd2_qty) AS Jumlah_Meter
      FROM kencanaprint.tlhk_proof_dtl_2
      GROUP BY lprd2_lpr_nomor, lprd2_spk_nomor
    ) u ON u.lprd2_lpr_nomor = d.lprd_lpr_nomor AND u.lprd2_spk_nomor = d.lprd_spk_nomor
    WHERE h.lpr_tanggal >= ?
      AND h.lpr_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
    ORDER BY h.lpr_tanggal, h.lpr_nomor, d.lprd_spk_nomor
    `,
    [tglAwal, tglAkhir],
  );

  return rows.map((r) => {
    const hasil = {
      ...r,
      J_Plangkan: Number(r.J_Plangkan) || 0,
      J_Proof: Number(r.J_Proof) || 0,
      Meter_Bahan: dua(r.Meter_Bahan),
      Jumlah_Meter: dua(r.Jumlah_Meter),
    };
    for (const u of UKURAN) {
      hasil[u.alias] = Number(r[u.alias]) || 0;
    }
    return hasil;
  });
};

module.exports = { getMonitoringHasilProof };
