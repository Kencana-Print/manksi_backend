const svc = require("../../services/penjualan/invoiceService");

const getBrowse = async (req, res) => {
  try {
    const { tglAwal, tglAkhir } = req.query;
    const data = await svc.getBrowse(tglAwal, tglAkhir);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getBrowseDetail = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, nomor = "" } = req.query;
    const data = await svc.getBrowseDetail(tglAwal, tglAkhir, nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const cekBisaHapus = async (req, res) => {
  try {
    const { nomor } = req.query;
    const data = await svc.cekBisaHapus(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const deleteData = async (req, res) => {
  try {
    const { nomor } = req.params;
    await svc.deleteData(nomor);
    res.json({ success: true, message: "Berhasil dihapus." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getPengajuanStatus = async (req, res) => {
  try {
    const { nomor } = req.query;
    const data = await svc.getPengajuanStatus(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const cekPerluPengajuan = async (req, res) => {
  try {
    const { nomor } = req.query;
    const data = await svc.cekPerluPengajuan(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const pengajuanUbah = async (req, res) => {
  try {
    const { nomor, tanggal, namaCustomer, alasan, urut } = req.body;
    const userKode = req.user?.kode || req.user?.user_kode || "";
    await svc.pengajuanUbah(
      nomor,
      tanggal,
      namaCustomer,
      alasan,
      urut,
      userKode,
    );
    res.json({ success: true, message: "Berhasil diajukan. Menunggu ACC." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getStatusInfo = async (req, res) => {
  try {
    const { nomor } = req.query;
    const data = await svc.getStatusInfo(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const saveStatusUpdate = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { penerima, tglTerima, rencanaBayar } = req.body;
    await svc.saveStatusUpdate(nomor, penerima, tglTerima, rencanaBayar);
    res.json({ success: true, message: "Berhasil diupdate." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const cekBisaCetak = async (req, res) => {
  try {
    const { nomor } = req.query;
    const data = await svc.cekBisaCetak(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const cekBisaUbah = async (req, res) => {
  try {
    const { nomor } = req.query;
    const data = await svc.cekBisaUbah(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getExportData = async (req, res) => {
  try {
    const { tglAwal, tglAkhir } = req.query;
    const data = await svc.getExportData(tglAwal, tglAkhir);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getExportDetail = async (req, res) => {
  try {
    const { tglAwal, tglAkhir } = req.query;
    const data = await svc.getExportDetail(tglAwal, tglAkhir);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  cekBisaHapus,
  deleteData,
  getPengajuanStatus,
  cekPerluPengajuan,
  pengajuanUbah,
  getStatusInfo,
  saveStatusUpdate,
  cekBisaCetak,
  cekBisaUbah,
  getExportData,
  getExportDetail,
};
