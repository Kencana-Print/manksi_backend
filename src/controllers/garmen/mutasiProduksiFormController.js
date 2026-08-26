const svc = require("../../services/garmen/mutasiProduksiFormService");
const tutupBukuService = require("../../services/tutupBukuService");

// ─────────────────────────────────────────────────────────
// GET GUDANG BY JENIS MUTASI
// GET /api/garmen/mutasi-produksi-form/gudang-mutasi?cab=&jenis=
// ─────────────────────────────────────────────────────────
const getGudangByMutasi = async (req, res) => {
  try {
    const { cab = "P04", jenis } = req.query;
    if (!jenis)
      return res
        .status(400)
        .json({ success: false, message: "jenis wajib diisi." });
    const data = svc.getGudangByMutasi(cab, jenis);
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Jenis mutasi tidak ditemukan." });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET SPK INFO
// GET /api/garmen/mutasi-produksi-form/spk-info?nomor=
// ─────────────────────────────────────────────────────────
const getSpkInfo = async (req, res) => {
  try {
    const { nomor } = req.query;
    if (!nomor)
      return res
        .status(400)
        .json({ success: false, message: "nomor wajib diisi." });
    const data = await svc.getSpkInfo(nomor);
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Nomor SPK tidak ditemukan." });

    // Validasi pending penuh
    if (data.spk_pending === "PENDING PENUH" && data.spk_accpending === "N") {
      return res.status(400).json({
        success: false,
        message:
          "SPK tsb sedang di pending penuh.\nHubungi marketing jika akan tetap melanjutkan transaksi.",
      });
    }
    // Validasi CMO
    if (!data.spk_cmo && !nomor.startsWith("SPG") && !nomor.startsWith("MAP")) {
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
// GET KOMPONEN LIST
// GET /api/garmen/mutasi-produksi-form/komponen?nomorSpk=
// ─────────────────────────────────────────────────────────
const getKomponenList = async (req, res) => {
  try {
    const { nomorSpk } = req.query;
    const data = await svc.getKomponenList(nomorSpk || "");
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET BABARAN STD + MKB INFO
// GET /api/garmen/mutasi-produksi-form/babaran?nomorSpk=&komponen=
// ─────────────────────────────────────────────────────────
const getBabaranInfo = async (req, res) => {
  try {
    const { nomorSpk, komponen } = req.query;
    const [babaran, mkb] = await Promise.all([
      svc.getBabaranStd(nomorSpk, komponen),
      svc.getMkbInfo(nomorSpk, komponen),
    ]);
    res.json({ success: true, data: { babaran, mkb } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// SEARCH NO MATERIAL
// GET /api/garmen/mutasi-produksi-form/search-material?nomorSpk=&q=&page=&limit=
// ─────────────────────────────────────────────────────────
const searchNoMaterial = async (req, res) => {
  try {
    const {
      nomorSpk = "",
      q = "",
      excludeNomor = "",
      page = "1",
      limit = "30",
    } = req.query;
    const data = await svc.searchNoMaterial(
      nomorSpk,
      q,
      excludeNomor,
      parseInt(page),
      parseInt(limit),
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET NO MATERIAL DETAIL
// GET /api/garmen/mutasi-produksi-form/material-detail?noMaterial=&kodeBahan=&excludeNomor=
// ─────────────────────────────────────────────────────────
const getNoMaterialDetail = async (req, res) => {
  try {
    const { noMaterial, kodeBahan, excludeNomor = "" } = req.query;
    if (!noMaterial || !kodeBahan) {
      return res
        .status(400)
        .json({ success: false, message: "noMaterial dan kodeBahan wajib." });
    }
    const data = await svc.getNoMaterialDetail(
      noMaterial,
      kodeBahan,
      excludeNomor,
    );
    if (!data.detail) {
      return res.status(404).json({
        success: false,
        message: "No permintaan dengan kode kain tsb tidak ada.",
      });
    }
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET PLANNING PPIC
// GET /api/garmen/mutasi-produksi-form/planning?nomorSpk=&jenis=&kelompok=
// ─────────────────────────────────────────────────────────
const getPlanningPpic = async (req, res) => {
  try {
    const { nomorSpk, jenisMutasi, kelompok = "", tglDibuat = "" } = req.query;
    const data = await svc.getPlanningPpic(
      nomorSpk,
      jenisMutasi,
      kelompok,
      tglDibuat,
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET KELOMPOK LIST
// GET /api/garmen/mutasi-produksi-form/kelompok?namaGudang=&cab=
// ─────────────────────────────────────────────────────────
const getKelompokList = async (req, res) => {
  try {
    const { namaGudang = "", cab = "" } = req.query;
    const data = await svc.getKelompokList(namaGudang, cab);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET KELOMPOK TUJUAN LIST
// GET /api/garmen/mutasi-produksi-form/kelompok-tujuan?gdgTujuan=&cab=
// ─────────────────────────────────────────────────────────
const getKelompokTujuanList = async (req, res) => {
  try {
    const { gdgTujuan = "", cab = "" } = req.query;
    const data = await svc.getKelompokTujuanList(gdgTujuan, cab);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// SEARCH BAHAN
// GET /api/garmen/mutasi-produksi-form/search-bahan?q=&gdgAsal=&page=&limit=
// ─────────────────────────────────────────────────────────
const searchBahan = async (req, res) => {
  try {
    const { q = "", gdgAsal = "", page = "1", limit = "30" } = req.query;
    const data = await svc.searchBahan(
      q,
      gdgAsal,
      parseInt(page),
      parseInt(limit),
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// LOAD KODE BAHAN (auto-expand per size)
// GET /api/garmen/mutasi-produksi-form/load-bahan?kode=&nomorSpk=&gdgAsal=&excludeNomor=
// ─────────────────────────────────────────────────────────
const loadKodeBahan = async (req, res) => {
  try {
    const {
      kode,
      nomorSpk,
      gdgAsal,
      excludeNomor = "",
      spkKodek = "",
    } = req.query;
    if (!kode || !nomorSpk || !gdgAsal) {
      return res
        .status(400)
        .json({ success: false, message: "kode, nomorSpk, gdgAsal wajib." });
    }
    const data = await svc.loadKodeBahan(
      kode,
      nomorSpk,
      gdgAsal,
      excludeNomor,
      spkKodek,
    );
    if (data.error)
      return res.status(404).json({ success: false, message: data.error });
    res.json({ success: true, data: data.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// LOAD KOMPONEN MAP
// GET /api/garmen/mutasi-produksi-form/komponen-map?nomorSpk=&komponen=&jumlahSpk=&excludeNomor=
// ─────────────────────────────────────────────────────────
const loadKomponenMap = async (req, res) => {
  try {
    const {
      nomorSpk,
      komponen,
      jumlahSpk = "0",
      excludeNomor = "",
      gdgAsal = "GP001",
    } = req.query;
    if (!nomorSpk || !komponen) {
      return res
        .status(400)
        .json({ success: false, message: "nomorSpk dan komponen wajib." });
    }
    const data = await svc.loadKomponenMap(
      nomorSpk,
      komponen,
      jumlahSpk,
      excludeNomor,
      gdgAsal,
    );
    res.json({ success: true, data: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET KOMPONEN PROOF (untuk DC GP032)
// GET /api/garmen/mutasi-produksi-form/komponen-proof?nomorSpk=
// ─────────────────────────────────────────────────────────
const getKomponenProof = async (req, res) => {
  try {
    const { nomorSpk } = req.query;
    if (!nomorSpk) return res.json({ success: true, data: [] });
    const [detail, terima, sudahDc] = await Promise.all([
      svc.getKomponenProof(nomorSpk),
      svc.getTerimaGp032(nomorSpk),
      svc.getSudahGp032(nomorSpk),
    ]);
    res.json({ success: true, data: { detail, terima, sudahDc } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// CEK VALIDASI GUDANG ASAL (pending, planning, LHK)
// POST /api/garmen/mutasi-produksi-form/cek-gudang-asal
// ─────────────────────────────────────────────────────────
const cekGudangAsal = async (req, res) => {
  try {
    // Gunakan 'let' agar nilai ckcetak dan ckbordir bisa kita timpa
    let {
      nomorSpk,
      gdgAsal,
      ckcetak = false,
      ckbordir = false,
      lbldivisi = "",
    } = req.body;

    // --- BACA DARI IDENTITAS KOMPONEN (SECOND PROCESS) ---
    // Jika dari frontend/header bernilai false, pastikan cek lagi ke tabel komponen
    if (nomorSpk) {
      if (!ckcetak) ckcetak = await svc.cekKomponen(nomorSpk, "CETAK");
      if (!ckbordir) ckbordir = await svc.cekKomponen(nomorSpk, "BORDIR");
    }
    // -----------------------------------------------------

    const isSpg = nomorSpk?.startsWith("SPG");
    const skipValidation = svc.isSkipPlanningValidation(nomorSpk || "");

    // 1. Cek pending
    const pendingMsg = await svc.cekPendingSpk(nomorSpk, gdgAsal);
    if (pendingMsg)
      return res.status(400).json({ success: false, message: pendingMsg });

    if (!isSpg && !skipValidation) {
      // 2. Cek planning
      const planningMap = {
        GP001: "CUTTING",
        GP015: "CUTTING",
        GP002: "SEWING",
        GP017: "SEWING",
        GP014: "KOLI",
        GP016: "KOLI", // bordir
        GP003: "SEWING",
        GP018: "SEWING",
        GP004: "KOLI",
        GP019: "KOLI",
      };
      // ⚠️ FIX: token spesifik utk fallback ke tplanningspk — "SEWING" generik
      // dipecah jadi CETAK (GP002/GP017) vs JAHIT (GP003/GP018), supaya cek
      // planning per-SPK bisa pilih kolom yg benar (plan_cetak vs plan_jahit)
      const planSpkKolomMap = {
        GP001: "CUTTING",
        GP015: "CUTTING",
        GP002: "CETAK",
        GP017: "CETAK",
        GP014: "BORDIR",
        GP016: "BORDIR",
        GP003: "JAHIT",
        GP018: "JAHIT",
        GP004: "KOLI",
        GP019: "KOLI",
      };
      const planningDivisi = planningMap[gdgAsal];
      if (planningDivisi) {
        const hasPlan = await svc.cekPlanning(
          nomorSpk,
          planningDivisi,
          planSpkKolomMap[gdgAsal],
        );
        if (!hasPlan) {
          const msgMap = {
            GP001: "cutting",
            GP015: "cutting",
            GP002: "cetak atau sublim",
            GP017: "cetak atau sublim",
            GP014: "bordir",
            GP016: "bordir",
            GP003: "jahit",
            GP018: "jahit",
            GP004: "finishing",
            GP019: "finishing",
          };
          return res.status(400).json({
            success: false,
            message: `Spk tsb belum input planning ${msgMap[gdgAsal] || ""}.`,
          });
        }
      }

      // 3. Cek LHK sebelumnya
      const hasPo = await svc.cekPoInternal(nomorSpk);

      const lhkPrevMap = {
        GP012: "GP001",
        GP021: "GP015", // qc cutting → butuh LHK cutting
        GP032: null, // DC — cek khusus
        GP018: null, // jahit P1 — cek dc
        GP003: null, // jahit P4 — cek dc
        GP004: null,
        GP019: null, // finishing — cek LHK jahit
      };

      if (gdgAsal === "GP012" || gdgAsal === "GP021") {
        const lhkAsal = gdgAsal === "GP012" ? "GP001" : "GP015";
        const hasLhk = await svc.cekLhk(nomorSpk, lhkAsal);
        if (!hasLhk && !hasPo) {
          return res.status(400).json({
            success: false,
            message: "Spk tsb belum input lhk cutting.\nHubungi divisi tsb.",
          });
        }
      } else if (gdgAsal === "GP004" || gdgAsal === "GP019") {
        const lhkJahit = gdgAsal === "GP004" ? "GP003" : "GP018";
        const hasLhk = await svc.cekLhk(nomorSpk, lhkJahit);
        if (!hasLhk && !hasPo) {
          return res.status(400).json({
            success: false,
            message: "Spk tsb belum input lhk jahit.\nHubungi divisi tsb.",
          });
        }
      } // Cek LHK DC (GP032)
      else if (gdgAsal === "GP032") {
        const divisi = lbldivisi || "";
        if (!ckcetak && !ckbordir) {
          // Tidak ada cetak/bordir → harus ada LHK QC Cutting
          const gdgQcCut = "GP012"; // P04 default, nanti bisa cek divisi
          const hasLhk =
            (await svc.cekLhk(nomorSpk, gdgQcCut)) ||
            (await svc.cekLhk(nomorSpk, "GP021"));
          if (!hasLhk && !hasPo)
            return res.status(400).json({
              success: false,
              message:
                "Spk tsb belum input lhk qc cutting.\nHubungi divisi tsb.",
            });
        }
        if (ckcetak && divisi === "3") {
          // Kaosan + cetak → cek LHK QC Cutting
          const hasLhk =
            (await svc.cekLhk(nomorSpk, "GP012")) ||
            (await svc.cekLhk(nomorSpk, "GP021"));
          if (!hasLhk && !hasPo)
            return res.status(400).json({
              success: false,
              message:
                "Spk tsb belum input lhk qc cutting.\nHubungi divisi tsb.",
            });
        }
        if (ckbordir) {
          // Bordir → cek LHK QC Cetak
          const hasLhk =
            (await svc.cekLhk(nomorSpk, "GP010")) ||
            (await svc.cekLhk(nomorSpk, "GP022"));
          if (!hasLhk && !hasPo)
            return res.status(400).json({
              success: false,
              message: "Spk tsb belum input lhk qc cetak.\nHubungi divisi tsb.",
            });
        }
      }
      // Cek LHK Jahit P1 (GP018)
      else if (gdgAsal === "GP018") {
        if (ckcetak) {
          const hasLhk =
            (await svc.cekLhk(nomorSpk, "GP010")) ||
            (await svc.cekLhk(nomorSpk, "GP022"));
          if (!hasLhk && !hasPo)
            return res.status(400).json({
              success: false,
              message: "Spk tsb belum input lhk qc cetak.\nHubungi divisi tsb.",
            });
        }
      }
      // Cek LHK Jahit P4 (GP003)
      else if (gdgAsal === "GP003") {
        if (ckcetak) {
          const hasLhk = await svc.cekLhk(nomorSpk, "GP032");
          if (!hasLhk && !hasPo)
            return res.status(400).json({
              success: false,
              message: "Spk tsb belum input lhk dc.\nHubungi divisi tsb.",
            });
        }
      }
      // Cek LHK Cetak untuk QC Cetak ke DC (GP010 sebagai asal — baru)
      else if (gdgAsal === "GP010") {
        if (ckcetak) {
          const hasLhk = await svc.cekLhk(nomorSpk, "GP002");
          if (!hasLhk && !hasPo) {
            return res.status(400).json({
              success: false,
              message: "Spk tsb belum input lhk cetak.\nHubungi divisi tsb.",
            });
          }
        } else if (ckbordir) {
          // Jika SPK adalah bordir, validasi LHK bordir (GP014 / GP016)
          const hasLhk =
            (await svc.cekLhk(nomorSpk, "GP014")) ||
            (await svc.cekLhk(nomorSpk, "GP016"));
          if (!hasLhk && !hasPo) {
            return res.status(400).json({
              success: false,
              message: "Spk tsb belum input lhk bordir.\nHubungi divisi tsb.",
            });
          }
        }
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// SEARCH GUDANG PRODUKSI
// GET /api/garmen/mutasi-produksi-form/search-gudang?q=&cab=
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
// GET NAMA GUDANG PRODUKSI
// GET /api/garmen/mutasi-produksi-form/nama-gudang?kode=
// ─────────────────────────────────────────────────────────
const getNamaGudang = async (req, res) => {
  try {
    const { kode } = req.query;
    const data = await svc.getNamaGudangProduksi(kode);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET PROSES SEBELUMNYA (F4)
// GET /api/garmen/mutasi-produksi-form/proses-sebelumnya?nomorSpk=&gdgAsal=&excludeNomor=
// ─────────────────────────────────────────────────────────
const getProsesSebelumnya = async (req, res) => {
  try {
    const { nomorSpk, gdgAsal, excludeNomor = "" } = req.query;
    const data = await svc.getProsesSebelumnya(nomorSpk, gdgAsal, excludeNomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET BY NOMOR
// GET /api/garmen/mutasi-produksi-form/:nomor
// ─────────────────────────────────────────────────────────
const getById = async (req, res) => {
  try {
    const nomor = req.params.nomor || req.query.nomor;
    if (!nomor)
      return res.status(400).json({ success: false, message: "Nomor wajib." });
    const data = await svc.getById(nomor);
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan." });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// SAVE (INSERT)
// POST /api/garmen/mutasi-produksi-form
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
// PUT /api/garmen/mutasi-produksi-form/:nomor
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

const searchBahanBySuffix = async (req, res) => {
  try {
    const { suffix, gdgAsal } = req.query;
    if (!suffix)
      return res.status(400).json({ success: false, message: "suffix wajib" });
    const data = await svc.searchBahanBySuffix(suffix, gdgAsal || "");
    res.status(200).json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const getDataCetak = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await svc.getDataCetak(nomor);
    res.status(200).json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const cekKomponenIdentifikasi = async (req, res) => {
  try {
    const { nomorSpk, lini } = req.query;
    const ada = await svc.cekKomponen(nomorSpk, lini);
    res.json({ success: true, data: ada });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET TERIMA SEBELUMNYA — dipakai FE hitung warning "beda dari
// LHK sebelumnya" (non-blocking) saat input Jumlah di Detail.
// GET /api/garmen/mutasi-produksi-form/terima-sebelumnya?nomorSpk=&gdgAsal=&excludeNomor=
// ─────────────────────────────────────────────────────────
const getTerimaSebelumnya = async (req, res) => {
  try {
    const { nomorSpk, gdgAsal, excludeNomor = "" } = req.query;
    if (!nomorSpk || !gdgAsal) {
      return res.json({ success: true, data: [] });
    }
    const data = await svc.getTerimaSebelumnya(nomorSpk, gdgAsal, excludeNomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getGudangByMutasi,
  getSpkInfo,
  getKomponenList,
  getBabaranInfo,
  searchNoMaterial,
  getNoMaterialDetail,
  getPlanningPpic,
  getKelompokList,
  getKelompokTujuanList,
  searchBahan,
  loadKodeBahan,
  loadKomponenMap,
  getKomponenProof,
  cekGudangAsal,
  searchGudangProduksi,
  getNamaGudang,
  getProsesSebelumnya,
  getById,
  save,
  update,
  searchBahanBySuffix,
  getDataCetak,
  cekKomponenIdentifikasi,
  getTerimaSebelumnya,
};
