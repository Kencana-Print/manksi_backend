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

const getBarangByKode = async (req, res) => {
  try {
    const { kode } = req.params;
    const { jenis, cabang, bagian } = req.query;
    const data = await service.getBarangByKode(
      kode,
      jenis || "ACCESORIES",
      cabang || "HO-",
      bagian || "",
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const uploadGambarItem = async (req, res) => {
  try {
    if (!req.file) throw new Error("File gambar tidak ditemukan.");
    const { nomor, kode } = req.params;
    const url = await service.saveGambarItem(
      nomor,
      kode,
      req.file.path,
      req.file.size,
    );
    res.status(200).json({
      success: true,
      data: { url },
      message: "Gambar berhasil diupload",
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const deleteGambarItem = async (req, res) => {
  try {
    const { nomor, kode } = req.params;
    await service.deleteGambarItem(nomor, kode);
    res.status(200).json({ success: true, message: "Gambar berhasil dihapus" });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getDetail,
  saveData,
  saveRealisasi,
  getBarangByKode,
  uploadGambarItem,
  deleteGambarItem,
};
