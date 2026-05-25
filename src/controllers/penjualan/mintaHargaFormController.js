const mintaHargaFormService = require("../../services/penjualan/mintaHargaFormService");
const fs = require("fs");

const getKalkulasiMetadata = async (req, res) => {
  try {
    const { model, jenisKain, warna, qty } = req.query;

    // Validasi sederhana
    if (!model || !jenisKain || !warna || !qty) {
      return res.status(400).json({
        success: false,
        message: "Parameter model, jenisKain, warna, dan qty harus diisi.",
      });
    }

    const data = await mintaHargaFormService.getKalkulasiMetadata(
      model,
      jenisKain,
      warna,
      Number(qty),
    );

    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getById = async (req, res) => {
  try {
    const data = await mintaHargaFormService.getById(
      req.params.nomor,
      req.user,
    );
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan" });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const { isNewMode, data } = req.body;

    // 1. Validasi Basic Delphi
    if (!data.NamaPekerjaan)
      return res
        .status(400)
        .json({ success: false, message: "Nama Perkerjaan belum di isi" });
    if (!data.CustKode)
      return res
        .status(400)
        .json({ success: false, message: "Customer belum di isi" });
    if (!data.SalesKode)
      return res
        .status(400)
        .json({ success: false, message: "Sales belum di isi" });

    // 2. Validasi Tanggal (Weekend & Jam 5 Sore)
    if (isNewMode) {
      const inputDate = new Date(data.Tanggal);
      const day = inputDate.getDay();
      if (day === 0 || day === 6) {
        return res.status(400).json({
          success: false,
          message:
            "Hari sabtu dan minggu libur. Masukkan inputan ke hari senin saja.",
        });
      }

      const now = new Date();
      // cCekJam5 Delphi logic
      if (
        now.getHours() >= 17 &&
        inputDate.toDateString() === now.toDateString()
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Sudah lewat jam 5 sore. Masukkan inputan ke hari berikutnya.",
        });
      }
    }

    // 3. Validasi PIN 5
    if (!isNewMode && ["MINTA", "WAIT", "TOLAK"].includes(data.StatusEdit)) {
      return res.status(400).json({
        success: false,
        message:
          "Transaksi sudah diclose. Silahkan minta approve untuk menyimpan perubahan data.",
      });
    }

    const nomor = await mintaHargaFormService.save(
      data,
      req.user.kode,
      req.user.cabang,
      isNewMode,
    );

    res
      .status(200)
      .json({ success: true, message: "Berhasil disimpan", nomor });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const uploadImage = async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "Tidak ada file yang diunggah." });
    }

    const { nomor } = req.params;
    const cabang = req.user.cabang; // Diperlukan untuk penempatan folder

    if (!nomor || !cabang) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: "Nomor Minta Harga atau Cabang tidak valid.",
      });
    }

    const finalPath = await mintaHargaFormService.processImage(
      req.file.path,
      nomor,
      cabang,
    );

    // URL publik yang bisa diakses dari frontend
    const imageUrl = `/images/${cabang}/mintaharga/${nomor}.jpg`;

    res.status(200).json({
      success: true,
      message: "Gambar berhasil diunggah.",
      imageUrl: imageUrl,
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

module.exports = { getById, save, uploadImage, getKalkulasiMetadata };
