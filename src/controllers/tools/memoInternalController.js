const fs = require("fs");
const svc = require("../../services/tools/memoInternalService");

const kirimError = (res, error) =>
  res
    .status(error.statusCode || 500)
    .json({ success: false, message: error.message });

// Siarkan ke semua klien yang terhubung (event "memo:berubah")
const siarkan = (req, payload) => {
  try {
    req.app.get("io")?.emit("memo:berubah", payload);
  } catch {
    // siaran tidak boleh menggagalkan request
  }
};

// Dipasang SEBELUM multer: user yang tidak berhak tidak sempat menulis file ke temp
const hanyaBagianUpload = (req, res, next) => {
  if (!svc.bolehUpload(req.user)) {
    return res.status(403).json({
      success: false,
      message: "Hanya bagian Audit, Direksi, dan EDP yang diizinkan.",
    });
  }
  next();
};

const getList = async (req, res) => {
  try {
    const data = await svc.getList(req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error);
  }
};

const getUnread = async (req, res) => {
  try {
    const data = await svc.getUnread(req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error);
  }
};

const simpan = async (req, res) => {
  try {
    const data = await svc.simpan(req.body, req.file, req.user);
    if (data.notif) {
      siarkan(req, {
        aksi: "baru",
        id: data.id,
        judul: data.judul,
        tanggal: data.tanggal,
        userKode: req.user.kode,
        userNama: req.user.nama || req.user.kode,
      });
    }
    res
      .status(201)
      .json({ success: true, message: "Memo berhasil diunggah.", data });
  } catch (error) {
    kirimError(res, error);
  }
};

const getFile = async (req, res) => {
  try {
    const { path: p, namaAsli } = await svc.getFile(req.params.id, req.user);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(namaAsli)}`,
    );
    fs.createReadStream(p).pipe(res);
  } catch (error) {
    kirimError(res, error);
  }
};

const hapus = async (req, res) => {
  try {
    await svc.hapus(req.params.id, req.user);
    siarkan(req, { aksi: "hapus", id: Number(req.params.id) });
    res.status(200).json({ success: true, message: "Memo dihapus." });
  } catch (error) {
    kirimError(res, error);
  }
};

module.exports = {
  hanyaBagianUpload,
  getList,
  simpan,
  getUnread,
  getFile,
  hapus,
};
