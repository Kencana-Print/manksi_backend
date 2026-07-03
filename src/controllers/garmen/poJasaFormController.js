const svc = require("../../services/garmen/poJasaFormService");

// ─────────────────────────────────────────────────────────
// GET SPK INFO — validasi pending penuh + CMO
// GET /api/garmen/po-jasa-form/spk-info?nomor=
// ─────────────────────────────────────────────────────────
const getSpkInfo = async (req, res) => {
  try {
    const { nomor } = req.query;
    if (!nomor) return res.status(400).json({ success: false, message: "nomor wajib." });
    const data = await svc.getSpkInfo(nomor);
    if (!data) return res.status(404).json({ success: false, message: "SPK tidak ditemukan." });

    if (data.spk_pending === "PENDING PENUH" && data.spk_accpending === "N") {
      return res.status(400).json({
        success: false,
        message: "SPK tsb sedang di pending penuh.\nHubungi marketing jika akan tetap melanjutkan transaksi.",
      });
    }
    if (!data.cmo) {
      return res.status(400).json({
        success: false,
        message: "SPK tsb belum di approve oleh Chief Marketing.",
      });
    }
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET JASA LIST — dengan auto-fill gudang produksi
// GET /api/garmen/po-jasa-form/jasa?cab=
// ─────────────────────────────────────────────────────────
const getJasaList = async (req, res) => {
  try {
    const { cab = "" } = req.query;
    const data = await svc.getJasaList(cab);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET PLANNING PPIC
// GET /api/garmen/po-jasa-form/planning?nomorSpk=&jasaKode=
// ─────────────────────────────────────────────────────────
const getPlanningPpic = async (req, res) => {
  try {
    const { nomorSpk, jasaKode } = req.query;
    if (!nomorSpk || !jasaKode) return res.json({ success: true, data: [] });
    const data = await svc.getPlanningPpic(nomorSpk, jasaKode);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// LOAD KODE BAHAN (Tab Komponen)
// GET /api/garmen/po-jasa-form/load-bahan?kode=&jasaKode=&nomorSpk=&gdgpKode=&excludeNomor=
// ─────────────────────────────────────────────────────────
const loadKodeBahan = async (req, res) => {
  try {
    const { kode, jasaKode = "", nomorSpk = "", gdgpKode = "", excludeNomor = "" } = req.query;
    if (!kode) return res.status(400).json({ success: false, message: "kode wajib." });
    const data = await svc.loadKodeBahan(kode, jasaKode, nomorSpk, gdgpKode, excludeNomor);
    if (data.error) return res.status(404).json({ success: false, message: data.error });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// SEARCH BAHAN (F1 di grid)
// GET /api/garmen/po-jasa-form/search-bahan?q=&jasaKode=&withStok=&page=&limit=
// ─────────────────────────────────────────────────────────
const searchBahan = async (req, res) => {
  try {
    const { q = "", jasaKode = "", withStok = "false", page = "1", limit = "30" } = req.query;
    const data = await svc.searchBahan(q, jasaKode, withStok === "true", parseInt(page), parseInt(limit));
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET SET FROM MUTASI (CheckBox1 "Set")
// GET /api/garmen/po-jasa-form/set-mutasi?nomorSpk=&gdgpKode=&jumlahPO=&excludeNomor=
// ─────────────────────────────────────────────────────────
const getSetFromMutasi = async (req, res) => {
  try {
    const { nomorSpk, gdgpKode = "", jumlahPO = "0", excludeNomor = "" } = req.query;
    if (!nomorSpk) return res.status(400).json({ success: false, message: "nomorSpk wajib." });
    const data = await svc.getSetFromMutasi(nomorSpk, gdgpKode, Number(jumlahPO), excludeNomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// SEARCH SUPPLIER
// GET /api/garmen/po-jasa-form/search-supplier?q=&page=&limit=
// ─────────────────────────────────────────────────────────
const searchSupplier = async (req, res) => {
  try {
    const { q = "", page = "1", limit = "30" } = req.query;
    const data = await svc.searchSupplier(q, parseInt(page), parseInt(limit));
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET SUPPLIER BY KODE (exit field kode supplier)
// GET /api/garmen/po-jasa-form/supplier?kode=
// ─────────────────────────────────────────────────────────
const getSupplierByKode = async (req, res) => {
  try {
    const { kode } = req.query;
    if (!kode) return res.status(400).json({ success: false, message: "kode wajib." });
    const data = await svc.getSupplierByKode(kode);
    if (!data) return res.status(404).json({ success: false, message: "Kode Supplier tidak ditemukan." });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// SEARCH GUDANG PRODUKSI
// GET /api/garmen/po-jasa-form/search-gudang?q=&cab=
// ─────────────────────────────────────────────────────────
const searchGudangProduksi = async (req, res) => {
  try {
    const { q = "", cab = "" } = req.query;
    const data = await svc.searchGudangProduksi(q, cab);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// CEK PENDING GUDANG (exit field GdgAsal)
// POST /api/garmen/po-jasa-form/cek-gudang
// body: { nomorSpk, gdgpKode }
// ─────────────────────────────────────────────────────────
const cekPendingGudang = async (req, res) => {
  try {
    const { nomorSpk, gdgpKode } = req.body;
    if (!nomorSpk || !gdgpKode)
      return res.status(400).json({ success: false, message: "nomorSpk dan gdgpKode wajib." });
    const msg = await svc.cekPendingGudang(nomorSpk, gdgpKode);
    if (msg) return res.status(400).json({ success: false, message: msg });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET BY NOMOR
// GET /api/garmen/po-jasa-form/by-nomor?nomor=
// ─────────────────────────────────────────────────────────
const getById = async (req, res) => {
  try {
    const nomor = req.params.nomor || req.query.nomor;
    if (!nomor) return res.status(400).json({ success: false, message: "Nomor wajib." });
    const data = await svc.getById(nomor);
    if (!data) return res.status(404).json({ success: false, message: "Data tidak ditemukan." });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// SAVE (INSERT)
// POST /api/garmen/po-jasa-form
// ─────────────────────────────────────────────────────────
const save = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const nomor = await svc.save(req.body, userKode, true);
    res.json({ success: true, data: { nomor }, message: "Berhasil disimpan." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// UPDATE (EDIT)
// PUT /api/garmen/po-jasa-form/by-nomor
// ─────────────────────────────────────────────────────────
const update = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const data = { ...req.body, Nomor: req.body.Nomor || req.params.nomor };
    const nomor = await svc.save(data, userKode, false);
    res.json({ success: true, data: { nomor }, message: "Berhasil diupdate." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = {
  getSpkInfo,
  getJasaList,
  getPlanningPpic,
  loadKodeBahan,
  searchBahan,
  getSetFromMutasi,
  searchSupplier,
  getSupplierByKode,
  searchGudangProduksi,
  cekPendingGudang,
  getById,
  save,
  update,
};