const service = require("../../services/tools/approvalService");

const getMasterData = async (req, res) => {
  try {
    const data = await service.getApprovalPiutangMaster(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getPengajuanDtl = async (req, res) => {
  try {
    const { cusKode } = req.params;
    if (!cusKode)
      return res
        .status(400)
        .json({ success: false, message: "Kode Customer wajib dikirim" });

    const data = await service.getPengajuanByCustomer(cusKode, req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getInvoiceList = async (req, res) => {
  try {
    const { cusKode, status } = req.params;
    const { startDate } = req.query;

    const dStart =
      startDate ||
      new Date(new Date().getFullYear(), new Date().getMonth(), 1)
        .toISOString()
        .substring(0, 10);

    if (!cusKode || !status)
      return res.status(400).json({
        success: false,
        message: "Kode dan Status Customer wajib dikirim",
      });

    const data = await service.getInvoiceNunggak(cusKode, status, dStart);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const submitOtorisasi = async (req, res) => {
  try {
    const { spk_nomor, status_acc } = req.body; // status_acc: 'Y' (Acc) atau 'N' (Tolak)
    const userKode = req.user.kode;

    if (!spk_nomor || !status_acc) {
      return res.status(400).json({
        success: false,
        message: "Nomor SPK dan Status ACC wajib diisi",
      });
    }

    const result = await service.setOtorisasi(spk_nomor, status_acc, userKode);
    res.status(200).json({
      success: true,
      message: `Berhasil.\nSilahkan info ke ${result.peminta}`,
      data: result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// =========================================================================
// APPROVAL SPK HARGA 0 (MENU_ID: 257)
// =========================================================================

const getHargaNolList = async (req, res) => {
  try {
    const data = await service.getHargaNolList(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getHargaNolDetailInfo = async (req, res) => {
  try {
    const { nomor } = req.params;
    if (!nomor)
      return res
        .status(400)
        .json({ success: false, message: "Nomor SPK wajib dikirim" });

    const data = await service.getHargaNolDetailInfo(nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const submitHargaNolOtorisasi = async (req, res) => {
  try {
    const { spk_nomor, status_acc } = req.body;
    const userKode = req.user.kode;

    if (!spk_nomor || !status_acc) {
      return res.status(400).json({
        success: false,
        message: "Nomor SPK dan Status ACC wajib diisi",
      });
    }

    const result = await service.submitHargaNolOtorisasi(
      spk_nomor,
      status_acc,
      userKode,
    );
    res.status(200).json({
      success: true,
      message: `Berhasil.\nSilahkan info ke ${result.peminta}`,
      data: result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// =========================================================================
// APPROVAL SPK KLIEN PRIORITAS (MENU_ID: 258)
// =========================================================================

const getPrioritasList = async (req, res) => {
  try {
    const data = await service.getPrioritasList(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const submitPrioritasOtorisasi = async (req, res) => {
  try {
    const { spk_nomor, status_acc } = req.body;
    const userKode = req.user.kode;

    if (!spk_nomor || !status_acc) {
      return res.status(400).json({
        success: false,
        message: "Nomor SPK dan Status ACC wajib diisi",
      });
    }

    const result = await service.submitPrioritasOtorisasi(
      spk_nomor,
      status_acc,
      userKode,
    );
    res.status(200).json({
      success: true,
      message: `Berhasil.\nSilahkan info ke ${result.peminta}`,
      data: result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// =========================================================================
// APPROVAL INVOICE BELUM BUAT SJ (MENU_ID: 260)
// =========================================================================

const getInvoiceBlmSjList = async (req, res) => {
  try {
    const data = await service.getInvoiceBlmSjList(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const submitInvoiceBlmSjOtorisasi = async (req, res) => {
  try {
    const { nomor, status_acc } = req.body;
    const userKode = req.user.kode;

    if (!nomor || !status_acc) {
      return res.status(400).json({
        success: false,
        message: "Nomor Invoice dan Status ACC wajib diisi",
      });
    }

    const result = await service.submitInvoiceBlmSjOtorisasi(
      nomor,
      status_acc,
      userKode,
    );
    res.status(200).json({
      success: true,
      message: `Berhasil.\nSilahkan info ke ${result.peminta}`,
      data: result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// =========================================================================
// APPROVAL PERUBAHAN DATA (MENU_ID: 259)
// =========================================================================

const getPerubahanDataList = async (req, res) => {
  try {
    const data = await service.getPerubahanDataList(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const submitPerubahanDataOtorisasi = async (req, res) => {
  try {
    // Karena butuh PK komposit, kita tangkap dari body
    const { nomor, transaksi, urut, status_acc } = req.body;
    const userKode = req.user.kode;

    if (!nomor || !transaksi || !urut || !status_acc) {
      return res.status(400).json({
        success: false,
        message: "Nomor, Transaksi, Urutan, dan Status ACC wajib diisi",
      });
    }

    const result = await service.submitPerubahanDataOtorisasi(
      nomor,
      transaksi,
      urut,
      status_acc,
      userKode,
    );
    res.status(200).json({
      success: true,
      message: `Berhasil.\nSilahkan info ke ${result.peminta}`,
      data: result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// =========================================================================
// APPROVAL HAPUS DATA (MENU_ID: 261)
// =========================================================================

const getHapusDataList = async (req, res) => {
  try {
    const data = await service.getHapusDataList(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const submitHapusDataOtorisasi = async (req, res) => {
  try {
    const { nomor, transaksi, urut, status_acc } = req.body;
    const userKode = req.user.kode;

    if (!nomor || !transaksi || !urut || !status_acc) {
      return res.status(400).json({
        success: false,
        message: "Nomor, Transaksi, Urutan, dan Status ACC wajib diisi",
      });
    }

    const result = await service.submitHapusDataOtorisasi(
      nomor,
      transaksi,
      urut,
      status_acc,
      userKode,
    );
    res.status(200).json({
      success: true,
      message: `Berhasil.\nSilahkan info ke ${result.peminta}`,
      data: result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// =========================================================================
// APPROVAL PLAFON CUSTOMER (MENU_ID: 262 = Manager, 263 = Direksi)
// =========================================================================

const getPlafonList = async (req, res) => {
  try {
    const data = await service.getPlafonList(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const submitPlafonOtorisasi = async (req, res) => {
  try {
    const { cus_kode, status_acc } = req.body;
    const userKode = req.user.kode;
    const userBagian = req.user.bagian || "";

    if (!cus_kode || !status_acc) {
      return res.status(400).json({
        success: false,
        message: "Kode Customer dan Status ACC wajib diisi",
      });
    }

    const result = await service.approvalPlafon(
      cus_kode,
      status_acc,
      userKode,
      userBagian,
    );
    res.status(200).json({
      success: true,
      message: `Berhasil.\nSilahkan info ke ${result.peminta}`,
      data: result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// =========================================================================
// APPROVAL MUTASI PRODUKSI TANPA PLANNING PPIC (MENU_ID: 266)
// =========================================================================
const getMutasiNoPlanList = async (req, res) => {
  try {
    const data = await service.getMutasiNoPlanList(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const submitMutasiNoPlanOtorisasi = async (req, res) => {
  try {
    const { nomor, status_acc } = req.body;
    const userKode = req.user.kode;
    if (!nomor || !status_acc) {
      return res.status(400).json({
        success: false,
        message: "Nomor dan Status ACC wajib diisi",
      });
    }
    const result = await service.submitMutasiNoPlanOtorisasi(
      nomor,
      status_acc,
      userKode,
    );
    res.status(200).json({
      success: true,
      message: `Berhasil.\nSilahkan info ke ${result.peminta}`,
      data: result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// controller
const getSpkCetakUlangList = async (req, res) => {
  try {
    const data = await service.getSpkCetakUlangList(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
const submitSpkCetakUlangOtorisasi = async (req, res) => {
  try {
    const { nomor, status_acc } = req.body;
    const userKode = req.user.kode;
    if (!nomor || !status_acc) {
      return res
        .status(400)
        .json({ success: false, message: "Nomor dan Status ACC wajib diisi" });
    }
    const result = await service.submitSpkCetakUlangOtorisasi(
      nomor,
      status_acc,
      userKode,
    );
    res.status(200).json({
      success: true,
      message: `Berhasil.\nSilahkan info ke ${result.peminta}`,
      data: result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// =========================================================================
// APPROVAL PEMBATALAN SPK/SO (MENU_ID: 262)
// =========================================================================
const getPembatalanSpkList = async (req, res) => {
  try {
    const data = await service.getPembatalanSpkList(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const submitPembatalanSpkOtorisasi = async (req, res) => {
  try {
    const { nomor, status_acc } = req.body;
    const userKode = req.user.kode;
    if (!nomor || !status_acc) {
      return res.status(400).json({
        success: false,
        message: "Nomor dan Status ACC wajib diisi",
      });
    }
    const result = await service.submitPembatalanSpkOtorisasi(
      nomor,
      status_acc,
      userKode,
    );
    res.status(200).json({
      success: true,
      message: `Berhasil.\nSilahkan info ke ${result.peminta}`,
      data: result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// =========================================================================
// APPROVAL SPK GANTI QTY & JENIS KAIN (MENU_ID: 265)
// =========================================================================
const getGantiQtyKainList = async (req, res) => {
  try {
    const data = await service.getGantiQtyKainList(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const submitGantiQtyKainOtorisasi = async (req, res) => {
  try {
    const { nomor, transaksi, urut, status_acc } = req.body;
    const userKode = req.user.kode;

    if (!nomor || !transaksi || !urut || !status_acc) {
      return res.status(400).json({
        success: false,
        message: "Nomor, Transaksi, Urutan, dan Status ACC wajib diisi",
      });
    }

    const result = await service.submitGantiQtyKainOtorisasi(
      nomor,
      transaksi,
      urut,
      status_acc,
      userKode,
    );
    res.status(200).json({
      success: true,
      message: `Berhasil.\nSilahkan info ke ${result.peminta}`,
      data: result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// =========================================================================
// APPROVAL SO TANPA NOMOR PO (MENU_ID: 268)
// =========================================================================
const getNoPoList = async (req, res) => {
  try {
    const data = await service.getNoPoList(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const submitNoPoOtorisasi = async (req, res) => {
  try {
    const { nomor, status_acc } = req.body;
    const userKode = req.user.kode;
    if (!nomor || !status_acc) {
      return res.status(400).json({
        success: false,
        message: "Nomor dan Status ACC wajib diisi",
      });
    }
    const result = await service.submitNoPoOtorisasi(
      nomor,
      status_acc,
      userKode,
    );
    res.status(200).json({
      success: true,
      message: `Berhasil.\nSilahkan info ke ${result.peminta}`,
      data: result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// =========================================================================
// APPROVAL REALISASI MINTA BAHAN BEDA DENGAN MKB (MENU_ID: 269)
// =========================================================================
const getRealisasiBedaBahanList = async (req, res) => {
  try {
    const data = await service.getRealisasiBedaBahanList(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getRealisasiBedaBahanDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    if (!nomor)
      return res
        .status(400)
        .json({ success: false, message: "Nomor Realisasi wajib dikirim" });

    const data = await service.getRealisasiBedaBahanDetail(nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const submitRealisasiBedaBahanOtorisasi = async (req, res) => {
  try {
    const { nomor, status_acc } = req.body;
    const userKode = req.user.kode;

    if (!nomor || !status_acc) {
      return res.status(400).json({
        success: false,
        message: "Nomor dan Status ACC wajib diisi",
      });
    }

    const result = await service.submitRealisasiBedaBahanOtorisasi(
      nomor,
      status_acc,
      userKode,
    );
    res.status(200).json({
      success: true,
      message: `Berhasil.\nSilahkan info ke ${result.peminta}`,
      data: result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getMasterData,
  getPengajuanDtl,
  getInvoiceList,
  submitOtorisasi,
  getHargaNolList,
  getHargaNolDetailInfo,
  submitHargaNolOtorisasi,
  getPrioritasList,
  submitPrioritasOtorisasi,
  getInvoiceBlmSjList,
  submitInvoiceBlmSjOtorisasi,
  getPerubahanDataList,
  submitPerubahanDataOtorisasi,
  getHapusDataList,
  submitHapusDataOtorisasi,
  getPlafonList,
  submitPlafonOtorisasi,
  getMutasiNoPlanList,
  submitMutasiNoPlanOtorisasi,
  getSpkCetakUlangList,
  submitSpkCetakUlangOtorisasi,
  getPembatalanSpkList,
  submitPembatalanSpkOtorisasi,
  getGantiQtyKainList,
  submitGantiQtyKainOtorisasi,
  getNoPoList,
  submitNoPoOtorisasi,
  getRealisasiBedaBahanList,
  getRealisasiBedaBahanDetail,
  submitRealisasiBedaBahanOtorisasi,
};
