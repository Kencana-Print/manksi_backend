// Pastikan nama file service sesuai dengan file fisik Anda (misal: poExternal.service)
const poService = require("../../../services/mmt/finance/poExtMmtService");

const browse = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // PENTING: Response disesuaikan langsung mengembalikan Array data [ ]
    // karena di Vue: masterData.value = res.data || []; (Tanpa .data.data)
    const data = await poService.getPoExternalBrowse(
      startDate,
      endDate,
      req.user?.cab,
    );

    res.json(data);
  } catch (error) {
    console.error("ERROR API BROWSE:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

const remove = async (req, res) => {
  try {
    const { nomor } = req.params;
    await poService.deletePoExternal(nomor, req.user?.cab);
    res.json({ success: true, message: "Berhasil dihapus" });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const submitPin = async (req, res) => {
  try {
    // PERBAIKAN: Menyesuaikan properti payload JSON dari Vue Frontend
    const { pin_nomor, pin_alasan } = req.body;
    if (!pin_alasan)
      return res.status(400).json({ message: "Alasan harus diisi" });

    const result = await poService.ajukanPerubahan(
      pin_nomor,
      pin_alasan,
      (req.user?.nama || req.user?.username || req.user?.kode || 'SYSTEM') || (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM'),
    );
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// BARU: Menangani request check-pin dari frontend sebelum dialog modal alasan terbuka
const checkPin = async (req, res) => {
  try {
    const { nomor } = req.params;
    const pool = require("../../../config/database");

    // Mengambil status PIN terakhir untuk keperluan urutan koli/index di frontend
    const [rows] = await pool.query(
      'SELECT pin_urut, pin_dipakai, pin_alasan FROM tspk_pin5 WHERE pin_trs="PO EXT MMT" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1',
      [nomor],
    );

    // Kembalikan objek tunggal atau null agar dibaca dengan benar oleh Vue
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
        message: "Detail PO tidak ditemukan",
      });
    }

    // 🌟 PERBAIKAN: Kirim objek utuh agar frontend dapat membaca d.poe_nomor, d.spk_nama, dll.
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

    // Prioritas:
    // 1. Dari middleware auth (req.user) jika route diproteksi JWT
    // 2. Dari body payload frontend (payload.currentUser atau payload.kdUser)
    // 3. Fallback ke "SYSTEM"
    const currentUser =
      (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') ||
      (req.user?.nama || req.user?.username || req.user?.kode || 'SYSTEM') ||
      payload.currentUser ||
      payload.kdUser ||
      "SYSTEM";

    const result = await poService.savePoExternal(payload, currentUser);
    res.json(result);
  } catch (error) {
    console.error("ERROR API SAVE PO EXT:", error.message);
    res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * BARU: Mendapatkan tanggal limit periode closing (ZCLOSE) dari Delphi
 * Sesuai dengan aksi: api.get(`${API_URL}/date-close/PO EXT MMT`)
 */
const getDateClose = async (req, res) => {
  try {
    const pool = require("../../../config/database");
    // Meniru fungsi global bulanan milik Delphi untuk modul PO EXT MMT
    const [rows] = await pool.query(
      "SELECT finance.get_date_close(?) AS closeDate",
      ["PO EXT MMT"],
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
    const data = await poService.getPoExternalById(nomor);

    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Nomor PO tidak ditemukan" });
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
    const data = await poService.getPoExternalById(nomor);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Data PO untuk cetak tidak ditemukan",
      });
    }

    // Menyesuaikan struktur output yang diminta oleh frontend cetak (header, items, alokasi)
    res.json({
      header: data.header,
      items: data.custom || [], // Item pesanan custom merujuk ke tpoexternal_custom
      alokasi: data.alokasi || [], // Alokasi kota merujuk ke tpoexternal_dtl_alokasi
    });
  } catch (error) {
    console.error("ERROR API PRINT PO EXT:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  browse,
  remove,
  save,
  getById,
  printData,
  getDateClose,
  submitPin,
  checkPin,
  getLookupBpb,
  getDetailForBpb,
  getSudahTerima,
};
