const svc = require("../../../services/laporan/finance/kasbonBelumSelesaiService");

const getDefaultAccount = (req, res) => {
  const { cabang } = req.query;
  const kode = svc.getDefaultAccount(cabang);
  res.json({ success: true, data: { kode } });
};

const searchAccount = async (req, res) => {
  try {
    const { cabang, search } = req.query;
    const data = await svc.searchAccount(cabang, search || "");
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getAccountByKode = async (req, res) => {
  try {
    const data = await svc.getAccountByKode(req.params.kode);
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Account tidak ditemukan." });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getKasbonBelumSelesai = async (req, res) => {
  try {
    const { rekkode } = req.query;
    if (!rekkode) {
      return res
        .status(400)
        .json({ success: false, message: "Account wajib diisi." });
    }
    const data = await svc.getKasbonBelumSelesai(rekkode);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getDefaultAccount,
  searchAccount,
  getAccountByKode,
  getKasbonBelumSelesai,
};
