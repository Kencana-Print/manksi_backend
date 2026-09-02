const jwt = require("jsonwebtoken");
const pool = require("../config/database");

/**
 * Memverifikasi validitas Token JWT
 */
const verifyToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res
      .status(401)
      .json({ message: "Akses ditolak. Silakan login kembali." });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res
        .status(403)
        .json({ message: "Sesi telah berakhir atau token tidak valid." });
    }
    // Pastikan payload JWT berisi 'kode' (User ID)
    req.user = decoded;
    next();
  });
};

/**
 * Middleware untuk cek hak akses per Menu ID
 * @param {number} menuId - ID dari tabel tmenu
 * @param {string} action - 'view', 'insert', 'edit', 'delete'
 */
const checkPermission = (menuId, action) => {
  return async (req, res, next) => {
    const userKode = req.user.kode;
    const actionColumnMap = {
      view: "hak_men_view",
      insert: "hak_men_insert",
      edit: "hak_men_edit",
      delete: "hak_men_delete",
    };

    const column = actionColumnMap[action];
    if (!column) return res.status(500).json({ message: "Aksi tidak valid." });

    try {
      const query = `
        SELECT ${column} AS permission 
        FROM thakuser 
        WHERE hak_user_kode = ? AND hak_men_id = ?`;

      const [rows] = await pool.query(query, [userKode, menuId]);

      if (rows.length > 0 && rows[0].permission === "Y") {
        next();
      } else {
        res.status(403).json({
          message: `Hak akses ditolak. Anda tidak memiliki izin [${action}] pada menu ID ${menuId}.`,
        });
      }
    } catch (error) {
      res.status(500).json({
        message: "Gagal memvalidasi hak akses.",
        error: error.message,
      });
    }
  };
};

const requireAdmin = (req, res, next) => {
  if (!req.user || !req.user.kode) {
    return res
      .status(401)
      .json({ message: "Akses ditolak. Token tidak valid." });
  }

  const kode = req.user.kode.toUpperCase();
  if (kode === "ADMIN" || kode === "DEVELOPER") {
    return next();
  }

  return res
    .status(403)
    .json({ message: "Akses ditolak. Modul ini hanya untuk Administrator." });
};

/**
 * Middleware untuk membatasi endpoint hanya bisa diakses oleh user
 * dari bagian/departemen tertentu (mis. PPIC untuk konfirmasi
 * kesanggupan Pra Order). Beda dari checkPermission (menu access) —
 * ini validasi departemen, dipakai saat aksi tertentu di suatu menu
 * memang cuma boleh dilakukan role tertentu meski menu-nya sama
 * dan sudah lolos checkPermission.
 */
const checkBagian = (...allowedBagian) => {
  const allowedUpper = allowedBagian.map((b) => b.toUpperCase());

  return (req, res, next) => {
    if (!req.user || !req.user.kode) {
      return res
        .status(401)
        .json({ message: "Akses ditolak. Token tidak valid." });
    }

    const bagian = (req.user.bagian || "").toUpperCase();
    const kode = req.user.kode.toUpperCase();

    if (kode === "ADMIN" || allowedUpper.includes(bagian)) {
      return next();
    }

    return res.status(403).json({
      message: `Aksi ini hanya bisa dilakukan oleh bagian ${allowedBagian.join("/")}.`,
    });
  };
};

module.exports = {
  verifyToken,
  checkPermission,
  requireAdmin,
  checkBagian,
};
