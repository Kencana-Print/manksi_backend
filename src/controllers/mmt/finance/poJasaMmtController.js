// backend/src/controllers/mmt/finance/poJasaMmtController.js
const poService = require("../../../services/mmt/finance/poJasaMmtService");

const browse = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const data = await poService.getPoJasaBrowse(
      startDate,
      endDate,
      req.user?.cab,
    );
    res.json(data);
  } catch (error) {
    console.error("ERROR API BROWSE PO JASA:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

const remove = async (req, res) => {
  try {
    const { nomor } = req.params;
    await poService.deletePoJasa(nomor, req.user?.cab);
    res.json({ success: true, message: "Berhasil dihapus" });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const submitPin = async (req, res) => {
  try {
    const { pin_nomor, pin_alasan } = req.body;
    if (!pin_alasan) {
      return res.status(400).json({ message: "Alasan harus diisi" });
    }

    const result = await poService.ajukanPerubahan(
      pin_nomor,
      pin_alasan,
      req.user?.nama || req.user?.username || req.user?.kode || "SYSTEM",
    );
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const checkPin = async (req, res) => {
  try {
    const { nomor } = req.params;
    const pool = require("../../../config/database");

    const [rows] = await pool.query(
      'SELECT pin_urut, pin_dipakai, pin_alasan FROM tspk_pin5 WHERE pin_trs="PO JASA MMT" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1',
      [nomor],
    );

    res.json(rows.length > 0 ? rows[0] : null);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getLookupBpb = async (req, res) => {
  try {
    const { q } = req.query;
    const data = await poService.getLookupPoForBpb(q);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDetailForBpb = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await poService.getPoDetailForBpb(nomor);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Detail PO Jasa tidak ditemukan",
      });
    }

    res.json({
      success: true,
      data: data,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getSudahTerima = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await poService.getSudahTerima(nomor);
    res.json({ success: true, totalTerima: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const payload = req.body;
    const currentUser =
      req.user?.kode ||
      req.user?.kdUser ||
      req.user?.nama ||
      payload.currentUser ||
      payload.kdUser ||
      "SYSTEM";

    const result = await poService.savePoJasa(payload, currentUser);
    res.json(result);
  } catch (error) {
    console.error("ERROR API SAVE PO JASA:", error.message);
    res.status(400).json({ success: false, message: error.message });
  }
};

const getDateClose = async (req, res) => {
  try {
    const pool = require("../../../config/database");
    const [rows] = await pool.query(
      "SELECT finance.get_date_close(?) AS closeDate",
      ["PO JASA MMT"],
    );

    res.json({
      success: true,
      closeDate: rows.length > 0 ? rows[0].closeDate : null,
    });
  } catch (error) {
    console.error("ERROR API GET DATE CLOSE:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

const getById = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await poService.getPoJasaById(nomor);

    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Nomor PO Jasa tidak ditemukan" });
    }

    res.json({ success: true, ...data });
  } catch (error) {
    console.error("ERROR API GET BY ID:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

const printData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await poService.getPoJasaById(nomor);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Data PO Jasa untuk cetak tidak ditemukan",
      });
    }

    res.json({
      header: data.header,
      items: data.custom || [],
      alokasi: data.alokasi || [],
      bahanList: data.bahanList || [],
      bahan: data.bahan || [],
    });
  } catch (error) {
    console.error("ERROR API PRINT PO JASA:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

const syncSpk = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await poService.syncSpk(nomor);
    res.json({ success: true, data });
  } catch (error) {
    console.error("ERROR API SYNC SPK:", error.message);
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  browse,
  remove,
  submitPin,
  checkPin,
  getLookupBpb,
  getDetailForBpb,
  getSudahTerima,
  save,
  getDateClose,
  getById,
  printData,
  syncSpk,
};
