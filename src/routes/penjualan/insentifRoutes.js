const express = require("express");
const router = express.Router();
const controller = require("../../controllers/penjualan/insentifController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

// Menu ID = 167, web_route = /penjualan/insentif
const MENU_ID = 167;

router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowseList,
);

router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.deleteData,
);

router.get(
  "/:nomor/cetak",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getCetakData,
);

// ⚠️ Delphi (btnSimpanClick) memakai permission cekdelete() untuk aksi
// SIMPAN realisasi — kemungkinan copy-paste dari tombol Hapus di
// atasnya (btnUpdateClick & btnbatalClick juga sama-sama cekdelete).
// Di sini pakai permission "edit" karena aksi ini murni UPDATE data,
// bukan hapus — supaya user yang boleh edit tapi tidak boleh hapus
// tetap bisa pakai Realisasi Transfer.
router.put(
  "/:nomor/realisasi",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.realisasiTransfer,
);

module.exports = router;
