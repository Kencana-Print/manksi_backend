const svc = require("../../../services/laporan/gudang-garmen/realisasiMintaVsLhkCuttService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, cab = "ALL", spk = "" } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Tgl Permintaan wajib diisi." });
    }
    const data = await svc.getBrowse(startDate, endDate, cab, spk);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// :id = "{Nomor} {Kode}" (persis format Id di master, dipisah spasi).
// Frontend WAJIB encodeURIComponent(row.Id) saat memanggil endpoint ini.
const getDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const idxSpace = id.indexOf(" ");
    if (idxSpace === -1) {
      return res
        .status(400)
        .json({ success: false, message: "Id tidak valid." });
    }
    const nomor = id.substring(0, idxSpace);
    const kode = id.substring(idxSpace + 1);
    const data = await svc.getDetail(nomor, kode);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getAllDetail = async (req, res) => {
  try {
    const { startDate, endDate, cab = "ALL", spk = "" } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Tgl Permintaan wajib diisi." });
    }
    const data = await svc.getAllDetail(startDate, endDate, cab, spk);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getBrowse, getDetail, getAllDetail };
