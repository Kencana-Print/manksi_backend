const service = require("../../../services/laporan/piutang/spkTerkirimBelumInvoiceService");

// Format YYYY-MM-DD dan benar-benar tanggal yang ada (mis. 2026-02-30 ditolak)
const isTanggalValid = (v) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

const getSpkTerkirimBelumInvoice = async (req, res) => {
  try {
    const { endDate, perusahaan } = req.query;
    if (endDate && !isTanggalValid(endDate)) {
      return res
        .status(400)
        .json({ success: false, message: "Format tanggal harus YYYY-MM-DD." });
    }
    if (perusahaan && !/^[A-Za-z0-9]{1,10}$/.test(String(perusahaan))) {
      return res
        .status(400)
        .json({ success: false, message: "Kode perusahaan tidak valid." });
    }
    const data = await service.getSpkTerkirimBelumInvoice({
      endDate,
      perusahaan,
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getSpkTerkirimBelumInvoice };
