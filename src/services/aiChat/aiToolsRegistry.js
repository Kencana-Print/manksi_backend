// ============================================================
// AI TOOLS REGISTRY
// Setiap tool = { definition (JSON schema buat Claude), handler
// (fungsi backend yang benar-benar dijalankan) }. Handler REUSE
// langsung dari dashboardService.js — tidak duplikasi logic.
// ============================================================
const dashboardService = require("../dashboard/dashboardService");
const mutasiProduksiService = require("../laporan/gudang-garmen/laporanMutasiProduksiService");
const realisasiPenjualanService = require("../laporan/marketing/realisasiPenjualanService");

const parseTanggalID = (str) => {
  const [d, m, y] = String(str).split("-").map(Number);
  return new Date(y, m - 1, d);
};

const tools = [
  // ── PENJUALAN ──
  {
    definition: {
      name: "get_spk_summary",
      description:
        "Ringkasan SPK (Surat Perintah Kerja) aktif: total aktif, terlambat, deadline hari ini, segera deadline (≤3 hari), dan selesai.",
      input_schema: { type: "object", properties: {} },
    },
    handler: async (input, user) => dashboardService.getSpkSummary(user),
  },
  {
    definition: {
      name: "get_so_summary",
      description:
        "Ringkasan SO (Sales Order) aktif: total aktif, belum dibuatkan SPK, belum kirim, belum jadi.",
      input_schema: { type: "object", properties: {} },
    },
    handler: async (input, user) => dashboardService.getSoSummary(user),
  },
  {
    definition: {
      name: "get_penawaran_summary",
      description:
        "Ringkasan penawaran (1 tahun terakhir): total penawaran, sudah ada SPK/SO, belum ada SPK/SO.",
      input_schema: { type: "object", properties: {} },
    },
    handler: async (input, user) => dashboardService.getPenawaranSummary(user),
  },
  {
    definition: {
      name: "get_spk_urgent",
      description:
        "Daftar SPK yang deadline-nya sudah lewat atau ≤3 hari lagi (customer prioritas/keramat), lengkap dengan sisa hari, qty order, dan qty jadi.",
      input_schema: { type: "object", properties: {} },
    },
    handler: async (input, user) => dashboardService.getSpkUrgent(user),
  },
  {
    definition: {
      name: "get_customer_tanpa_order",
      description:
        "Cari customer yang SUDAH LAMA tidak order dari sales tertentu — dipakai untuk 2 kasus: (1) 'urgent dikunjungi' (biasanya 30-90 hari tanpa order, default pakai 60), (2) 'customer lost' (biasanya 180-365 hari tanpa order sama sekali, default pakai 180). Sesuaikan parameter minHariTanpaOrder berdasarkan kata-kata user — kalau user bilang 'urgent'/'perlu dikunjungi', pakai angka lebih kecil; kalau bilang 'lost'/'hilang'/'sudah lama sekali', pakai angka lebih besar.",
      input_schema: {
        type: "object",
        properties: {
          namaSales: {
            type: "string",
            description: "Nama sales (partial match), WAJIB diisi",
          },
          minHariTanpaOrder: {
            type: "number",
            description:
              "Minimal jumlah hari sejak order terakhir untuk dianggap 'urgent'/'lost'. Default 60 untuk urgent, gunakan 180+ untuk lost.",
          },
          riwayatBulan: {
            type: "number",
            description:
              "Rentang histori order yang dicek ke belakang (bulan), default 24 bulan. Customer yang order terakhirnya lebih lama dari ini tidak akan terdeteksi.",
          },
        },
        required: ["namaSales"],
      },
    },
    handler: async (input) => {
      if (!input.namaSales) {
        return { error: "Nama sales wajib diisi." };
      }
      const minHari = input.minHariTanpaOrder || 60;
      const riwayatBulan = input.riwayatBulan || 24;

      const today = new Date();
      const startDate = new Date(today);
      startDate.setMonth(startDate.getMonth() - riwayatBulan);
      const toISO = (d) => d.toISOString().substring(0, 10);

      const rows = await realisasiPenjualanService.getBrowse({
        startDate: toISO(startDate),
        endDate: toISO(today),
        namaSales: input.namaSales,
      });

      const byCustomer = {};
      for (const r of rows) {
        const key = r.Kdcus;
        const tgl = parseTanggalID(r.Tanggal);
        if (!byCustomer[key]) {
          byCustomer[key] = {
            customer: r.Customer,
            kdcus: r.Kdcus,
            jumlahOrder: 0,
            totalNominal: 0,
            tanggalTerakhir: tgl,
          };
        }
        const g = byCustomer[key];
        g.jumlahOrder += 1;
        g.totalNominal += Number(r.Nominal_Order) || 0;
        if (tgl > g.tanggalTerakhir) g.tanggalTerakhir = tgl;
      }

      const hasil = Object.values(byCustomer)
        .map((g) => {
          const hariSejakOrder = Math.floor(
            (today.getTime() - g.tanggalTerakhir.getTime()) / 86400000,
          );
          return {
            customer: g.customer,
            jumlahOrderDalamPeriode: g.jumlahOrder,
            totalNominalDalamPeriode: g.totalNominal,
            tanggalOrderTerakhir: toISO(g.tanggalTerakhir),
            hariSejakOrderTerakhir: hariSejakOrder,
          };
        })
        .filter((g) => g.hariSejakOrderTerakhir >= minHari)
        .sort((a, b) => b.hariSejakOrderTerakhir - a.hariSejakOrderTerakhir);

      return {
        namaSalesDicari: input.namaSales,
        thresholdHariDipakai: minHari,
        riwayatBulanDicek: riwayatBulan,
        jumlahCustomerDitemukan: hasil.length,
        customerList: hasil.slice(0, 30),
      };
    },
  },
  {
    definition: {
      name: "get_order_list_by_customer",
      description:
        "Ambil daftar pesanan/order (SPK/SO) untuk 1 customer tertentu, urut dari yang terbaru. Pakai ini kalau user tanya riwayat/list order suatu customer.",
      input_schema: {
        type: "object",
        properties: {
          namaCustomer: {
            type: "string",
            description: "Nama customer (partial match), WAJIB diisi",
          },
          startDate: {
            type: "string",
            description:
              "Tanggal mulai (YYYY-MM-DD). HANYA isi kalau user sebutkan rentang tanggal eksplisit — kalau tidak, biarkan kosong (default 1 tahun terakhir).",
          },
          endDate: {
            type: "string",
            description:
              "Tanggal akhir (YYYY-MM-DD). HANYA isi kalau user sebutkan rentang tanggal eksplisit.",
          },
          limit: {
            type: "number",
            description: "Jumlah order maksimal ditampilkan, default 30",
          },
        },
        required: ["namaCustomer"],
      },
    },
    handler: async (input) => {
      if (!input.namaCustomer) {
        return { error: "Nama customer wajib diisi." };
      }
      const today = new Date();
      const oneYearAgo = new Date(today);
      oneYearAgo.setFullYear(today.getFullYear() - 1);
      const toISO = (d) => d.toISOString().substring(0, 10);

      const rows = await realisasiPenjualanService.getBrowse({
        startDate: input.startDate || toISO(oneYearAgo),
        endDate: input.endDate || toISO(today),
        namaCustomer: input.namaCustomer,
      });

      const totalNominal = rows.reduce(
        (s, r) => s + (Number(r.Nominal_Order) || 0),
        0,
      );
      const limit = input.limit || 30;
      const sorted = [...rows].sort(
        (a, b) => parseTanggalID(b.Tanggal) - parseTanggalID(a.Tanggal),
      );

      return {
        customerDicari: input.namaCustomer,
        totalOrderDitemukan: rows.length,
        totalNominalSemuaOrder: totalNominal,
        catatan:
          rows.length > limit
            ? `Hanya menampilkan ${limit} order terbaru dari total ${rows.length}.`
            : undefined,
        orderList: sorted.slice(0, limit),
      };
    },
  },
  {
    definition: {
      name: "get_customer_baru_nilai_besar",
      description:
        "Cari customer BARU (order pertama kalinya dalam periode tertentu, tidak pernah order sebelumnya dalam rentang histori yang dicek) dengan nilai order terbesar. Berguna untuk lihat prospek baru yang potensial. CATATAN: 'baru' di sini adalah pendekatan berdasarkan window histori yang dicek (default 1 tahun) — bukan jaminan customer itu benar-benar baru pertama kali order sepanjang sejarah perusahaan.",
      input_schema: {
        type: "object",
        properties: {
          namaSales: {
            type: "string",
            description:
              "Opsional — filter ke sales tertentu saja. Kalau tidak diisi, cari di semua sales.",
          },
          bulanPeriode: {
            type: "number",
            description:
              "Periode 'order pertama' yang dicek, dalam bulan ke belakang dari hari ini. Default 1 (bulan berjalan).",
          },
          riwayatTahun: {
            type: "number",
            description:
              "Rentang histori yang dicek untuk memastikan customer belum pernah order sebelumnya, dalam tahun. Default 1 tahun.",
          },
          limit: {
            type: "number",
            description: "Jumlah customer maksimal ditampilkan, default 10",
          },
        },
      },
    },
    handler: async (input) => {
      const bulanPeriode = input.bulanPeriode || 1;
      const riwayatTahun = input.riwayatTahun || 1;
      const limit = input.limit || 10;

      const today = new Date();
      const periodStart = new Date(today);
      periodStart.setMonth(periodStart.getMonth() - bulanPeriode);
      const historiStart = new Date(today);
      historiStart.setFullYear(historiStart.getFullYear() - riwayatTahun);
      const toISO = (d) => d.toISOString().substring(0, 10);

      const rows = await realisasiPenjualanService.getBrowse({
        startDate: toISO(historiStart),
        endDate: toISO(today),
        namaSales: input.namaSales || "",
      });

      const byCustomer = {};
      for (const r of rows) {
        const key = r.Kdcus;
        const tgl = parseTanggalID(r.Tanggal);
        if (!byCustomer[key]) {
          byCustomer[key] = {
            customer: r.Customer,
            sales: r.Sales,
            firstOrderDate: tgl,
            nilaiDalamPeriode: 0,
            jumlahOrderDalamPeriode: 0,
          };
        }
        const g = byCustomer[key];
        if (tgl < g.firstOrderDate) g.firstOrderDate = tgl;
        if (tgl >= periodStart) {
          g.nilaiDalamPeriode += Number(r.Nominal_Order) || 0;
          g.jumlahOrderDalamPeriode += 1;
        }
      }

      const hasil = Object.values(byCustomer)
        .filter(
          (g) => g.firstOrderDate >= periodStart && g.nilaiDalamPeriode > 0,
        )
        .map((g) => ({
          customer: g.customer,
          sales: g.sales,
          tanggalOrderPertama: toISO(g.firstOrderDate),
          nilaiOrderDalamPeriode: g.nilaiDalamPeriode,
          jumlahOrderDalamPeriode: g.jumlahOrderDalamPeriode,
        }))
        .sort((a, b) => b.nilaiOrderDalamPeriode - a.nilaiOrderDalamPeriode);

      return {
        periodeDicek: `${toISO(periodStart)} s/d ${toISO(today)}`,
        riwayatTahunDicek: riwayatTahun,
        catatan:
          "Status 'baru' hanya dijamin akurat dalam window riwayat yang dicek (riwayatTahun) — bukan sepanjang sejarah perusahaan.",
        jumlahCustomerBaruDitemukan: hasil.length,
        customerList: hasil.slice(0, limit),
      };
    },
  },
  {
    definition: {
      name: "get_top_order_terbesar",
      description:
        "Cari order (SPK/SO) dengan nilai TERBESAR dalam periode terakhir, dari customer APA PUN (baru atau lama, tidak dibedakan). Pakai ini kalau user tanya 'order besar belakangan ini', 'customer yang baru-baru ini order gede', atau semacamnya — TANPA maksud khusus soal customer yang baru pertama kali order. Kalau user secara eksplisit tanya soal customer yang BARU PERTAMA KALI order (bukan sekadar 'baru-baru ini'/'belakangan ini'), pakai tool get_customer_baru_nilai_besar sebagai gantinya.",
      input_schema: {
        type: "object",
        properties: {
          namaSales: {
            type: "string",
            description:
              "Opsional — filter ke sales tertentu saja. Kalau tidak diisi, cari di semua sales.",
          },
          hariTerakhir: {
            type: "number",
            description:
              "Rentang waktu 'belakangan ini' dalam hari ke belakang dari hari ini. Default 30 hari.",
          },
          limit: {
            type: "number",
            description: "Jumlah order maksimal ditampilkan, default 10",
          },
        },
      },
    },
    handler: async (input) => {
      const hariTerakhir = input.hariTerakhir || 30;
      const limit = input.limit || 10;

      const today = new Date();
      const startDate = new Date(today);
      startDate.setDate(startDate.getDate() - hariTerakhir);
      const toISO = (d) => d.toISOString().substring(0, 10);

      const rows = await realisasiPenjualanService.getBrowse({
        startDate: toISO(startDate),
        endDate: toISO(today),
        namaSales: input.namaSales || "",
      });

      const sorted = [...rows]
        .sort(
          (a, b) =>
            (Number(b.Nominal_Order) || 0) - (Number(a.Nominal_Order) || 0),
        )
        .slice(0, limit)
        .map((r) => ({
          nomor: r.Nomor,
          customer: r.Customer,
          sales: r.Sales,
          divisi: r.Divisi,
          tanggal: r.Tanggal,
          nominalOrder: r.Nominal_Order,
          jumlahLembar: r.QtyGarmen,
          luasOrder: r.QtyOrder,
        }));

      return {
        periodeDicek: `${hariTerakhir} hari terakhir (${toISO(startDate)} s/d ${toISO(today)})`,
        totalOrderDalamPeriode: rows.length,
        topOrder: sorted,
      };
    },
  },
  {
    definition: {
      name: "get_penjualan_by_sales",
      description:
        "Total nilai penjualan (SPK/SO) per sales. Ada 2 mode: (1) kalau namaSales diisi, tampilkan total penjualan sales itu, dipecah per divisi; (2) kalau namaSales KOSONG, tampilkan ranking SEMUA sales dari nilai penjualan terbesar ke terkecil (opsional filter per divisi). Pakai tool ini untuk pertanyaan seperti 'penjualan sales X berapa', 'ranking sales bulan ini', atau 'sales mana paling laku per divisi'.",
      input_schema: {
        type: "object",
        properties: {
          namaSales: {
            type: "string",
            description:
              "Opsional. Nama sales (partial match). Kalau diisi, jawaban fokus ke sales ini saja (breakdown per divisi). Kalau kosong, jawaban jadi ranking semua sales.",
          },
          divisi: {
            type: "string",
            description:
              "Opsional. Filter ke divisi tertentu saja (nama divisi, partial match, misal 'GARMEN', 'MMT', 'SPANDUK', 'KAOSAN').",
          },
          startDate: {
            type: "string",
            description:
              "Tanggal mulai (YYYY-MM-DD). HANYA isi kalau user sebutkan rentang/tahun/bulan eksplisit (misal 'tahun 2026' → startDate 2026-01-01). Kalau tidak disebutkan, JANGAN isi — biarkan kosong (default 1 tahun terakhir).",
          },
          endDate: {
            type: "string",
            description:
              "Tanggal akhir (YYYY-MM-DD). HANYA isi kalau user sebutkan rentang/tahun/bulan eksplisit (misal 'tahun 2026' → endDate 2026-12-31). Kalau tidak disebutkan, JANGAN isi.",
          },
          limit: {
            type: "number",
            description:
              "Jumlah sales maksimal ditampilkan di mode ranking, default 15. Tidak berlaku di mode 1-sales.",
          },
        },
      },
    },
    handler: async (input) => {
      const today = new Date();
      const oneYearAgo = new Date(today);
      oneYearAgo.setFullYear(today.getFullYear() - 1);
      const toISO = (d) => d.toISOString().substring(0, 10);

      const startDate = input.startDate || toISO(oneYearAgo);
      const endDate = input.endDate || toISO(today);
      const limit = input.limit || 15;

      const rows = await realisasiPenjualanService.getBrowse({
        startDate,
        endDate,
        namaSales: input.namaSales || "",
      });

      const filtered = input.divisi
        ? rows.filter((r) =>
            (r.Divisi || "")
              .toUpperCase()
              .includes(String(input.divisi).toUpperCase()),
          )
        : rows;

      if (filtered.length === 0) {
        return {
          periodeDicek: `${startDate} s/d ${endDate}`,
          namaSalesDicari: input.namaSales || null,
          divisiDicari: input.divisi || null,
          totalDataDitemukan: 0,
        };
      }

      // ── Mode 1: sales spesifik diisi → breakdown per divisi ──
      if (input.namaSales) {
        const byDivisi = {};
        let totalNominal = 0;
        let totalOrder = 0;
        for (const r of filtered) {
          const key = r.Divisi || "LAINNYA";
          if (!byDivisi[key]) {
            byDivisi[key] = { divisi: key, nominal: 0, jumlahOrder: 0 };
          }
          byDivisi[key].nominal += Number(r.Nominal_Order) || 0;
          byDivisi[key].jumlahOrder += 1;
          totalNominal += Number(r.Nominal_Order) || 0;
          totalOrder += 1;
        }
        return {
          periodeDicek: `${startDate} s/d ${endDate}`,
          namaSalesDicari: input.namaSales,
          totalNominalPenjualan: totalNominal,
          totalJumlahOrder: totalOrder,
          breakdownPerDivisi: Object.values(byDivisi).sort(
            (a, b) => b.nominal - a.nominal,
          ),
        };
      }

      // ── Mode 2: tidak ada namaSales → ranking semua sales ──
      const bySales = {};
      for (const r of filtered) {
        const key = r.Sales || "TANPA SALES";
        if (!bySales[key]) {
          bySales[key] = { sales: key, nominal: 0, jumlahOrder: 0 };
        }
        bySales[key].nominal += Number(r.Nominal_Order) || 0;
        bySales[key].jumlahOrder += 1;
      }
      const ranking = Object.values(bySales).sort(
        (a, b) => b.nominal - a.nominal,
      );

      return {
        periodeDicek: `${startDate} s/d ${endDate}`,
        divisiDicari: input.divisi || null,
        jumlahSalesDitemukan: ranking.length,
        catatan:
          ranking.length > limit
            ? `Hanya menampilkan ${limit} sales teratas dari total ${ranking.length}.`
            : undefined,
        rankingSales: ranking.slice(0, limit),
      };
    },
  },
  {
    definition: {
      name: "get_penawaran_batal",
      description:
        "Cari penawaran yang DIBATALKAN (seluruh item di penawaran itu batal, bukan sebagian), lengkap dengan ALASAN batal per item. Bisa difilter per sales dan/atau per customer, dengan rentang tanggal bebas. Berguna untuk: (1) tindak lanjut customer yang sudah lama tidak order — cek apakah ada penawaran yang dibuat lalu batal SETELAH tanggal order terakhirnya (pakai startDate = tanggal order terakhir dari get_customer_tanpa_order), (2) analisis pola pembatalan per sales.",
      input_schema: {
        type: "object",
        properties: {
          namaSales: {
            type: "string",
            description:
              "Opsional. Nama sales (partial match). Kosongkan untuk semua sales.",
          },
          namaCustomer: {
            type: "string",
            description:
              "Opsional. Nama customer (partial match). Berguna untuk cek riwayat pembatalan 1 customer tertentu.",
          },
          startDate: {
            type: "string",
            description:
              "Tanggal mulai (YYYY-MM-DD). Isi kalau user sebutkan rentang eksplisit, ATAU kalau melanjutkan dari pertanyaan sebelumnya (misal 'apakah ada penawaran batal SETELAH itu' — pakai tanggal order terakhir yang sudah diketahui dari jawaban sebelumnya). Kalau tidak ada acuan apa pun, biarkan kosong (default 1 tahun terakhir).",
          },
          endDate: {
            type: "string",
            description:
              "Tanggal akhir (YYYY-MM-DD). HANYA isi kalau user sebutkan eksplisit. Kalau tidak, biarkan kosong (default hari ini).",
          },
          limit: {
            type: "number",
            description: "Jumlah baris maksimal, default 30",
          },
        },
      },
    },
    handler: async (input, user) =>
      dashboardService.getPenawaranBatalBySales(user, {
        namaSales: input.namaSales,
        namaCustomer: input.namaCustomer,
        startDate: input.startDate,
        endDate: input.endDate,
        limit: input.limit || 30,
      }),
  },

  // ── PIUTANG ──
  {
    definition: {
      name: "get_piutang_dashboard",
      description:
        "Dashboard piutang lengkap: total outstanding, invoice bulan ini, top 10 piutang terbesar per customer, daftar invoice overdue, dan tren tagihan vs penerimaan 6 bulan terakhir.",
      input_schema: { type: "object", properties: {} },
    },
    handler: async (input, user) => dashboardService.getPiutangDashboard(user),
  },
  {
    definition: {
      name: "get_piutang_overdue",
      description:
        "Daftar invoice yang sudah melewati jatuh tempo, dengan nama customer, tanggal jatuh tempo, jumlah hari terlambat, dan sisa tagihan. Bisa diambil sebagian (pagination).",
      input_schema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Jumlah baris maksimal, default 20",
          },
          offset: {
            type: "number",
            description: "Baris yang dilewati, default 0",
          },
        },
      },
    },
    handler: async (input, user) =>
      dashboardService.getPiutangOverdue(
        user,
        input.limit || 20,
        input.offset || 0,
      ),
  },
  {
    definition: {
      name: "get_penerimaan_summary",
      description:
        "Ringkasan penerimaan pembayaran bulan ini: total penerimaan, jumlah transaksi, dan saldo yang belum diaplikasikan ke invoice.",
      input_schema: { type: "object", properties: {} },
    },
    handler: async (input, user) => dashboardService.getPenerimaanSummary(user),
  },
  {
    definition: {
      name: "get_piutang_by_customer",
      description:
        "Cari total piutang/outstanding invoice untuk 1 customer TERTENTU berdasarkan nama (partial match). Pakai ini kalau user tanya piutang customer spesifik, misal 'piutang PT ABC berapa?'. Kalau user cuma sebut nama customer TANPA maksud tanya piutang, jangan panggil tool ini.",
      input_schema: {
        type: "object",
        properties: {
          namaCustomer: {
            type: "string",
            description: "Nama customer atau sebagian nama customer",
          },
          limit: {
            type: "number",
            description: "Jumlah invoice maksimal ditampilkan, default 20",
          },
        },
        required: ["namaCustomer"],
      },
    },
    handler: async (input) => {
      if (!input.namaCustomer) {
        return { error: "Nama customer wajib diisi." };
      }
      return dashboardService.getPiutangByCustomer(
        input.namaCustomer,
        input.limit || 20,
        0,
      );
    },
  },
  {
    definition: {
      name: "get_customer_info",
      description:
        "Cari informasi detail 1 customer: alamat, kota, kontak (telepon, contact person), dan sales yang menangani. Berguna untuk persiapan kunjungan (butuh tahu lokasi/wilayah customer, nomor yang bisa dihubungi) atau sekadar cek data customer. Pakai ini kalau user tanya alamat/lokasi/kontak customer, atau butuh info customer untuk rencana kunjungan.",
      input_schema: {
        type: "object",
        properties: {
          namaCustomer: {
            type: "string",
            description:
              "Nama customer atau sebagian nama (partial match), WAJIB diisi",
          },
        },
        required: ["namaCustomer"],
      },
    },
    handler: async (input) => {
      if (!input.namaCustomer) {
        return { error: "Nama customer wajib diisi." };
      }
      const db = require("../../config/database");
      const [rows] = await db.query(
        `SELECT
           c.Cus_kode AS kode,
           c.Cus_nama AS nama,
           c.Cus_alamat AS alamat,
           c.Cus_kota AS kota,
           c.Cus_telp AS telp,
           c.cus_telp2 AS telp2,
           c.Cus_CP AS contactPerson,
           c.cus_email AS email,
           s.sal_nama AS salesPenanggungJawab,
           c.cus_keramat AS prioritas
         FROM tcustomer c
         LEFT JOIN tsales s ON s.sal_kode = c.cus_sales
         WHERE c.Cus_nama LIKE ?
         LIMIT 10`,
        [`%${input.namaCustomer}%`],
      );

      if (rows.length === 0) {
        return { ditemukan: false, pesan: "Customer tidak ditemukan." };
      }

      return {
        ditemukan: true,
        jumlahDitemukan: rows.length,
        catatan:
          rows.length > 1
            ? "Ada beberapa customer dengan nama serupa, tampilkan semuanya ke user."
            : undefined,
        customerList: rows.map((r) => ({
          kode: r.kode,
          nama: r.nama,
          alamat: r.alamat || "(alamat belum diisi)",
          kota: r.kota || "(kota belum diisi)",
          telepon: r.telp || r.telp2 || "(nomor belum diisi)",
          contactPerson: r.contactPerson || undefined,
          email: r.email || undefined,
          salesPenanggungJawab:
            r.salesPenanggungJawab || "(belum ada sales tetap)",
          prioritas: r.prioritas === "Y" ? "Customer prioritas" : undefined,
        })),
      };
    },
  },

  // ── PRODUKSI ──
  {
    definition: {
      name: "get_pipeline_spk_produksi",
      description:
        "Funnel SPK masuk ke tahap-tahap produksi (SPK Masuk → Ada MKB → Realisasi Minta → LHK Cutting → STBJ → Kirim), difilter berdasarkan rentang tanggal dateline.",
      input_schema: {
        type: "object",
        properties: {
          startDate: {
            type: "string",
            description:
              "HANYA isi kalau user eksplisit sebutkan tanggal/rentang waktu. Kalau tidak disebutkan, JANGAN isi parameter ini sama sekali — biarkan kosong/undefined.",
          },
          endDate: {
            type: "string",
            description:
              "HANYA isi kalau user eksplisit sebutkan tanggal/rentang waktu. Kalau tidak disebutkan, JANGAN isi parameter ini sama sekali — biarkan kosong/undefined.",
          },
        },
        required: ["startDate", "endDate"],
      },
    },
    handler: async (input, user) =>
      dashboardService.getPipelineSpkProduksi(
        user,
        input.startDate,
        input.endDate,
      ),
  },
  {
    definition: {
      name: "get_pipeline_penyelesaian_spk",
      description:
        "Funnel penyelesaian SPK aktif (SPK Aktif → Sudah STBJ → Sudah Kirim → Full Invoice), difilter rentang tanggal SPK.",
      input_schema: {
        type: "object",
        properties: {
          startDate: { type: "string", description: "Format YYYY-MM-DD" },
          endDate: { type: "string", description: "Format YYYY-MM-DD" },
        },
        required: ["startDate", "endDate"],
      },
    },
    handler: async (input, user) =>
      dashboardService.getPipelinePenyelesaianSpk(
        user,
        input.startDate,
        input.endDate,
      ),
  },
  {
    definition: {
      name: "get_bahan_kurang_count",
      description:
        "Jumlah SPK yang kekurangan bahan baku untuk produksi (belum semua kebutuhan bahan tersedia/di-PO-kan).",
      input_schema: { type: "object", properties: {} },
    },
    handler: async (input, user) => dashboardService.getBahanKurangCount(user),
  },
  {
    definition: {
      name: "get_spk_belum_mkb_count",
      description:
        "Jumlah SPK/SO bulan berjalan yang belum dibuatkan MKB (Memo Kebutuhan Bahan) sama sekali.",
      input_schema: { type: "object", properties: {} },
    },
    handler: async (input, user) => dashboardService.getSpkBelumMkbCount(user),
  },
  {
    definition: {
      name: "get_mutasi_produksi_detail",
      description:
        "Cari histori/progress mutasi produksi (perpindahan bahan antar gudang produksi, hasil cetak DTF/DTG/Plastisol, penerimaan barang jadi/STBJ, proses jasa luar) untuk 1 SPK/SO/MAP TERTENTU. WAJIB isi salah satu: nomorSpk (nomor SPK/SO/MAP persis) ATAU namaSpk (nama produk, partial match). JANGAN panggil tool ini kalau user cuma sebut NAMA CUSTOMER tanpa nomor/nama SPK — nomor/nama customer TIDAK didukung sebagai filter pencarian.",
      input_schema: {
        type: "object",
        properties: {
          nomorSpk: {
            type: "string",
            description: "Nomor SPK/SO/MAP persis, contoh SPK-JA-BU-000003",
          },
          namaSpk: {
            type: "string",
            description:
              "Nama produk/desain (partial match), dipakai kalau nomor SPK tidak diketahui",
          },
          startDate: {
            type: "string",
            description:
              "Tanggal mulai pencarian, format YYYY-MM-DD. Kalau tidak disebutkan user, pakai 1 tahun ke belakang dari hari ini.",
          },
          endDate: {
            type: "string",
            description:
              "Tanggal akhir pencarian, format YYYY-MM-DD. Kalau tidak disebutkan user, pakai hari ini.",
          },
        },
      },
    },
    handler: async (input) => {
      const today = new Date();
      const oneYearAgo = new Date(today);
      oneYearAgo.setFullYear(today.getFullYear() - 1);
      const toISO = (d) => d.toISOString().substring(0, 10);

      if (!input.nomorSpk && !input.namaSpk) {
        return {
          error:
            "Nomor SPK atau nama SPK wajib diisi untuk mencari mutasi produksi.",
        };
      }

      // Pengaman: kalau endDate yang dikasih Claude sudah lewat > 60 hari
      // dari hari ini, kemungkinan besar itu hasil "ngarang" tanggal
      // (bukan permintaan eksplisit user) — abaikan dan pakai default.
      let { startDate, endDate } = input;
      if (endDate) {
        const endDateObj = new Date(endDate);
        const diffDays = (today.getTime() - endDateObj.getTime()) / 86400000;
        if (diffDays > 60) {
          console.warn(
            `[aiChat][tool] get_mutasi_produksi_detail: endDate "${endDate}" dari Claude terlalu jauh di masa lalu (${Math.round(diffDays)} hari), diabaikan & pakai default.`,
          );
          startDate = undefined;
          endDate = undefined;
        }
      }

      const rows = await mutasiProduksiService.getBrowse({
        startDate: startDate || toISO(oneYearAgo),
        endDate: endDate || toISO(today),
        cab: "ALL",
        nomorSpk: input.nomorSpk || "",
        namaSpk: input.namaSpk || "",
      });

      if (rows.length === 0) {
        return { totalBarisDitemukan: 0, data: [] };
      }

      // ── Agregasi per tahap (Kelompok) — dihitung dari SELURUH baris,
      // bukan cuma sebagian, supaya progress-nya akurat & lengkap
      // walau jumlah baris mentahnya ribuan. Jauh lebih hemat token
      // daripada kirim semua baris mentah ke Claude.
      const byTahap = {};
      for (const r of rows) {
        const tahap = r.Kelompok || r.NomorMutasi || "LAINNYA";
        if (!byTahap[tahap]) {
          byTahap[tahap] = {
            tahap,
            jumlahBaris: 0,
            totalJumlah: 0,
            tanggalPertama: r.TanggalMutasi,
            tanggalTerakhir: r.TanggalMutasi,
          };
        }
        const g = byTahap[tahap];
        g.jumlahBaris += 1;
        g.totalJumlah += Number(r.Jumlah) || 0;
        if (r.TanggalMutasi < g.tanggalPertama)
          g.tanggalPertama = r.TanggalMutasi;
        if (r.TanggalMutasi > g.tanggalTerakhir)
          g.tanggalTerakhir = r.TanggalMutasi;
      }
      const ringkasanTahapan = Object.values(byTahap).sort((a, b) =>
        a.tanggalPertama.localeCompare(b.tanggalPertama),
      );

      // Info umum SPK (sama di semua baris) — diambil dari baris manapun
      const info = rows[0];

      // Sample detail terbaru (10 baris paling akhir berdasar tanggal)
      // — buat jaga-jaga kalau user nanya rincian lebih lanjut.
      const sortedByTgl = [...rows].sort((a, b) =>
        a.TanggalMutasi.localeCompare(b.TanggalMutasi),
      );
      const sampleTerbaru = sortedByTgl.slice(-10);

      return {
        infoSpk: {
          nomor: info.Nomor,
          namaSpk: info.NamaSpk,
          jumlahSpk: info.JumlahSpk,
          tipe: info.Tipe,
          divisi: info.DivisiNama,
          tglSpk: info.TglSpk,
        },
        totalBarisMutasi: rows.length,
        ringkasanTahapan,
        sampleDetailTerbaru: sampleTerbaru,
        catatan:
          "ringkasanTahapan sudah mencakup SEMUA baris (bukan sebagian) — pakai ini untuk menjawab progress. sampleDetailTerbaru cuma 10 baris paling akhir sebagai contoh detail, bukan data lengkap.",
      };
    },
  },
];

const getToolDefinitions = () => tools.map((t) => t.definition);

const executeTool = async (name, input, user) => {
  const tool = tools.find((t) => t.definition.name === name);
  if (!tool) {
    console.error(`[aiChat][tool] Tool tidak dikenal: "${name}"`);
    throw new Error(`Tool "${name}" tidak dikenal.`);
  }

  console.log(
    `[aiChat][tool] >> ${name} | input=${JSON.stringify(input)} | user=${user?.kode || "?"}`,
  );

  const startTime = Date.now();
  try {
    const result = await tool.handler(input || {}, user);
    const duration = Date.now() - startTime;

    // Ringkas hasil biar log nggak kebanjiran data mentah — cukup
    // tipe/jumlah baris/beberapa key pertama.
    let resultSummary;
    if (Array.isArray(result)) {
      resultSummary = `array(${result.length} item)`;
    } else if (result && typeof result === "object") {
      resultSummary = JSON.stringify(result).slice(0, 500);
    } else {
      resultSummary = String(result);
    }

    console.log(
      `[aiChat][tool] << ${name} | ${duration}ms | result=${resultSummary}`,
    );
    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(
      `[aiChat][tool] !! ${name} FAILED after ${duration}ms | input=${JSON.stringify(input)}`,
    );
    console.error(err); // full stack trace
    throw err;
  }
};

module.exports = { getToolDefinitions, executeTool };
