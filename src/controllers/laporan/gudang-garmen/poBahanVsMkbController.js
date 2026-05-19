const service = require("../../../services/laporan/gudang-garmen/poBahanVsMkbService");

const getBrowse = async (req, res) => {
  try {
    const data = await service.getBrowse(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getBrowseDetail = async (req, res) => {
  try {
    const nomorPO = req.params.nomor;

    // 1. Ambil detail bahan dari PO
    const detailBahan = await service.getBrowseDetail(nomorPO);

    // 2. Loop detail bahan untuk mencari history MKB-nya
    const promises = detailBahan.map(async (bahan) => {
      const mkbHistory = await service.getSubDetailMkb(
        nomorPO,
        bahan.UrutPO,
        bahan.KodeBahan,
        bahan.NomorMKB_Utama,
      );

      return {
        ...bahan,
        RiwayatMkb: mkbHistory,
      };
    });

    const dataComplete = await Promise.all(promises);

    res.status(200).json({ success: true, data: dataComplete });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  getBrowseDetail,
};
