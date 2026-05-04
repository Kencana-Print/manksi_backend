const penawaranService = require("../../services/penjualan/penawaranService");

const getBrowseList = async (req, res) => {
  try {
    const { startDate, endDate, status } = req.query;
    const user = req.user; // Didapat dari authMiddleware

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Parameter startDate dan endDate wajib diisi.",
      });
    }

    const data = await penawaranService.getPenawaranList(
      startDate,
      endDate,
      status || "ALL",
      user,
    );

    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getBrowseDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await penawaranService.getPenawaranDetail(nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteData = async (req, res) => {
  try {
    const { nomor } = req.params;

    // Todo: Anda dapat menambahkan logika validasi "Sudah Close" menggunakan tutupBukuService di sini

    const success = await penawaranService.deletePenawaran(nomor);

    if (success) {
      res
        .status(200)
        .json({ success: true, message: "Data berhasil dihapus." });
    } else {
      res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan." });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateStatus = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { details } = req.body; // Array of detail yang diupdate
    await penawaranService.updateStatusDetail(nomor, details);
    res
      .status(200)
      .json({ success: true, message: "Status berhasil diupdate." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowseList,
  getBrowseDetail,
  deleteData,
  updateStatus,
};
