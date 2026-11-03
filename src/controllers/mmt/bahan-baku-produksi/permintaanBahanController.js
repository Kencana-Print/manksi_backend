// backend/src/controllers/permintaanBahan.controller.js

const permintaanBahanService = require("../../../services/mmt/bahan-baku-produksi/permintaanBahanService");
const { format } = require("date-fns");

exports.getPermintaanBahan = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const defaultStart = new Date();
    defaultStart.setDate(defaultStart.getDate() - 30);
    const start = startDate || format(defaultStart, "yyyy-MM-dd");
    const end = endDate || format(new Date(), "yyyy-MM-dd");

    // ==========================================================
    // 🌟 PERBAIKAN DI SINI: Sesuaikan dengan nama properti di JWT Payload
    // ==========================================================
    const divisi = req.user?.divisi !== undefined && req.user?.divisi !== null ? req.user.divisi : 0;
    const userManager = req.user?.user_manager || 0;

    // INGAT: Di auth.service namanya 'bagian', bukan 'user_bagian'
    const userBagian = req.user?.bagian ? req.user.bagian.toLowerCase() : "";

    // Kirim ke service dengan parameter yang sudah benar
    const data = await permintaanBahanService.getPermintaanBahanData(
      start,
      end,
      divisi,
      userManager,
      userBagian, // Parameter ke-5
    );

    return res.status(200).json({
      message: "Pengambilan data transaksi berhasil.",
      divisi_aktif: divisi,
      bagian_aktif: userBagian, // Sekarang ini tidak akan "" lagi
      is_manager: userManager === 1,
      data: data,
    });
  } catch (error) {
    console.error("Error Controller getPermintaanBahan:", error);
    return res.status(500).json({
      message: "Gagal mengambil data transaksi.",
      error: error.message,
    });
  }
};

exports.lookupPermintaanBahan = async (req, res) => {
  try {
    const { startDate, endDate, status } = req.query;

    // 30 hari yang lalu
    const defaultStartDate =
      startDate ||
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

    const defaultEndDate = endDate || new Date().toISOString().slice(0, 10);

    const data = await permintaanBahanService.getPermintaanBahanForLookup(
      defaultStartDate,
      defaultEndDate,
      status,
    );

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({
      message: "Gagal memuat data lookup Permintaan Bahan.",
      error: error.message,
    });
  }
};

exports.getPermintaanBahanByNomor = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await permintaanBahanService.getPermintaanBahanByNomor(nomor);

    if (!data || Object.keys(data).length === 0) {
      return res
        .status(404)
        .json({ message: "Data Permintaan Bahan tidak ditemukan." });
    }

    res.status(200).json(data);
  } catch (error) {
    // Tangkap error 404 dari service
    if (error.message.includes("tidak ditemukan")) {
      return res.status(404).json({ message: error.message });
    }
    console.error("Error fetching Permintaan Bahan by ID:", error);
    res
      .status(500)
      .json({
        message: "Gagal mengambil data transaksi.",
        error: error.message,
      });
  }
};

// 3. SAVE (POST/PUT)
// backend/src/controllers/permintaanBahan.controller.js

exports.savePermintaanBahan = async (req, res) => {
  try {
    const data = req.body;
    const nomorToEdit = data.NomorToEdit || null;

    // Pastikan mengambil key yang benar dari payload JWT (kdUser atau nmUser)
    // Jika di login payload pakai 'kdUser', maka ambil 'kdUser'
    const currentUser = req.user ? (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') : "SYSTEM";

    // Panggil service
    const result = await permintaanBahanService.savePermintaanBahan(
      data,
      nomorToEdit,
      currentUser,
    );

    res.status(200).json({
      message: "Data berhasil disimpan.",
      Nomor: result.Nomor,
      oleh: currentUser,
    });
  } catch (error) {
    res.status(400).json({ message: "Gagal Simpan.", error: error.message });
  }
};

exports.approvePermintaan = async (req, res) => {
  try {
    const { nomor, role } = req.body;

    // AMBIL USER DARI TOKEN (Sama seperti saat Save Data)
    // Jika payload JWT Anda namanya 'user_nama', maka: req.user.user_nama
    const userPengklik = req.user.user_nama || (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM');

    let success = false;
    if (role === "SPV") {
      success = await permintaanBahanService.approveBySPV(nomor, userPengklik);
    } else {
      success = await permintaanBahanService.approveByManager(
        nomor,
        userPengklik,
      );
    }

    if (success) res.json({ message: "Berhasil Approval" });
    else res.status(400).json({ message: "Gagal Approval" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
// ===================================
// 3. DELETE (DELETE /:nomor) - Replikasi cxButton4Click
// ===================================
exports.deletePermintaanBahan = async (req, res) => {
  try {
    const { nomor } = req.params;

    if (!nomor) {
      return res.status(400).json({ message: "Nomor transaksi wajib diisi." });
    }

    // Panggil service untuk menghapus Master dan Detail
    const isDeleted = await permintaanBahanService.deletePermintaanBahan(nomor);

    if (isDeleted) {
      return res
        .status(200)
        .json({ message: `Transaksi dengan nomor ${nomor} berhasil dihapus.` });
    } else {
      return res
        .status(404)
        .json({
          message: `Gagal menghapus transaksi. Nomor ${nomor} tidak ditemukan.`,
        });
    }
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Gagal menghapus transaksi.", error: error.message });
  }
};

exports.getPermintaanBahanForPrint = async (req, res) => {
  try {
    const { nomor } = req.params;

    if (!nomor) {
      return res
        .status(400)
        .json({ message: "Nomor Permintaan wajib diisi untuk dicetak." });
    }

    // Panggil service yang spesifik untuk mengambil data dalam format cetak
    const data = await permintaanBahanService.getPermintaanBahanForPrint(nomor);

    // Mengirimkan data dalam format yang siap digunakan oleh komponen Vue.js (frontend)
    return res.status(200).json(data);
  } catch (error) {
    // Handle error seperti data tidak ditemukan atau kesalahan database
    const status = error.message.includes("tidak ditemukan") ? 404 : 500;
    return res.status(status).json({
      message: "Gagal memuat data cetak Permintaan Bahan.",
      error: error.message,
    });
  }
};
