const bapProduksiService = require("../../services/master/bapProduksiService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Parameter startDate dan endDate wajib diisi",
      });
    }

    const userCabang = req.user.cabang;
    const isAccKor = req.user.isAccKor === 1 || req.user.isAccKor === true; // Sesuaikan dengan properti token JWT kamu

    const data = await bapProduksiService.getBrowse(
      startDate,
      endDate,
      userCabang,
      isAccKor,
    );
    res.status(200).json({ success: true, data: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const remove = async (req, res) => {
  try {
    await bapProduksiService.remove(req.params.nomor);
    res.status(200).json({ success: true, message: "BAP berhasil dihapus" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const ajukanPerubahan = async (req, res) => {
  try {
    const { alasan } = req.body;
    if (!alasan)
      return res
        .status(400)
        .json({ success: false, message: "Alasan pengajuan wajib diisi" });

    await bapProduksiService.ajukanPerubahan(
      req.params.nomor,
      alasan,
      req.user.kode,
    );
    res
      .status(200)
      .json({ success: true, message: "Berhasil diajukan. Menunggu ACC." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getBrowse, remove, ajukanPerubahan };
