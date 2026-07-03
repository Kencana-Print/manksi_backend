const svc = require("../../services/garmen/mutasiProduksiService");

// ─────────────────────────────────────────────────────────
// HELPER parse filter
// ─────────────────────────────────────────────────────────
const parseFilter = (query) => {
  const { tglAwal, tglAkhir, cab = "ALL", lini = "" } = query;
  if (!tglAwal || !tglAkhir) {
    throw new Error("Parameter tglAwal dan tglAkhir wajib diisi.");
  }
  return { tglAwal, tglAkhir, cab, lini };
};

// ─────────────────────────────────────────────────────────
// GET BROWSE
// GET /api/garmen/mutasi-produksi?tglAwal=&tglAkhir=&cab=&lini=
// ─────────────────────────────────────────────────────────
const getBrowse = async (req, res) => {
  try {
    const filter = parseFilter(req.query);
    const data = await svc.getBrowse(filter);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET DETAIL (expand per baris)
// GET /api/garmen/mutasi-produksi/:nomor/detail
// ─────────────────────────────────────────────────────────
const getDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await svc.getDetail(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET DETAIL BY FILTER (untuk export detail)
// GET /api/garmen/mutasi-produksi/detail-by-filter?...
// ─────────────────────────────────────────────────────────
const getDetailByFilter = async (req, res) => {
  try {
    const filter = parseFilter(req.query);
    const data = await svc.getDetailByFilter(filter);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET LOOKUP GUDANG PRODUKSI
// GET /api/garmen/mutasi-produksi/lookup/gudang-produksi?cab=
// ─────────────────────────────────────────────────────────
const getListGudangProduksi = async (req, res) => {
  try {
    const cab = req.query.cab || "";
    const data = await svc.getListGudangProduksi(cab);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET LIST CABANG
// GET /api/garmen/mutasi-produksi/lookup/cabang
// ─────────────────────────────────────────────────────────
const getListCabang = async (req, res) => {
  try {
    const data = await svc.getListCabang();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// DELETE
// DELETE /api/garmen/mutasi-produksi/:nomor
// ─────────────────────────────────────────────────────────
const deleteData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const userCab = req.user?.cabang || "";
    await svc.deleteData(nomor, userKode, userCab);
    res.json({ success: true, message: "Data berhasil dihapus." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET PIN5 STATUS (sebelum buka form pengajuan)
// GET /api/garmen/mutasi-produksi/:nomor/pin5-status?jenis=
// ─────────────────────────────────────────────────────────
const getPin5Status = async (req, res) => {
  try {
    const { nomor } = req.params;
    const jenis = req.query.jenis || "MUTASI PRODUKSI";
    const data = await svc.getPin5Status(nomor, jenis);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/garmen/mutasi-produksi/:nomor/perlu-pengajuan
const cekPerluPengajuan = async (req, res) => {
  try {
    const { nomor } = req.params;
    const perlu = await svc.cekPerluPengajuan(nomor);
    res.json({ success: true, data: { perlu } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// PENGAJUAN UBAH
// POST /api/garmen/mutasi-produksi/:nomor/pengajuan-ubah
// body: { alasan, urut }
// ─────────────────────────────────────────────────────────
const pengajuanUbah = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { alasan, urut } = req.body;
    const userKode = req.user?.kode || req.user?.user_kode || "";

    if (!alasan?.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Alasan harus diisi." });
    }

    await svc.pengajuanUbah(nomor, userKode, alasan, urut || 1);
    res.json({ success: true, message: "Berhasil diajukkan. Nunggu ACC." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// PENGAJUAN HAPUS
// POST /api/garmen/mutasi-produksi/:nomor/pengajuan-hapus
// body: { alasan, urut }
// ─────────────────────────────────────────────────────────
const pengajuanHapus = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { alasan, urut } = req.body;
    const userKode = req.user?.kode || req.user?.user_kode || "";

    if (!alasan?.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Alasan harus diisi." });
    }

    await svc.pengajuanHapus(nomor, userKode, alasan, urut || 1);
    res.json({ success: true, message: "Berhasil diajukkan. Nunggu ACC." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = {
  getBrowse,
  getDetail,
  getDetailByFilter,
  getListGudangProduksi,
  getListCabang,
  deleteData,
  getPin5Status,
  cekPerluPengajuan,
  pengajuanUbah,
  pengajuanHapus,
};
