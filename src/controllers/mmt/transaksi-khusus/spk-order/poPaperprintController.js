// backend/src/controllers/poPaperprint.controller.js

const service = require("../../../../services/mmt/transaksi-khusus/spk-order/poPaperprintService.js");
const { format, startOfMonth } = require("date-fns");

// READ MASTER (Browse List)
const getPoPaperprint = async (req, res) => {
  const endDate = req.query.endDate || format(new Date(), "yyyy-MM-dd");
  const startDate =
    req.query.startDate || format(startOfMonth(new Date()), "yyyy-MM-dd");

  try {
    const data = await service.getPoPaperprintMaster(startDate, endDate);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// READ DETAIL (Expanded Row per Nomor)
const getPoPaperprintDetail = async (req, res) => {
  const nomor = req.query.nomor || req.params.nomor;
  try {
    const data = await service.getPoPaperprintDetail(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// READ SINGLE PO (Header + Detail untuk Mode Edit / Print)
const getPoPaperprintByNomor = async (req, res) => {
  const { nomor } = req.params;
  try {
    const details = await service.getPoPaperprintDetail(nomor);
    // Ambil header dari master query dengan rentang tanggal luas
    const masterList = await service.getPoPaperprintMaster(
      "2000-01-01",
      "2099-12-31",
    );
    const header = masterList.find((h) => h.Nomor === nomor) || null;

    if (!header) {
      return res
        .status(404)
        .json({ message: "PO Paperprint tidak ditemukan." });
    }

    res.json({ header, details });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GENERATE MAX NOMOR OTOMATIS
const getMaxNomor = async (req, res) => {
  const { tanggal } = req.query;
  try {
    const nomor = await service.generateMaxNomor(tanggal);
    res.json({ success: true, nomor });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const createPoPaperprint = async (req, res) => {
  try {
    // 1. Parsing payload "data" dari FormData
    let payload = req.body;
    if (typeof req.body.data === "string") {
      payload = JSON.parse(req.body.data);
    } else if (req.body.data) {
      payload = req.body.data;
    }

    // 2. Ambil header & details (berikan fallback jika struktur bertingkat)
    const header = payload.header || payload;
    const details = payload.details || payload.Detail || [];
    const files = req.files || []; // File gambar yang di-upload via Multer

    // 3. Panggil Service
    const result = await service.createPoPaperprint(
      { header, details },
      files,
      req.user,
    );

    res.status(201).json({
      success: true,
      message: "PO Paperprint berhasil disimpan",
      data: result,
      nomor: result.nomor || header.nomor,
    });
  } catch (error) {
    console.error("Error createPoPaperprint:", error);
    res
      .status(500)
      .json({ message: error.message || "Gagal menyimpan PO Paperprint" });
  }
};

const updatePoPaperprint = async (req, res) => {
  const { nomor } = req.params;
  try {
    let payload = req.body;
    if (typeof req.body.data === "string") {
      payload = JSON.parse(req.body.data);
    } else if (req.body.data) {
      payload = req.body.data;
    }

    const header = payload.header || payload;
    const details = payload.details || payload.Detail || [];
    const files = req.files || [];

    const result = await service.updatePoPaperprint(
      nomor,
      { header, details },
      files,
      req.user,
    );

    res.json({
      success: true,
      message: "PO Paperprint berhasil diubah",
      data: result,
      nomor: result.nomor || nomor,
    });
  } catch (error) {
    console.error("Error updatePoPaperprint:", error);
    res
      .status(500)
      .json({ message: error.message || "Gagal mengubah PO Paperprint" });
  }
};

// DELETE (Hapus Transaksi)
const deletePoPaperprint = async (req, res) => {
  const { nomor } = req.params;
  try {
    await service.deletePoPaperprint(nomor);
    res.status(200).json({ message: "PO Paperprint berhasil dihapus." });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getPoPaperprint,
  getPoPaperprintDetail,
  getPoPaperprintByNomor,
  getMaxNomor,
  createPoPaperprint,
  updatePoPaperprint,
  deletePoPaperprint,
};
