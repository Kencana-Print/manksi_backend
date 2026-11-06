const service = require("../../services/garmen/mintaBahanFormService");
const tutupBukuService = require("../../services/tutupBukuService");

// Cabang transaksi mengikuti login; hanya HO-/ALL yang boleh memilih cabang lain.
const cabangBoleh = (user, cabang) => {
  const cab = String(user.cabang || "");
  return cabang === cab || cab === "ALL" || cab.startsWith("HO-");
};

const getKomponen = async (req, res) => {
  try {
    const data = await service.getKomponenOptions();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getSpkInfo = async (req, res) => {
  try {
    const { spk } = req.params;
    const { keterangan, isEdit } = req.query;
    const cabang = req.query.cabang || req.user.cabang;

    if (!cabangBoleh(req.user, cabang)) {
      return res.status(403).json({
        success: false,
        message: "Cabang tsb bukan cabang anda.",
      });
    }

    const data = await service.getSpkDetailsAndMkb(
      spk,
      cabang,
      keterangan,
      isEdit === "true",
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getMintaBahan(nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const saveData = async (req, res) => {
  try {
    const isEdit = !!req.params.nomor;
    const payload = req.body;
    if (isEdit) payload.nomor = req.params.nomor;

    // Cabang default = cabang login
    payload.cabang = payload.cabang || req.user.cabang;

    // Cek Akses Cabang
    if (!cabangBoleh(req.user, payload.cabang)) {
      return res.status(403).json({
        success: false,
        message: "Nomor permintaan tsb bukan cabang anda.",
      });
    }

    // Eksekusi Service (Validasi Tutup Buku, PIN 5, dan aturan Spanduk ada di dalam sini)
    const result = await service.saveMintaBahan(payload, req.user, isEdit);

    res
      .status(200)
      .json({ success: true, message: "Berhasil disimpan", data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const data = await service.getPrintData(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const getCloseStatus = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getCloseStatus(nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getKomponen,
  getSpkInfo,
  getDetail,
  saveData,
  getPrintData,
  getCloseStatus,
};
