const svc = require("../../services/garmen/bpbJasaService");

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

const getDetailByNomor = async (req, res) => {
  try {
    const nomor = req.params.nomor || req.query.nomor;
    const data = await svc.getDetailByNomor(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

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

const save = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const nomor = await svc.save(req.body, userKode, true);
    res.json({ success: true, data: { nomor }, message: "Berhasil disimpan." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const update = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.user_kode || "";
    // Nomor bisa dari body, params, ATAU query
    const data = {
      ...req.body,
      Nomor: req.body.Nomor || req.params.nomor || req.query.nomor,
    };
    if (!data.Nomor) {
      return res.status(400).json({ success: false, message: "Nomor wajib." });
    }
    const nomor = await svc.save(data, userKode, false);
    res.json({ success: true, data: { nomor }, message: "Berhasil diupdate." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const deleteData = async (req, res) => {
  try {
    const userCab = req.user?.cabang || "";
    await svc.deleteData(req.params.nomor, userCab);
    res.json({ success: true, message: "Berhasil dihapus." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// POST /update-bayar-produksi
// body: { nomor, status }  — status: "Sudah" | "Belum"
const updateBayarProduksi = async (req, res) => {
  try {
    const { nomor, status } = req.body;
    if (!nomor || !status)
      return res
        .status(400)
        .json({ success: false, message: "nomor dan status wajib." });

    // Cek voucher dulu (sesuai Delphi: belum ada voucher → tidak bisa update)
    const noVoucher = await svc.cekVoucher(nomor);
    if (!noVoucher)
      return res
        .status(400)
        .json({ success: false, message: "Belum ada pembayaran." });

    const nilai = await svc.updateBayarProduksi(nomor, status);
    res.json({
      success: true,
      data: { bpj_bayar_realisasi: nilai },
      message: "Berhasil diupdate.",
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

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

const getDataCetak = async (req, res) => {
  try {
    const data = await svc.getDataCetak(req.params.nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const exportData = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, cab = "ALL" } = req.query;
    const data = await svc.getExportData(tglAwal, tglAkhir, cab);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const exportDetail = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, cab = "ALL" } = req.query;
    const data = await svc.getExportDetail(tglAwal, tglAkhir, cab);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const cekTutupBuku = async (req, res) => {
  try {
    const nomor = req.query.nomor || req.params.nomor;
    if (!nomor)
      return res.status(400).json({ success: false, message: "Nomor wajib." });
    const data = await svc.cekTutupBuku(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const cekBisaHapus = async (req, res) => {
  try {
    const nomor = req.query.nomor;
    if (!nomor)
      return res.status(400).json({ success: false, message: "Nomor wajib." });
    const bisaHapus = await svc.cekBisaHapus(nomor);
    res.json({ success: true, data: { bisaHapus } });
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
  updateBayarProduksi,
  pengajuanUbah,
  pengajuanHapus,
  getDataCetak,
  exportData,
  exportDetail,
  cekTutupBuku,
  cekBisaHapus,
};
