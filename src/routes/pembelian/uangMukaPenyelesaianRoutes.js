const express = require("express");
const router = express.Router();
const controller = require("../../controllers/pembelian/uangMukaPenyelesaianController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const menuId = 315;

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

router.get(
  "/:nomor",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getFormData,
);
router.post(
  "/:nomor/save",
  verifyToken,
  checkPermission(menuId, "save"),
  controller.saveData,
);

module.exports = router;
