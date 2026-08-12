const { get } = require("../routes/authRoute");
const lookupService = require("../services/lookupService");

const searchSpk = async (req, res) => {
  try {
    const {
      q,
      page = 1,
      limit = 50,
      filterMode = "all",
      cusKode = "",
      perushKode = "",
      divisi = "",
    } = req.query;

    const data = await lookupService.searchSpk(q, page, limit, filterMode, {
      cusKode,
      perushKode,
      divisi,
    });
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

const getPerusahaanByKode = async (req, res) => {
  try {
    const data = await lookupService.getPerusahaanByKode(req.params.kode);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const getDigitalSign = async (req, res) => {
  try {
    const { kode } = req.params;
    if (!kode) {
      return res
        .status(400)
        .json({ success: false, message: "Kode perusahaan wajib diisi." });
    }
    const data = await lookupService.getDigitalSign(kode);
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
    const { q, cus_kode, perush_kode, divisi, includeClosed } = req.query;
    const data = await lookupService.searchMapGarmen(
      q,
      cus_kode,
      perush_kode,
      divisi,
      includeClosed === "true" || includeClosed === "1",
    );
    res.json({ success: true, data });
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

const searchPoInternalSpk = async (req, res) => {
  try {
    const { q, page, limit } = req.query;
    const data = await lookupService.searchPoInternalSpk(q, page, limit);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchAccesories = async (req, res) => {
  try {
    const { q = "", limit = 50, size = "" } = req.query;
    const data = await lookupService.searchAccesories(q, limit, size);
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
    const {
      q = "",
      page = 1,
      limit = 50,
      nomorSpk = "",
      excludeNomor = "",
      flat,
    } = req.query;
    const data = await lookupService.searchRealisasiMinta(
      q,
      page,
      limit,
      nomorSpk,
      excludeNomor,
      flat === "true" || flat === "1",
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const searchRealisasiMintaDetail = async (req, res) => {
  try {
    const { nomor, gdg } = req.query;

    // Cukup validasi nomor saja. Biarkan gdg kosong jika memang dipanggil dari form general.
    if (!nomor) {
      return res.status(400).json({
        success: false,
        message: "Parameter nomor realisasi wajib disertakan.",
      });
    }

    // Jika gdg bernilai undefined/kosong, berikan fallback string kosong "" agar query SQL tetap berjalan aman
    const data = await lookupService.searchRealisasiMintaDetail(
      nomor,
      gdg || "",
    );
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
    const { perushKode, cusKode, q, page, limit } = req.query;
    if (!perushKode || !cusKode)
      return res.status(400).json({
        success: false,
        message: "Perusahaan & Customer wajib dipilih dulu.",
      });

    const data = await lookupService.searchBarangInvProforma(
      perushKode,
      cusKode,
      q,
      page,
      limit,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchBarangJadi = async (req, res) => {
  try {
    const { q, page, limit } = req.query;
    const data = await lookupService.searchBarangJadi(q, page, limit);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getWorkshops = async (req, res) => {
  try {
    const data = await lookupService.getWorkshops();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getKepentinganSpk = async (req, res) => {
  try {
    const data = await lookupService.getKepentinganSpk();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getKetPo = async (req, res) => {
  try {
    const data = await lookupService.getKetPo();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getKetKomponen = async (req, res) => {
  try {
    const data = await lookupService.getKetKomponen();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchCustKaosan = async (req, res) => {
  try {
    const { q, page, limit } = req.query;
    const data = await lookupService.searchCustKaosan(q, page, limit);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchSoKaosan = async (req, res) => {
  try {
    const { q, page, limit } = req.query;
    // Mengambil cabang kaosan user dari token JWT (req.user)
    const cabKaos = req.user.cabangKaos;

    if (!cabKaos) {
      return res.status(400).json({
        success: false,
        message: "User tidak memiliki akses Cabang Kaosan.",
      });
    }

    const data = await lookupService.searchSoKaosan(q, cabKaos, page, limit);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- GET INVOICE DC ---
const searchInvDc = async (req, res) => {
  try {
    const { q, page, limit } = req.query;
    const data = await lookupService.searchInvDc(q, page, limit);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchSjMemo = async (req, res) => {
  try {
    const data = await lookupService.searchSjMemo(
      req.query.q,
      req.query.page,
      req.query.limit,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchMemo = async (req, res) => {
  try {
    const data = await lookupService.searchMemo(
      req.query.q,
      req.query.page,
      req.query.limit,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchSpg = async (req, res) => {
  try {
    const { q, page, limit } = req.query;
    const data = await lookupService.searchSpg(q, page, limit);
    res.status(200).json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const searchMppb = async (req, res) => {
  try {
    const data = await lookupService.searchMppb(
      req.query.q,
      req.query.page,
      req.query.limit,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getHistoryAlokasi = async (req, res) => {
  try {
    const { cusKode, page = 1, limit = 20 } = req.query;
    const data = await lookupService.getHistoryAlokasi(cusKode, page, limit);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchBarangKaosan = async (req, res) => {
  try {
    const data = await lookupService.searchBarangKaosan(
      req.query.q,
      req.query.page,
      req.query.limit,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchSupplier = async (req, res) => {
  try {
    const page = req.query.page || 1;
    const limit = req.query.limit || 50;
    const keyword = req.query.q || "";
    const jenis = req.query.jenis; // <-- TAMBAHKAN BARIS INI

    // UPDATE PANGGILAN SERVICE DENGAN MENYISIPKAN VARIABEL JENIS
    const data = await lookupService.searchSupplier(
      keyword,
      jenis,
      page,
      limit,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchPoGreige = async (req, res) => {
  try {
    const { q, page, limit } = req.query;
    const data = await lookupService.searchPoGreige(q, page, limit);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchMkb = async (req, res) => {
  try {
    const { q, page, limit } = req.query;
    const data = await lookupService.searchMkb(q, page, limit);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchGudangBahan = async (req, res) => {
  try {
    const { q, page, limit, mode = "" } = req.query;
    const data = await lookupService.searchGudangBahan(q, page, limit, mode);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchPoBahanBuka = async (req, res) => {
  try {
    const { q, page, limit } = req.query;
    const data = await lookupService.searchPoBahanBuka(q, page, limit);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchPermintaanBeliGarmen = async (req, res) => {
  try {
    const { q, jenis } = req.query;
    if (!jenis)
      return res
        .status(400)
        .json({ success: false, message: "Parameter jenis wajib diisi." });
    const data = await lookupService.searchPermintaanBeliGarmen(q, jenis);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchPoGarmenBuka = async (req, res) => {
  try {
    const { q, jenis, page, limit } = req.query;

    if (!jenis) {
      return res
        .status(400)
        .json({ success: false, message: "Parameter jenis wajib diisi." });
    }

    const data = await lookupService.searchPoGarmenBuka(q, jenis, page, limit);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getMkbDetail = async (req, res) => {
  try {
    const { nomor } = req.query;
    if (!nomor) {
      return res.status(400).json({
        success: false,
        message: "Nomor MKB wajib dikirim.",
      });
    }
    const data = await lookupService.getMkbDetail(nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchKaryawan = async (req, res) => {
  try {
    const { q, page, limit } = req.query;
    const data = await lookupService.searchKaryawan(q, page, limit);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchAccount = async (req, res) => {
  try {
    const { q, page, limit } = req.query;
    const data = await lookupService.searchAccount(q, page, limit);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getSetoranPembayaranLookup = async (req, res) => {
  try {
    const { cus_kode, tipe, q, page = 1, limit = 50 } = req.query;
    const data = await lookupService.getSetoranPembayaranLookup(
      cus_kode,
      tipe,
      q,
      Number(page),
      Number(limit),
    );
    res.status(200).json({
      success: true,
      data: data.rows,
      total: data.total,
    });
  } catch (error) {
    const statusCode = error.message.includes("Customer") ? 400 : 500;
    res.status(statusCode).json({ success: false, message: error.message });
  }
};

const getInvoicePiutang = async (req, res) => {
  try {
    const { cabang, search } = req.query;
    if (!cabang) {
      return res.status(400).json({
        success: false,
        message: "Parameter cabang wajib diisi.",
      });
    }
    const data = await lookupService.getInvoicePiutang(cabang, search);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getKodeBayar = async (req, res) => {
  try {
    const data = await lookupService.getKodeBayar();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchBuktiBayar = async (req, res) => {
  try {
    const { cabang, kode, search } = req.query;
    if (!cabang || !kode) {
      return res.status(400).json({
        success: false,
        message: "Parameter cabang dan kode wajib diisi.",
      });
    }
    const data = await lookupService.searchBuktiBayar(cabang, kode, search);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchHistoryPakaiMaterial = async (req, res) => {
  try {
    const {
      noMaterial,
      kodeBahan,
      excludeNomor = "",
      q = "",
      page = 1,
      limit = 25,
    } = req.query;
    if (!noMaterial || !kodeBahan)
      return res
        .status(400)
        .json({ success: false, message: "noMaterial dan kodeBahan wajib." });
    const data = await lookupService.searchHistoryPakaiMaterial(
      noMaterial,
      kodeBahan,
      excludeNomor,
      q,
      page,
      limit,
    );
    res.status(200).json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const searchPoJasa = async (req, res) => {
  try {
    const { q = "", cab = "ALL", page = 1, limit = 20 } = req.query;
    const data = await lookupService.searchPoJasa(
      q,
      cab,
      Number(page),
      Number(limit),
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchRealisasiMintaBySpk = async (req, res) => {
  try {
    const { spkNomor, q = "", page = 1, limit = 20 } = req.query;
    if (!spkNomor)
      return res
        .status(400)
        .json({ success: false, message: "spkNomor wajib." });
    const data = await lookupService.searchRealisasiMintaBySpk(
      spkNomor,
      q,
      Number(page),
      Number(limit),
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getGudangJadi = async (req, res) => {
  try {
    const { q = "", divisi = 0 } = req.query;
    const data = await lookupService.getGudangJadi(q, Number(divisi));
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const getGudangProduksiKoli = async (req, res) => {
  try {
    const { q = "", cab = "", divisi = 0 } = req.query;
    const data = await lookupService.getGudangProduksiKoli(
      q,
      cab,
      Number(divisi),
    );
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const getPackingTersedia = async (req, res) => {
  try {
    const { q = "", page = 1, limit = 50 } = req.query;
    const data = await lookupService.getPackingTersedia(q, page, limit);
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const searchInvProforma = async (req, res) => {
  try {
    const { cusKode = "", q = "", page = 1, limit = 50 } = req.query;
    const data = await lookupService.searchInvProforma(
      cusKode,
      q,
      Number(page),
      Number(limit),
    );
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const searchBpbPo = async (req, res) => {
  try {
    const { q, page, limit } = req.query;
    const data = await lookupService.searchBpbPo(q, page, limit);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchBpb = async (req, res) => {
  try {
    const { q, page, limit } = req.query;
    const data = await lookupService.searchBpb(q, page, limit);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchProduksiRetur = async (req, res) => {
  try {
    const { q, page, limit } = req.query;
    const data = await lookupService.searchProduksiRetur(q, page, limit);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchJasa = async (req, res) => {
  try {
    const { q, page, limit } = req.query;
    const data = await lookupService.searchJasa(q, page, limit);
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
  getPerusahaanByKode,
  getDigitalSign,
  getRekening,
  getDivisi,
  searchMintaHarga,
  searchJenisOrder,
  searchPenawaran,
  searchPenawaranDetail,
  searchMapGarmen,
  validateMapGarmen,
  searchPoInternal,
  searchPoInternalSpk,
  searchAccesories,
  getKomponen,
  searchMintaBahan,
  searchRealisasiMinta,
  searchRealisasiMintaDetail,
  searchGudangProduksi,
  searchBarangGarmen,
  searchPermintaanBarangGarmen,
  searchBarangInvProforma,
  searchBarangJadi,
  getWorkshops,
  getKepentinganSpk,
  getKetPo,
  getKetKomponen,
  searchCustKaosan,
  searchSoKaosan,
  searchInvDc,
  searchSjMemo,
  searchMemo,
  searchSpg,
  searchMppb,
  getHistoryAlokasi,
  searchBarangKaosan,
  searchSupplier,
  searchPoGreige,
  searchMkb,
  searchGudangBahan,
  searchPoBahanBuka,
  searchBpbPo,
  searchPermintaanBeliGarmen,
  searchPoGarmenBuka,
  getMkbDetail,
  searchKaryawan,
  searchAccount,
  getSetoranPembayaranLookup,
  getInvoicePiutang,
  getKodeBayar,
  searchBuktiBayar,
  searchHistoryPakaiMaterial,
  searchPoJasa,
  searchRealisasiMintaBySpk,
  getGudangJadi,
  getGudangProduksiKoli,
  getPackingTersedia,
  searchInvProforma,
  searchBpb,
  searchProduksiRetur,
  searchJasa,
};
