const sjService = require("../../../../services/mmt/transaksi-khusus/pengiriman/suratJalanService");

/* ==========================================================================
   BAGIAN 1: CONTROLLER BROWSE & TRANSAKSI UTAMA (ufrmBrowseSJ)
   ========================================================================== */

/**
 * Browse List Master Surat Jalan (Modul Utama)
 */
const browseSJ = async (req, res) => {
  try {
    const { startDate, endDate, zcus, zdivisi } = req.query;
    const kdUser =
      (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') || (req.user?.nama || req.user?.username || req.user?.kode || 'SYSTEM') || req.query.kdUser || "ADMIN";

    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ message: "Parameter startDate dan endDate wajib diisi" });
    }

    const data = await sjService.getBrowseSJ(
      startDate,
      endDate,
      kdUser,
      zcus,
      zdivisi,
    );
    res.status(200).json({ data });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Get Detail Surat Jalan Berdasarkan Nomor SJ (Sub-grid Modul Utama)
 */
const getDetailSJByNomor = async (req, res) => {
  try {
    const { nomor } = req.query;

    if (!nomor) {
      return res
        .status(400)
        .json({ message: "Parameter nomor Surat Jalan wajib diisi" });
    }

    const data = await sjService.getDetailSJ(nomor);
    res.status(200).json({ data, details: data });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Delete Surat Jalan
 */
const deleteSJ = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { invoice, approved } = req.query;

    if (!nomor) {
      return res.status(400).json({ message: "Parameter nomor wajib diisi" });
    }

    const success = await sjService.deleteSJ(nomor, invoice, approved);
    if (success) {
      res
        .status(200)
        .json({ message: `Surat Jalan ${nomor} berhasil dihapus` });
    } else {
      res.status(404).json({ message: "Data Surat Jalan tidak ditemukan" });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

/**
 * Cek Urutan Pengajuan Edit Terakhir
 */
const getUrutPengajuan = async (req, res) => {
  try {
    const { nomor } = req.params;

    if (!nomor) {
      return res.status(400).json({ message: "Nomor Surat Jalan wajib diisi" });
    }

    const data = await sjService.getUrutPengajuanSJ(nomor);
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Submit Pengajuan Edit Perubahan Data
 */
const submitPengajuan = async (req, res) => {
  try {
    const userLogin =
      (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') || (req.user?.nama || req.user?.username || req.user?.kode || 'SYSTEM') || req.body.kdUser || "ADMIN";
    const result = await sjService.submitPengajuanSJ(req.body, userLogin);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

/* ==========================================================================
   BAGIAN 2: CONTROLLER MODUL APPROVAL & ACTIONS
   ========================================================================== */

/**
 * Browse Master Data Khusus Modul Approval SJ
 */
const browseMasterApprovalSj = async (req, res) => {
  try {
    const { startDate, endDate, cab, zcus, pendingOnly } = req.query;
    const isPendingOnly = pendingOnly === "true" || pendingOnly === true;

    const data = await sjService.getMasterSj(
      startDate,
      endDate,
      cab,
      zcus,
      isPendingOnly,
    );
    res.status(200).json({ data });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Get Detail Data Khusus Modul Approval SJ
 */
const getDetailApprovalSj = async (req, res) => {
  try {
    const { startDate, endDate, cab, pendingOnly } = req.query;
    const isPendingOnly = pendingOnly === "true" || pendingOnly === true;

    const data = await sjService.getDetailSj(
      startDate,
      endDate,
      cab,
      isPendingOnly,
    );
    res.status(200).json({ data, details: data });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Akses Approve Surat Jalan
 */
const approveSj = async (req, res) => {
  try {
    const nomor = req.params.nomor || req.body.nomor;
    const { kodeGdg } = req.body;

    if (!nomor) {
      return res
        .status(400)
        .json({ message: "Parameter nomor surat jalan wajib diisi" });
    }
    if (!kodeGdg) {
      return res.status(400).json({ message: "Parameter kodeGdg wajib diisi" });
    }

    const result = await sjService.approveSj(nomor, kodeGdg);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

/**
 * Akses Pending Surat Jalan
 */
const pendingSj = async (req, res) => {
  try {
    const nomor = req.params.nomor || req.body.nomor;

    if (!nomor) {
      return res
        .status(400)
        .json({ message: "Parameter nomor surat jalan wajib diisi" });
    }

    const result = await sjService.pendingSj(nomor);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

/**
 * Akses Batal Surat Jalan
 */
const batalSj = async (req, res) => {
  try {
    const nomor = req.params.nomor || req.body.nomor;

    if (!nomor) {
      return res
        .status(400)
        .json({ message: "Parameter nomor surat jalan wajib diisi" });
    }

    const result = await sjService.batalSj(nomor);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  // Modul Utama Transaksi
  browseSJ,
  getDetailSJByNomor,
  deleteSJ,
  getUrutPengajuan,
  submitPengajuan,

  // Modul Approval
  browseMasterApprovalSj,
  getDetailApprovalSj,
  approveSj,
  pendingSj,
  batalSj,
};
