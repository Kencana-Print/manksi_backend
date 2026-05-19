const mutasiInBarangService = require("../../services/garmen/mutasiInBarangService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, jenis, cabang } = req.query;

    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Parameter startDate dan endDate diperlukan.",
        });
    }

    const data = await mutasiInBarangService.getBrowse(
      startDate,
      endDate,
      jenis,
      cabang,
    );

    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const terimaMutasi = async (req, res) => {
  try {
    const { nomor } = req.params;
    const userKode = req.user.kode; // Dari token JWT middleware

    if (!nomor) {
      return res
        .status(400)
        .json({ success: false, message: "Nomor Mutasi diperlukan." });
    }

    const result = await mutasiInBarangService.terimaMutasi(nomor, userKode);

    res.status(200).json({
      success: true,
      message: "Mutasi berhasil diterima.",
      data: result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  terimaMutasi,
};
