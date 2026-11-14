const kartuStokKainService = require("../../../services/laporan/spanduk/kartuStokKainService");

const jalankan = (aksi) => async (req, res) => {
  try {
    const data = await aksi(req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error("Error kartu stok kain spanduk:", error);
    res
      .status(error.status || 500)
      .json({ success: false, message: error.message });
  }
};

const getBrowse = jalankan(kartuStokKainService.getBrowse);
const getDetail = jalankan(kartuStokKainService.getDetail);
const getGudang = jalankan(kartuStokKainService.getGudang);

module.exports = { getBrowse, getDetail, getGudang };
