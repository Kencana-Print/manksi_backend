const svc = require("../../services/garmen/cetakBkbjService");
const lookupService = require("../../services/lookupService");

const getBrowse = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, gudang } = req.query;
    if (!gudang) {
      return res
        .status(400)
        .json({ success: false, message: "Gudang wajib dipilih." });
    }
    const data = await svc.getBrowse(tglAwal, tglAkhir, gudang);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getExportData = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, gudang } = req.query;
    const data = await svc.getExportData(tglAwal, tglAkhir, gudang);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// dipanggil dari tombol "Cetak" di browse — bikin/ambil nomor bukti,
// hasilnya dipakai frontend buat window.open() ke halaman print (tab baru)
const prosesCetak = async (req, res) => {
  try {
    const { gudang, tanggal, expedisi } = req.body;
    if (!gudang || !tanggal) {
      return res
        .status(400)
        .json({ success: false, message: "Gudang dan tanggal wajib diisi." });
    }
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const result = await svc.prosesCetak(gudang, tanggal, expedisi, userKode);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// dipanggil dari halaman print (tab baru) — assemble header + detail + perusahaan
const getPrintData = async (req, res) => {
  try {
    const { gudang, tanggal, expedisi } = req.query;
    if (!gudang || !tanggal) {
      return res
        .status(400)
        .json({ success: false, message: "Gudang dan tanggal wajib diisi." });
    }

    const [header, details, perusahaanList] = await Promise.all([
      svc.getHeaderBukti(gudang, tanggal, expedisi),
      svc.getDetailCetak(gudang, tanggal, expedisi),
      lookupService.getPerusahaan(),
    ]);

    if (!header) {
      return res.status(404).json({
        success: false,
        message: "Bukti belum dicetak/dibuat untuk kombinasi ini.",
      });
    }

    // ⚠️ asumsi: perusahaan tunggal (ambil baris pertama) — sesuaikan kalau
    // ternyata ada multi-cabang/perush_kode spesifik yang perlu difilter.
    const perusahaan = perusahaanList?.[0] || null;

    res.json({ success: true, data: { header, details, perusahaan } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getBrowse,
  getExportData,
  prosesCetak,
  getPrintData,
};
