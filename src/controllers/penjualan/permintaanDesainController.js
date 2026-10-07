const service = require("../../services/penjualan/permintaanDesainService");

const getBrowse = async (req, res) => {
  try {
    const data = await service.getBrowse(req.query);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const data = await service.getDetail(req.params.nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateDesainer = async (req, res) => {
  try {
    if (hanyaDesain(req, res)) return;
    const data = await service.updateDesainer(req.params.nomor, {
      pd2Id: req.body.pd2Id,
      desainerKode: req.body.desainerKode,
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const setStatusManual = async (req, res) => {
  try {
    const data = await service.setStatusManual(req.params.nomor, {
      status: req.body.status,
      keterangan: req.body.keterangan,
      referensi: req.body.referensi,
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const resumeStatus = async (req, res) => {
  try {
    const data = await service.resumeStatus(req.params.nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const searchReferensi = async (req, res) => {
  try {
    const data = await service.searchReferensi(req.query);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDesainerOptions = async (req, res) => {
  try {
    const data = await service.getDesainerOptions();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateHeader = async (req, res) => {
  try {
    const data = await service.updateHeader(
      req.params.nomor,
      req.body,
      req.user,
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getAntrean = async (req, res) => {
  try {
    if (hanyaDesain(req, res)) return;
    const data = await service.getAntrean(req.user);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const mulaiKerja = async (req, res) => {
  try {
    if (hanyaDesain(req, res)) return;
    const data = await service.mulaiKerja(
      req.params.pd2Id,
      req.body.jml,
      req.user,
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const updateKerja = async (req, res) => {
  try {
    if (hanyaDesain(req, res)) return;
    const data = await service.updateKerja(
      req.params.kerjaId,
      req.body.jml,
      req.user,
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const batalKerja = async (req, res) => {
  try {
    if (hanyaDesain(req, res)) return;
    const data = await service.batalKerja(req.params.kerjaId, req.user);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const closeKerja = async (req, res) => {
  try {
    if (hanyaDesain(req, res)) return;
    const data = await service.closeKerja(req.body.kerjaIds, req.user);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const ambilAlih = async (req, res) => {
  try {
    if (hanyaDesain(req, res)) return;
    const data = await service.ambilAlih(req.params.kerjaId, req.user);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const closePD = async (req, res) => {
  try {
    if (hanyaDesain(req, res)) return;
    const data = await service.closePD(
      req.params.nomor,
      { soMapNomor: req.body.soMapNomor, path: req.body.path },
      req.user,
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const bukaKembali = async (req, res) => {
  try {
    const data = await service.bukaKembali(req.params.nomor, req.user);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const BAGIAN_DESAIN_OK = ["DESAIN", "EDP", "AUDIT"];
const hanyaDesain = (req, res) => {
  const bagian = String(req.user?.bagian || "")
    .toUpperCase()
    .trim();
  if (!BAGIAN_DESAIN_OK.includes(bagian)) {
    res.status(403).json({
      success: false,
      message: "Hanya bagian Desain yang dapat melakukan ini",
    });
    return true;
  }
  return false;
};

module.exports = {
  getBrowse,
  getDetail,
  updateDesainer,
  setStatusManual,
  resumeStatus,
  searchReferensi,
  getDesainerOptions,
  updateHeader,
  getAntrean,
  closePD,
  bukaKembali,
  mulaiKerja,
  updateKerja,
  batalKerja,
  closeKerja,
  ambilAlih,
};
