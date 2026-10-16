const svc = require("../../services/penjualan/approvalSjService");

const getBrowse = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, cabang = "", gudang = "" } = req.query;
    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1;
    const data = await svc.getBrowse(
      tglAwal,
      tglAkhir,
      cabang,
      canLihatCus,
      gudang,
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getBrowseDetail = async (req, res) => {
  try {
    const {
      tglAwal,
      tglAkhir,
      cabang = "",
      nomor = "",
      gudang = "",
    } = req.query;
    const data = await svc.getBrowseDetail(
      tglAwal,
      tglAkhir,
      cabang,
      nomor,
      gudang,
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getAllNotApproved = async (req, res) => {
  try {
    const { gudang = "" } = req.query;
    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1;
    const data = await svc.getAllNotApproved(canLihatCus, gudang);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const approveSingle = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await svc.approveSingle(nomor);
    res.json({ success: true, data: result, message: "Sukses." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const setPending = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await svc.setPending(nomor);
    res.json({ success: true, data: result, message: "Sukses." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const batalSj = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await svc.batalSj(nomor);
    res.json({ success: true, data: result, message: "Sukses." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getBulkList = async (req, res) => {
  try {
    const { divisi = "", cabang = "", gudang = "" } = req.query;
    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1;
    const data = await svc.getBulkList(divisi, cabang, canLihatCus, gudang);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const approveBulk = async (req, res) => {
  try {
    const { nomorList } = req.body;
    const result = await svc.approveBulk(nomorList);
    res.json({ success: true, data: result, message: "Selesai." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getExportData = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, cabang = "", gudang = "" } = req.query;
    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1;
    const data = await svc.getExportData(
      tglAwal,
      tglAkhir,
      cabang,
      canLihatCus,
      gudang,
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getExportDetail = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, cabang = "", gudang = "" } = req.query;
    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1;
    const data = await svc.getExportDetail(
      tglAwal,
      tglAkhir,
      cabang,
      canLihatCus,
      gudang,
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDivisiList = async (req, res) => {
  try {
    const data = await svc.getDivisiList();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  getAllNotApproved,
  approveSingle,
  setPending,
  batalSj,
  getBulkList,
  approveBulk,
  getExportData,
  getExportDetail,
  getDivisiList,
};
