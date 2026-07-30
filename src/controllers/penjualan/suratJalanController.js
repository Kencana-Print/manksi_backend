const svc = require("../../services/penjualan/suratJalanService");

const getBrowse = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, divisi = 0 } = req.query;
    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1;
    const data = await svc.getBrowse(
      tglAwal,
      tglAkhir,
      Number(divisi),
      canLihatCus,
    );
    res.json({ success: true, data, canLihatCus });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getBrowseDetail = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, nomor = "" } = req.query;
    const data = await svc.getBrowseDetail(tglAwal, tglAkhir, nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const cekBisaHapusUbah = async (req, res) => {
  try {
    const { nomor } = req.query;
    const data = await svc.cekBisaHapusUbah(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const deleteData = async (req, res) => {
  try {
    const { nomor } = req.body;
    if (!nomor)
      return res.status(400).json({ success: false, message: "Nomor wajib." });
    const userKode = req.user?.kode || req.user?.user_kode || "";
    await svc.deleteData(nomor, userKode);
    res.json({ success: true, message: "Data berhasil dihapus." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getPengajuanStatus = async (req, res) => {
  try {
    const { nomor } = req.query;
    const data = await svc.getPengajuanStatus(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const pengajuanUbah = async (req, res) => {
  try {
    const { nomor, tanggal, keterangan, alasan, urut } = req.body;
    if (!nomor || !alasan) {
      return res
        .status(400)
        .json({ success: false, message: "Nomor dan alasan wajib." });
    }
    const userKode = req.user?.kode || req.user?.user_kode || "";
    await svc.pengajuanUbah(nomor, tanggal, keterangan, alasan, urut, userKode);
    res.json({ success: true, message: "Pengajuan berhasil." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const cekSjKemarinBelumApprove = async (req, res) => {
  try {
    const ada = await svc.cekSjKemarinBelumApprove();
    res.json({ success: true, data: { ada } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getExportData = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, divisi = 0 } = req.query;
    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1;
    const data = await svc.getExportData(
      tglAwal,
      tglAkhir,
      Number(divisi),
      canLihatCus,
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getExportDetail = async (req, res) => {
  try {
    const { tglAwal, tglAkhir } = req.query;
    const data = await svc.getExportDetail(tglAwal, tglAkhir);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const cekPerluPengajuan = async (req, res) => {
  try {
    const { nomor } = req.query;
    if (!nomor)
      return res.status(400).json({ success: false, message: "Nomor wajib." });
    const data = await svc.cekPerluPengajuan(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  cekBisaHapusUbah,
  deleteData,
  getPengajuanStatus,
  pengajuanUbah,
  cekSjKemarinBelumApprove,
  getExportData,
  getExportDetail,
  cekPerluPengajuan,
};
