const penawaranFormService = require("../../services/penjualan/penawaranFormService");
const fs = require("fs");

const getById = async (req, res) => {
  try {
    const { nomor } = req.params;
    // Jika format nomor mengandung /, express menerimanya sebagai URL encoded
    const decodedNomor = decodeURIComponent(nomor);

    const data = await penawaranFormService.getById(decodedNomor);
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Data Penawaran tidak ditemukan." });
    }

    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const { isNewMode, data } = req.body;

    if (
      !data.PerushKode ||
      !data.CustKode ||
      !data.SalesKode ||
      !data.Details ||
      data.Details.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Perusahaan, Customer, Sales, dan Detail wajib diisi.",
      });
    }

    const nomorSaved = await penawaranFormService.save(
      data,
      req.user, // ✅ kirim objek user lengkap (bukan cuma kode) — dibutuhkan untuk cek hak CMO di service
      isNewMode,
    );

    res.status(200).json({
      success: true,
      nomor: nomorSaved,
      message: "Data Penawaran berhasil disimpan.",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const loadMintaHarga = async (req, res) => {
  try {
    // Tangkap nomor dan decode (jaga-jaga kalau formatnya mengandung garis miring)
    const nomorMintaHarga = decodeURIComponent(req.params.nomor);

    // Panggil fungsi service yang tadi baru kita tambahkan
    const data =
      await penawaranFormService.getMintaHargaDetail(nomorMintaHarga);

    res.status(200).json({ success: true, data });
  } catch (error) {
    // Kalau errornya dari validasi kita (contoh: status CANCEL / Harga 0), pakai status 400
    const statusCode =
      error.message.includes("tidak ditemukan") ||
      error.message.includes("dicancel") ||
      error.message.includes("Belum ada kalkulasi")
        ? 400
        : 500;

    res.status(statusCode).json({ success: false, message: error.message });
  }
};

const uploadImage = async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "Tidak ada file yang diunggah." });
    }

    const cabang = req.user.cabang; // Diperlukan untuk penempatan folder
    if (!cabang) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res
        .status(400)
        .json({ success: false, message: "Cabang tidak valid." });
    }

    // Proses gambar menggunakan service
    const fileName = await penawaranFormService.processImage(
      req.file.path,
      cabang,
    );

    // URL publik yang bisa diakses dari frontend dan disimpan ke database
    const imageUrl = `/images/${cabang}/penawaran/${fileName}`;

    res.status(200).json({
      success: true,
      message: "Gambar berhasil diunggah.",
      filename: imageUrl, // Frontend kita (di prompt sebelumnya) mengharapkan field 'filename'
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {}
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getById,
  save,
  loadMintaHarga,
  uploadImage,
};
