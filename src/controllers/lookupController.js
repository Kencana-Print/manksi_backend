const { get } = require("../routes/authRoute");
const lookupService = require("../services/lookupService");

const searchSpk = async (req, res) => {
  try {
    const page = req.query.page || 1;
    const limit = req.query.limit || 50;
    const data = await lookupService.searchSpk(req.query.q, page, limit);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchSpkProduksi = async (req, res) => {
  try {
    const { q, page, limit } = req.query;
    const data = await lookupService.searchSpkProduksi(q, page, limit);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchBahan = async (req, res) => {
  try {
    const keyword = req.query.q || "";
    const isBordir = req.query.isBordir; // Bernilai "true" atau undefined
    const mode = req.query.mode; // <-- TAMBAHKAN TANGKAPAN MODE
    const page = req.query.page || 1;
    const limit = req.query.limit || 50;

    const data = await lookupService.searchBahan(
      keyword,
      isBordir,
      mode, // <-- SISIPKAN DI SINI SESUAI URUTAN SERVICE
      page,
      limit,
    );

    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchCustomer = async (req, res) => {
  try {
    const page = req.query.page || 1;
    const limit = req.query.limit || 50;
    const keyword = req.query.q || "";

    // Panggil service yang sudah kita buat sebelumnya
    const data = await lookupService.searchCustomer(keyword, page, limit);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 1. Get Cabang Pabrik
const getCabangPabrik = async (req, res) => {
  try {
    const type = req.query.type; // Tangkap parameter dari URL (?type=po-internal)
    const data = await lookupService.getCabangPabrik(type);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. Search Bagian Produksi
const searchBagianProduksi = async (req, res) => {
  try {
    const cabang = req.query.cabang;

    // Validasi: Cabang harus dikirim agar bisa mencari 3 karakter awalnya
    if (!cabang) {
      return res
        .status(400)
        .json({ success: false, message: "Parameter cabang wajib dikirim" });
    }

    const data = await lookupService.searchBagianProduksi(cabang);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getSales = async (req, res) => {
  try {
    const data = await lookupService.getSales();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getJenisKainMintaHarga = async (req, res) => {
  try {
    const { kode } = req.query; // Menangkap kode model dari URL

    if (!kode) {
      return res
        .status(400)
        .json({ success: false, message: "Kode model harus disertakan." });
    }

    const data = await lookupService.getJenisKainMintaHarga(kode);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getKomponenKain = async (req, res) => {
  try {
    const { model, jenisKain, warna } = req.query;

    if (!model || !jenisKain || !warna) {
      return res.status(400).json({
        success: false,
        message: "Parameter model, jenisKain, dan warna harus disertakan.",
      });
    }

    const data = await lookupService.getKomponenKain(model, jenisKain, warna);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getCetakOptions = async (req, res) => {
  try {
    const data = await lookupService.getCetakOptions();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getTambahanOptions = async (req, res) => {
  try {
    const data = await lookupService.getTambahanOptions();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getPerusahaan = async (req, res) => {
  try {
    const data = await lookupService.getPerusahaan();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getRekening = async (req, res) => {
  try {
    // Kita butuh parameter perushKode karena rekening spesifik per perusahaan
    const { perushKode } = req.query;
    if (!perushKode) {
      return res
        .status(400)
        .json({ success: false, message: "Kode Perusahaan diperlukan." });
    }
    const data = await lookupService.getRekeningPerusahaan(perushKode);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDivisi = async (req, res) => {
  try {
    const data = await lookupService.getDivisi();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchMintaHarga = async (req, res) => {
  try {
    const { q, custKode, page, limit } = req.query;

    // VALIDASI DIHAPUS: Customer tidak lagi wajib
    // Kita langsung lempar ke service, biarkan service yang menangani logic-nya
    const data = await lookupService.searchMintaHarga(q, custKode, page, limit);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchJenisOrder = async (req, res) => {
  try {
    const divisi = req.query.divisi; // Menangkap parameter ?divisi=x
    const data = await lookupService.searchJenisOrder(divisi);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchPenawaran = async (req, res) => {
  try {
    const { q, custKode, page, limit } = req.query;
    const data = await lookupService.searchPenawaran(q, custKode, page, limit);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchPenawaranDetail = async (req, res) => {
  try {
    const { nomor } = req.query;

    if (!nomor) {
      return res.status(400).json({
        success: false,
        message: "Nomor Penawaran wajib dikirim.",
      });
    }

    const data = await lookupService.searchPenawaranDetail(nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchMapGarmen = async (req, res) => {
  try {
    const { q, cus_kode, perush_kode, divisi } = req.query;

    const data = await lookupService.searchMapGarmen(
      q,
      cus_kode,
      perush_kode,
      divisi,
    );

    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const validateMapGarmen = async (req, res) => {
  try {
    const { nomor } = req.params;
    if (!nomor) {
      return res
        .status(400)
        .json({ success: false, message: "Nomor MAP wajib diisi." });
    }
    const data = await lookupService.validateMapGarmen(nomor);
    res.status(200).json({ success: true, data }); // data bisa bernilai null jika tidak ketemu
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchPoInternal = async (req, res) => {
  try {
    // Ambil parameter cabang dari query string (?cabang=P04)
    const { cabang } = req.query;

    if (!cabang) {
      return res.status(400).json({
        success: false,
        message: "Parameter cabang wajib disertakan untuk mencari PO.",
      });
    }

    const data = await lookupService.searchPoInternal(cabang);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchAccesories = async (req, res) => {
  try {
    const data = await lookupService.searchAccesories();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getKomponen = async (req, res) => {
  try {
    const data = await lookupService.getKomponen();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchMintaBahan = async (req, res) => {
  try {
    const { q, page, limit } = req.query;
    const data = await lookupService.searchMintaBahan(q, page, limit);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchRealisasiMinta = async (req, res) => {
  try {
    const { q, page, limit } = req.query;
    const data = await lookupService.searchRealisasiMinta(q, page, limit);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchRealisasiMintaDetail = async (req, res) => {
  try {
    const { nomor, gdg } = req.query;
    if (!nomor || !gdg) {
      return res.status(400).json({
        success: false,
        message:
          "Parameter nomor realisasi dan kode gudang produksi wajib disertakan.",
      });
    }
    const data = await lookupService.searchRealisasiMintaDetail(nomor, gdg);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchGudangProduksi = async (req, res) => {
  try {
    const { q, cabang, page, limit } = req.query;
    const data = await lookupService.searchGudangProduksi(
      q,
      cabang,
      page,
      limit,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchBarangGarmen = async (req, res) => {
  try {
    const { q, jenis, cabang, page, limit } = req.query;
    // req.user.bagian didapat dari middleware verifyToken
    const bagian = req.user.bagian ? req.user.bagian.toUpperCase() : "";

    if (!jenis || !cabang) {
      return res.status(400).json({
        success: false,
        message: "Parameter jenis dan cabang wajib dikirim.",
      });
    }

    const data = await lookupService.searchBarangGarmen(
      q,
      jenis,
      cabang,
      bagian,
      page,
      limit,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchPermintaanBarangGarmen = async (req, res) => {
  try {
    const { q, jenis, page, limit } = req.query;
    const cabang = req.user.cabang;
    const bagian = req.user.bagian ? req.user.bagian.toUpperCase() : "";

    if (!jenis) {
      return res.status(400).json({
        success: false,
        message: "Parameter jenis wajib dikirim.",
      });
    }

    const data = await lookupService.searchPermintaanBarangGarmen(
      q,
      jenis,
      cabang,
      bagian,
      page,
      limit,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchBarangInvProforma = async (req, res) => {
  try {
    const { perush, cus, q, page, limit } = req.query;
    if (!perush || !cus)
      return res.status(400).json({
        success: false,
        message: "Perusahaan & Customer wajib dipilih dulu.",
      });

    const data = await lookupService.searchBarangInvProforma(
      perush,
      cus,
      q,
      page,
      limit,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  searchSpk,
  searchSpkProduksi,
  searchBahan,
  searchCustomer,
  getCabangPabrik,
  searchBagianProduksi,
  getSales,
  getJenisKainMintaHarga,
  getKomponenKain,
  getCetakOptions,
  getTambahanOptions,
  getPerusahaan,
  getRekening,
  getDivisi,
  searchMintaHarga,
  searchJenisOrder,
  searchPenawaran,
  searchPenawaranDetail,
  searchMapGarmen,
  validateMapGarmen,
  searchPoInternal,
  searchAccesories,
  getKomponen,
  searchMintaBahan,
  searchRealisasiMinta,
  searchRealisasiMintaDetail,
  searchGudangProduksi,
  searchBarangGarmen,
  searchPermintaanBarangGarmen,
  searchBarangInvProforma,
};
