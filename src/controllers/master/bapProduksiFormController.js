const bapProduksiFormService = require("../../services/master/bapProduksiFormService");

const getById = async (req, res) => {
  try {
    const data = await bapProduksiFormService.getById(req.params.nomor);
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan" });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getSpkDetail = async (req, res) => {
  try {
    const data = await bapProduksiFormService.getSpkDetail(req.params.spkNomor);
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "SPK tidak ditemukan" });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const { isNewMode, data } = req.body;

    // Validasi basic
    if (!data.BagNama)
      return res
        .status(400)
        .json({ success: false, message: "Bagian harus diisi" });
    if (!data.Masalah)
      return res
        .status(400)
        .json({ success: false, message: "Permasalahan harus diisi" });

    // Pengecekan PIN 5 (Sesuai Delphi KeyDown F10)
    if (!isNewMode) {
      if (["MINTA", "WAIT", "TOLAK"].includes(data.StatusEdit)) {
        return res.status(400).json({
          success: false,
          message:
            "Belum bisa menyimpan. Status pengajuan edit: " + data.StatusEdit,
        });
      }
    }

    const nomor = await bapProduksiFormService.save(
      data,
      req.user.kode,
      isNewMode,
    );
    res
      .status(200)
      .json({ success: true, message: "BAP berhasil disimpan", nomor });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const data = await bapProduksiFormService.getPrintData(req.params.nomor);
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan" });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getById, getSpkDetail, save, getPrintData };
