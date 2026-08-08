const db = require("../../../config/database");

const getTableName = (jenis, userBagian) => {
  if (userBagian === "FINANCE") return "finance.tmasterstok_finance";
  if (jenis === "OBAT") return "tmasterstok_obat";
  if (jenis === "SPAREPART") return "tmasterstok_sparepart";
  if (jenis === "ATK/RTK" || jenis === "ATK") return "tmasterstok_atk";
  return "tmasterstok_acc";
};

/**
 * MENGAMBIL SUMMARY MASTER STOK BARANG
 */
const getMasterStok = async (query, user) => {
  const { startDate, endDate, cabang, jenis, barang } = query;

  const selectedJenis = jenis || "ACCESORIES";

  let fallbackStart = new Date();
  fallbackStart.setMonth(fallbackStart.getMonth() - 1);
  const defaultStart = new Date(
    fallbackStart.getFullYear(),
    fallbackStart.getMonth(),
    1,
  )
    .toISOString()
    .substring(0, 10);

  const dStart = startDate || defaultStart;
  const dEnd = endDate || new Date().toISOString().substring(0, 10);
  const fixCabang = cabang || user?.cabang || "P04";

  const tableName = getTableName(selectedJenis, user?.bagian);

  let filterBarang = " AND b.brg_jenis = ? ";
  let baseParams = [selectedJenis];

  if (barang) {
    filterBarang += " AND b.brg_kode = ? ";
    baseParams.push(barang);
  }

  // FIX: Array parameter harus tepat 16 item untuk mengisi 16 placeholder (?)
  const subParams = [
    dStart, // 1. Stok Awal (< dStart)
    dStart,
    dEnd, // 2, 3. BPBbahan
    dStart,
    dEnd, // 4, 5. BPB
    dStart,
    dEnd, // 6, 7. Retur
    dStart,
    dEnd, // 8, 9. Koreksi
    dStart,
    dEnd, // 10, 11. MSI
    dStart,
    dEnd, // 12, 13. Realisasi
    dStart,
    dEnd, // 14, 15. MSO
    fixCabang, // 16. mst_cab
  ];

  const sql = `
    SELECT 
      b.brg_kode AS Kode, 
      IF(b.brg_note="", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
      b.brg_satuan AS Satuan,
      IFNULL(s.StokAwal, 0) AS StokAwal,
      IFNULL(s.BPBbahan, 0) AS BPBbahan,
      IFNULL(s.BPB, 0) AS BPB,
      IFNULL(s.Retur, 0) AS Retur,
      IFNULL(s.Koreksi, 0) AS Koreksi,
      IFNULL(s.MSI, 0) AS MSI,
      IFNULL(s.RealisasiPermintaan, 0) AS RealisasiPermintaan,
      IFNULL(s.MSO, 0) AS MSO,
      (IFNULL(s.StokAwal, 0) + IFNULL(s.BPBbahan, 0) + IFNULL(s.BPB, 0) + IFNULL(s.Retur, 0) + IFNULL(s.Koreksi, 0) + IFNULL(s.MSI, 0) - IFNULL(s.RealisasiPermintaan, 0) - IFNULL(s.MSO, 0)) AS StokAkhir
    FROM tgarmen_brg b
    LEFT JOIN (
      SELECT 
        mst_brg_kode,
        SUM(CASE WHEN mst_tanggal < ? THEN mst_stok_in - mst_stok_out ELSE 0 END) AS StokAwal,
        SUM(CASE WHEN mst_tanggal >= ? AND mst_tanggal <= ? AND LEFT(mst_noreferensi, 3)='BPG' THEN mst_stok_in ELSE 0 END) AS BPBbahan,
        SUM(CASE WHEN mst_tanggal >= ? AND mst_tanggal <= ? AND LEFT(mst_noreferensi, 2)='PB' THEN mst_stok_in ELSE 0 END) AS BPB,
        SUM(CASE WHEN mst_tanggal >= ? AND mst_tanggal <= ? AND LEFT(mst_noreferensi, 2)='RT' THEN mst_stok_in ELSE 0 END) AS Retur,
        SUM(CASE WHEN mst_tanggal >= ? AND mst_tanggal <= ? AND LEFT(mst_noreferensi, 2)='KR' THEN mst_stok_in ELSE 0 END) AS Koreksi,
        SUM(CASE WHEN mst_tanggal >= ? AND mst_tanggal <= ? AND LEFT(mst_noreferensi, 3)='MSI' THEN mst_stok_in ELSE 0 END) AS MSI,
        SUM(CASE WHEN mst_tanggal >= ? AND mst_tanggal <= ? AND LEFT(mst_noreferensi, 2)='RE' THEN mst_stok_out ELSE 0 END) AS RealisasiPermintaan,
        SUM(CASE WHEN mst_tanggal >= ? AND mst_tanggal <= ? AND LEFT(mst_noreferensi, 3)='MSO' THEN mst_stok_out ELSE 0 END) AS MSO
      FROM ${tableName}
      WHERE mst_aktif = "Y" AND mst_cab = ?
      GROUP BY mst_brg_kode
    ) s ON s.mst_brg_kode = b.brg_kode
    WHERE b.brg_aktif = "Y" ${filterBarang}
    ORDER BY b.brg_nama ASC
  `;

  const finalParams = [...subParams, ...baseParams];
  const [rows] = await db.query(sql, finalParams);

  return rows;
};

/**
 * MENGAMBIL DETAIL HISTORI KARTU STOK PER BARANG
 */
const getDetailKartuStok = async (query, brgKode, user) => {
  const { startDate, endDate, cabang, jenis } = query;

  const selectedJenis = jenis || "ACCESORIES";

  let fallbackStart = new Date();
  fallbackStart.setMonth(fallbackStart.getMonth() - 1);
  const defaultStart = new Date(
    fallbackStart.getFullYear(),
    fallbackStart.getMonth(),
    1,
  )
    .toISOString()
    .substring(0, 10);

  const dStart = startDate || defaultStart;
  const dEnd = endDate || new Date().toISOString().substring(0, 10);
  const fixCabang = cabang || user?.cabang || "P04";

  const tableName = getTableName(selectedJenis, user?.bagian);

  const qAwal = `
    SELECT IFNULL(SUM(mst_stok_in - mst_stok_out), 0) AS awal
    FROM ${tableName}
    WHERE mst_aktif="Y" AND mst_cab=? AND mst_brg_kode=? AND mst_tanggal < ?
  `;
  const [rAwal] = await db.query(qAwal, [fixCabang, brgKode, dStart]);
  const stokAwal = rAwal[0].awal;

  const qTrans = `
    SELECT 
      mst_noreferensi AS Nomor,
      DATE_FORMAT(mst_tanggal, "%d-%m-%Y") AS Tanggal,
      mst_stok_in AS StokIn,
      mst_stok_out AS StokOut,
      CASE 
        WHEN LEFT(mst_noreferensi, 3) = "BPG" THEN "Dari BPB Bahan"
        WHEN LEFT(mst_noreferensi, 2) = "PB" THEN "PB"
        WHEN LEFT(mst_noreferensi, 2) = "RT" THEN "Retur"
        WHEN LEFT(mst_noreferensi, 2) = "KR" THEN "Koreksi"
        WHEN LEFT(mst_noreferensi, 3) = "MSI" THEN "Mutasi In"
        WHEN LEFT(mst_noreferensi, 2) = "RE" THEN "Realisasi Permintaan"
        WHEN LEFT(mst_noreferensi, 3) = "MSO" THEN "Mutasi Out"
        ELSE "Lainnya"
      END AS Transaksi
    FROM ${tableName}
    WHERE mst_aktif="Y" AND mst_cab=? AND mst_brg_kode=? AND mst_tanggal >= ? AND mst_tanggal <= ?
    ORDER BY mst_tanggal ASC, mst_noreferensi ASC
  `;
  const [rTrans] = await db.query(qTrans, [fixCabang, brgKode, dStart, dEnd]);

  let history = [];
  history.push({
    Transaksi: "Stok Awal",
    Nomor: "-",
    Tanggal: dStart.split("-").reverse().join("-"),
    StokIn: 0,
    StokOut: 0,
    Saldo: parseFloat(stokAwal),
  });

  let currentSaldo = parseFloat(stokAwal);
  for (let row of rTrans) {
    currentSaldo += parseFloat(row.StokIn) - parseFloat(row.StokOut);
    history.push({
      ...row,
      StokIn: parseFloat(row.StokIn),
      StokOut: parseFloat(row.StokOut),
      Saldo: currentSaldo,
    });
  }

  return history.filter(
    (h) => h.StokIn !== 0 || h.StokOut !== 0 || h.Transaksi === "Stok Awal",
  );
};

module.exports = {
  getMasterStok,
  getDetailKartuStok,
};
