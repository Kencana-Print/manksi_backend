const db = require("../../../config/database");

const getBrowse = async (query) => {
  const { startDate, endDate } = query;

  // Default tanggal: Awal bulan s/d Hari ini
  const date = new Date();
  const dStart =
    startDate ||
    new Date(date.getFullYear(), date.getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || date.toISOString().substring(0, 10);

  // Mengambil data berdasarkan Tanggal Plan atau Tanggal Realisasi
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
      SELECT cc_kode AS cus_kode, cc_nama AS cus_nama, cc_alamat AS cus_alamat FROM marketing.tcaloncustomer 
    ) b ON a.cus_kode = b.cus_kode
    WHERE (DATE(a.Tanggal_Plan) BETWEEN ? AND ?) 
       OR (DATE(a.tanggal) BETWEEN ? AND ?)
    ORDER BY a.USER ASC, a.Tanggal_Plan DESC, a.tanggal DESC
  `;

  const params = [dStart, dEnd, dStart, dEnd];
  const [rows] = await db.query(sql, params);

  // Validasi format tanggal (menghindari '0000-00-00')
  const isValidDate = (d) =>
    d && d !== "0000-00-00" && d !== "0000-00-00 00:00:00";

  // Objek untuk menampung summary per sales
  const summaryObj = {};

  // Pemrosesan logic plan vs realisasi
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

    // Inisialisasi summary object untuk sales ini jika belum ada
    if (!summaryObj[salesName]) {
      summaryObj[salesName] = { done: 0, failed: 0, unplan: 0, total: 0 };
    }

    // Increment nilai summary
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

  // Convert summary object ke array untuk mempermudah render di table summary frontend
  const summaryArray = Object.keys(summaryObj).map((sales) => ({
    Nama_Sales: sales,
    ...summaryObj[sales],
  }));

  return {
    data: processedData,
    summary: summaryArray,
  };
};

module.exports = {
  getBrowse,
};
