// backend/src/controllers/spk.controller.js
const spkService = require("../../../../services/mmt/transaksi-khusus/spk-order/spkService");

// ==========================================
// SPK HANDLERS
// ==========================================

exports.getSpkBrowse = async (req, res) => {
  try {
    const data = await spkService.getAllSpkData(req.query);
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getSpkDetailSize = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await spkService.getSpkDetailSize(nomor);
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getSpkLookup = async (req, res) => {
  const keyword = req.query.keyword || "";
  try {
    const data = await spkService.getSpkLookupData(keyword);
    res.status(200).json({ success: true, data: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
exports.getAlokasiSpk = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await spkService.getAlokasiBySpk(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getSpkDetail = async (req, res) => {
  const { nomor } = req.params;
  try {
    const data = await spkService.getSpkDetailByNomor(nomor);
    res.status(200).json({ success: true, data: data });
  } catch (error) {
    const statusCode = error.message.includes("tidak ditemukan") ? 404 : 500;
    res.status(statusCode).json({ success: false, message: error.message });
  }
};

exports.getSpkForMesinLookup = async (req, res) => {
  const keyword = req.query.keyword || "";
  try {
    const data = await spkService.getSpkForMesin(keyword);
    res.status(200).json({ success: true, data: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getMemoSpkLookup = async (req, res) => {
  const keyword = req.query.keyword || "";
  try {
    const data = await spkService.getMemoSpkLookupData(keyword);
    res.status(200).json({ success: true, data: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.printSpk = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await spkService.getSpkForPrint(nomor);

    // Langsung mengirimkan objek utuh (termasuk properti Daftar_Alokasi yang baru saja kita buat)
    res.status(200).json(data);
  } catch (error) {
    // PERBAIKAN: Jika pesan error dari service menyatakan tidak ditemukan, kirim status 404
    const statusCode = error.message.includes("tidak ditemukan") ? 404 : 500;
    res.status(statusCode).json({ message: error.message });
  }
};
// ==========================================
// STBJ HANDLERS (Baru)
// ==========================================

exports.getStbjLookup = async (req, res) => {
  const keyword = req.query.keyword || "";
  try {
    const data = await spkService.getSpkForStbjLookup(keyword);
    res.status(200).json({ success: true, data: data });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Gagal memuat lookup STBJ" });
  }
};

exports.getStbjDetail = async (req, res) => {
  const { nomor } = req.params;
  try {
    const data = await spkService.getStbjFullDetail(nomor);
    res.status(200).json({ success: true, data: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.lookupSpkForJadwal = async (req, res) => {
  try {
    const { keyword } = req.query;
    const data = await spkService.getSpkForJadwalKirimLookup(keyword);
    res.json({
      success: true,
      data: data,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getSpkForSublimLookup = async (req, res) => {
  const keyword = req.query.keyword || "";
  try {
    const data = await spkService.getSpkForSublimLookup(keyword);
    res.status(200).json({ success: true, data: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

