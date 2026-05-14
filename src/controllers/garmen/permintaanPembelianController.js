const service = require("../../services/garmen/permintaanPembelianService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, jenis, cabang } = req.query;
    const userBagian = req.user?.bagian || ""; // Ditarik dari JWT auth middleware

    const data = await service.getBrowse(
      startDate,
      endDate,
      jenis,
      cabang,
      userBagian,
    );

    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getBrowseDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { jenis } = req.query;

    const data = await service.getBrowseDetail(nomor, jenis);

    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deletePermintaan = async (req, res) => {
  try {
    const { nomor } = req.params;
    await service.deletePermintaan(nomor);
    res.status(200).json({ success: true, message: "Berhasil dihapus" });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const closePermintaan = async (req, res) => {
  try {
    const { nomor } = req.params;
    await service.closePermintaan(nomor);
    res.status(200).json({ success: true, message: "Berhasil diclose." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const requestPin = async (req, res) => {
  try {
    const { nomor, alasan } = req.body;
    const userKode = req.user?.kode || "SYSTEM";

    await service.requestPinPerubahan(nomor, alasan, userKode);
    res
      .status(200)
      .json({ success: true, message: "Berhasil diajukan. Menunggu ACC." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateEstimasi = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { tanggal } = req.body;
    if (!tanggal) throw new Error("Tanggal estimasi wajib diisi");

    await service.updateEstimasi(nomor, tanggal);
    res.status(200).json({ success: true, message: "Berhasil disimpan" });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  deletePermintaan,
  closePermintaan,
  requestPin,
  updateEstimasi,
};
