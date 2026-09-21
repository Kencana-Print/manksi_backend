const pengajuanUangMukaService = require("../../services/pembelian/pengajuanUangMukaService");

const create = async (req, res) => {
  try {
    const { tanggal, keterangan, items } = req.body;
    const result = await pengajuanUangMukaService.createPengajuan(
      { tanggal, keterangan, items },
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

module.exports = { create, getBrowse, getDetail };
