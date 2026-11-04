const svc = require("../../services/ppic/lhkMarkerFormService");
const permintaanSvc = require("../../services/garmen/permintaanMarkerFormService");

const getDetail = async (req, res) => {
  try {
    const data = await svc.getDetail(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const userKode = req.user?.kode || "ADMIN";
    const result = await svc.saveData(req.body, { kode: userKode }, false);
    res.status(200).json({
      success: true,
      message: "LHK Marker berhasil disimpan.",
      data: result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const update = async (req, res) => {
  try {
    const userKode = req.user?.kode || "ADMIN";
    const payload = { ...req.body, nomor: req.params.nomor };
    const result = await svc.saveData(payload, { kode: userKode }, true);
    res.status(200).json({
      success: true,
      message: "LHK Marker berhasil diupdate.",
      data: result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const remove = async (req, res) => {
  try {
    await svc.deleteData(req.params.nomor);
    res
      .status(200)
      .json({ success: true, message: "LHK Marker berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const searchSpk = async (req, res) => {
  try {
    const { q = "" } = req.query;
    const data = await svc.searchSpk(q);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getSpkByNomor = async (req, res) => {
  try {
    const data = await svc.getSpkByNomor(req.params.nomor);
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "SPK/MAP tidak ditemukan." });
    }
    const divisiNama = await svc.getDivisiNama(data.Divisi);
    res
      .status(200)
      .json({ success: true, data: { ...data, DivisiNama: divisiNama } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const uploadGambar = async (req, res) => {
  try {
    if (!req.file) throw new Error("File gambar tidak ditemukan.");
    const { lhkNomor, tab, spkNomor } = req.body;

    if (!lhkNomor || !tab || !spkNomor) {
      throw new Error("Nomor LHK Marker, Tab, dan No. SPK harus disertakan.");
    }

    const filename = await svc.uploadGambarDetail(
      req.file.path,
      lhkNomor,
      tab,
      spkNomor,
    );
    res
      .status(200)
      .json({ success: true, message: "Gambar berhasil diupload.", filename });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Aksi PIC atas Permintaan Marker (logika tulis tetap di permintaanMarkerFormService)
const aksiPermintaan = (fn) => async (req, res) => {
  try {
    if (!req.user?.kode) {
      return res
        .status(401)
        .json({ success: false, message: "User tidak dikenali." });
    }
    const data = await fn(req.params.nomor, { kode: req.user.kode });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res
      .status(error.statusCode || 400)
      .json({ success: false, message: error.message });
  }
};

const ambilPermintaan = aksiPermintaan((nomor, user) =>
  permintaanSvc.ambil(nomor, user),
);
const ambilAlihPermintaan = aksiPermintaan((nomor, user) =>
  permintaanSvc.ambilAlih(nomor, user),
);
const lepasPermintaan = aksiPermintaan((nomor, user) =>
  permintaanSvc.lepas(nomor, user),
);

const getTandaTerima = async (req, res) => {
  try {
    const data = await svc.getTandaTerima(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res
      .status(error.statusCode || 400)
      .json({ success: false, message: error.message });
  }
};

const cetakTandaTerima = async (req, res) => {
  try {
    if (!req.user?.kode) {
      return res
        .status(401)
        .json({ success: false, message: "User tidak dikenali." });
    }
    const data = await svc.cetakTandaTerima(req.params.nomor, {
      kode: req.user.kode,
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res
      .status(error.statusCode || 400)
      .json({ success: false, message: error.message });
  }
};

module.exports = {
  getDetail,
  save,
  update,
  remove,
  searchSpk,
  getSpkByNomor,
  uploadGambar,
  ambilPermintaan,
  ambilAlihPermintaan,
  lepasPermintaan,
  getTandaTerima,
  cetakTandaTerima,
};
