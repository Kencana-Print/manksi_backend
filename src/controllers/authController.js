const authService = require("../services/authService");

const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validasi seperti Delphi: if (username = '') then ...
    if (!username || !password) {
      return res
        .status(400)
        .json({ message: "Username dan Password harus diisi." });
    }

    const result = await authService.loginUser(username, password);

    // Response sukses
    res.json(result);
  } catch (error) {
    // Menangkap Error dari Service (User pasif, Salah password, dll)
    res.status(401).json({ message: error.message });
  }
};

const changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword, confirmPassword } = req.body;
    const userKode = req.user.kode; // Didapat dari verifyToken middleware

    // Validasi inputan kosong (1:1 Delphi)
    if (!oldPassword)
      return res.status(400).json({ message: "Silahkan isi Password Lama!" });
    if (!newPassword)
      return res.status(400).json({ message: "Silahkan isi Password Baru!" });
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: "Ulangi password beda." });
    }

    await authService.changePassword(userKode, oldPassword, newPassword);
    res.json({ success: true, message: "Password berhasil diganti." });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Tambahkan ke dalam module.exports:
module.exports = { login, changePassword };
