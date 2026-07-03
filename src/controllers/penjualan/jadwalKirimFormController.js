const svc = require("../../services/penjualan/jadwalKirimFormService");

// GET /api/penjualan/jadwal-kirim-form/generate-nomor?tanggal=
const generateNomor = async (req, res) => {
  try {
    const { tanggal } = req.query;
    if (!tanggal)
      return res
        .status(400)
        .json({ success: false, message: "tanggal wajib diisi." });
    const nomor = await svc.generateNomor(tanggal);
    res.json({ success: true, data: { nomor } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/penjualan/jadwal-kirim-form/spk-info?nomor=&divisiUser=
const getSpkInfo = async (req, res) => {
  try {
    const { nomor, divisiUser = "0" } = req.query;
    if (!nomor)
      return res
        .status(400)
        .json({ success: false, message: "nomor wajib diisi." });

    const spk = await svc.getSpkInfo(nomor);
    if (!spk)
      return res
        .status(404)
        .json({ success: false, message: "Nomor SPK tidak ditemukan." });

    // Validasi cross-divisi (sesuai Delphi edtnospkExit)
    const dUser = parseInt(divisiUser, 10);
    const dSpk = parseInt(spk.divisi, 10);
    if (dUser === 1 && (dSpk === 3 || dSpk === 4)) {
      return res
        .status(400)
        .json({ success: false, message: "SPK ini milik divisi Garmen." });
    }
    if (dUser === 4 && (dSpk === 1 || dSpk === 5)) {
      return res
        .status(400)
        .json({ success: false, message: "SPK ini milik divisi Spanduk." });
    }

    res.json({ success: true, data: spk });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/penjualan/jadwal-kirim-form/sudah-dijadwalkan?nomorSpk=&excludeNomor=
const getSudahDijadwalkan = async (req, res) => {
  try {
    const { nomorSpk, excludeNomor = "" } = req.query;
    if (!nomorSpk)
      return res
        .status(400)
        .json({ success: false, message: "nomorSpk wajib diisi." });
    const sudah = await svc.getSudahDijadwalkan(nomorSpk, excludeNomor);
    res.json({ success: true, data: { sudah } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/penjualan/jadwal-kirim-form/planning-ppic?nomorSpk=
const getPlanningPpic = async (req, res) => {
  try {
    const { nomorSpk } = req.query;
    if (!nomorSpk) return res.json({ success: true, data: [] });
    const data = await svc.getPlanningPpic(nomorSpk);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/penjualan/jadwal-kirim-form/cek-kota?nomorSpk=&kota=&excludeNomor=
const cekDuplikatKota = async (req, res) => {
  try {
    const { nomorSpk, kota, excludeNomor = "" } = req.query;
    const existing = await svc.cekDuplikatKota(nomorSpk, kota, excludeNomor);
    res.json({
      success: true,
      data: { duplikat: !!existing, nomorKirim: existing },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const cekJadwalByTanggal = async (req, res) => {
  try {
    const { nomorSpk, tanggal } = req.query;
    const data = await svc.cekJadwalByTanggal(nomorSpk, tanggal);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/penjualan/jadwal-kirim-form/search-spk?q=&divisiUser=&page=&limit=
const searchSpk = async (req, res) => {
  try {
    const { q = "", divisiUser = "0", page = "1", limit = "30" } = req.query;
    const data = await svc.searchSpk(
      q,
      parseInt(divisiUser, 10),
      parseInt(page, 10),
      parseInt(limit, 10),
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/penjualan/jadwal-kirim-form/:nomor
const getById = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await svc.getById(nomor);
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan." });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/penjualan/jadwal-kirim-form
const save = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const isNewMode = !req.body.NomorKirim;
    const nomor = await svc.save(req.body, userKode, isNewMode);
    res.json({ success: true, data: { nomor }, message: "Berhasil disimpan." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// PUT /api/penjualan/jadwal-kirim-form/:nomor
const update = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const data = { ...req.body, NomorKirim: req.params.nomor };
    const nomor = await svc.save(data, userKode, false);
    res.json({ success: true, data: { nomor }, message: "Berhasil diupdate." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = {
  generateNomor,
  getSpkInfo,
  getSudahDijadwalkan,
  getPlanningPpic,
  cekDuplikatKota,
  cekJadwalByTanggal,
  searchSpk,
  getById,
  save,
  update,
};
