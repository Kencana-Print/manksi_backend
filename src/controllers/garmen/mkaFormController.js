// controllers/garmen/mkaFormController.js
const svc = require("../../services/garmen/mkaFormService");

const getDetail = async (req, res) => {
  try {
    const { nomor } = req.query;
    if (!nomor) return res.status(400).json({ message: "Nomor wajib diisi" });
    const data = await svc.getDetail(nomor);
    if (!data) return res.status(404).json({ message: "Data tidak ditemukan" });
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Dipanggil saat user memilih/mengetik nomor SPK di form
const getSpkInfo = async (req, res) => {
  try {
    const { spkNomor } = req.query;
    if (!spkNomor)
      return res.status(400).json({ message: "SPK nomor wajib diisi" });
    const result = await svc.getSpkInfo(spkNomor);
    if (!result.exists) return res.status(404).json({ message: result.error });
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Lookup kode bahan untuk search modal / ketik kode langsung
const getAksesorisMaster = async (req, res) => {
  try {
    const { search = "" } = req.query;
    const rows = await svc.getAksesorisMaster(search);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Resolve satu kode bahan (dipanggil setelah user pilih dari modal atau ketik kode)
const getAksesorisByKode = async (req, res) => {
  try {
    const { kode, spkJumlah = 0, excludeMkaNomor = "" } = req.query;
    if (!kode) return res.status(400).json({ message: "Kode wajib diisi" });
    const data = await svc.getAksesorisByKode(
      kode,
      parseFloat(spkJumlah),
      excludeMkaNomor,
    );
    if (!data)
      return res.status(404).json({ message: "Kode bahan tidak ditemukan" });
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const saveData = async (req, res) => {
  try {
    const userKode = req.user?.kode || "";
    const result = await svc.saveData(req.body, userKode);
    res.json(result);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const deleteData = async (req, res) => {
  try {
    const { nomor } = req.query;
    if (!nomor) return res.status(400).json({ message: "Nomor wajib diisi" });
    await svc.deleteData(nomor);
    res.json({ message: "Berhasil dihapus" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getDetail,
  getSpkInfo,
  getAksesorisMaster,
  getAksesorisByKode,
  saveData,
  deleteData,
};
