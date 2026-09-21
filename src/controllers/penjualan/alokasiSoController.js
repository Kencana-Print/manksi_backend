const service = require("../../services/penjualan/alokasiSoService");

const getBrowseData = async (req, res) => {
  try {
    const { startDate, endDate, divisi = "" } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Periode tanggal wajib diisi." });
    }
    const data = await service.getBrowseData(
      startDate,
      endDate,
      divisi,
      req.user,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAlokasi = async (req, res) => {
  try {
    const data = await service.getAlokasi(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const saveAlokasi = async (req, res) => {
  try {
    const { rows } = req.body;
    const data = await service.saveAlokasi(
      req.params.nomor,
      rows,
      req.user.kode,
    );
    res
      .status(200)
      .json({ success: true, message: "Alokasi berhasil disimpan.", data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowseData,
  getAlokasi,
  saveAlokasi,
};
