// backend/src/controllers/invoicePembelian.controller.js

const invoicePembelianService = require('../../../services/mmt/finance/invoicePembelianService.js');

// =============================
// GET BY NOMOR
// =============================
exports.getInvoiceByNomor = async (req, res) => {
    try {
        const { nomor } = req.params;

        const data = await invoicePembelianService.getInvoicePembelianByNomor(nomor);

        res.json(data);

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: error.message });
    }
};

// =============================
// GET LIST (BY DATE)
// =============================
exports.getInvoiceList = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({ message: 'startDate dan endDate wajib diisi' });
        }

        const data = await invoicePembelianService.getInvoicePembelianData(startDate, endDate);
        res.json(data);

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: error.message });
    }
};

// =============================
// SAVE (INSERT / UPDATE)
// =============================
// backend/src/controllers/invoicePembelian.controller.js

exports.saveInvoice = async (req, res) => {
  try {
    const data = req.body;
    const nomorToEdit = data.nomorToEdit || null;

    // SAMAKAN DENGAN PERMINTAAN BAHAN: ambil kdUser
    const currentUser = req.user ? ((req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') || req.user.username) : 'SYSTEM';

    // Panggil service dengan urutan parameter yang benar
    const result = await invoicePembelianService.saveInvoicePembelian(
      data, 
      nomorToEdit, 
      currentUser
    );

    res.status(200).json({
      message: nomorToEdit ? "Invoice berhasil diupdate" : "Invoice berhasil disimpan",
      data: result,
      oleh: currentUser // Tambahkan ini untuk debug di frontend
    });
  } catch (error) {
    console.error("SAVE INVOICE ERROR:", error);
    res.status(500).json({ message: error.message });
  }
};


// =============================
// PRINT
// =============================
exports.printInvoice = async (req, res) => {
    try {
        const { nomor } = req.params;

        const data = await invoicePembelianService.getInvoicePembelianForPrint(nomor);

        res.json(data);

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: error.message });
    }
};

// =============================
// GENERATE NOMOR BARU
// =============================
exports.getNextNomor = async (req, res) => {
    try {
        const { kodePerush, tanggal } = req.query;

        if (!kodePerush || !tanggal) {
            return res.status(400).json({ message: 'kodePerush dan tanggal wajib diisi' });
        }

        const nomor = await invoicePembelianService.generateMaxKode(kodePerush, tanggal);

        res.json({ nextNomor: nomor });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: error.message });
    }
};


exports.deleteInvoice = async (req, res) => {
    try {
        const { nomor } = req.params;
        // Panggil service yang menghapus tinvp_hdr & tjurnal_mmt secara transaksional
        await invoicePembelianService.deleteInvoice(nomor); 
        res.json({ message: "Invoice dan Jurnal terkait berhasil dihapus" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};