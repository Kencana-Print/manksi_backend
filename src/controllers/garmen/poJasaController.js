const svc = require("../../services/garmen/poJasaService");

// ─────────────────────────────────────────────────────────
// GET BROWSE
// GET /api/garmen/po-jasa?tglAwal=&tglAkhir=&cab=
// ─────────────────────────────────────────────────────────
const getBrowse = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, cab = "ALL" } = req.query;
    if (!tglAwal || !tglAkhir)
      return res
        .status(400)
        .json({ success: false, message: "tglAwal dan tglAkhir wajib." });
    const data = await svc.getBrowse(tglAwal, tglAkhir, cab);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET BROWSE DETAIL (all detail per periode)
// GET /api/garmen/po-jasa/detail-all?tglAwal=&tglAkhir=&cab=
// ─────────────────────────────────────────────────────────
const getBrowseDetail = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, cab = "ALL" } = req.query;
    if (!tglAwal || !tglAkhir)
      return res
        .status(400)
        .json({ success: false, message: "tglAwal dan tglAkhir wajib." });
    const data = await svc.getBrowseDetail(tglAwal, tglAkhir, cab);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET DETAIL BY NOMOR (expand row)
// GET /api/garmen/po-jasa/:nomor/detail
// ─────────────────────────────────────────────────────────
const getDetailByNomor = async (req, res) => {
  try {
    const nomor = req.params.nomor || req.query.nomor;
    const data = await svc.getDetailByNomor(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET BY NOMOR (form edit)
// GET /api/garmen/po-jasa/by-nomor?nomor=
// ─────────────────────────────────────────────────────────
const getById = async (req, res) => {
  try {
    const nomor = req.params.nomor || req.query.nomor;
    if (!nomor)
      return res.status(400).json({ success: false, message: "Nomor wajib." });
    const data = await svc.getById(nomor);
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan." });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// SAVE (INSERT)
// POST /api/garmen/po-jasa
// ─────────────────────────────────────────────────────────
const save = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const nomor = await svc.save(req.body, userKode, true);
    res.json({ success: true, data: { nomor }, message: "Berhasil disimpan." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// UPDATE (EDIT)
// PUT /api/garmen/po-jasa/by-nomor
// ─────────────────────────────────────────────────────────
const update = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const data = { ...req.body, Nomor: req.body.Nomor || req.params.nomor };
    const nomor = await svc.save(data, userKode, false);
    res.json({ success: true, data: { nomor }, message: "Berhasil diupdate." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// DELETE
// DELETE /api/garmen/po-jasa/:nomor
// ─────────────────────────────────────────────────────────
const deleteData = async (req, res) => {
  try {
    const userCab = req.user?.cabang || "";
    const nomor = req.params.nomor;
    await svc.deleteData(nomor, userCab);
    res.json({ success: true, message: "Berhasil dihapus." });
  } catch (err) {
    // "Perlu Pengajuan Hapus Data." → 400
    res.status(400).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// PENGAJUAN UBAH DATA
// POST /api/garmen/po-jasa/pengajuan-ubah
// body: { nomor, tanggal, keterangan, alasan }
// ─────────────────────────────────────────────────────────
const pengajuanUbah = async (req, res) => {
  try {
    const { nomor, tanggal, keterangan = "", alasan } = req.body;
    if (!nomor || !alasan)
      return res
        .status(400)
        .json({ success: false, message: "nomor dan alasan wajib." });
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const urut = await svc.pengajuanUbah(
      nomor,
      tanggal,
      keterangan,
      alasan,
      userKode,
    );
    res.json({
      success: true,
      data: { urut },
      message: "Berhasil diajukkan. Nunggu ACC.",
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// PENGAJUAN HAPUS DATA
// POST /api/garmen/po-jasa/pengajuan-hapus
// body: { nomor, tanggal, keterangan, alasan }
// ─────────────────────────────────────────────────────────
const pengajuanHapus = async (req, res) => {
  try {
    const { nomor, tanggal, keterangan = "", alasan } = req.body;
    if (!nomor || !alasan)
      return res
        .status(400)
        .json({ success: false, message: "nomor dan alasan wajib." });
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const urut = await svc.pengajuanHapus(
      nomor,
      tanggal,
      keterangan,
      alasan,
      userKode,
    );
    res.json({
      success: true,
      data: { urut },
      message: "Berhasil diajukkan. Nunggu ACC.",
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET JASA LIST (lookup)
// GET /api/garmen/po-jasa/lookup/jasa
// ─────────────────────────────────────────────────────────
const getJasaList = async (req, res) => {
  try {
    const data = await svc.getJasaList();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET GUDANG LIST (lookup)
// GET /api/garmen/po-jasa/lookup/gudang?cab=
// ─────────────────────────────────────────────────────────
const getGudangList = async (req, res) => {
  try {
    const { cab = "" } = req.query;
    const data = await svc.getGudangList(cab);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// EXPORT EXCEL MASTER
// GET /api/garmen/po-jasa/export?tglAwal=&tglAkhir=&cab=
// ─────────────────────────────────────────────────────────
const exportData = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, cab = "ALL" } = req.query;
    const data = await svc.getExportData(tglAwal, tglAkhir, cab);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// EXPORT EXCEL DETAIL
// GET /api/garmen/po-jasa/export-detail?tglAwal=&tglAkhir=&cab=
// ─────────────────────────────────────────────────────────
const exportDetail = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, cab = "ALL" } = req.query;
    const data = await svc.getExportDetail(tglAwal, tglAkhir, cab);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET DATA CETAK
// GET /api/garmen/po-jasa/cetak/:nomor
// ─────────────────────────────────────────────────────────
const getDataCetak = async (req, res) => {
  try {
    const data = await svc.getDataCetak(req.params.nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET DATA CETAK SJ
// GET /api/garmen/po-jasa/cetak-sj/:nomor
// ─────────────────────────────────────────────────────────
const getDataCetakSJ = async (req, res) => {
  try {
    const data = await svc.getDataCetakSJ(req.params.nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const approveData = async (req, res) => {
  try {
    const nomor = req.params.nomor || req.body.nomor;
    if (!nomor)
      return res.status(400).json({ success: false, message: "Nomor wajib." });
    await svc.approveData(nomor);
    res.json({ success: true, message: "Berhasil di-approve." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  getDetailByNomor,
  getById,
  save,
  update,
  deleteData,
  pengajuanUbah,
  pengajuanHapus,
  getJasaList,
  getGudangList,
  exportData,
  exportDetail,
  getDataCetak,
  getDataCetakSJ,
  approveData,
};
