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

module.exports = { login };
