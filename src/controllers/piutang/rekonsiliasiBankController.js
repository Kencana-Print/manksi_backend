const svc = require("../../services/piutang/rekonsiliasiBankService");

const getBrowse = async (req, res) => {
  try {
    const { tanggal } = req.query;
    const data = await svc.getBrowse(tanggal);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const deleteData = async (req, res) => {
  try {
    const { rekKode } = req.params;
    const { tanggal } = req.query;
    await svc.deleteData(rekKode, tanggal);
    res.json({ success: true, message: "Berhasil dihapus." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getValidasi = async (req, res) => {
  try {
    const { rekKode } = req.params;
    const { tanggal } = req.query;
    const data = await svc.getValidasi(rekKode, tanggal);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const saveValidasi = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const { rekKode } = req.params;
    const { tanggal, saldoKoran } = req.body;
    await svc.saveValidasi(rekKode, tanggal, saldoKoran, { kode: userKode });
    res.json({ success: true, message: "Berhasil disimpan." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getRekon = async (req, res) => {
  try {
    const { rekKode } = req.params;
    const { tanggal } = req.query;
    const data = await svc.getRekon(rekKode, tanggal);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const saveRekon = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const { rekKode } = req.params;
    const { tanggal, saldoBuku, saldoKoran, detail } = req.body;
    await svc.saveRekon(rekKode, tanggal, saldoBuku, saldoKoran, detail, {
      kode: userKode,
    });
    res.json({ success: true, message: "Berhasil disimpan." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = {
  getBrowse,
  deleteData,
  getValidasi,
  saveValidasi,
  getRekon,
  saveRekon,
};
