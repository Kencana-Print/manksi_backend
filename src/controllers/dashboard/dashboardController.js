const service = require("../../services/dashboard/dashboardService");

const getSpkUrgent = async (req, res) => {
  try {
    const data = await service.getSpkUrgent(req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getPenawaranSummary = async (req, res) => {
  try {
    const data = await service.getPenawaranSummary(req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getPenawaranBelumSpk = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const data = await service.getPenawaranBelumSpk(req.user, limit, offset);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getSpkSummary = async (req, res) => {
  try {
    const data = await service.getSpkSummary(req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getPoBahanSisa = async (req, res) => {
  try {
    const data = await service.getPoBahanSisa(req.user);
    // null = user tidak berhak, kembalikan empty
    res
      .status(200)
      .json({ success: true, data: data ?? { TotalPO: 0, PoAdaSisa: 0 } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getPoBahanVsBpbSummary = async (req, res) => {
  try {
    const data = await service.getPoBahanVsBpbSummary(req.user);
    res.status(200).json({
      success: true,
      data: data ?? { TotalPO: 0, Open: 0, OnProses: 0, Close: 0 },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getPenawaranBelumMap = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const data = await service.getPenawaranBelumMap(req.user, limit, offset);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getPenawaranMapSummary = async (req, res) => {
  try {
    const data = await service.getPenawaranMapSummary(req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getKunjunganSalesSummary = async (req, res) => {
  try {
    const data = await service.getKunjunganSalesSummary(req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getPiutangDashboard = async (req, res) => {
  try {
    const data = await service.getPiutangDashboard(req.user);

    res.status(200).json({
      success: true,
      data: data || { summary: {}, top5: [], overdue: [] },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getPiutangOverdue = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const data = await service.getPiutangOverdue(req.user, limit, offset);
    res.status(200).json({ success: true, data: data ?? [] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getPenerimaanSummary = async (req, res) => {
  try {
    const data = await service.getPenerimaanSummary(req.user);
    res.status(200).json({
      success: true,
      data: data ?? {
        TotalPenerimaanBulanIni: 0,
        JmlTransaksiBulanIni: 0,
        SaldoBelumAplikasi: 0,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getGudangBahanDashboard = async (req, res) => {
  try {
    const data = await service.getGudangBahanDashboard(req.user);
    res.status(200).json({
      success: true,
      data: data || {
        metric: {
          TotalJenis: 0,
          JmlBawahBuffer: 0,
          TotalBarcode: 0,
          JmlMinus: 0,
        },
        detailBawahBuffer: [],
        topStok: [],
        bahanBarcode: [],
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getGudangBahanBuffer = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const data = await service.getGudangBahanBuffer(req.user, limit, offset);
    res.status(200).json({ success: true, data: data ?? [] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getGudangBahanBarcode = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const data = await service.getGudangBahanBarcode(req.user, limit, offset);
    res.status(200).json({ success: true, data: data ?? [] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getRealisasiPenawaranDashboard = async (req, res) => {
  try {
    const data = await service.getRealisasiPenawaranDashboard(req.user);
    res.status(200).json({
      success: true,
      data: data || { metric: {}, tren: [], distribusi: [] },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getRealisasiPenawaranDetail = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const data = await service.getRealisasiPenawaranDetail(
      req.user,
      limit,
      offset,
    );
    res.status(200).json({ success: true, data: data ?? [] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getMapVsSpkDashboard = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const data = await service.getMapVsSpkDashboard(
      req.user,
      startDate,
      endDate,
    );
    res
      .status(200)
      .json({ success: true, data: data || { metric: {}, divisi: [] } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getMapBelumSpk = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const { startDate, endDate } = req.query;
    const data = await service.getMapBelumSpk(
      req.user,
      limit,
      offset,
      startDate,
      endDate,
    );
    res.status(200).json({ success: true, data: data ?? [] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getMapVsSjDashboard = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const data = await service.getMapVsSjDashboard(
      req.user,
      startDate,
      endDate,
    );
    res.status(200).json({ success: true, data: data || {} });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getMapBelumKirim = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const { startDate, endDate } = req.query;
    const data = await service.getMapBelumKirim(
      req.user,
      limit,
      offset,
      startDate,
      endDate,
    );
    res.status(200).json({ success: true, data: data ?? [] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getSpkBelumMkbCount = async (req, res) => {
  try {
    const data = await service.getSpkBelumMkbCount(req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAktivitasHariIni = async (req, res) => {
  try {
    const data = await service.getAktivitasHariIni();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getTrendSpk7Hari = async (req, res) => {
  try {
    const data = await service.getTrendSpk7Hari();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getApprovalPendingCount = async (req, res) => {
  try {
    const data = await service.getApprovalPendingCount();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getSpkUrgent,
  getPenawaranSummary,
  getPenawaranBelumSpk,
  getSpkSummary,
  getPoBahanSisa,
  getPoBahanVsBpbSummary,
  getPenawaranBelumMap,
  getPenawaranMapSummary,
  getKunjunganSalesSummary,
  getPiutangDashboard,
  getPiutangOverdue,
  getPenerimaanSummary,
  getGudangBahanDashboard,
  getGudangBahanBuffer,
  getGudangBahanBarcode,
  getRealisasiPenawaranDashboard,
  getRealisasiPenawaranDetail,
  getMapVsSpkDashboard,
  getMapBelumSpk,
  getMapVsSjDashboard,
  getMapBelumKirim,
  getSpkBelumMkbCount,
  getAktivitasHariIni,
  getTrendSpk7Hari,
  getApprovalPendingCount,
};
