const service = require("../../services/garmen/mintaBahanFormService");
const tutupBukuService = require("../../services/tutupBukuService");

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
    const { cabang, keterangan, isEdit } = req.query; // Tambah isEdit

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

    // Cek Akses Cabang
    if (
      payload.cabang !== req.user.cabang &&
      req.user.cabang !== "ALL" &&
      !req.user.cabang.startsWith("HO-")
    ) {
      return res.status(403).json({
        success: false,
        message: "Nomor permintaan tsb bukan cabang anda.",
      });
    }

    // Eksekusi Service (Validasi Tutup Buku & PIN 5 sudah ada di dalam sini)
    const result = await service.saveMintaBahan(payload, req.user, isEdit);

    res
      .status(200)
      .json({ success: true, message: "Berhasil disimpan", data: result });
  } catch (error) {
    // Tangkap error dari throw new Error() di Service
    res
      .status(400) // Gunakan 400 (Bad Request) agar pesan error validasi muncul di toast frontend, bukan 500
      .json({ success: false, message: error.message });
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
