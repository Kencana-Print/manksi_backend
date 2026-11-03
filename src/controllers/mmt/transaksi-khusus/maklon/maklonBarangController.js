// controllers/maklonBarang.controller.js
const maklonBarangService = require('../../../../services/mmt/transaksi-khusus/maklon/maklonBarangService');

// Cabang user yang login — JWT MMT membawa field "cab" (dari tuser.user_cab),
// middleware verifyToken menormalisasikannya menjadi "cabang" (pola bastMap).
const getUserCabang = (req) =>
  req.user?.cabang ?? req.user?.cab ?? req.user?.Cab ?? null;

// GET /browse?startDate=&endDate=&keyword=&cab=&semuaCabang=
exports.getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, keyword, cab, semuaCabang } = req.query;
    const cabangFilter = (semuaCabang === 'true' || semuaCabang === true)
      ? null
      : (cab !== undefined ? cab : getUserCabang(req));

    const data = await maklonBarangService.getBrowse({
      startDate,
      endDate,
      cab: cabangFilter,
      keyword,
      semuaCabang: semuaCabang === 'true' || semuaCabang === true,
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('GET /maklon-barang/browse', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data Maklon Barang',
      error: error.message,
    });
  }
};

// GET /detail/:nomor
exports.getDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await maklonBarangService.getDetail(nomor);
    res.json({ success: true, data });
  } catch (error) {
    console.error(`GET /maklon-barang/detail/${req.params?.nomor}`, error);
    res.status(404).json({
      success: false,
      message: error.message || 'Gagal mengambil detail Maklon',
    });
  }
};

// GET /print/:nomor
exports.getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await maklonBarangService.getPrintData(nomor);
    res.json({ success: true, data });
  } catch (error) {
    console.error(`GET /maklon-barang/print/${req.params?.nomor}`, error);
    res.status(404).json({
      success: false,
      message: error.message || 'Gagal mengambil data cetak Maklon',
    });
  }
};

// GET /sj-keluar/print/:sjkNomor
exports.getSjKeluarPrintData = async (req, res) => {
  try {
    const { sjkNomor } = req.params;
    const data = await maklonBarangService.getSjKeluarPrintData(sjkNomor);
    res.json({ success: true, data });
  } catch (error) {
    console.error(`GET /maklon-barang/sj-keluar/print/${req.params?.sjkNomor}`, error);
    res.status(404).json({
      success: false,
      message: error.message || 'Gagal mengambil data cetak SJ Keluar',
    });
  }
};

// GET /lookup?keyword=
exports.getLookup = async (req, res) => {
  try {
    const { keyword, limit } = req.query;
    const data = await maklonBarangService.lookupMaklon({
      keyword,
      cab: getUserCabang(req),
      limit,
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('GET /maklon-barang/lookup', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data lookup Maklon',
      error: error.message,
    });
  }
};
