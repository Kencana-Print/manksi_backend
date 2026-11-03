const svc = require("../../services/garmen/cetakBarcodeKoliFormService");

const searchStbj = async (req, res) => {
  try {
    const { q = "", page = 1, limit = 50 } = req.query;
    const data = await svc.searchStbj({ q, page, limit });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    if (!nomor) {
      return res
        .status(400)
        .json({ success: false, message: "Nomor wajib diisi." });
    }
    const data = await svc.getDetail(nomor);
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Nomor tersebut belum ada." });
    }
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const cetakUlang = async (req, res) => {
  try {
    const result = await svc.cetakUlang(
      req.params.nomor,
      req.body?.koliIds,
      req.user,
      req.ip,
    );
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const voidKoli = async (req, res) => {
  try {
    const result = await svc.voidKoli(req.body || {}, req.user, req.ip);
    res.json({
      success: true,
      data: result,
      message: `${result.jumlah} koli berhasil di-VOID.`,
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = {
  searchStbj,
  getDetail,
  cetakUlang,
  voidKoli,
};
