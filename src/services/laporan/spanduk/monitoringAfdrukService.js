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

// Slot bahan tetap, sama dengan form LHK Afdruk
const SLOT_BAHAN = [
  { alias: "Rinso", kode: 10401 },
  { alias: "Porstek", kode: 10400 },
  { alias: "M46", kode: 10622 },
  { alias: "Kaporit", kode: 10438 },
  { alias: "Caustik", kode: 10439 },
  { alias: "Ulano", kode: 10435 },
  { alias: "Screen", kode: 10436 },
  { alias: "Lem", kode: 10441 },
  { alias: "Katalis", kode: 10437 },
];

// Semua nilai di bawah berasal dari konstanta di atas, bukan input user
const SQL_PIVOT_UKURAN = UKURAN.map(
  (u) =>
    `SUM(CASE WHEN ROUND(lad2_up_kode * 100) = ${Math.round(u.nilai * 100)} THEN lad2_qty ELSE 0 END) AS ${u.alias}`,
).join(",\n        ");

const SQL_KOLOM_UKURAN = UKURAN.map(
  (u) => `IFNULL(u.${u.alias}, 0) AS ${u.alias}`,
).join(",\n      ");

const SQL_PIVOT_BAHAN = SLOT_BAHAN.map(
  (s) =>
    `SUM(CASE WHEN lab_brg_kode = ${s.kode} THEN lab_qty END) * 1e0 AS ${s.alias}`,
).join(",\n        ");

const SQL_KOLOM_BAHAN = SLOT_BAHAN.map(
  (s) => `IFNULL(bhn.${s.alias}, 0) AS ${s.alias}`,
).join(",\n      ");

const getMonitoringAfdruk = async (tglAwal, tglAkhir) => {
  validasiPeriode(tglAwal, tglAkhir);

  const [rows] = await db.query(
    `
    SELECT
      ELT(WEEKDAY(h.lah_tanggal) + 1,
          'Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Minggu')   AS Hari,
      DATE_FORMAT(h.lah_tanggal, '%Y-%m-%d')                           AS Tanggal,
      h.lah_nomor                                                      AS Nomor_LHK,
      x.spk_nama                                                       AS Nama,
      x.spk_panjang                                                    AS Panjang,
      x.spk_lebar                                                      AS Lebar,
      d.lad_spk_nomor                                                  AS Nomor,
      CONCAT(h.lah_nomor, '|', d.lad_spk_nomor)                        AS Kunci,
      ${SQL_KOLOM_UKURAN},
      IFNULL(d.lad_j_plangkan, 0)                                      AS J_Plangkan,
      IFNULL(d.lad_jumlahmeter,
             ROUND(IFNULL(d.lad_j_plangkan, 0) * IFNULL(x.spk_panjang, 0), 2)) AS J_Meter,
      IFNULL(u.Jumlah_Meter, 0)                                        AS Jumlah_Meter,
      ${SQL_KOLOM_BAHAN},
      d.lad_keterangan                                                 AS Keterangan
    FROM kencanaprint.tlhk_afdruk_hdr h
    INNER JOIN kencanaprint.tlhk_afdruk_dtl d ON d.lad_lah_nomor = h.lah_nomor
    LEFT JOIN (
      SELECT spk_nomor, spk_nama,
             IFNULL(spk_panjang, 0) AS spk_panjang,
             IFNULL(spk_lebar, 0)   AS spk_lebar
      FROM kencanaprint.tspk
      UNION ALL
      SELECT mspk_nomor, mspk_nama,
             IFNULL(mspk_panjang, 0),
             IFNULL(mspk_lebar, 0)
      FROM kencanaprint.tmemospk
    ) x ON x.spk_nomor = d.lad_spk_nomor
    LEFT JOIN (
      SELECT lad2_lah_nomor, lad2_spk_nomor,
        ${SQL_PIVOT_UKURAN},
        SUM(lad2_up_kode * lad2_qty) AS Jumlah_Meter
      FROM kencanaprint.tlhk_afdruk_dtl_2
      GROUP BY lad2_lah_nomor, lad2_spk_nomor
    ) u ON u.lad2_lah_nomor = d.lad_lah_nomor AND u.lad2_spk_nomor = d.lad_spk_nomor
    LEFT JOIN (
      SELECT lab_lah_nomor,
        ${SQL_PIVOT_BAHAN}
      FROM kencanaprint.tlhk_afdruk_bahan
      GROUP BY lab_lah_nomor
    ) bhn ON bhn.lab_lah_nomor = h.lah_nomor
    WHERE h.lah_tanggal >= ?
      AND h.lah_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
    ORDER BY h.lah_tanggal, h.lah_nomor, d.lad_spk_nomor
    `,
    [tglAwal, tglAkhir],
  );

  // Bahan bersifat per LHK: hanya baris pertama tiap LHK yang membawa nilainya,
  // supaya total footer tidak berlipat (pola Export Detail LHK Tinta)
  const sudahAda = new Set();
  return rows.map((r) => {
    const pertama = !sudahAda.has(r.Nomor_LHK);
    sudahAda.add(r.Nomor_LHK);

    const hasil = {
      ...r,
      J_Plangkan: Number(r.J_Plangkan) || 0,
      J_Meter: dua(r.J_Meter),
      Jumlah_Meter: dua(r.Jumlah_Meter),
    };
    for (const u of UKURAN) {
      hasil[u.alias] = Number(r[u.alias]) || 0;
    }
    for (const s of SLOT_BAHAN) {
      hasil[s.alias] = pertama ? dua(r[s.alias]) : 0;
    }
    return hasil;
  });
};

module.exports = { getMonitoringAfdruk };
