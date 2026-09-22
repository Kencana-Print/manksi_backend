const pengajuanUangMukaService = require("../../services/pembelian/pengajuanUangMukaService");

const create = async (req, res) => {
  try {
    const { tanggal, keterangan, nota, nominalDiajukan, items } = req.body;
    const result = await pengajuanUangMukaService.createPengajuan(
      { tanggal, keterangan, nota, nominalDiajukan, items },
      req.user,
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, cabang, status } = req.query;
    const rows = await pengajuanUangMukaService.getBrowse({
      startDate,
      endDate,
      cabang,
      status,
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const rows = await pengajuanUangMukaService.getDetail(req.params.nomor);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const data = await pengajuanUangMukaService.getPrintData(
      req.params.nomor,
      req.user,
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(404).json({ success: false, message: err.message });
  }
};

module.exports = { create, getBrowse, getDetail, getPrintData };
