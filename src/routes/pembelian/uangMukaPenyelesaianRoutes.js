const db = require("../../config/database");
const express = require("express");
const router = express.Router();
const controller = require("../../controllers/pembelian/uangMukaPenyelesaianController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const menuId = 315;
const menuIdPetty = 973;

// Mode ditentukan route, jenis bon dibaca dari DB (bukan dari klien):
// /petty/... hanya untuk bon Penyerahan Dana Belanja (PD), route lama hanya
// untuk bon non-PD. Nomor di URL harus sama dengan nomor di body karena
// saveData membaca nomor dari body.
const wajibJenis = (pd) => async (req, res, next) => {
  try {
    if (req.body?.nomor && req.body.nomor !== req.params.nomor)
      return res
        .status(400)
        .json({ message: "Nomor pada URL dan data tidak sama." });
    const [[row]] = await db.query(
      `SELECT 1 AS ok FROM tpengajuan_uang_muka_hdr
       WHERE pum_bon_nomor = ? AND pum_jenis = 'PD' LIMIT 1`,
      [req.params.nomor],
    );
    if (!!row !== pd)
      return res.status(400).json({
        message: pd
          ? "Bon ini bukan Penyerahan Dana Belanja."
          : "Penyelesaian Penyerahan Dana Belanja dilakukan lewat menu Petty Cash.",
      });
    next();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

router.get("/account-options", verifyToken, controller.getAccountOptions);
router.get("/account-all", verifyToken, controller.getAllAccounts);
router.get("/account/:kode", verifyToken, controller.getAccountByKode);
router.get(
  "/cost-center-options",
  verifyToken,
  controller.getCostCenterOptions,
);
router.get("/dc-options", verifyToken, controller.getDcOptions);
router.get("/supplier-options", verifyToken, controller.getSupplierOptions);
router.get("/pengajuan-ga", verifyToken, controller.getListPengajuanGA);
router.get(
  "/pengajuan-ga/:pjhNomor",
  verifyToken,
  controller.getDetailPengajuanGA,
);
router.get("/po-external", verifyToken, controller.getListPoExternal);
router.get("/voucher", verifyToken, controller.getListVoucher);
router.get(
  "/permintaan-garmen",
  verifyToken,
  controller.getListPermintaanGarmen,
);
router.get(
  "/permintaan-garmen/:mbNomor",
  verifyToken,
  controller.getDetailPermintaanGarmen,
);
router.get("/invoice-garmen", verifyToken, controller.getListInvoiceGarmen);
router.get(
  "/invoice-garmen/:ivNomor",
  verifyToken,
  controller.getDetailInvoiceGarmen,
);
router.post("/supplier", verifyToken, controller.createSupplier);
router.patch("/status-finance", verifyToken, controller.updateStatusFinance);

// Penyelesaian Dana Belanja (PD): hak menu 973
router.get(
  "/petty/:nomor",
  verifyToken,
  checkPermission(menuIdPetty, "view"),
  wajibJenis(true),
  controller.getFormData,
);
router.get(
  "/petty/:nomor/cek-batas",
  verifyToken,
  checkPermission(menuIdPetty, "view"),
  wajibJenis(true),
  controller.cekBatas,
);
router.post(
  "/petty/:nomor/save",
  verifyToken,
  checkPermission(menuIdPetty, "save"),
  wajibJenis(true),
  controller.saveData,
);

router.get(
  "/:nomor",
  verifyToken,
  checkPermission(menuId, "view"),
  wajibJenis(false),
  controller.getFormData,
);
router.get(
  "/:nomor/cek-batas",
  verifyToken,
  checkPermission(menuId, "view"),
  wajibJenis(false),
  controller.cekBatas,
);
router.post(
  "/:nomor/save",
  verifyToken,
  checkPermission(menuId, "save"),
  wajibJenis(false),
  controller.saveData,
);

module.exports = router;
