const svc = require("../../../services/laporan/gudang-garmen/browseSpkService");
const spkService = require("../../../services/ppic/spkService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Periode wajib diisi." });
    }
    const data = await svc.getBrowse({
      startDate,
      endDate,
      userCabang: req.user?.cabang,
      userKode: req.user?.kode,
      userBagian: req.user?.bagian,
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Cek status izin cetak sebelum tombol "Cetak" ditekan ──
const getPrintPermission = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await spkService.checkPrintPermission(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Minta approval cetak ulang langsung dari halaman ini ──
const requestPrintApproval = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { alasan } = req.body;
    const userKode = req.user?.kode || req.user?.username;
    await spkService.requestPrintApproval(nomor, alasan, userKode);
    res.json({
      success: true,
      message: "Permintaan approval cetak ulang terkirim.",
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Dipanggil SETELAH cetak berhasil dibuka (increment counter) ──
const recordPrint = async (req, res) => {
  try {
    const { nomor } = req.params;
    await spkService.recordPrint(nomor);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getBrowse,
  getPrintPermission,
  requestPrintApproval,
  recordPrint,
};
