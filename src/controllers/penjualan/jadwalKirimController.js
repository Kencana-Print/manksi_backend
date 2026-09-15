const jadwalKirimService = require("../../services/penjualan/jadwalKirimService");

// ─────────────────────────────────────────────────────────
// HELPER: parse & validasi filter dari query params
// ─────────────────────────────────────────────────────────
const parseFilter = (query) => {
  const { tglAwal, tglAkhir, gudang = "" } = query;
  if (!tglAwal || !tglAkhir) {
    throw new Error("Parameter tglAwal dan tglAkhir wajib diisi.");
  }
  return { tglAwal, tglAkhir, gudang };
};

// ─────────────────────────────────────────────────────────
// GET BROWSE
// GET /api/penjualan/jadwal-kirim?tglAwal=&tglAkhir=&gudang=
// ─────────────────────────────────────────────────────────
const getBrowse = async (req, res) => {
  try {
    const filter = parseFilter(req.query);
    const data = await jadwalKirimService.getBrowse(filter);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET DETAIL (expand per baris)
// GET /api/penjualan/jadwal-kirim/:nomor/detail
// ─────────────────────────────────────────────────────────
const getDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await jadwalKirimService.getDetail(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET DETAIL BY FILTER
// GET /api/penjualan/jadwal-kirim/detail-by-filter?tglAwal=&tglAkhir=&gudang=
// Dipakai frontend untuk export detail via excelExport.ts
// ─────────────────────────────────────────────────────────
const getDetailByFilter = async (req, res) => {
  try {
    const filter = parseFilter(req.query);
    const data = await jadwalKirimService.getDetailByFilter(filter);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET LOOKUP GUDANG
// GET /api/penjualan/jadwal-kirim/lookup/gudang
// ─────────────────────────────────────────────────────────
const getListGudang = async (req, res) => {
  try {
    const divisi = req.query.divisi ? Number(req.query.divisi) : null;
    const data = await jadwalKirimService.getListGudang(divisi);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// DELETE
// DELETE /api/penjualan/jadwal-kirim/:nomor
// ─────────────────────────────────────────────────────────
const deleteData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const userKode = req.user?.kode || req.user?.user_kode || "";
    await jadwalKirimService.deleteData(nomor, userKode);
    res.json({ success: true, message: "Data berhasil dihapus." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getCetak = async (req, res) => {
  try {
    const filter = parseFilter(req.query);
    const data = await jadwalKirimService.getDataCetak(filter);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// TUNDA PENGIRIMAN
// POST /api/penjualan/jadwal-kirim/:nomor/tunda
// Hanya bagian KIRIM yang boleh menunda
// ─────────────────────────────────────────────────────────
const tundaData = async (req, res) => {
  try {
    // ⚠️ KONFIRMASI: apakah field & value ini benar untuk representasikan
    // "bagian KIRIM"? Disesuaikan dari pola cek role di mintaHargaController
    const bagianUser = (req.user?.bagian || "").toUpperCase();
    if (bagianUser !== "KIRIM") {
      return res.status(403).json({
        success: false,
        message: "Hanya bagian Kirim yang dapat menunda jadwal pengiriman.",
      });
    }

    const { nomor } = req.params;
    const { alasan } = req.body;
    const userKode = req.user?.kode || req.user?.user_kode || "";

    const result = await jadwalKirimService.tundaData(nomor, alasan, userKode);
    res.json({
      success: true,
      message: `Jadwal berhasil ditunda. Nomor baru: ${result.nomorBaru}`,
      data: result,
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = {
  getBrowse,
  getDetail,
  getDetailByFilter,
  getListGudang,
  deleteData,
  getCetak,
  tundaData,
};
