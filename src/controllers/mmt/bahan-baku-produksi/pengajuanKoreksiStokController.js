const service = require("../../../services/mmt/bahan-baku-produksi/pengajuanKoreksiStokService");

const getPengajuan = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const user = req.user?.kode || (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') || "SYSTEM";
    const data = await service.getPengajuanData(startDate, endDate, user);
    res.json({ success: true, data });
  } catch (e) {
    console.error("getPengajuan:", e.message);
    res.status(500).json({ success: false, message: e.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const { nomor } = req.query;
    if (!nomor) return res.status(400).json({ success:false, message:"nomor required"});
    const data = await service.getPengajuanDetail(nomor);
    res.json({ success:true, data });
  } catch (e) {
    res.status(404).json({ success:false, message:e.message});
  }
};

const savePengajuan = async (req, res) => {
  try {
    const user = req.user?.kode || (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') || (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') || "SYSTEM";
    const result = await service.savePengajuan(req.body, user);
    res.json({ success:true, data: result });
  } catch (e) {
    console.error("savePengajuan", e);
    res.status(500).json({ success:false, message:e.message});
  }
};

const deletePengajuan = async (req, res) => {
  try {
    const { nomor } = req.params;
    const user = req.user?.kode || "SYSTEM";
    await service.deletePengajuan(nomor, user);
    res.json({ success:true, message:"Pengajuan dihapus"});
  } catch (e) {
    res.status(400).json({ success:false, message:e.message});
  }
};

const approvePengajuan = async (req, res) => {
  try {
    const { nomor } = req.params;
    const user = req.user?.kode || (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') || "SYSTEM";
    const result = await service.approvePengajuan(nomor, user);
    res.json({ success:true, data: result, message:"Pengajuan disetujui. Stok telah dikoreksi."});
  } catch (e) {
    res.status(400).json({ success:false, message:e.message});
  }
};

const rejectPengajuan = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { reason } = req.body;
    const user = req.user?.kode || (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') || "SYSTEM";
    await service.rejectPengajuan(nomor, user, reason);
    res.json({ success:true, message:"Pengajuan ditolak"});
  } catch (e) {
    res.status(400).json({ success:false, message:e.message});
  }
};

module.exports = { getPengajuan, getDetail, savePengajuan, deletePengajuan, approvePengajuan, rejectPengajuan };
