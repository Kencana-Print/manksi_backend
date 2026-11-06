const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/tools/userFormController");
const {
  verifyToken,
  requireAdmin,
} = require("../../middleware/authMiddleware");

// Admin-only via requireAdmin (bukan sistem thakuser/menuId) — karena
// modul ini sendiri yang mengelola thakuser untuk user lain.

// Rute statis WAJIB di atas '/:kode' supaya tidak ketangkap sbg kode.
router.get("/search", verifyToken, requireAdmin, ctrl.searchUsers);
router.get("/check/:kode", verifyToken, requireAdmin, ctrl.checkKode);
router.get(
  "/permissions/:kode",
  verifyToken,
  requireAdmin,
  ctrl.getPermissionsForCopy,
);

router.get("/nik", verifyToken, requireAdmin, ctrl.searchHrd);
router.get("/role", verifyToken, requireAdmin, ctrl.getRoleList);
router.get("/role/:kode", verifyToken, requireAdmin, ctrl.getRole);
router.get(
  "/role/:kode/anggota",
  verifyToken,
  requireAdmin,
  ctrl.getRoleAnggota,
);
router.post(
  "/role/:kode/pratinjau",
  verifyToken,
  requireAdmin,
  ctrl.pratinjauRole,
);
router.put("/role/:kode", verifyToken, requireAdmin, ctrl.saveRole);
router.post("/", verifyToken, requireAdmin, ctrl.createUser);

// Dipecah jadi 2 route eksplisit — path-to-regexp v7+ (dipakai Express 5)
// tidak lagi mendukung syntax optional param model lama (":kode?").
router.get("/", verifyToken, requireAdmin, ctrl.getFormData); // mode Baru
router.get("/:kode", verifyToken, requireAdmin, ctrl.getFormData); // mode Ubah

router.put("/:kode", verifyToken, requireAdmin, ctrl.updateUser);
router.delete("/:kode", verifyToken, requireAdmin, ctrl.deleteUser);

module.exports = router;
