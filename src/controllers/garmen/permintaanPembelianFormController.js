const service = require("../../services/garmen/permintaanPembelianFormService");

const getDetail = async (req, res) => {
  try {
    const data = await service.getDetail(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const saveData = async (req, res) => {
  try {
    const userKode = req.user?.kode || "SYSTEM";
    const bagian = req.user?.bagian || "";
    // Jika tidak ada cabang, set fallback sesuai delphi
    const cabang = req.user?.cabang || "P01";

    const result = await service.saveData(req.body, userKode, bagian, cabang);
    res
      .status(200)
      .json({ success: true, data: result, message: "Berhasil disimpan" });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const saveRealisasi = async (req, res) => {
  try {
    const { nomor, kode, items } = req.body;
    await service.saveRealisasi(nomor, kode, items);
    res
      .status(200)
      .json({ success: true, message: "Realisasi berhasil diperbarui" });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = { getDetail, saveData, saveRealisasi };
