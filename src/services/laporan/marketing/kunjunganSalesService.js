const db = require("../../../config/database");

const getBrowse = async (query) => {
  const { startDate, endDate, sales } = query;

  // Default tanggal: Awal bulan s/d Hari ini
  const date = new Date();
  const dStart =
    startDate ||
    new Date(date.getFullYear(), date.getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || date.toISOString().substring(0, 10);

  // ── Filter sales (opsional) ──
  let salesFilter = "";
  const params = [dStart, dEnd, dStart, dEnd];
  if (sales && sales.trim()) {
    salesFilter = " AND a.USER LIKE ?";
    params.push(`%${sales.trim()}%`);
  }

  const sql = `
    SELECT 
      a.Tanggal_Plan, 
      a.tanggal AS Tgl_Realisasi, 
      a.realisasi AS Status_Realisasi, 
      a.Cus_Kode, 
      b.Cus_Nama, 
      b.Cus_Alamat, 
      a.Latitude, 
      a.Longitude,
      a.note AS Keperluan, 
      a.Catatan, 
      a.USER AS Nama_Sales
    FROM marketing.tkunjungan a 
    LEFT JOIN (
      SELECT cus_kode, cus_nama, cus_alamat FROM tcustomer
      UNION ALL
      SELECT cc_kode AS cus_kode, cc_nama AS cus_nama, cc_alamat AS cus_alamat 
      FROM marketing.tcaloncustomer 
    ) b ON a.cus_kode = b.cus_kode
    WHERE (
      (DATE(a.Tanggal_Plan) BETWEEN ? AND ?) 
      OR (DATE(a.tanggal) BETWEEN ? AND ?)
    )${salesFilter}
    ORDER BY a.USER ASC, a.Tanggal_Plan DESC, a.tanggal DESC
  `;

  const [rows] = await db.query(sql, params);

  // ── Nominal Penawaran & MH per sales (bulan berjalan, bukan range filter) ──
  // Gunakan bulan berjalan agar konsisten dengan tampilan dashboard
  const sqlNominal = `
    SELECT
      s.sal_nama AS Nama_Sales,
      SUM(d.pend_qty * d.pend_harga)          AS NominalPenawaran,
      SUM(mh.mh_harga_kalkulasi * mh.mh_jmlorder) AS NominalMintaHarga
    FROM tsales s
    LEFT JOIN tpenawaran_hdr ph
      ON ph.pen_sal_kode = s.sal_kode
      AND ph.pen_tanggal >= DATE_FORMAT(NOW(), '%Y-%m-01')
      AND ph.pen_tanggal <= CURDATE()
    LEFT JOIN tmintaharga mh
      ON mh.mh_sal_kode = s.sal_kode
      AND mh.mh_tanggal >= DATE_FORMAT(NOW(), '%Y-%m-01')
      AND mh.mh_tanggal <= CURDATE()
    LEFT JOIN tpenawaran_dtl d
      ON d.pend_pen_nomor = ph.pen_nomor      
    WHERE s.sal_nama IN (
      SELECT DISTINCT USER FROM marketing.tkunjungan
      WHERE (DATE(Tanggal_Plan) BETWEEN ? AND ?)
         OR (DATE(tanggal)      BETWEEN ? AND ?)
    )
    GROUP BY s.sal_nama
  `;
  const [nominalRows] = await db.query(sqlNominal, [
    dStart,
    dEnd,
    dStart,
    dEnd,
  ]);

  // Map nominal ke object { NamaSales: { JmlPenawaran, JmlMintaHarga } }
  const nominalMap = {};
  for (const r of nominalRows) {
    nominalMap[r.Nama_Sales] = {
      JmlPenawaran: Number(r.JmlPenawaran) || 0,
      JmlMintaHarga: Number(r.JmlMintaHarga) || 0,
    };
  }

  // ── Validasi format tanggal ──
  const isValidDate = (d) =>
    d && d !== "0000-00-00" && d !== "0000-00-00 00:00:00";

  // ── Objek summary per sales ──
  const summaryObj = {};

  const processedData = rows.map((row) => {
    const hasPlan = isValidDate(row.Tanggal_Plan);
    const hasRealisasi =
      isValidDate(row.Tgl_Realisasi) || row.Status_Realisasi === "Y";

    let statusKunjungan = "";
    if (hasPlan && hasRealisasi) {
      statusKunjungan = "done";
    } else if (hasPlan && !hasRealisasi) {
      statusKunjungan = "failed";
    } else if (!hasPlan && hasRealisasi) {
      statusKunjungan = "unplan";
    }

    const salesName = row.Nama_Sales || "TIDAK DIKETAHUI";

    if (!summaryObj[salesName]) {
      summaryObj[salesName] = { done: 0, failed: 0, unplan: 0, total: 0 };
    }
    if (statusKunjungan) {
      summaryObj[salesName][statusKunjungan]++;
      summaryObj[salesName].total++;
    }

    return {
      ...row,
      has_plan: hasPlan,
      has_realisasi: hasRealisasi,
      status_kunjungan: statusKunjungan,
    };
  });

  // ── Summary array: gabungkan dengan nominal ──
  const summaryArray = Object.keys(summaryObj).map((salesName) => ({
    Nama_Sales: salesName,
    ...summaryObj[salesName],
    JmlPenawaran: nominalMap[salesName]?.JmlPenawaran ?? 0,
    JmlMintaHarga: nominalMap[salesName]?.JmlMintaHarga ?? 0,
  }));

  return {
    data: processedData,
    summary: summaryArray,
  };
};

module.exports = {
  getBrowse,
};
