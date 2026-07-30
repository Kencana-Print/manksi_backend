const svc = require("../../services/penjualan/suratJalanFormService");

const getById = async (req, res) => {
  try {
    const data = await svc.getById(req.query.nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getSpkDetail = async (req, res) => {
  try {
    const {
      spkNomor,
      cusKode,
      divisi,
      excludeNomor = "",
      existingSpkNomors = [],
    } = req.body;
    const data = await svc.getSpkDetail(
      spkNomor,
      cusKode,
      divisi,
      excludeNomor,
      existingSpkNomors,
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getSpkDetailFromJadwal = async (req, res) => {
  try {
    const {
      spkNomor,
      divisi,
      excludeNomor = "",
      noKirim = "",
      idKirim = 0,
      uraian = "",
    } = req.body;
    const data = await svc.getSpkDetailFromJadwal(
      spkNomor,
      divisi,
      excludeNomor,
      noKirim,
      idKirim,
      uraian,
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getSpkList = async (req, res) => {
  try {
    const { cusKode, perushKode, divisi, invPro = "", q = "" } = req.query;
    const data = await svc.getSpkList(cusKode, perushKode, divisi, invPro, q);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getJadwalKirimList = async (req, res) => {
  try {
    const {
      cusKode,
      perushKode,
      divisi,
      invPro = "",
      q = "",
      page = 1,
      limit = 50,
    } = req.query;
    const data = await svc.getJadwalKirimList(
      cusKode,
      perushKode,
      divisi,
      invPro,
      q,
      Number(page),
      Number(limit),
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const cekPiutang = async (req, res) => {
  try {
    const { spkNomor, cusKode } = req.query;
    const data = await svc.cekPiutang(spkNomor, cusKode);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getAlokasiHistory = async (req, res) => {
  try {
    const data = await svc.getAlokasiHistory(req.query.cusKode);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getAlokasiSpk = async (req, res) => {
  try {
    const { spkNomor, page = 1, limit = 20, q = "" } = req.query;
    const data = await svc.getAlokasiSpk(spkNomor, page, limit, q);
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

const getInvProformaList = async (req, res) => {
  try {
    const { cusKode = "", q = "" } = req.query;
    const data = await svc.getInvProformaList(cusKode, q);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getRekeningPerush = async (req, res) => {
  try {
    const data = await svc.getRekeningPerush(req.query.perushKode);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const save = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const result = await svc.save(req.body, userKode, true);
    res.json({ success: true, data: result, message: "Berhasil disimpan." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const update = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const result = await svc.save(req.body, userKode, false);
    res.json({ success: true, data: result, message: "Berhasil diupdate." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getDataCetak = async (req, res) => {
  try {
    const data = await svc.getDataCetak(req.query.nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getKodeOtorisasi = async (req, res) => {
  try {
    const kode = svc.generateKodeOtorisasi();
    res.json({ success: true, data: { kode } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const submitOtorisasi = async (req, res) => {
  try {
    const { spkNomor, kodeOtorisasi, jawaban } = req.body;
    if (!spkNomor) {
      return res
        .status(400)
        .json({ success: false, message: "SPK wajib diisi." });
    }
    const result = await svc.validateOtorisasi(kodeOtorisasi, jawaban);
    if (!result.valid) {
      return res.status(400).json({ success: false, message: result.message });
    }
    await svc.saveOtorisasi(spkNomor, jawaban);
    res.json({ success: true, data: { otorisator: result.otorisator } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getById,
  getSpkDetail,
  getSpkDetailFromJadwal,
  getSpkList,
  getJadwalKirimList,
  cekPiutang,
  getAlokasiHistory,
  getAlokasiSpk,
  getDivisiList,
  getInvProformaList,
  getRekeningPerush,
  save,
  update,
  getDataCetak,
  getKodeOtorisasi,
  submitOtorisasi,
};
