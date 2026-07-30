const svc = require("../../../services/laporan/marketing/targetSpkService");

const getBrowse = async (req, res) => {
  try {
    const data = await svc.getBrowse(req.query);
    res.json({ success: true, data: data.rows, meta: data.meta });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getSettingList = async (req, res) => {
  try {
    const { tahun, divisi, salesKode = "", cusKode = "" } = req.query;
    const data = await svc.getSettingList(tahun, divisi, salesKode, cusKode);
    res.json({ success: true, data: data.rows, meta: data.meta });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const updateTarget = async (req, res) => {
  try {
    const { kode, tahun, divisi, target } = req.body;
    const result = await svc.updateTarget(kode, tahun, divisi, target);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const updateKodeSales = async (req, res) => {
  try {
    const { kode, kodeSales } = req.body;
    const result = await svc.updateKodeSales(kode, kodeSales);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = { getBrowse, getSettingList, updateTarget, updateKodeSales };
