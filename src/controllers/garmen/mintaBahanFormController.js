const service = require("../../services/garmen/mintaBahanFormService");
const tutupBukuService = require("../../services/tutupBukuService");

const getKomponen = async (req, res) => {
  try {
    const data = await service.getKomponenOptions();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getSpkInfo = async (req, res) => {
  try {
    const { spk } = req.params;
    const { cabang, keterangan, isEdit } = req.query; // Tambah isEdit

    const data = await service.getSpkDetailsAndMkb(
      spk,
      cabang,
      keterangan,
      isEdit === "true",
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getMintaBahan(nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const saveData = async (req, res) => {
  try {
    const isEdit = !!req.params.nomor;
    const payload = req.body;
    if (isEdit) payload.nomor = req.params.nomor;

    // --- LOGIKA TUTUP BUKU (Translasi dari Delphi) ---
    // 1. Ambil boundary tanggal (zdtClose)
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    const tglInput = new Date(payload.tanggal);

    // 2. Cek Bypass PIN5 (xminta5 = 'ACC')
    // Kita cek apakah ada status ACC untuk nomor ini di database
    const { pin_acc } = payload;

    // 3. Jalankan Validasi Tanggal
    // Jika tanggal input LEBIH KECIL dari tanggal tutup buku,
    // DAN tidak ada ACC dari PIN5, maka TOLAK.
    if (tglInput < zdtClose && pin_acc !== "Y") {
      return res.status(400).json({
        success: false,
        message:
          "Anda tidak boleh input di tanggal periode yang sudah diclose.\nSilahkan ajukan perubahan data (PIN5) terlebih dahulu.",
      });
    }
    // -------------------------------------------------

    // Cek Akses Cabang
    if (
      payload.cabang !== req.user.cabang &&
      req.user.cabang !== "ALL" &&
      !req.user.cabang.startsWith("HO-")
    ) {
      return res.status(403).json({
        success: false,
        message: "Nomor permintaan tsb bukan cabang anda.",
      });
    }

    const result = await service.saveMintaBahan(payload, req.user, isEdit);
    res
      .status(200)
      .json({ success: true, message: "Berhasil disimpan", data: result });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Gagal Simpan: " + error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const data = await service.getPrintData(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

module.exports = {
  getKomponen,
  getSpkInfo,
  getDetail,
  saveData,
  getPrintData,
};
