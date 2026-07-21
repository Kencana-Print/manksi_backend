const db = require("../../../config/database");

const GD_DC = "GP032";

// ─────────────────────────────────────────────
// MASTER — kombinasi SPK + Kode Bahan + Size yang pernah
// bersentuhan dengan GD DC (baik Masuk maupun Keluar).
// StokAwal dihitung kumulatif sebelum startDate, Masuk/Keluar
// dihitung dalam rentang periode.
// ─────────────────────────────────────────────
const getBrowse = async (startDate, endDate, tampilkanKosong = false) => {
  const sql = `
    SELECT x.*, (x.StokAwal + x.Masuk - x.Keluar) AS StokAkhir
    FROM (
      SELECT
        mv.Spk, mv.Kode,
        MAX(mv.Nama) AS Nama, MAX(mv.Satuan) AS Satuan, mv.Size,
        CONCAT(mv.Spk, '|', mv.Kode, '|', IFNULL(mv.Size, '')) AS RowKey,
        IFNULL(MAX(sp.spk_nama), IFNULL(MAX(so.so_nama), IFNULL(MAX(mp.mspk_nama), mv.Spk))) AS NamaSpk,
        IFNULL(MAX(sp.spk_tanggal), IFNULL(MAX(so.so_tanggal), MAX(mp.mspk_tanggal))) AS TanggalSpk,
        SUM(IF(mv.Tanggal < ?, mv.MasukQty - mv.KeluarQty, 0)) AS StokAwal,
        SUM(IF(mv.Tanggal >= ? AND mv.Tanggal <= ?, mv.MasukQty, 0)) AS Masuk,
        SUM(IF(mv.Tanggal >= ? AND mv.Tanggal <= ?, mv.KeluarQty, 0)) AS Keluar
      FROM (
        SELECT
          d.mpd_spk AS Spk, d.mpd_bhn_kode AS Kode,
          d.MPD_NAMA AS Nama, d.mpd_satuan AS Satuan, d.mpd_size AS Size,
          h.mph_tanggal AS Tanggal,
          IF(h.mph_gdgtujuan = '${GD_DC}', d.mpd_jumlah, 0) AS MasukQty,
          IF(h.mph_gdgasal = '${GD_DC}', d.mpd_jumlah, 0) AS KeluarQty
        FROM tmutasiproduksi_dtl d
        INNER JOIN tmutasiproduksi_hdr h ON h.mph_nomor = d.mpd_mph_nomor
        WHERE h.mph_gdgtujuan = '${GD_DC}' OR h.mph_gdgasal = '${GD_DC}'
      ) mv
      LEFT JOIN tspk sp ON sp.spk_nomor = mv.Spk
      LEFT JOIN tsalesorder so ON so.so_nomor = mv.Spk
      LEFT JOIN tmemospk mp ON mp.mspk_nomor = mv.Spk
      GROUP BY mv.Spk, mv.Kode, mv.Size
    ) x
    WHERE x.TanggalSpk >= ? AND x.TanggalSpk <= ?
    ${tampilkanKosong ? "" : `AND (x.StokAwal + x.Masuk - x.Keluar) <> 0`}
    ORDER BY x.TanggalSpk DESC, x.Nama, x.Size
  `;

  const params = [
    startDate,
    startDate,
    endDate,
    startDate,
    endDate,
    startDate,
    endDate,
  ];
  const [rows] = await db.query(sql, params);
  return rows;
};
// ─────────────────────────────────────────────
// DETAIL — rincian transaksi mutasi untuk satu kombinasi
// SPK + Kode + Size, dengan running balance (mirip Kartu Stok),
// plus nama Gudang Asal/Tujuan per transaksi.
// ─────────────────────────────────────────────
const getDetail = async (spk, kode, size, startDate, endDate) => {
  const [awalRows] = await db.query(
    `SELECT
       IFNULL((
         SELECT SUM(d.mpd_jumlah)
         FROM tmutasiproduksi_dtl d
         INNER JOIN tmutasiproduksi_hdr h ON h.mph_nomor = d.mpd_mph_nomor
         WHERE h.mph_gdgtujuan = '${GD_DC}'
           AND d.mpd_spk = ? AND d.mpd_bhn_kode = ? AND d.mpd_size = ?
           AND h.mph_tanggal < ?
       ), 0)
       -
       IFNULL((
         SELECT SUM(d.mpd_jumlah)
         FROM tmutasiproduksi_dtl d
         INNER JOIN tmutasiproduksi_hdr h ON h.mph_nomor = d.mpd_mph_nomor
         WHERE h.mph_gdgasal = '${GD_DC}'
           AND d.mpd_spk = ? AND d.mpd_bhn_kode = ? AND d.mpd_size = ?
           AND h.mph_tanggal < ?
       ), 0) AS awal`,
    [spk, kode, size, startDate, spk, kode, size, startDate],
  );
  let xStok = Number(awalRows[0]?.awal) || 0;

  const [trxRows] = await db.query(
    `SELECT
       h.mph_nomor AS Nomor,
       DATE_FORMAT(h.mph_tanggal, '%Y-%m-%d') AS Tanggal,
       ga.gdgp_nama AS GudangAsal,
       gt.gdgp_nama AS GudangTujuan,
       d.mpd_jumlah AS Jumlah,
       IF(h.mph_gdgtujuan = '${GD_DC}', 'Masuk', 'Keluar') AS Arah
     FROM tmutasiproduksi_dtl d
     INNER JOIN tmutasiproduksi_hdr h ON h.mph_nomor = d.mpd_mph_nomor
     LEFT JOIN tgudangproduksi ga ON ga.gdgp_kode = h.mph_gdgasal
     LEFT JOIN tgudangproduksi gt ON gt.gdgp_kode = h.mph_gdgtujuan
     WHERE (h.mph_gdgtujuan = '${GD_DC}' OR h.mph_gdgasal = '${GD_DC}')
       AND d.mpd_spk = ? AND d.mpd_bhn_kode = ? AND d.mpd_size = ?
       AND h.mph_tanggal >= ? AND h.mph_tanggal <= ?
     ORDER BY h.mph_tanggal, h.date_create`,
    [spk, kode, size, startDate, endDate],
  );

  const detail = [
    {
      Nomor: "",
      Tanggal: startDate,
      GudangAsal: "",
      GudangTujuan: "",
      Arah: "Stok Awal",
      StokIn: xStok >= 0 ? xStok : 0,
      StokOut: xStok < 0 ? Math.abs(xStok) : 0,
      StokAkhir: xStok,
    },
  ];

  for (const t of trxRows) {
    const jml = Number(t.Jumlah) || 0;
    const stokIn = t.Arah === "Masuk" ? jml : 0;
    const stokOut = t.Arah === "Keluar" ? jml : 0;
    xStok = xStok + stokIn - stokOut;
    detail.push({
      Nomor: t.Nomor,
      Tanggal: t.Tanggal,
      GudangAsal: t.GudangAsal || "",
      GudangTujuan: t.GudangTujuan || "",
      Arah: t.Arah,
      StokIn: stokIn,
      StokOut: stokOut,
      StokAkhir: xStok,
    });
  }

  return detail;
};

// ─────────────────────────────────────────────
// ALL DETAIL — untuk "Export Detail" (semua kombinasi master
// sesuai filter saat ini, digabung jadi satu daftar flat).
// ─────────────────────────────────────────────
const getAllDetail = async (startDate, endDate, tampilkanKosong = false) => {
  const master = await getBrowse(startDate, endDate, tampilkanKosong);

  const result = [];
  for (const m of master) {
    const dtl = await getDetail(m.Spk, m.Kode, m.Size, startDate, endDate);
    for (const d of dtl) {
      result.push({
        Spk: m.Spk,
        NamaSpk: m.NamaSpk,
        Kode: m.Kode,
        Nama: m.Nama,
        Size: m.Size,
        ...d,
      });
    }
  }
  return result;
};

module.exports = {
  getBrowse,
  getDetail,
  getAllDetail,
};
