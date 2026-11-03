const service = require("../../../../services/mmt/transaksi-khusus/spk-order/soToSpkService");

const getBrowse = async (req, res) => {
  try {
    const user = req.user || {};
    const flags = user.flags || {};

    const canLihatCus = Number(flags.lihatCus) === 1;
    const canLihatHarga = Number(flags.lihatHarga) === 1;

    const today = new Date().toISOString().substring(0, 10);
    const startDate = req.query.startDate || today;
    const endDate = req.query.endDate || startDate;

    const filters = {
      startDate,
      endDate,
      workshop: req.query.workshop || "",
      customer: req.query.customer || "",
      keyword: req.query.keyword || "",
      userCabang: user.cab || user.cabang || user.Cab || "",
      canLihatCus,
      canLihatHarga,
    };

    const data = await service.getBrowseList(filters);
    return res.json({
      success: true,
      data: Array.isArray(data) ? data : [],
      canLihatCus,
      canLihatHarga,
    });
  } catch (error) {
    console.error("Error getBrowse:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Gagal memuat data",
      data: [],
    });
  }
};

const getSizes = async (req, res) => {
  try {
    const { nomor } = req.params;
    if (!nomor) {
      return res
        .status(400)
        .json({ success: false, message: "Nomor SPK wajib disertakan." });
    }

    const data = await service.getSizes(nomor);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteSpk = async (req, res) => {
  try {
    const user = req.user || {};
    await service.deleteSpk(req.params.nomor, user);
    res.json({ success: true, message: "SPK berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const toggleStatus = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { isClose, alasan } = req.body;

    // Panggil fungsi yang ada di service (atau sesuaikan dengan fungsi service Anda)
    // Berdasarkan file service Anda, fungsi untuk toggle status bernama toggleStatus(nomor, alasan, isClose)
    await service.toggleStatus(nomor, alasan || "", isClose);

    return res.json({
      success: true,
      message: "Status SPK berhasil diperbarui.",
    });
  } catch (error) {
    console.error("Error toggleStatus:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

const requestPin = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { alasan } = req.body;
    const userKode = req.user?.kode || (req.user?.nama || req.user?.username || req.user?.kode || 'SYSTEM') || "SYSTEM";

    await service.requestPin(nomor, alasan, userKode);
    res.json({ success: true, message: "Pengajuan PIN berhasil dikirim." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const approveCmo = async (req, res) => {
  try {
    const { nomor } = req.params;
    const flags = req.user?.flags || {};
    const userKode = req.user?.kode || (req.user?.nama || req.user?.username || req.user?.kode || 'SYSTEM') || "SYSTEM";

    const isCmo =
      flags.cmo === 1 ||
      flags.cmo === "Y" ||
      flags.cmo3 === 1 ||
      flags.cmo3 === "Y";

    if (!isCmo) {
      return res.status(403).json({
        success: false,
        message: "Akses ditolak. Anda tidak memiliki hak sebagai CMO.",
      });
    }

    await service.approveCmo(nomor, userKode);
    res.json({ success: true, message: "Berhasil di-approve." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const checkPrintPermission = async (req, res) => {
  try {
    const data = await service.checkPrintPermission(req.params.nomor);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const requestPrintApproval = async (req, res) => {
  try {
    const { alasan } = req.body;
    const userKode = req.user?.kode || (req.user?.nama || req.user?.username || req.user?.kode || 'SYSTEM') || "ADMIN";

    await service.requestPrintApproval(req.params.nomor, alasan, userKode);
    res.json({ success: true, message: "Pengajuan approval cetak dikirim." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const recordPrint = async (req, res) => {
  try {
    await service.recordPrint(req.params.nomor);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- Detail SPK PPIC (mode edit) ---
const getDetail = async (req, res) => {
  try {
    const { nomor } = req.query;
    if (!nomor)
      return res
        .status(400)
        .json({ success: false, message: "Nomor SPK wajib diisi." });

    const data = await service.getDetail(nomor);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- Ambil data SO sebagai dasar create SPK PPIC baru ---
const getSoSource = async (req, res) => {
  try {
    const { soNomor } = req.query;
    if (!soNomor)
      return res
        .status(400)
        .json({ success: false, message: "Nomor SO wajib diisi." });

    const data = await service.getSoSourceDetail(soNomor);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// --- Save (create & edit) ---
const save = async (req, res) => {
  try {
    // 💡 Defensif: Cek berbagai opsi penamaan objek user dari auth middleware & key dari JWT
    const userObj = req.user || req.userData || req.auth || {};
    const userLogin =
      userObj.kdUser ||
      userObj.kode ||
      userObj.user_kode ||
      userObj.usr ||
      (typeof req.user === "string" ? req.user : null);

    if (!userLogin) {
      console.error(
        "🔴 AUTH ERROR: req.user kosong atau tidak memiliki identitas user.",
      );
      console.error("   DEBUG req.user:", req.user);
      console.error("   DEBUG req.userData:", req.userData);

      return res.status(401).json({
        success: false,
        message: "User login tidak valid. Silakan login ulang.",
      });
    }

    console.log("📦 Payload diterima di backend:", req.body);
    console.log("👤 User executing save:", userLogin);

    const user = {
      kode: userLogin,
      cab: userObj.cab || "",
      divisi: userObj.divisi || "",
    };

    const result = await service.saveData(req.body, user);

    return res.status(200).json({
      success: true,
      message: "Data SO to SPK berhasil disimpan.",
      data: result,
    });
  } catch (error) {
    console.error("🔴 SERVER ERROR SAAT SAVE SO TO SPK:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Gagal menyimpan data SO to SPK.",
    });
  }
};

const getInitSizes = async (req, res) => {
  try {
    const data = await service.getInitSizes();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getStandarUkuran = async (req, res) => {
  try {
    const { joKode, varian } = req.query;
    const data = await service.getStandarUkuran(joKode, varian || "STANDAR");
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getMkbDetailBySpk = async (req, res) => {
  try {
    const { spkNomor } = req.query;
    if (!spkNomor)
      return res
        .status(400)
        .json({ success: false, message: "spkNomor wajib diisi." });
    const data = await service.getMkbDetailBySpk(spkNomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getKomponenMaster = async (req, res) => {
  try {
    const data = await service.getKomponenMaster(req.query.isBordir);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const importLayoutProses = async (req, res) => {
  try {
    if (!req.file) throw new Error("File Excel tidak ditemukan.");
    const { spkNomor } = req.body;
    if (!spkNomor) throw new Error("Nomor SPK wajib diisi.");
    const result = await service.importLayoutProses(spkNomor, req.file.path);
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(200).json({
      success: true,
      message: `Berhasil import: ${result.total} baris proses.`,
      data: result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getLayoutProses = async (req, res) => {
  try {
    const { spkNomor } = req.query;
    const data = await service.getLayoutProses(spkNomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getKeteranganKhusus = async (req, res) => {
  try {
    const { spkNomor } = req.query;
    const data = await service.getKeteranganKhusus(spkNomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getKetKomponenMaster = async (req, res) => {
  try {
    const data = await service.getKetKomponenMaster();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getMkaFromMap = async (req, res) => {
  try {
    const { mapNomor } = req.params;
    const data = await service.getMkaFromMap(mapNomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getKomponenFromProof = async (req, res) => {
  try {
    const { identifier } = req.params;
    const data = await service.getKomponenFromProof(identifier);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getAlokasi = async (req, res) => {
  try {
    const { nomor } = req.query;
    if (!nomor) {
      return res
        .status(400)
        .json({ success: false, message: "Nomor SPK wajib diisi." });
    }
    const data = await service.getAlokasi(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getBrowse,
  getSizes,
  deleteSpk,
  toggleStatus,
  requestPin,
  approveCmo,
  checkPrintPermission,
  requestPrintApproval,
  recordPrint,
  getDetail,
  getSoSource,
  save,
  getInitSizes,
  getStandarUkuran,
  getMkbDetailBySpk,
  getKomponenMaster,
  importLayoutProses,
  getLayoutProses,
  getKeteranganKhusus,
  getKetKomponenMaster,
  getMkaFromMap,
  getKomponenFromProof,
  getAlokasi,
};
