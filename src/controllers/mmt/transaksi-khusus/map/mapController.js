const mapService = require("../../../../services/mmt/transaksi-khusus/map/mapService");

// --- 1. BROWSE & INIT DATA ---
const getBrowseList = async (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      cabang: req.user?.cabang,
      isKaosan: req.user?.cabKaos,
    };

    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1;
    const canLihatHarga = Number(req.user?.flags?.lihatHarga) === 1;

    const data = await mapService.getBrowseList(
      filters,
      canLihatCus,
      canLihatHarga,
    );
    res.status(200).json({ success: true, data, canLihatCus, canLihatHarga });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getInitGrids = async (req, res) => {
  try {
    const data = await mapService.getInitGrids();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getSpkInformasi = async (req, res) => {
  try {
    const { divisi } = req.params;
    const data = await mapService.getSpkInformasi(divisi);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- 2. HELPER & LOOKUP ENDPOINTS ---
const generateNomor = async (req, res) => {
  try {
    const { perushKode, joKode } = req.query;
    if (!perushKode || !joKode) {
      return res.status(400).json({
        success: false,
        message: "Perusahaan dan Jenis Order (JO) wajib diisi.",
      });
    }
    const nomor = await mapService.generateNomor(perushKode, joKode);
    res.status(200).json({ success: true, nomor });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const loadMintaHarga = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await mapService.loadMintaHarga(nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getNamaSuggestions = async (req, res) => {
  try {
    const { keyword, divisi, cusKode } = req.query;
    const data = await mapService.getNamaSuggestions(
      keyword || "",
      divisi,
      cusKode,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const checkDuplikatNama = async (req, res) => {
  try {
    const { nama, divisi, cusKode, excludeNomor } = req.query;
    const data = await mapService.checkDuplikatNama(
      nama,
      divisi,
      cusKode,
      excludeNomor,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getKatalogCustomer = async (req, res) => {
  try {
    const { cusKode } = req.params;
    const { divisi, keyword, page, limit } = req.query;
    const data = await mapService.getKatalogCustomer(
      cusKode,
      divisi,
      keyword,
      page,
      limit,
    );
    res.status(200).json({ success: true, ...data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- 3. DETAIL & PRINT ---
const getById = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await mapService.getById(nomor);
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Data MAP tidak ditemukan." });
    }
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await mapService.getPrintData(nomor);
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Data cetak tidak ditemukan." });
    }
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- 4. TRANSACTION & MUTATION ---
const saveMap = async (req, res) => {
  try {
    const data = req.body;
    const isNewMode = req.body.isNewMode !== false; // default true jika tidak dikirim
    const userKode = (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') || req.user?.kode || "SYSTEM";

    const nomorMap = await mapService.save(data, userKode, isNewMode);
    res.status(200).json({
      success: true,
      message: "Data MAP berhasil disimpan.",
      nomor: nomorMap,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const uploadFile = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { type } = req.body; // MAIN, PO, atau ACC
    const cabang = req.user?.cabang || "DEFAULT";

    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "File wajib diunggah." });
    }

    const fileName = await mapService.processImage(
      req.file.path,
      cabang,
      type,
      nomor,
      req.file.mimetype,
    );

    res.status(200).json({
      success: true,
      message: "File berhasil diunggah.",
      fileName,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const deleteMap = async (req, res) => {
  try {
    const { nomor } = req.params;
    await mapService.deleteMap(nomor, req.user);
    res.status(200).json({ success: true, message: "Berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// --- 5. APPROVAL & DESIGN STATUS ---
const toggleClose = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { isClose } = req.body;

    await mapService.toggleClose(nomor, isClose);
    res.status(200).json({
      success: true,
      message: `Berhasil di-${isClose === "Y" ? "Close" : "Open"}.`,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const approveCmo = async (req, res) => {
  try {
    const { nomor } = req.params;

    if (req.user?.flags?.cmo !== 1) {
      return res
        .status(403)
        .json({ success: false, message: "Anda tidak memiliki hak CMO." });
    }

    await mapService.approveCmo(
      nomor,
      (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') || req.user?.kode || "SYSTEM",
    );
    res.status(200).json({ success: true, message: "Berhasil di-approve." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const requestPin5 = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { alasan } = req.body;

    if (!alasan || alasan.trim() === "") {
      return res
        .status(400)
        .json({ success: false, message: "Alasan harus diisi." });
    }

    await mapService.requestPin5(nomor, alasan, req.user?.kode);
    res
      .status(200)
      .json({ success: true, message: "Berhasil diajukan. Menunggu ACC." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDesignList = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "startDate dan endDate wajib diisi.",
      });
    }
    const data = await mapService.getDesignList(startDate, endDate);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateDesignStatus = async (req, res) => {
  try {
    const { rows } = req.body;
    await mapService.updateDesignStatus(rows);
    res
      .status(200)
      .json({ success: true, message: "Update status design berhasil." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getKomponenByMap = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await mapService.getKomponenByMap(nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowseList,
  getInitGrids,
  getSpkInformasi,
  generateNomor,
  loadMintaHarga,
  getNamaSuggestions,
  checkDuplikatNama,
  getKatalogCustomer,
  getById,
  getPrintData,
  saveMap,
  uploadFile,
  deleteMap,
  toggleClose,
  approveCmo,
  requestPin5,
  getDesignList,
  updateDesignStatus,
  getKomponenByMap,
};
