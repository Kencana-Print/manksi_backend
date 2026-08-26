const svc = require("../../../services/laporan/gudang-garmen/umurStokBahanService");

const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const getBrowse = async (req, res) => {
  try {
    // Default filter tanggal = hari ini (bukan range awal-akhir bulan
    // seperti laporan lain — laporan ini snapshot kondisi stok SAAT
    // INI, bukan riwayat transaksi periode tertentu)
    const { tanggal = todayLocal(), kodeBahan = "" } = req.query;
    const data = await svc.getBrowse(tanggal, kodeBahan);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getBrowse };
