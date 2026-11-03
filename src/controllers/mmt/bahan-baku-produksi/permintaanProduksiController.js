// backend/src/controllers/permintaanProduksi.controller.js

const permintaanProduksiService = require("../../../services/mmt/bahan-baku-produksi/permintaanProduksiService");

exports.getDetailByNomor = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await permintaanProduksiService.getPermintaanProduksiDataByNomor(nomor);
        if (!data) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 1. READ ALL (Browse)
exports.getPermintaanProduksi = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate)
      return res.status(400).json({ message: "Tanggal wajib diisi." });

    // SESUAIKAN DI SINI:
    // Karena di Auth Service payloadnya adalah 'divisi', maka ambil req.user.divisi
    const userDivisi = req.user ? req.user.divisi : null;

    const data = await permintaanProduksiService.getPermintaanProduksiData(
      startDate,
      endDate,
      userDivisi,
    );

    return res.status(200).json({
      success: true,
      message: "Pengambilan data transaksi berhasil.",
      data: data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Gagal mengambil data transaksi.",
      error: error.message,
    });
  }
};

// 2. DELETE
exports.deletePermintaanProduksi = async (req, res) => {
  try {
    const { nomor } = req.params;
    // Asumsi cek hak akses dilakukan di sini
    const isDeleted =
      await permintaanProduksiService.deletePermintaanProduksi(nomor);

    if (isDeleted)
      return res
        .status(200)
        .json({ message: `Transaksi ${nomor} berhasil dihapus.` });
    return res.status(404).json({ message: `Nomor ${nomor} tidak ditemukan.` });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Gagal menghapus transaksi.", error: error.message });
  }
};

exports.getStokByBarcode = async (req, res) => {
  try {
    const { barcode } = req.params; // Mengambil dari :barcode
    const { gudang } = req.query; // Mengambil dari ?gudang=WH-16

    // Validasi jika gudang tidak dikirim
    if (!gudang) {
      return res.status(400).json({
        success: false,
        message: "Gudang asal harus ditentukan.",
      });
    }

    // Panggil service dengan 2 parameter
    const data = await permintaanProduksiService.getStokByBarcode(
      barcode,
      gudang,
    );

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Barang tidak ditemukan di gudang tersebut.",
      });
    }

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- 2. SAVE (POST/PUT) ---
exports.savePermintaanProduksi = async (req, res) => {
  try {
    const { header, details, isEditMode } = req.body;
    const isUpdate = isEditMode || req.method === "PUT";

    if (!header)
      return res.status(400).json({ message: "Header tidak ditemukan." });

    // AMBIL USER DARI TOKEN (Middleware Auth)
    const userLogin = req.user ? (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') : "SYSTEM";

    let Nomor = header.nomor && header.nomor !== "AUTO" ? header.nomor : null;

    const normalizedDetails = (details || []).map((d, index) => ({
      sku: d.sku,
      barcode: d.barcode,
      qty: parseFloat(d.qty || 0),
      satuan: d.satuan || null,
      spk: d.spk || "0",
      keterangan: d.keterangan || null,
      nourut: index + 1,
      panjang: parseFloat(d.panjang || d.Panjang || 0), // <-- Tambahkan mapping panjang
      lebar: parseFloat(d.lebar || d.Lebar || 0), // <-- Tambahkan mapping lebar
    }));

    const serviceData = {
      Nomor,
      Gudang: header.mnt_gdg_kode,
      LokasiProduksi: header.mnt_lokasiproduksi,
      Tanggal: header.tanggal,
      Keterangan: header.mnt_keterangan || null,
      Permintaan: header.mnt_permintaan || null,
      Details: normalizedDetails,
    };

    // Kirim userLogin sebagai parameter ke-3
    const result = await permintaanProduksiService.savePermintaanProduksi(
      serviceData,
      isUpdate,
      userLogin,
    );
    return res
      .status(200)
      .json({ message: "Berhasil disimpan", nomor: result.nomor });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Gagal simpan.", error: error.message });
  }
};
