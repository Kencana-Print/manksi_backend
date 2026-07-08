const db = require("../config/database");

const searchSpk = async (
  keyword,
  page = 1,
  limit = 50,
  filterMode = "all",
  options = {},
) => {
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;
  let params = [];
  let baseQuery,
    whereSearch = "";

  if (filterMode === "spk-ppic") {
    // MKA: hanya SPK PPIC (spk_is_so=0, format SPK-)
    baseQuery = `
      FROM tspk
      WHERE spk_aktif = 'Y'
        AND spk_divisi IN (3, 4, 6)
        AND spk_cmo <> ''
        AND spk_jumlah <> spk_jumlah_kirim
        AND spk_is_so = 0
    `;
    if (keyword) {
      whereSearch = ` AND (spk_nomor LIKE ? OR spk_nama LIKE ?)`;
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
  } else if (filterMode === "so") {
    // MKB: SO (tsalesorder = baru, tspk legacy WHERE spk_is_so=1 = lama
    // pre-migrasi) + MAP dari tmemospk. tspk_is_so=1 TIDAK LAGI menjadi
    // satu-satunya sumber SO — data SO baru sekarang hidup di
    // tsalesorder, jadi harus di-UNION juga.
    baseQuery = `
      FROM (
        SELECT so_nomor AS Nomor, so_nama AS Nama, so_tanggal AS Tanggal,
               so_jumlah AS Jumlah, so_ukuran AS Ukuran, so_kain AS Kain,
               so_finishing AS Finishing, so_divisi AS Divisi,
               so_cmo AS CMO, so_aktif AS Aktif
        FROM tsalesorder
        UNION ALL
        SELECT spk_nomor AS Nomor, spk_nama AS Nama, spk_tanggal AS Tanggal,
               spk_jumlah AS Jumlah, spk_ukuran AS Ukuran, spk_kain AS Kain,
               spk_finishing AS Finishing, spk_divisi AS Divisi,
               spk_cmo AS CMO, spk_aktif AS Aktif
        FROM tspk
        WHERE spk_is_so = 1
        UNION ALL
        SELECT mspk_nomor, mspk_nama, mspk_tanggal,
               mspk_jumlah, mspk_ukuran, mspk_kain, mspk_finishing,
               mspk_divisi, mspk_cmo, 'Y'
        FROM tmemospk
      ) a
      WHERE Aktif = 'Y' AND Divisi IN (3,4,6) AND CMO <> ''
    `;
    if (keyword) {
      whereSearch = ` AND (Nomor LIKE ? OR Nama LIKE ?)`;
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
  } else if (filterMode === "mutasi") {
    // Mutasi Produksi: tspk divisi 3,4,6 (aktif, semua status)
    // UNION tmemospk divisi 3,4,6
    // Tidak filter spk_is_so, tidak filter jumlah_kirim
    baseQuery = `
    FROM (
      SELECT spk_nomor AS Nomor, spk_nama AS Nama, spk_tanggal AS Tanggal,
             spk_jumlah AS Jumlah, spk_ukuran AS Ukuran, spk_kain AS Kain,
             spk_finishing AS Finishing, spk_divisi AS Divisi,
             spk_cmo AS CMO, spk_aktif AS Aktif
      FROM tspk
      WHERE spk_aktif = 'Y' AND spk_divisi IN (3,4,6) AND spk_is_so = 0 
      UNION ALL
      SELECT mspk_nomor, mspk_nama, mspk_tanggal,
             mspk_jumlah, mspk_ukuran, mspk_kain, mspk_finishing,
             mspk_divisi, mspk_cmo, 'Y'
      FROM tmemospk
      WHERE mspk_divisi IN (3,4,6)
    ) a
    WHERE Aktif = 'Y'
  `;
    if (keyword) {
      whereSearch = ` AND (Nomor LIKE ? OR Nama LIKE ?)`;
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
  } else if (filterMode === "sj") {
    // SO: tsalesorder (baru) UNION tspk legacy WHERE spk_is_so=1 (lama).
    // Kolom di-alias spk_* di kedua sisi supaya selectClause di bawah
    // (yang literal pakai nama kolom spk_nomor, spk_nama, dst untuk
    // filterMode sj/spk-ppic) tetap bekerja tanpa perlu disentuh.
    const cusKode = options?.cusKode || "";
    const perushKode = options?.perushKode || "";
    const divisi = options?.divisi || "";
    baseQuery = `
    FROM (
      SELECT so_nomor AS spk_nomor, so_nama AS spk_nama, so_nama2 AS spk_nama2,
             so_tanggal AS spk_tanggal, so_jumlah AS spk_jumlah,
             so_ukuran AS spk_ukuran, so_kain AS spk_kain,
             so_finishing AS spk_finishing, so_divisi AS spk_divisi,
             so_cmo AS spk_cmo, so_aktif AS spk_aktif,
             so_cus_kode AS spk_cus_kode, so_perush_kode AS spk_perush_kode
      FROM tsalesorder
      UNION ALL
      SELECT spk_nomor, spk_nama, spk_nama2, spk_tanggal, spk_jumlah,
             spk_ukuran, spk_kain, spk_finishing, spk_divisi,
             spk_cmo, spk_aktif, spk_cus_kode, spk_perush_kode
      FROM tspk
      WHERE spk_is_so = 1
    ) spk
    WHERE spk_aktif = 'Y'
      AND spk_cmo <> ''
  `;
    if (cusKode) {
      baseQuery += ` AND spk_cus_kode = ?`;
      params.push(cusKode);
    }
    if (perushKode) {
      baseQuery += ` AND spk_perush_kode = ?`;
      params.push(perushKode);
    }
    if (divisi) {
      baseQuery += ` AND spk_divisi = ?`;
      params.push(divisi);
    }
    if (keyword) {
      whereSearch = ` AND (spk_nomor LIKE ? OR spk_nama LIKE ? OR spk_nama2 LIKE ?)`;
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
  } else {
    // Query UNION standar — untuk halaman lain (MKB, dll). Sekarang
    // mencakup 3 sumber: tsalesorder (SO baru), tspk (SPK PPIC +
    // SO legacy, tidak difilter spk_is_so supaya keduanya tetap
    // tercakup persis seperti perilaku asli), dan tmemospk (MAP).
    baseQuery = `
      FROM (
        SELECT so_nomor AS Nomor, so_nama AS Nama, so_tanggal AS Tanggal,
               so_jumlah AS Jumlah, so_ukuran AS Ukuran, so_kain AS Kain,
               so_finishing AS Finishing, so_divisi AS Divisi, so_cmo AS CMO, so_aktif AS Aktif
        FROM tsalesorder
        UNION ALL
        SELECT spk_nomor AS Nomor, spk_nama AS Nama, spk_tanggal AS Tanggal,
               spk_jumlah AS Jumlah, spk_ukuran AS Ukuran, spk_kain AS Kain,
               spk_finishing AS Finishing, spk_divisi AS Divisi, spk_cmo AS CMO, spk_aktif AS Aktif
        FROM tspk
        UNION ALL
        SELECT mspk_nomor, mspk_nama, mspk_tanggal,
               mspk_jumlah, mspk_ukuran, mspk_kain, mspk_finishing, mspk_divisi, mspk_cmo, 'Y'
        FROM tmemospk
      ) a
      WHERE Aktif = 'Y' AND Divisi IN (3,4,6) AND CMO <> ''
    `;
    if (keyword) {
      whereSearch = ` AND (Nomor LIKE ? OR Nama LIKE ?)`;
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
  }

  const [countResult] = await db.query(
    `SELECT COUNT(*) AS total ${baseQuery} ${whereSearch}`,
    params,
  );
  const total = countResult[0].total;

  // SELECT kolom eksplisit untuk mkaOnly, alias untuk non-mkaOnly sudah dari subquery
  const selectClause =
    filterMode === "spk-ppic" || filterMode === "sj"
      ? `SELECT spk_nomor AS Nomor, spk_nama AS Nama,
              spk_nama2 AS Nama2,
              DATE_FORMAT(spk_tanggal, '%Y-%m-%d') AS Tanggal,
              spk_jumlah AS Jumlah, spk_ukuran AS Ukuran,
              spk_kain AS Kain, spk_finishing AS Finishing,
              spk_divisi AS Divisi, spk_cmo AS CMO`
      : `SELECT *`;

  const orderByCol =
    filterMode === "spk-ppic" || filterMode === "sj"
      ? "spk_tanggal"
      : "Tanggal";

  const dataQuery = `
    ${selectClause} ${baseQuery} ${whereSearch}
    ORDER BY ${orderByCol} DESC
    LIMIT ? OFFSET ?
  `;
  params.push(limitNum, offset);

  const [rows] = await db.query(dataQuery, params);
  return { items: rows, total };
};

const searchSpkProduksi = async (keyword, page = 1, limit = 50) => {
  const limitNum = Number(limit);
  const pageNum = Number(page);
  const offset = (pageNum - 1) * limitNum;
  let params = [];

  const baseQuery = `
    FROM (
      SELECT 
        spk_nomor AS Nomor, spk_nama AS Nama, spk_tanggal AS Tanggal,
        spk_jumlah AS Jumlah, spk_ukuran AS Ukuran, spk_kain AS Kain,
        spk_finishing AS Finishing, spk_aktif AS Aktif
      FROM tspk
      UNION ALL
      SELECT 
        mspk_nomor AS Nomor, mspk_nama AS Nama, mspk_tanggal AS Tanggal,
        mspk_jumlah AS Jumlah, mspk_ukuran AS Ukuran, mspk_kain AS Kain,
        mspk_finishing AS Finishing, "Y" AS Aktif
      FROM tmemospk
    ) a
    WHERE Aktif = 'Y'
  `;

  let whereSearch = "";
  if (keyword && keyword.trim() !== "") {
    whereSearch = ` AND (Nomor LIKE ? OR Nama LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const [countResult] = await db.query(
    `SELECT COUNT(*) AS total ${baseQuery} ${whereSearch}`,
    params,
  );
  const total = countResult[0].total;

  const dataParams = [...params, limitNum, offset];
  const [rows] = await db.query(
    `SELECT * ${baseQuery} ${whereSearch} ORDER BY Nama ASC LIMIT ? OFFSET ?`,
    dataParams,
  );

  return { items: rows, total, page: pageNum, limit: limitNum };
};

const searchBahan = async (keyword, isBordir, mode, page = 1, limit = 50) => {
  const limitNum = Number(limit);
  const pageNum = Number(page);
  const offset = (pageNum - 1) * limitNum;

  let params = [];

  let whereClause = `WHERE b.bhn_aktif = 0`;

  if (mode === "komponen") {
    whereClause += ` AND b.bhn_jb_kode = 'LL'`;
  }

  if (isBordir === "true") {
    whereClause += ` AND b.bhn_bordir <> 0`;
  }

  if (keyword && keyword.trim() !== "") {
    whereClause += ` AND (b.bhn_kode LIKE ? OR b.bhn_name LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  // Hitung total (pakai alias b agar konsisten)
  const [countResult] = await db.query(
    `SELECT COUNT(*) AS total FROM tbahan b ${whereClause}`,
    params,
  );
  const total = countResult[0].total;

  let query = `
    SELECT 
      b.bhn_kode AS Kode, 
      b.bhn_name AS Nama, 
      b.bhn_satuan AS Satuan,
      IFNULL(g.bg_nama, "") AS Gramasi,
      IFNULL(s.bs_nama, "") AS Setting,
      IFNULL(j.bj_nama, "") AS Jenis,
      b.bhn_hargabeli AS Harga,
      IFNULL((
        SELECT SUM(c.mst_stok_in - c.mst_stok_out) 
        FROM tmasterstok_barcode c
        WHERE c.mst_aktif = 'Y' 
          AND LEFT(c.mst_brg_kode, LENGTH(c.mst_brg_kode)-7) = b.Bhn_kode
      ), 0) AS Stok
    FROM tbahan b
    LEFT JOIN tbahan_gramasi g ON g.bg_kode = MID(b.bhn_kode, 6, 2)
    LEFT JOIN tbahan_setting s ON s.bs_kode = RIGHT(b.bhn_kode, 2)
    LEFT JOIN tbahan_jenis j ON j.bj_kode = LEFT(b.bhn_kode, 2)
    ${whereClause} 
    ORDER BY b.bhn_name ASC
  `;

  if (limitNum > 0) {
    query += ` LIMIT ? OFFSET ?`;
    params.push(limitNum, offset);
  }

  const [rows] = await db.query(query, params);

  return {
    items: rows,
    total,
    page: pageNum,
    limit: limitNum,
  };
};

const searchCustomer = async (keyword, page = 1, limit = 50) => {
  const limitNum = Number(limit);
  const pageNum = Number(page);
  const offset = (pageNum - 1) * limitNum;

  let params = [];
  // Hanya cari customer yang aktif
  let whereClause = `WHERE cus_aktif = 0 AND cus_iscabang = 0`;

  if (keyword && keyword.trim() !== "") {
    whereClause += ` AND (cus_kode LIKE ? OR cus_nama LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const [countResult] = await db.query(
    `SELECT COUNT(*) AS total FROM tcustomer ${whereClause}`,
    params,
  );
  const total = countResult[0].total;

  let query = `
    SELECT cus_kode AS Kode, cus_nama AS Nama, cus_alamat AS Alamat, 
           cus_kota AS Kota, -- Tambahkan ini agar tidak kosong di frontend
           cus_cp AS CP, cus_perfect AS cus_perfect
    FROM tcustomer 
    ${whereClause} 
    ORDER BY cus_nama ASC
  `;

  // Fix Limit -1 (All)
  if (limitNum > 0) {
    query += ` LIMIT ? OFFSET ?`;
    params.push(limitNum, offset);
  }

  const [rows] = await db.query(query, params);
  return { items: rows, total: total, page: pageNum, limit: limitNum };
};

const getCabangPabrik = async (type) => {
  // FIX: Tambahkan pab_nama AS Nama agar tidak kosong di frontend
  let query = `SELECT pab_kode AS Kode, pab_nama AS Nama FROM tpabrik WHERE pab_nama NOT LIKE "%MITRA%"`;

  // Jika parameter type dikirim sebagai 'po-internal', batasi hasilnya
  if (type === "po-internal") {
    query += ` AND pab_kode IN ('P01', 'P02', 'P03', 'P04', 'P05', 'HO-')`;
  }

  query += ` ORDER BY pab_kode`;

  const [rows] = await db.query(query);
  return rows;
};

const searchBagianProduksi = async (cabang) => {
  // Hanya divisi PRODUKSI dan 3 huruf depannya sesuai cabang (contoh 'HO-')
  const [rows] = await db.query(
    `
    SELECT kb_kode AS Kode, kb_nama AS Nama 
    FROM kpi.tbagian 
    WHERE kb_divisi = "PRODUKSI" AND LEFT(kb_kode, 3) = ? 
    ORDER BY kb_nama
  `,
    [cabang],
  );
  return rows;
};

const getSales = async () => {
  // Hanya ambil sales yang aktif
  const [rows] = await db.query(
    `SELECT sal_kode, sal_nama, sal_alamat FROM tsales WHERE sal_aktif = "Y" ORDER BY sal_kode`,
  );
  return rows;
};

const getJenisKainMintaHarga = async (kodeModel) => {
  // Sesuai query Delphi: SELECT distinct k.mhk_jeniskain Jeniskain, k.mhk_ktg Kategori ...
  const [rows] = await db.query(
    `
    SELECT DISTINCT mhk_jeniskain AS Jeniskain, mhk_ktg AS Kategori 
    FROM tmintaharga_kain 
    WHERE mhk_kode = ? 
    ORDER BY mhk_jeniskain
  `,
    [kodeModel],
  );
  return rows;
};

const getKomponenKain = async (model, jenisKain, warna) => {
  // Query ini mereplika persis query di prosedur loadKomponen Delphi
  const query = `
    SELECT 
      k.mhk_lengan AS lengan, 
      k.mhk_komponen AS komponen, 
      k.mhk_babaran AS babaran,
      (
        SELECT a.mhk_harga 
        FROM tmintaharga_kain a 
        WHERE a.mhk_warna = ? AND a.mhk_kode = k.mhk_kode AND a.mhk_jeniskain = k.mhk_jeniskain
        LIMIT 1
      ) AS harga
    FROM tmintaharga_kain k
    WHERE k.mhk_komponen <> "" AND k.mhk_kode = ? AND k.mhk_jeniskain = ?
  `;

  // Urutan parameter: [warna (untuk subquery), model, jenisKain]
  const [rows] = await db.query(query, [warna, model, jenisKain]);
  return rows;
};

const getCetakOptions = async () => {
  const query = `
    SELECT mhb_jenis, mhb_ket, mhb_biaya 
    FROM tmintaharga_biaya 
    WHERE mhb_biaya <> 0 AND mhb_jenis IN ("CETAK", "SUBLIM") 
    ORDER BY mhb_jenis, mhb_ket
  `;
  const [rows] = await db.query(query);
  return rows;
};

const getTambahanOptions = async () => {
  const query = `
    SELECT mht_ket, mht_lacost, mht_cotton, mht_pe 
    FROM tmintaharga_tambahan 
    ORDER BY mht_ket
  `;
  const [rows] = await db.query(query);
  return rows;
};

const getPerusahaan = async () => {
  const query = `
    SELECT 
      p.perush_kode, p.perush_nama, p.perush_alamat,
      d.nama AS ttd_nama, d.jabatan AS ttd_jabatan
    FROM tperusahaan p
    LEFT JOIN tdigitalsign d ON d.kode = p.perush_kode
    ORDER BY p.perush_nama
  `;
  const [rows] = await db.query(query);
  return rows;
};

const getPerusahaanByKode = async (kode) => {
  const [rows] = await db.query(
    `SELECT perush_kode, perush_nama
     FROM tperusahaan WHERE perush_kode = ? LIMIT 1`,
    [kode],
  );
  if (rows.length === 0) throw new Error("Perusahaan tidak ditemukan.");
  return rows[0];
};

// Tambah fungsi baru
const getDigitalSign = async (kode) => {
  const [rows] = await db.query(
    "SELECT nama, jabatan FROM tdigitalsign WHERE kode = ?",
    [kode],
  );
  return rows.length > 0 ? rows[0] : null;
};

const getRekeningPerusahaan = async (perushKode) => {
  // Sesuai query Delphi (F1 pada edtAccount)
  // Memilih rekening yang berkaitan dengan perusahaan yang aktif
  const query = `
    SELECT 
      d.perushd_rekening AS Rekening, 
      d.perushd_bank AS Bank, 
      d.perushd_atasnama AS AtasNama, 
      d.perushd_cabang AS Cabang 
    FROM tperusahaan_dtl d
    INNER JOIN tperusahaan p ON p.perush_kode = d.perushd_perush_kode 
    WHERE d.perushd_perush_kode = ?
  `;
  const [rows] = await db.query(query, [perushKode]);
  return rows;
};

const getDivisi = async () => {
  // Ganti "nama" menjadi "divisi" sesuai struktur umum database Kencana Print
  const query = `SELECT kode, divisi AS nama FROM tdivisi WHERE kode <> 0 ORDER BY kode`;
  const [rows] = await db.query(query);
  return rows;
};

const searchMintaHarga = async (keyword, custKode, page = 1, limit = 50) => {
  const limitNum = Number(limit);
  const pageNum = Number(page);
  const offset = (pageNum - 1) * limitNum;

  let params = [];
  // Sesuai Delphi: status bukan BELUM
  let whereClause = `WHERE m.mh_status <> "BELUM"`;

  // Dinamis: Hanya filter customer JIKA custKode dikirim
  if (custKode && custKode.trim() !== "") {
    whereClause += ` AND m.mh_cus_kode = ?`;
    params.push(custKode);
  }

  if (keyword && keyword.trim() !== "") {
    whereClause += ` AND (m.mh_nomor LIKE ? OR m.mh_nama LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const countQuery = `SELECT COUNT(*) AS total FROM tmintaharga m ${whereClause}`;
  const [countResult] = await db.query(countQuery, params);
  const total = countResult[0].total;

  let query = `
    SELECT 
      m.mh_nomor AS Nomor, 
      DATE_FORMAT(m.mh_tanggal, "%d-%m-%Y") AS Tanggal, 
      v.divisi AS Divisi, 
      s.sal_nama AS Sales,
      m.mh_nama AS Nama, 
      m.mh_jmlorder AS QtyOrder, 
      m.mh_harga_kalkulasi AS Harga
    FROM tmintaharga m
    LEFT JOIN tsales s ON s.sal_kode = m.mh_sal_kode
    LEFT JOIN tdivisi v ON v.kode = m.mh_divisi
    ${whereClause}
    ORDER BY m.mh_nomor DESC
  `;

  if (limitNum > 0) {
    query += ` LIMIT ? OFFSET ?`;
    params.push(limitNum, offset);
  }

  const [rows] = await db.query(query, params);
  return { items: rows, total, page: pageNum, limit: limitNum };
};

const searchJenisOrder = async (divisi) => {
  let whereClause = "";
  let params = [];

  // Replikasi logika Delphi berdasarkan awalan kode Divisi
  if (divisi) {
    const divStr = String(divisi).charAt(0);
    if (divStr === "3") {
      whereClause = "WHERE jo_divisi IN (3, 4, 6)";
    } else if (divStr === "4" || divStr === "6") {
      whereClause = "WHERE jo_divisi = 4";
    } else {
      whereClause = "WHERE jo_divisi = ?";
      params.push(divStr);
    }
  }

  const query = `
    SELECT jo_kode, jo_nama 
    FROM tjenisorder 
    ${whereClause} 
    ORDER BY jo_kode ASC
  `;

  const [rows] = await db.query(query, params);

  // Format dikembalikan dalam objek items agar seragam dengan standar modal
  return { items: rows };
};

const searchPenawaran = async (keyword, custKode, page = 1, limit = 50) => {
  const limitNum = Number(limit);
  const pageNum = Number(page);
  const offset = (pageNum - 1) * limitNum;

  let params = [];
  let whereClause = "WHERE 1=1";

  // Filter opsional jika custKode dikirim dari frontend
  if (custKode && custKode.trim() !== "") {
    whereClause += " AND h.pen_cus_kode = ?";
    params.push(custKode);
  }

  if (keyword && keyword.trim() !== "") {
    whereClause += " AND (h.pen_nomor LIKE ? OR c.cus_nama LIKE ?)";
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const [countResult] = await db.query(
    `SELECT COUNT(*) AS total 
     FROM tpenawaran_hdr h 
     LEFT JOIN tcustomer c ON h.pen_cus_kode = c.cus_kode 
     ${whereClause}`,
    params,
  );
  const total = countResult[0].total;

  let query = `
    SELECT 
      h.pen_nomor, 
      DATE_FORMAT(h.pen_tanggal, "%d-%m-%Y") AS pen_tanggal, 
      h.pen_cus_kode, 
      c.cus_nama 
    FROM tpenawaran_hdr h 
    LEFT JOIN tcustomer c ON h.pen_cus_kode = c.cus_kode 
    ${whereClause} 
    ORDER BY h.pen_tanggal DESC
  `;

  if (limitNum > 0) {
    query += ` LIMIT ? OFFSET ?`;
    params.push(limitNum, offset);
  }

  const [rows] = await db.query(query, params);
  return { items: rows, total, page: pageNum, limit: limitNum };
};

const searchPenawaranDetail = async (penawaranNomor) => {
  const query = `
    SELECT pend_id AS id, pend_nama_barang AS Nama, pend_bahan AS Bahan, 
           pend_ukuran AS Ukuran, pend_satuan AS Satuan, pend_qty AS Qty, 
           pend_harga AS Harga, (pend_qty * pend_harga) AS Total
    FROM tpenawaran_dtl
    WHERE pend_pen_nomor = ?
    ORDER BY pend_id
  `;
  const [rows] = await db.query(query, [penawaranNomor]);
  return { items: rows }; // Tanpa pagination karena datanya spesifik per Header
};

// --- FUNGSI UNTUK MODAL SEARCH MAP GARMEN ---
const searchMapGarmen = async (keyword, cusKode, perushKode, divisi) => {
  let params = [];
  // Dasar: mspk_cmo dan mspk_close pake huruf kecil semua sesuai skema
  let whereClause = `WHERE mspk_cmo <> "" AND mspk_close = 'N'`; // mspk_close di skema Anda default 'N'

  if (divisi) {
    whereClause += ` AND mspk_divisi = ?`;
    params.push(divisi);
  }
  if (cusKode) {
    whereClause += ` AND Mspk_cus_kode = ?`; // Mspk_cus_kode
    params.push(cusKode);
  }
  if (perushKode) {
    whereClause += ` AND mspk_perush_kode = ?`; // mspk_perush_kode
    params.push(perushKode);
  }
  if (keyword && keyword.trim() !== "") {
    whereClause += ` AND (MSPK_Nomor LIKE ? OR Mspk_nama LIKE ?)`; // MSPK_Nomor & Mspk_nama
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const query = `
    SELECT 
      MSPK_Nomor AS Nomor, 
      Mspk_nama AS Nama, 
      DATE_FORMAT(Mspk_Tanggal, "%d-%m-%Y") AS Tanggal, 
      Mspk_jumlah AS Jumlah, 
      Mspk_ukuran AS Ukuran, 
      Mspk_kain AS Bahan,
      Mspk_jumlah_kirim AS JmlKirim, 
      (Mspk_jumlah - Mspk_jumlah_kirim) AS Kurang
    FROM tmemospk 
    ${whereClause} 
    ORDER BY Mspk_Tanggal DESC, MSPK_Nomor DESC
  `;
  const [rows] = await db.query(query, params);
  return { items: rows };
};
// --- FUNGSI UNTUK VALIDASI KETIK LANGSUNG (edtkodeExit) ---
const validateMapGarmen = async (nomor) => {
  const query = `
    SELECT mspk_nomor AS Nomor, mspk_nama AS Nama
    FROM tmemospk 
    WHERE mspk_divisi IN (3, 4, 6) AND mspk_nomor = ?
  `;
  const [rows] = await db.query(query, [nomor]);
  if (rows.length === 0) return null; // Tidak ketemu
  return rows[0]; // Ketemu
};

// --- GET PO INTERNAL UNTUK SURAT JALAN ---
const searchPoInternal = async (cabangTujuan) => {
  // Query Delphi: SELECT h.poi_nomor Nomor,h.poi_tanggal Tanggal,h.poi_cab AsalPO
  // WHERE h.poi_close="N" AND h.poi_cab=...
  const query = `
    SELECT h.poi_nomor AS Nomor, h.poi_tanggal AS Tanggal, h.poi_cab AS AsalPO
    FROM tpointernalmap_hdr h
    WHERE h.poi_close = "N" AND h.poi_cab = ?
    ORDER BY h.date_create DESC
  `;
  const [rows] = await db.query(query, [cabangTujuan]);
  return { items: rows };
};

// --- GET ACCESORIES (Dari tgarmen_brg) ---
const searchAccesories = async () => {
  const query = `
    SELECT 
      brg_kode AS Kode, 
      brg_nama AS Nama, 
      brg_satuan AS Satuan, 
      brg_note AS Note
    FROM tgarmen_brg
    WHERE brg_jenis = 'ACCESORIES'
    ORDER BY brg_nama
  `;
  const [rows] = await db.query(query);
  return { items: rows };
};

// --- GET KOMPONEN ---
const getKomponen = async () => {
  const [rows] = await db.query(`SELECT komponen FROM tkomponen ORDER BY no`);
  return rows.map((r) => r.komponen); // Return array of string
};

// --- TAMBAHKAN FUNGSI INI ---
const searchMintaBahan = async (keyword, page = 1, limit = 50) => {
  const limitNum = Number(limit);
  const pageNum = Number(page);
  const offset = (pageNum - 1) * limitNum;

  let params = [];
  // Syarat: Belum close (min_close <> 1) dan sudah di-ACC (min_apv = 'Y')
  let whereClause = `WHERE min_close <> 1`;

  if (keyword && keyword.trim() !== "") {
    whereClause += ` AND (min_nomor LIKE ? OR min_spk_nomor LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const countQuery = `SELECT COUNT(*) AS total FROM tmintabahan_hdr ${whereClause}`;
  const [countResult] = await db.query(countQuery, params);
  const total = countResult[0].total;

  let query = `
    SELECT 
      min_nomor AS Nomor, 
      min_tanggal AS Tanggal, 
      min_spk_nomor AS SPK, 
      min_ket AS Keterangan, 
      min_apv AS Approve
    FROM tmintabahan_hdr 
    ${whereClause} 
    ORDER BY min_tanggal DESC, min_nomor DESC
  `;

  if (limitNum > 0) {
    query += ` LIMIT ? OFFSET ?`;
    params.push(limitNum, offset);
  }

  const [rows] = await db.query(query, params);
  return { items: rows, total, page: pageNum, limit: limitNum };
};

// --- SEARCH HEADER REALISASI MINTA (Untuk kolom No. Realisasi Minta) ---
const searchRealisasiMinta = async (keyword, page = 1, limit = 50) => {
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;
  let params = [];
  let whereClause = "WHERE 1=1";

  if (keyword && keyword.trim() !== "") {
    whereClause += ` AND (h.promin_nomor LIKE ? OR h.promin_spk_nomor LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const [countResult] = await db.query(
    `SELECT COUNT(*) AS total FROM tproduksiminta_hdr h ${whereClause}`,
    params,
  );
  const total = countResult[0].total;

  const query = `
    SELECT 
      h.promin_nomor AS Nomor, 
      h.promin_tanggal AS Tanggal, 
      h.promin_spk_nomor AS SPK,
      IFNULL(s.spk_nama, m.mspk_nama) AS NamaSpk,
      h.promin_keterangan AS Keterangan
    FROM tproduksiminta_hdr h
    LEFT JOIN tspk s ON s.spk_nomor = h.promin_spk_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = h.promin_spk_nomor
    ${whereClause}
    ORDER BY h.promin_tanggal DESC, h.promin_nomor DESC
    LIMIT ? OFFSET ?
  `;
  params.push(limitNum, offset);

  const [rows] = await db.query(query, params);
  return { items: rows, total };
};

// --- SEARCH DETAIL REALISASI MINTA (Berdasarkan Header yang dipilih) ---
const searchRealisasiMintaDetail = async (nomorRealisasi, gdgProduksi) => {
  const query = `
    SELECT x.*, (x.Minta - x.LHK) AS Sisa FROM (
      SELECT 
        h.promin_nomor AS NoMinta, h.promin_spk_nomor AS SPK,
        d.promind_bhn_kode AS Kode, b.Bhn_Name AS Nama, b.Bhn_satuan AS Satuan, 
        d.promind_jumlah AS Minta,
        -- TAMBAHKAN FIELD INI:
        d.promind_sup_kode AS kdsup, 
        IFNULL(u.Sup_nama, "") AS nmsup,
        (SELECT IFNULL(SUM(u.proretd_Jumlah),0) FROM tproduksireturlog_dtl u 
         WHERE u.proretd_nominta = h.promin_nomor AND u.proretd_bhn_kode = d.promind_bhn_kode) AS Sudah,
        (SELECT IFNULL(SUM(k.mph_qty_berat),0) FROM tmutasiproduksi_hdr k
         WHERE k.mph_nomaterial = h.promin_nomor AND k.mph_spk_nomor = h.promin_spk_nomor 
         AND k.mph_bhn_kode = d.promind_bhn_kode AND k.mph_gdgasal = ?) AS LHK
      FROM tproduksiminta_hdr h
      INNER JOIN tproduksiminta_dtl d ON d.promind_promin_Nomor = h.promin_nomor
      LEFT JOIN tbahan b ON b.Bhn_kode = d.promind_bhn_kode
      LEFT JOIN tsupplier u ON u.Sup_kode = d.promind_sup_kode
      WHERE h.promin_nomor = ?
    ) x
  `;
  const [rows] = await db.query(query, [gdgProduksi, nomorRealisasi]);
  return { items: rows };
};

const searchGudangProduksi = async (keyword, cabang, page = 1, limit = 50) => {
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;
  let params = [];
  let whereClause = "";

  // Logika Filter Sesuai Delphi
  if (cabang === "P03") {
    whereClause = `WHERE gdgp_kode = "K0001"`;
  } else if (cabang === "P05") {
    whereClause = `WHERE gdgp_kode = "MMT01"`;
  } else {
    whereClause = `WHERE gdgp_aktif = 0 AND gdgp_jasa <> "" AND gdgp_nama NOT LIKE "%QC%"`;
    if (cabang && cabang !== "ALL" && !cabang.startsWith("HO")) {
      whereClause += ` AND gdgp_cab = ?`;
      params.push(cabang);
    }
  }

  // Filter Keyword Pencarian
  if (keyword && keyword.trim() !== "") {
    whereClause += ` AND (gdgp_kode LIKE ? OR gdgp_nama LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  // Hitung Total Data
  const [countResult] = await db.query(
    `SELECT COUNT(*) AS total FROM tgudangproduksi ${whereClause}`,
    params,
  );
  const total = countResult[0].total;

  // Ambil Data
  let query = `
    SELECT gdgp_kode AS Kode, gdgp_nama AS Nama
    FROM tgudangproduksi
    ${whereClause}
    ORDER BY gdgp_nama ASC
  `;

  if (limitNum > 0) {
    query += ` LIMIT ? OFFSET ?`;
    params.push(limitNum, offset);
  }

  const [rows] = await db.query(query, params);

  return {
    items: rows,
    total: total,
    page: Number(page),
    limit: limitNum,
  };
};

const searchBarangGarmen = async (
  keyword,
  jenis,
  cabang,
  bagian,
  page = 1,
  limit = 50,
) => {
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;

  // 1. Tentukan tabel stok berdasarkan jenis
  let stockTable = "tmasterstok_atk"; // Default ATK/RTK
  if (jenis === "ACCESORIES") stockTable = "tmasterstok_acc";
  else if (jenis === "OBAT") stockTable = "tmasterstok_obat";
  else if (jenis === "SPAREPART") stockTable = "tmasterstok_sparepart";

  // 2. Siapkan kondisi dasar
  let whereClause = `WHERE b.brg_aktif = "Y" AND b.brg_jenis = ?`;
  let whereParams = [jenis];

  // 3. Filter khusus Sparepart berdasarkan Bagian User
  if (jenis === "SPAREPART") {
    if (bagian === "TEKNISI") whereClause += ` AND b.brg_ktg <> "IT"`;
    else if (bagian === "IT") whereClause += ` AND b.brg_ktg = "IT"`;
  }

  // 4. Pencarian keyword
  if (keyword && keyword.trim() !== "") {
    whereClause += ` AND (b.brg_kode LIKE ? OR b.brg_nama LIKE ? OR b.brg_note LIKE ?)`;
    whereParams.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }

  // Hitung total data
  const [countRes] = await db.query(
    `SELECT COUNT(*) AS total FROM tgarmen_brg b ${whereClause}`,
    whereParams,
  );
  const total = countRes[0].total;

  // 5. Query utama (termasuk subquery stok sesuai cabang)
  const dataQuery = `
    SELECT 
      b.brg_kode AS Kode, 
      IF(b.brg_note="", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama, 
      b.brg_satuan AS Satuan,
      IFNULL((
        SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
        FROM ${stockTable} m 
        WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_brg_kode=b.brg_kode
      ), 0) AS Stok
    FROM tgarmen_brg b
    ${whereClause}
    ORDER BY b.brg_nama ASC
    LIMIT ? OFFSET ?
  `;

  // Parameter: [cabang (utk stok), ...whereParams, limit, offset]
  const dataParams = [cabang, ...whereParams, limitNum, offset];
  const [rows] = await db.query(dataQuery, dataParams);

  return { items: rows, total, page: Number(page), limit: limitNum };
};

// --- SEARCH PERMINTAAN BARANG GARMEN (Untuk Realisasi) ---
const searchPermintaanBarangGarmen = async (
  keyword,
  jenis,
  cabang,
  bagian,
  page = 1,
  limit = 50,
) => {
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;
  let params = [];

  // Sesuai Delphi (edtMintaExit & F1 lookup):
  // Filter status Buka(0) atau Proses(2), sesuai jenisnya
  let whereClause = `WHERE min_close IN (0,2) AND min_jenis = ?`;
  params.push(jenis);

  // Jika jenis SPAREPART, batasi sesuai bagian user (TEKNISI / IT)
  if (jenis === "SPAREPART" && (bagian === "TEKNISI" || bagian === "IT")) {
    whereClause += ` AND min_bagian = ?`;
    params.push(bagian);
  }

  // Filter Keyword Pencarian
  if (keyword && keyword.trim() !== "") {
    whereClause += ` AND (min_nomor LIKE ? OR min_spk_nomor LIKE ? OR min_ket LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }

  // Hitung Total
  const [countResult] = await db.query(
    `SELECT COUNT(*) AS total FROM tgarmenminta_hdr ${whereClause}`,
    params,
  );
  const total = countResult[0].total;

  // Ambil Data
  let query = `
    SELECT 
      min_nomor AS Nomor, 
      DATE_FORMAT(min_tanggal, "%d-%m-%Y") AS Tanggal, 
      min_cab AS CabMinta, 
      user_create AS Peminta,
      min_spk_nomor AS SPK,
      IF(LEFT(min_gp,1)="K", gdgp_nama, RIGHT(gdgp_nama, LENGTH(gdgp_nama)-6)) AS GudangProduksi,
      min_ket AS Keterangan
    FROM tgarmenminta_hdr
    LEFT JOIN tgudangproduksi ON gdgp_kode = min_gp
    ${whereClause}
    ORDER BY min_nomor DESC
  `;

  if (limitNum > 0) {
    query += ` LIMIT ? OFFSET ?`;
    params.push(limitNum, offset);
  }

  const [rows] = await db.query(query, params);

  return {
    items: rows,
    total: total,
    page: Number(page),
    limit: limitNum,
  };
};

const searchBarangInvProforma = async (
  perushKode,
  cusKode,
  keyword,
  page = 1,
  limit = 50,
) => {
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;
  let params = [];

  // Logika Delphi: Barang tanpa SPK ATAU SPK-nya (SO) punya perusahaan & customer yg sama
  let whereClause = `
    WHERE (s.spk_nomor IS NULL 
       OR (s.spk_perush_kode = ? AND s.spk_cus_kode = ?))
  `;
  params.push(perushKode, cusKode);

  if (keyword && keyword.trim() !== "") {
    whereClause += ` AND (b.brg_kode LIKE ? OR b.brg_name LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const [countResult] = await db.query(
    `SELECT COUNT(*) AS total 
     FROM tbarang b 
     LEFT JOIN tspk s ON b.brg_kode = s.spk_nomor AND s.spk_is_so = 1 
     ${whereClause}`,
    params,
  );
  const total = countResult[0].total;

  let query = `
    SELECT 
      b.brg_kode AS Kode, 
      b.brg_name AS Nama, 
      b.brg_ukuran AS Ukuran, 
      b.brg_harga AS Harga
    FROM tbarang b
    LEFT JOIN tspk s ON b.brg_kode = s.spk_nomor AND s.spk_is_so = 1
    ${whereClause}
    ORDER BY b.brg_kode ASC
  `;

  if (limitNum > 0) {
    query += ` LIMIT ? OFFSET ?`;
    params.push(limitNum, offset);
  }

  const [rows] = await db.query(query, params);
  return { items: rows, total, page: Number(page), limit: limitNum };
};

const getWorkshops = async () => {
  // Sesuai logic FormCreate di Delphi: SELECT DISTINCT pab_kode FROM tpabrik
  const [rows] = await db.query(
    `SELECT DISTINCT pab_kode AS Workshop FROM tpabrik ORDER BY pab_kode`,
  );
  // Kembalikan dalam bentuk array string sederhana agar cocok dengan v-for di Vue
  return rows.map((r) => r.Workshop);
};

// Dapatkan daftar status kepentingan
const getKepentinganSpk = async () => {
  const [rows] = await db.query(
    `SELECT kepentingan FROM tspk_kepentingan ORDER BY kode`,
  );
  return rows.map((r) => r.kepentingan);
};

// Dapatkan daftar keterangan PO
const getKetPo = async () => {
  // Tambahkan 'acc' pada SELECT
  const [rows] = await db.query(`SELECT ket, acc FROM tspk_ketpo`);

  // Kembalikan sebagai array of objects. Tambahkan opsi kosong di awal agar default combobox tidak error
  return [{ ket: "", acc: "N" }, ...rows];
};

// Dapatkan keterangan komponen (untuk Tab Kaosan jika nanti butuh)
const getKetKomponen = async () => {
  const [rows] = await db.query(`SELECT * FROM tketkomponen ORDER BY kode`);
  // Transformasikan sedikit untuk Vue
  return rows.map((r) => ({
    kode: r.kode,
    nama: r.nama,
    pakai: false,
    ket: "",
  }));
};

// --- GET CUST KAOSAN (Dari db retail) ---
const searchCustKaosan = async (keyword, page = 1, limit = 50) => {
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;
  let params = [];
  let whereClause = `WHERE cus_aktif = 0`; // Sesuai Delphi

  if (keyword && keyword.trim() !== "") {
    whereClause += ` AND (cus_kode LIKE ? OR cus_nama LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const [countResult] = await db.query(
    `SELECT COUNT(*) AS total FROM retail.tcustomer ${whereClause}`,
    params,
  );
  const total = countResult[0].total;

  let query = `
    SELECT cus_kode AS Kode, cus_nama AS Nama, cus_alamat AS Alamat 
    FROM retail.tcustomer 
    ${whereClause} 
    ORDER BY cus_nama ASC 
    LIMIT ? OFFSET ?
  `;
  params.push(limitNum, offset);

  const [rows] = await db.query(query, params);
  return { items: rows, total, page: Number(page), limit: limitNum };
};

// --- GET SO KAOSAN (Sesuai F1 di edtpesanan Delphi) ---
const searchSoKaosan = async (keyword, cabKaos, page = 1, limit = 50) => {
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;
  let params = [cabKaos]; // Filter dari frmMenu.CABKAOS

  let whereClause = `WHERE LEFT(h.so_nomor, 3) = ?`;

  if (keyword && keyword.trim() !== "") {
    whereClause += ` AND (h.so_nomor LIKE ? OR c.cus_nama LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const [countResult] = await db.query(
    `SELECT COUNT(*) AS total FROM retail.tso_hdr h LEFT JOIN retail.tcustomer c ON c.cus_kode = h.so_cus_kode ${whereClause}`,
    params,
  );
  const total = countResult[0].total;

  let query = `
    SELECT 
      h.so_nomor AS Nomor, 
      DATE_FORMAT(h.so_tanggal, "%d-%m-%Y") AS Tanggal, 
      h.so_cus_kode AS KdCus, 
      c.cus_nama AS Customer, 
      c.cus_alamat AS Alamat 
    FROM retail.tso_hdr h 
    LEFT JOIN retail.tcustomer c ON c.cus_kode = h.so_cus_kode 
    ${whereClause} 
    ORDER BY h.so_nomor DESC 
    LIMIT ? OFFSET ?
  `;
  params.push(limitNum, offset);

  const [rows] = await db.query(query, params);
  return { items: rows, total, page: Number(page), limit: limitNum };
};

// --- GET INVOICE DC (Untuk Divisi selain 3) ---
const searchInvDc = async (keyword, page = 1, limit = 50) => {
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;
  let params = [];

  // Sesuai SQL Delphi (F1 edtinvdc)
  let whereClause = `WHERE LEFT(h.inv_nomor, 3) = "KDC" AND h.inv_cus_kode = "K-00530"`;

  if (keyword && keyword.trim() !== "") {
    whereClause += ` AND (h.inv_nomor LIKE ? OR h.inv_ket LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  // Hitung total dengan DISTINCT/GROUP BY logic
  const [countResult] = await db.query(
    `SELECT COUNT(DISTINCT h.inv_nomor) AS total 
     FROM retail.tinv_hdr h 
     LEFT JOIN retail.tinv_dtl d ON d.invd_inv_nomor = h.inv_nomor 
     ${whereClause}`,
    params,
  );
  const total = countResult[0].total;

  let query = `
    SELECT 
      h.inv_nomor AS Nomor, 
      DATE_FORMAT(h.inv_tanggal, "%d-%m-%Y") AS Tanggal, 
      SUM(d.invd_jumlah) AS Qty, 
      h.inv_ket AS Keterangan
    FROM retail.tinv_hdr h
    LEFT JOIN retail.tinv_dtl d ON d.invd_inv_nomor = h.inv_nomor
    ${whereClause}
    GROUP BY h.inv_nomor
    ORDER BY h.inv_nomor DESC
    LIMIT ? OFFSET ?
  `;
  params.push(limitNum, offset);

  const [rows] = await db.query(query, params);
  return { items: rows, total, page: Number(page), limit: limitNum };
};

// --- GET SJ MEMO ---
const searchSjMemo = async (keyword, page = 1, limit = 50) => {
  const offset = (Number(page) - 1) * Number(limit);
  let params = [];
  let where = "WHERE 1=1";
  if (keyword) {
    where += " AND (sj_nomor LIKE ? OR c.cus_nama LIKE ?)";
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const query = `
    SELECT sj_nomor AS Nomor, DATE_FORMAT(sj_tanggal, "%d-%m-%Y") AS Tanggal, 
           sj_cus_kode AS KdCus, c.cus_nama AS Customer 
    FROM tsj_hdr_memo h LEFT JOIN tcustomer c ON h.sj_cus_kode = c.cus_kode 
    ${where} ORDER BY h.sj_tanggal DESC LIMIT ? OFFSET ?`;
  params.push(Number(limit), offset);
  const [rows] = await db.query(query, params);
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM tsj_hdr_memo h LEFT JOIN tcustomer c ON h.sj_cus_kode = c.cus_kode ${where}`,
    params.slice(0, -2),
  );
  return { items: rows, total };
};

// --- GET MEMO (MAP) ---
const searchMemo = async (keyword, page = 1, limit = 50) => {
  const offset = (Number(page) - 1) * Number(limit);
  let params = [];
  let where = "WHERE mspk_aktif='Y'";
  if (keyword) {
    where +=
      " AND (mspk_nomor LIKE ? OR c.cus_nama LIKE ? OR mspk_nama LIKE ?)";
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  const query = `
    SELECT mspk_nomor AS Nomor, v.divisi AS Divisi, c.cus_nama AS Customer, 
           mspk_nama AS Nama, mspk_ukuran AS Ukuran, mspk_kain AS Kain, mspk_finishing AS Finishing 
    FROM tmemospk m LEFT JOIN tcustomer c ON m.mspk_cus_kode = c.cus_kode LEFT JOIN tdivisi v ON v.kode = m.mspk_divisi 
    ${where} ORDER BY m.mspk_nomor DESC LIMIT ? OFFSET ?`;
  params.push(Number(limit), offset);
  const [rows] = await db.query(query, params);
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM tmemospk m LEFT JOIN tcustomer c ON m.mspk_cus_kode = c.cus_kode ${where}`,
    params.slice(0, -2),
  );
  return { items: rows, total };
};

const searchSpg = async (keyword, page = 1, limit = 50) => {
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;
  let params = [];

  let whereClause = "WHERE 1=1";
  if (keyword && keyword.trim() !== "") {
    whereClause += ` AND (i.spgi_spk LIKE ? OR i.spgi_nama LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const [countResult] = await db.query(
    `SELECT COUNT(DISTINCT i.spgi_spk) AS total
     FROM tspk_gudangitem i
     LEFT JOIN tspk_gudang j ON j.spg_nomor = i.spgi_nomor
     ${whereClause}`,
    params,
  );
  const total = countResult[0].total;

  const dataParams = [...params, limitNum, offset];
  const [rows] = await db.query(
    `SELECT DISTINCT i.spgi_spk AS Nomor,
            DATE_FORMAT(j.spg_tanggal, '%d-%m-%Y') AS Tanggal,
            i.spgi_nama AS Nama,
            i.spgi_kodek AS Kodek
     FROM tspk_gudangitem i
     LEFT JOIN tspk_gudang j ON j.spg_nomor = i.spgi_nomor
     ${whereClause}
     ORDER BY j.date_create DESC
     LIMIT ? OFFSET ?`,
    dataParams,
  );
  return { items: rows, total };
};

// --- GET MPPB ---
const searchMppb = async (keyword, page = 1, limit = 50) => {
  const offset = (Number(page) - 1) * Number(limit);
  let params = [];
  let where = `WHERE mpb_approve="Y" AND mpb_nomor NOT IN (SELECT spk_mppb FROM tspk WHERE spk_mppb<>"")`;
  if (keyword) {
    where += " AND (mpb_nomor LIKE ? OR mpb_nama LIKE ?)";
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const query = `
  SELECT mpb_nomor AS Nomor, DATE_FORMAT(mpb_tanggal, "%d-%m-%Y") AS Tanggal, 
         mpb_nama AS NamaProduk, mpb_jmlorder AS Jumlah, mpb_ket AS Keterangan 
  FROM tmpb ${where} ORDER BY mpb_nomor DESC LIMIT ? OFFSET ?`;
  params.push(Number(limit), offset);
  const [rows] = await db.query(query, params);
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM tmpb ${where}`,
    params.slice(0, -2),
  );
  return { items: rows, total };
};

// --- GET HISTORY ALOKASI BY CUSTOMER ---
const getHistoryAlokasi = async (cusKode, page = 1, limit = 20) => {
  if (!cusKode) return { items: [], total: 0 };
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;

  const [[{ total }]] = await db.query(
    `SELECT COUNT(DISTINCT a.alamat, a.kota) AS total
     FROM talokasi a
     INNER JOIN tspk s ON s.spk_nomor = a.spk_nomor
     INNER JOIN tcustomer c ON c.cus_kode = s.spk_cus_kode
     WHERE a.alamat <> '' AND c.cus_kode = ?`,
    [cusKode],
  );

  const [rows] = await db.query(
    `SELECT DISTINCT a.Alamat AS Alamat, a.kota AS Kota
     FROM talokasi a
     INNER JOIN tspk s ON s.spk_nomor = a.spk_nomor
     INNER JOIN tcustomer c ON c.cus_kode = s.spk_cus_kode
     WHERE a.alamat <> '' AND c.cus_kode = ?
     ORDER BY a.alamat
     LIMIT ? OFFSET ?`,
    [cusKode, limitNum, offset],
  );
  return { items: rows, total };
};

// --- GET BARANG KAOSAN (DC) ---
const searchBarangKaosan = async (keyword, page = 1, limit = 50) => {
  const offset = (Number(page) - 1) * Number(limit);
  let params = [];

  // Filter sesuai Delphi: aktif=0, logstok="Y", kelompok=""
  let where = 'WHERE a.brg_aktif=0 AND a.brg_logstok="Y" AND a.brg_kelompok=""';

  if (keyword) {
    where += ` AND (b.brgd_barcode LIKE ? OR a.brg_kode LIKE ? OR CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna) LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }

  const [countResult] = await db.query(
    `SELECT COUNT(*) AS total FROM retail.tbarangdc a INNER JOIN retail.tbarangdc_dtl b ON b.brgd_kode=a.brg_kode ${where}`,
    params,
  );

  // Menggunakan TRIM(CONCAT(...)) sesuai SI agar nama produk utuh
  const query = `
    SELECT b.brgd_barcode AS Barcode, a.brg_kode AS Kode,
           TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS Nama,
           b.brgd_ukuran AS Ukuran
    FROM retail.tbarangdc a
    INNER JOIN retail.tbarangdc_dtl b ON b.brgd_kode=a.brg_kode
    ${where}
    ORDER BY Nama, Barcode
    LIMIT ? OFFSET ?
  `;
  params.push(Number(limit), offset);

  const [rows] = await db.query(query, params);
  return { items: rows, total: countResult[0].total };
};

// --- GET SUPPLIER ---
const searchSupplier = async (keyword, jenis, page = 1, limit = 50) => {
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;
  let params = [];

  let whereClause = `WHERE sup_aktif = "Y"`;

  // ISI KOREKSI: Replikasi filter flag kualifikasi supplier sesuai F1 Delphi
  if (jenis === "ACCESORIES") whereClause += ` AND sup_accesories = "Y"`;
  else if (jenis === "OBAT") whereClause += ` AND sup_obat = "Y"`;
  else if (jenis === "SPAREPART") whereClause += ` AND sup_sparepart = "Y"`;
  else if (jenis === "ATK/RTK") whereClause += ` AND sup_atk = "Y"`;

  if (keyword && keyword.trim() !== "") {
    whereClause += ` AND (sup_kode LIKE ? OR sup_nama LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  if (keyword && keyword.trim() !== "") {
    whereClause += ` AND (sup_kode LIKE ? OR sup_nama LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const [countResult] = await db.query(
    `SELECT COUNT(*) AS total FROM tsupplier ${whereClause}`,
    params,
  );

  let query = `
    SELECT sup_kode AS Kode, sup_nama AS Nama, sup_alamat AS Alamat, sup_kota AS Kota 
    FROM tsupplier 
    ${whereClause} 
    ORDER BY sup_nama ASC 
    LIMIT ? OFFSET ?
  `;
  params.push(limitNum, offset);

  const [rows] = await db.query(query, params);
  return {
    items: rows,
    total: countResult[0].total,
    page: Number(page),
    limit: limitNum,
  };
};

// --- GET PO GREIGE ---
const searchPoGreige = async (keyword, page = 1, limit = 50) => {
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;
  let params = [];

  let whereClause = `WHERE po_jenis = 1`; // 1 = PO Greige

  if (keyword && keyword.trim() !== "") {
    whereClause += ` AND (po_nomor LIKE ? OR po_keterangan LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const [countResult] = await db.query(
    `SELECT COUNT(*) AS total FROM tpo_hdr ${whereClause}`,
    params,
  );

  let query = `
    SELECT po_nomor AS Nomor, DATE_FORMAT(po_tanggal, "%d-%m-%Y") AS Tanggal, po_keterangan AS Keterangan 
    FROM tpo_hdr 
    ${whereClause} 
    ORDER BY date_create DESC 
    LIMIT ? OFFSET ?
  `;
  params.push(limitNum, offset);

  const [rows] = await db.query(query, params);
  return {
    items: rows,
    total: countResult[0].total,
    page: Number(page),
    limit: limitNum,
  };
};

// --- GET MKB (MEMO KEBUTUHAN BAHAN) ---
const searchMkb = async (keyword, page = 1, limit = 50) => {
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;
  let params = [];

  let whereClause = `WHERE 1=1`;

  if (keyword && keyword.trim() !== "") {
    whereClause += ` AND (h.mkb_nomor LIKE ? OR h.mkb_spk_nomor LIKE ? OR s.spk_nama LIKE ? OR m.mspk_nama LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }

  const [countResult] = await db.query(
    `
    SELECT COUNT(*) AS total 
    FROM tmkb_hdr h
    LEFT JOIN tspk s ON s.spk_nomor = h.mkb_spk_nomor AND s.spk_aktif = "Y"
    LEFT JOIN tmemospk m ON m.mspk_nomor = h.mkb_spk_nomor
    ${whereClause}
  `,
    params,
  );

  let query = `
    SELECT 
      h.mkb_nomor AS Nomor, 
      DATE_FORMAT(h.mkb_tanggal, "%d-%m-%Y") AS Tanggal, 
      h.mkb_spk_nomor AS SPK_Nomor, 
      IFNULL(s.spk_nama, m.mspk_nama) AS Nama
    FROM tmkb_hdr h
    LEFT JOIN tspk s ON s.spk_nomor = h.mkb_spk_nomor AND s.spk_aktif = "Y"
    LEFT JOIN tmemospk m ON m.mspk_nomor = h.mkb_spk_nomor
    ${whereClause} 
    ORDER BY h.date_create DESC 
    LIMIT ? OFFSET ?
  `;
  params.push(limitNum, offset);

  const [rows] = await db.query(query, params);
  return {
    items: rows,
    total: countResult[0].total,
    page: Number(page),
    limit: limitNum,
  };
};

const getMkbDetail = async (nomor) => {
  // 1. Validasi Pertama (Cek tmkb_dtl2)
  const [cek1] = await db.query(
    `SELECT mkbd2_po_nomor FROM tmkb_dtl2 WHERE mkbd2_mkb_nomor = ? LIMIT 1`,
    [nomor],
  );

  // 2. Validasi Kedua (Cek tpo_dtl)
  const [cek2] = await db.query(
    `SELECT pod_po_nomor FROM tpo_dtl WHERE pod_mkb_nomor = ? LIMIT 1`,
    [nomor],
  );

  let warning = null;
  if (cek1.length > 0) {
    warning = `MKB tsb sudah di link di MKB dengan No.PO: ${cek1[0].mkbd2_po_nomor}\nYakin akan dilanjutkan?`;
  } else if (cek2.length > 0) {
    warning = `MKB tsb sudah tambah No.PO: ${cek2[0].pod_po_nomor}\nYakin akan dilanjutkan?`;
  }

  // 3. Kueri Utama Detail MKB (1:1 dengan Delphi)
  const query = `
    SELECT 
      d.mkbd_bhn_kode AS Kode,
      b.bhn_name AS Nama,
      b.bhn_name AS NamaExt,
      d.mkbd_bhn_satuan AS Satuan,
      IFNULL(j.bj_nama, "") AS Jenis,
      b.bhn_hargabeli AS Harga,
      IFNULL(g.bg_nama, "") AS Gramasi,
      IFNULL(s.bs_nama, "") AS Seting,
      SUM(d.mkbd_jumlah_po) AS Jumlah,
      h.mkb_spk_nomor AS Spk,
      IFNULL(spk.spk_nama, m.mspk_nama) AS NamaSpk,
      ? AS Mkb
    FROM tmkb_dtl d
    INNER JOIN tmkb_hdr h ON h.mkb_nomor = d.mkbd_mkb_nomor
    LEFT JOIN tbahan b ON b.bhn_kode = d.mkbd_bhn_kode
    LEFT JOIN tbahan_jenis j ON j.bj_kode = LEFT(d.mkbd_bhn_kode, 2)
    LEFT JOIN tbahan_gramasi g ON g.bg_kode = MID(d.mkbd_bhn_kode, 6, 2)
    LEFT JOIN tbahan_setting s ON s.bs_kode = RIGHT(d.mkbd_bhn_kode, 2)
    LEFT JOIN tspk spk ON spk.spk_nomor = h.mkb_spk_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = h.mkb_spk_nomor
    WHERE h.mkb_nomor = ?
    GROUP BY d.mkbd_bhn_kode
  `;

  // Parameter diisi dua kali karena ada "? AS Mkb" di select dan "? di WHERE"
  const [rows] = await db.query(query, [nomor, nomor]);

  // Tambahkan kalkulasi Total secara on-the-fly untuk mempermudah frontend
  const items = rows.map((r) => ({
    ...r,
    Diskon: 0,
    Total: Number(r.Jumlah || 0) * Number(r.Harga || 0),
  }));

  // Kembalikan items beserta warning (jika ada) agar bisa di-handle konfirmasinya oleh Frontend Vue
  return { items, warning };
};

// --- GET GUDANG BAHAN (gdg_bahan = 4) ---
const searchGudangBahan = async (keyword, page = 1, limit = 50, mode = "") => {
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;
  let params = [];

  // mode "all" = semua gudang (sesuai Delphi col 8 AdvColumnGrid1 PO Jasa)
  // default (tanpa mode) = filter gdg_bahan = 4
  let whereClause = mode === "all" ? "" : `WHERE gdg_bahan = 4`;

  if (keyword && keyword.trim() !== "") {
    whereClause += whereClause
      ? ` AND (gdg_kode LIKE ? OR gdg_nama LIKE ?)`
      : `WHERE (gdg_kode LIKE ? OR gdg_nama LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const [countResult] = await db.query(
    `SELECT COUNT(*) AS total FROM tgudang ${whereClause}`,
    params,
  );

  let query = `SELECT gdg_kode AS Kode, gdg_nama AS Nama 
               FROM tgudang ${whereClause} 
               ORDER BY gdg_nama LIMIT ? OFFSET ?`;
  params.push(limitNum, offset);

  const [rows] = await db.query(query, params);
  return {
    items: rows,
    total: countResult[0].total,
    page: Number(page),
    limit: limitNum,
  };
};

// --- GET PO BAHAN BUKA (PO_CLOSE NOT IN 1,9 AND BUKAN GREIGE) ---
const searchPoBahanBuka = async (keyword, page = 1, limit = 50) => {
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;
  let params = [];

  let whereClause = `WHERE po_close NOT IN (1, 9) AND po_jenis <> 1`;

  if (keyword && keyword.trim() !== "") {
    whereClause += ` AND (po_nomor LIKE ? OR po_keterangan LIKE ? OR s.sup_nama LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }

  const [countResult] = await db.query(
    `SELECT COUNT(*) AS total FROM tpo_hdr LEFT JOIN tsupplier s ON po_sup_kode = s.sup_kode ${whereClause}`,
    params,
  );

  let query = `
    SELECT 
      po_nomor AS Nomor, 
      DATE_FORMAT(po_tanggal, "%d-%m-%Y") AS Tanggal, 
      po_keterangan AS Keterangan, 
      IFNULL(s.sup_nama, "") AS Supplier
    FROM tpo_hdr 
    LEFT JOIN tsupplier s ON po_sup_kode = s.sup_kode
    ${whereClause} 
    ORDER BY tpo_hdr.date_create DESC 
    LIMIT ? OFFSET ?
  `;
  params.push(limitNum, offset);

  const [rows] = await db.query(query, params);
  return {
    items: rows,
    total: countResult[0].total,
    page: Number(page),
    limit: limitNum,
  };
};

const searchPermintaanBeliGarmen = async (keyword, jenis) => {
  let params = [jenis];
  let whereClause = `WHERE h.mb_status NOT IN ("CLOSE", "DICLOSE") AND h.mb_jenis = ? AND h.mb_nomor NOT IN (SELECT DISTINCT IFNULL(po_mb_nomor, '') FROM tgarmenpo_hdr)`;

  if (keyword && keyword.trim() !== "") {
    whereClause += ` AND (h.mb_nomor LIKE ? OR h.mb_ket LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const query = `
    SELECT h.mb_nomor AS Nomor, DATE_FORMAT(h.mb_tanggal, "%Y-%m-%d") AS Tanggal, 
           h.mb_jenis AS Jenis, h.mb_ket AS Keterangan, h.mb_cab AS Cab
    FROM tgarmenmintabeli_hdr h
    ${whereClause}
    ORDER BY h.mb_nomor DESC
  `;
  const [rows] = await db.query(query, params);
  return { items: rows };
};

// --- GET PO GARMEN (NON-BAHAN) BUKA ---
const searchPoGarmenBuka = async (keyword, jenis, page = 1, limit = 50) => {
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;
  let params = [jenis];

  // Logic Delphi: h.po_status<>"CLOSE" and h.po_status<>"DICLOSE" and po_jenis=...
  let whereClause = `WHERE po_status <> "CLOSE" AND po_status <> "DICLOSE" AND po_jenis = ?`;

  if (keyword && keyword.trim() !== "") {
    whereClause += ` AND (po_nomor LIKE ? OR po_ket LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const [countResult] = await db.query(
    `SELECT COUNT(*) AS total FROM tgarmenpo_hdr ${whereClause}`,
    params,
  );

  let query = `
    SELECT 
      po_nomor AS Nomor, 
      DATE_FORMAT(po_tanggal, "%d-%m-%Y") AS Tanggal, 
      po_mb_nomor AS NoMinta,
      po_ket AS Keterangan
    FROM tgarmenpo_hdr 
    ${whereClause} 
    ORDER BY po_nomor DESC 
    LIMIT ? OFFSET ?
  `;
  params.push(limitNum, offset);

  const [rows] = await db.query(query, params);
  return {
    items: rows,
    total: countResult[0].total,
    page: Number(page),
    limit: limitNum,
  };
};

const searchKaryawan = async (keyword, page = 1, limit = 20) => {
  const offset = (Number(page) - 1) * Number(limit);
  let where = `WHERE kar_status_aktif = 1`;
  const params = [];

  if (keyword) {
    where += ` AND (kar_Nik LIKE ? OR kar_nama LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM hrd2.tkaryawan ${where}`,
    params,
  );

  params.push(Number(limit), offset);
  const [rows] = await db.query(
    `SELECT kar_Nik AS Nik, kar_nama AS Nama 
     FROM hrd2.tkaryawan ${where} 
     ORDER BY kar_nama ASC 
     LIMIT ? OFFSET ?`,
    params,
  );

  return { items: rows, total, page: Number(page), limit: Number(limit) };
};

// --- GET ALL ACCOUNTS (T-REKENING) ---
const searchAccount = async (keyword, page = 1, limit = 50) => {
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;
  let params = [];

  // Mengikuti kondisi Delphi: rek_rekening <> ""
  let whereClause = `WHERE rek_rekening <> ""`;

  if (keyword && keyword.trim() !== "") {
    whereClause += ` AND (rek_kode LIKE ? OR rek_nama LIKE ? OR rek_rekening LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }

  const [countResult] = await db.query(
    `SELECT COUNT(*) AS total FROM finance.trekening ${whereClause}`,
    params,
  );

  let query = `
    SELECT 
      rek_nama AS Nama, 
      rek_kode AS Kode, 
      rek_rekening AS Rekening 
    FROM finance.trekening 
    ${whereClause} 
    ORDER BY rek_nama ASC 
    LIMIT ? OFFSET ?
  `;
  params.push(limitNum, offset);

  const [rows] = await db.query(query, params);
  return {
    items: rows,
    total: countResult[0].total,
    page: Number(page),
    limit: limitNum,
  };
};

// --- LOOKUP SETORAN PEMBAYARAN (GIRO/CASH/TRANSFER/POTONGAN) UNTUK SO ---
const getSetoranPembayaranLookup = async (
  cus_kode,
  tipe,
  q,
  page = 1,
  limit = 50,
) => {
  if (!cus_kode) throw new Error("Customer harus dipilih terlebih dahulu.");

  const offset = (page - 1) * limit;
  let queryParams = [cus_kode];
  let sqlCondition = "WHERE REPLACE(customer, ';', '') = ? ";

  if (tipe && tipe !== "ALL") {
    sqlCondition += " AND kode LIKE ? ";
    queryParams.push(`%${tipe}%`);
  } else {
    sqlCondition +=
      " AND (kode LIKE '%BG%' OR kode LIKE '%CS%' OR kode LIKE '%BT%' OR kode LIKE '%PT%') ";
  }

  if (q) {
    sqlCondition += " AND (nomor LIKE ? OR notes LIKE ?) ";
    queryParams.push(`%${q}%`, `%${q}%`);
  }

  const sqlCount = `SELECT COUNT(*) AS total FROM terima_bayar_debet ${sqlCondition}`;
  const [[{ total }]] = await db.query(sqlCount, queryParams);

  const sql = `
  SELECT 
    nomor                    AS Nomor, 
    kode                     AS KodeBayar,
    tanggal                  AS Tanggal, 
    debet                    AS Nominal, 
    notes                    AS Notes
  FROM terima_bayar_debet
  ${sqlCondition}
  ORDER BY tanggal DESC
  LIMIT ? OFFSET ?
`;

  const [rows] = await db.query(sql, [...queryParams, limit, offset]);
  return { rows, total };
};

const getInvoicePiutang = async (cabang, search = "") => {
  let whereExtra = "";
  let params = [cabang];

  if (search && search.trim() !== "") {
    whereExtra = ` AND (a.inv_nomor LIKE ? OR c.cus_nama LIKE ? OR a.inv_keterangan LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const query = `
    SELECT
      a.inv_nomor                                  AS Nomor,
      DATE_FORMAT(a.inv_tanggal, '%d-%m-%Y')       AS Tanggal,
      c.cus_nama                                    AS Customer,
      a.inv_keterangan                              AS Keterangan
    FROM tinv_hdr a
    INNER JOIN tcustomer c ON c.cus_kode = a.inv_cus_kode
    WHERE a.inv_perush_kode = ?
      AND a.inv_status_otomatis <> 1
      ${whereExtra}
    ORDER BY a.inv_tanggal DESC
    LIMIT 300
  `;

  const [rows] = await db.query(query, params);
  return rows;
};

const getKodeBayar = async () => {
  const [rows] = await db.query(
    `SELECT tt_kode AS kode, tt_nama AS nama FROM tkode_tt ORDER BY tt_kode`,
  );
  return rows;
};

const searchBuktiBayar = async (cabang, kode, search = "") => {
  if (!cabang || !kode) throw new Error("Cabang dan kode bayar wajib diisi.");

  let rows = [];

  if (kode === "RT") {
    // Retur Penjualan
    let whereClause = `WHERE a.retj_perush_kode = ?`;
    let params = [cabang];

    if (search && search.trim() !== "") {
      whereClause += ` AND (a.retj_nomor LIKE ? OR a.retj_keterangan LIKE ? OR b.cus_nama LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const query = `
      SELECT
        a.retj_nomor                            AS Nomor,
        DATE_FORMAT(a.retj_tanggal, '%d-%m-%Y') AS Tanggal,
        a.retj_keterangan                        AS Keterangan,
        b.cus_nama                               AS Customer,
        (
          SELECT SUM(retjd_harga * retjd_jumlah *
            IF(a.retj_sts_ppn = 1, ((100 + a.retj_ppn) / 100), 1))
          FROM tretj_dtl
          WHERE retjd_retj_nomor = a.retj_nomor
        )                                        AS Debet
      FROM tretj_hdr a
      INNER JOIN tcustomer b ON a.retj_cus_kode = b.cus_kode
      ${whereClause}
      ORDER BY a.retj_tanggal DESC
      LIMIT 200
    `;
    [rows] = await db.query(query, params);
  } else {
    // BG, BT, CS, PT
    let whereClause = `WHERE a.cabang = ? AND a.kode = ?`;
    let params = [cabang, kode];

    if (search && search.trim() !== "") {
      whereClause += ` AND (a.nomor LIKE ? OR a.notes LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    const query = `
      SELECT
        a.nomor                            AS Nomor,
        DATE_FORMAT(a.tanggal, '%d-%m-%Y') AS Tanggal,
        a.kode                             AS Kode,
        a.customer                         AS Customer,
        a.debet                            AS Debet,
        a.notes                            AS Keterangan
      FROM terima_bayar_debet a
      ${whereClause}
      ORDER BY a.tanggal DESC
      LIMIT 200
    `;
    [rows] = await db.query(query, params);
  }

  return rows;
};

const searchHistoryPakaiMaterial = async (
  noMaterial,
  kodeBahan,
  excludeNomor = "",
  keyword = "",
  page = 1,
  limit = 25,
) => {
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;

  let whereSearch = "";
  const params = [
    noMaterial,
    excludeNomor,
    kodeBahan,
    noMaterial,
    excludeNomor,
    kodeBahan,
  ];

  if (keyword) {
    whereSearch = `AND (x.Nomor LIKE ? OR x.Keterangan LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const baseQuery = `
    FROM (
      SELECT h.mph_nomor        AS Nomor,
             DATE_FORMAT(h.mph_tanggal, '%d-%m-%Y') AS Tgl,
             h.mph_qty_berat    AS Berat,
             h.user_create      AS UserCreate,
             h.user_modified    AS UserModified,
             h.mph_keterangan   AS Keterangan
      FROM tmutasiproduksi_hdr h
      WHERE h.mph_nomaterial = ? AND h.mph_nomor <> ? AND h.mph_bhn_kode = ?
      UNION ALL
      SELECT j.bpj_Nomor,
             DATE_FORMAT(j.bpj_Tanggal, '%d-%m-%Y'),
             j.bpj_qty_berat,
             j.user_create,
             j.user_modified,
             j.bpj_Keterangan
      FROM tbpj_hdr j
      WHERE j.bpj_nomaterial = ? AND j.bpj_nomaterial <> ? AND j.bpj_bhn_kode = ?
    ) x
  `;

  const [[countRow]] = await db.query(
    `SELECT COUNT(*) AS total ${baseQuery} ${whereSearch}`,
    params,
  );
  const total = countRow.total;

  const dataParams = [...params];
  if (keyword) dataParams.push(`%${keyword}%`, `%${keyword}%`);
  dataParams.push(limitNum, offset);

  const [rows] = await db.query(
    `SELECT * ${baseQuery} ${whereSearch} ORDER BY Tgl DESC LIMIT ? OFFSET ?`,
    dataParams,
  );

  return { items: rows, total };
};

// --- SEARCH PO JASA (Untuk modal pilih PO di form BPB Jasa) ---
const searchPoJasa = async (keyword, cab, page = 1, limit = 20) => {
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;
  let params = [];
  let whereClause = "WHERE 1=1";

  if (keyword && keyword.trim() !== "") {
    whereClause += ` AND (h.pojh_nomor LIKE ? OR h.pojh_keterangan LIKE ? OR s.sup_nama LIKE ?)`;
    const k = `%${keyword}%`;
    params.push(k, k, k);
  }
  if (cab && cab !== "ALL") {
    whereClause += ` AND h.pojh_cab = ?`;
    params.push(cab);
  }

  const [countResult] = await db.query(
    `SELECT COUNT(*) AS total
     FROM tpojasa_hdr h
     INNER JOIN tsupplier s ON s.sup_kode = h.pojh_sup_kode
     ${whereClause}`,
    params,
  );
  const total = countResult[0].total;

  const [rows] = await db.query(
    `SELECT
       h.pojh_nomor     AS Nomor,
       DATE_FORMAT(h.pojh_tanggal, '%Y-%m-%d') AS Tanggal,
       h.pojh_keterangan AS Keterangan,
       s.sup_nama        AS Supplier,
       h.pojh_cab        AS Cab
     FROM tpojasa_hdr h
     INNER JOIN tsupplier s ON s.sup_kode = h.pojh_sup_kode
     ${whereClause}
     ORDER BY h.date_create DESC
     LIMIT ? OFFSET ?`,
    [...params, limitNum, offset],
  );

  return { items: rows, total, page: Number(page), limit: limitNum };
};

// --- SEARCH REALISASI MINTA PER SPK (Untuk modal No.Material di form BPB Jasa) ---
// Berbeda dengan searchRealisasiMinta yang ada (search global header saja)
// Ini filter per spkNomor + return detail bahan sekaligus
const searchRealisasiMintaBySpk = async (
  spkNomor,
  keyword,
  page = 1,
  limit = 20,
) => {
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;
  let params = [spkNomor];
  let whereSearch = "";

  if (keyword && keyword.trim() !== "") {
    whereSearch = ` AND (b.bhn_name LIKE ? OR g.gdgp_cab LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const [countResult] = await db.query(
    `SELECT COUNT(*) AS total
     FROM tproduksiminta_hdr h
     INNER JOIN tproduksiminta_dtl e ON e.promind_promin_nomor = h.promin_nomor
     LEFT JOIN tbahan b ON b.bhn_kode = e.promind_bhn_kode
     LEFT JOIN tsupplier s ON s.sup_kode = e.promind_sup_kode
     LEFT JOIN tgudangproduksi g ON g.gdgp_kode = h.promin_gdgp_kode
     WHERE h.promin_spk_nomor = ? ${whereSearch}`,
    params,
  );
  const total = countResult[0].total;

  const [rows] = await db.query(
    `SELECT
       h.promin_nomor    AS Nomor,
       DATE_FORMAT(h.promin_tanggal, '%d-%m-%Y') AS Tanggal,
       e.promind_bhn_kode AS kode,
       b.bhn_name        AS JenisKain,
       b.bhn_satuan      AS Satuan,
       e.promind_jumlah - IFNULL((
         SELECT SUM(r.proretd_jumlah)
         FROM tproduksiretur_dtl r
         WHERE r.proretd_nominta = h.promin_nomor
           AND r.proretd_bhn_kode = e.promind_bhn_kode
       ), 0) AS Jumlah,
       e.promind_sup_kode AS Kodesup,
       s.sup_nama         AS NamaSupplier,
       g.gdgp_cab         AS Cab
     FROM tproduksiminta_hdr h
     INNER JOIN tproduksiminta_dtl e ON e.promind_promin_nomor = h.promin_nomor
     LEFT JOIN tbahan b ON b.bhn_kode = e.promind_bhn_kode
     LEFT JOIN tsupplier s ON s.sup_kode = e.promind_sup_kode
     LEFT JOIN tgudangproduksi g ON g.gdgp_kode = h.promin_gdgp_kode
     WHERE h.promin_spk_nomor = ? ${whereSearch}
     ORDER BY h.promin_nomor DESC
     LIMIT ? OFFSET ?`,
    [...params, limitNum, offset],
  );

  return { items: rows, total, page: Number(page), limit: limitNum };
};

// --- GET GUDANG BARANG JADI (untuk STBJ) ---
const getGudangJadi = async (q = "", divisi = 0) => {
  let where = "gdg_jadi <> 0";
  if (divisi === 1) where = "gdg_jadi = 1";
  if (divisi === 4) where = "gdg_jadi = 4";

  const params = [];
  if (q) {
    where += ` AND (gdg_kode LIKE ? OR gdg_nama LIKE ?)`;
    params.push(`%${q}%`, `%${q}%`);
  }

  const [rows] = await db.query(
    `SELECT gdg_kode AS Kode, gdg_nama AS Nama
     FROM tgudang WHERE ${where} ORDER BY gdg_nama`,
    params,
  );
  return rows;
};

// --- GET GUDANG PRODUKSI KOLI (untuk STBJ, filter KOLI) ---
const getGudangProduksiKoli = async (q = "", cab = "", divisi = 0) => {
  let where = `gdgp_aktif = 0 AND gdgp_nama LIKE '%KOLI%'`;
  if (divisi === 1) where += ` AND gdgp_kode = 'GP-001'`;
  else if (cab === "P01") where += ` AND gdgp_cab = 'P01'`;
  else if (cab === "P04") where += ` AND gdgp_cab = 'P04'`;

  const params = [];
  if (q) {
    where += ` AND (gdgp_kode LIKE ? OR gdgp_nama LIKE ?)`;
    params.push(`%${q}%`, `%${q}%`);
  }

  const [rows] = await db.query(
    `SELECT gdgp_kode AS Kode, gdgp_nama AS Nama
     FROM tgudangproduksi WHERE ${where} ORDER BY gdgp_nama`,
    params,
  );
  return rows;
};

// --- GET PACKING TERSEDIA (belum ada STBJ, untuk lookup di form) ---
const getPackingTersedia = async (q = "", page = 1, limit = 50) => {
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;
  const params = [];

  let where = `WHERE p.pack_nostbj IS NULL`;
  if (q) {
    where += ` AND (p.pack_nomor LIKE ? OR p.pack_spk_nomor LIKE ?)`;
    params.push(`%${q}%`, `%${q}%`);
  }

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM retail.tpacking p ${where}`,
    params,
  );

  const [rows] = await db.query(
    `SELECT p.pack_nomor AS Nomor,
            DATE_FORMAT(p.pack_tanggal, '%d-%m-%Y') AS TglPacking,
            p.pack_spk_nomor AS SPK
     FROM retail.tpacking p
     ${where}
     ORDER BY p.pack_nomor
     LIMIT ? OFFSET ?`,
    [...params, limitNum, offset],
  );

  return { items: rows, total, page: Number(page), limit: limitNum };
};

const searchInvProforma = async (
  cusKode = "",
  keyword = "",
  page = 1,
  limit = 50,
) => {
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;
  let params = [];

  let where = `WHERE inv_sts_pro = 1`;
  if (cusKode) {
    where += ` AND inv_cus_kode = ?`;
    params.push(cusKode);
  }
  if (keyword) {
    where += ` AND (inv_nomor LIKE ? OR c.cus_nama LIKE ? OR inv_keterangan LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total
     FROM tinv_hdr
     INNER JOIN tcustomer c ON c.cus_kode = inv_cus_kode
     ${where}`,
    params,
  );

  const [rows] = await db.query(
    `SELECT inv_nomor AS Nomor,
            c.cus_nama AS Customer,
            DATE_FORMAT(inv_tanggal, '%d-%m-%Y') AS Tanggal,
            inv_keterangan AS Keterangan
     FROM tinv_hdr
     INNER JOIN tcustomer c ON c.cus_kode = inv_cus_kode
     ${where}
     ORDER BY inv_tanggal DESC
     LIMIT ? OFFSET ?`,
    [...params, limitNum, offset],
  );
  return { items: rows, total, page: Number(page), limit: limitNum };
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
  getRekeningPerusahaan,
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
  getMkbDetail,
  searchGudangBahan,
  searchPoBahanBuka,
  searchPermintaanBeliGarmen,
  searchPoGarmenBuka,
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
};
