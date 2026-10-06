const service = require("../../../services/laporan/ppic/keberhasilanKomitmenKirimService");

const isTanggalValid = (v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(String(v));

const getKeberhasilanKomitmenKirim = async (req, res) => {
  try {
    const { startDate, endDate, cabang, tipe } = req.query;
    if (!isTanggalValid(startDate) || !isTanggalValid(endDate)) {
      return res
        .status(400)
        .json({ success: false, message: "Format tanggal harus YYYY-MM-DD." });
    }
    if (startDate && endDate && startDate > endDate) {
      return res.status(400).json({
        success: false,
        message: "Tanggal awal tidak boleh melebihi tanggal akhir.",
      });
    }
    if (cabang && !/^[A-Za-z0-9]{1,10}$/.test(String(cabang))) {
      return res
        .status(400)
        .json({ success: false, message: "Kode cabang tidak valid." });
    }
    if (tipe && !["SO", "MAP"].includes(String(tipe))) {
      return res
        .status(400)
        .json({ success: false, message: "Tipe harus SO atau MAP." });
    }
    const data = await service.getKeberhasilanKomitmenKirim(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getKeberhasilanKomitmenKirim };
