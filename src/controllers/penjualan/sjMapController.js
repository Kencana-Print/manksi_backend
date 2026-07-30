const sjMapService = require("../../services/penjualan/sjMapService");

const getBrowseData = async (req, res) => {
  try {
    const formatDate = (date) => {
      const d = new Date(date);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };

    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const startDate = req.query.start_date || formatDate(firstDayOfMonth);
    const endDate = req.query.end_date || formatDate(today);

    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1; // <-- TAMBAHAN
    const data = await sjMapService.getSjMapList(
      startDate,
      endDate,
      canLihatCus,
    );

    res.status(200).json({ success: true, data, canLihatCus });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteData = async (req, res) => {
  try {
    const isDeleted = await sjMapService.deleteSjMap(req.params.nomor);
    if (!isDeleted) {
      return res
        .status(404)
        .json({ success: false, message: "Data Surat Jalan tidak ditemukan." });
    }
    res
      .status(200)
      .json({ success: true, message: "Surat Jalan berhasil dihapus." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getPengajuanStatus = async (req, res) => {
  try {
    const status = await sjMapService.getPin5Status(req.params.nomor);
    res.status(200).json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const ajukanPerubahanData = async (req, res) => {
  try {
    const userKode = req.user?.kode || "ADMIN";

    if (!req.body.alasan || req.body.alasan.trim() === "") {
      return res
        .status(400)
        .json({ success: false, message: "Alasan pengajuan harus diisi." });
    }

    await sjMapService.ajukanPerubahan(req.body, userKode);
    res
      .status(200)
      .json({ success: true, message: "Berhasil diajukan. Menunggu ACC." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowseData,
  deleteData,
  getPengajuanStatus,
  ajukanPerubahanData,
};
