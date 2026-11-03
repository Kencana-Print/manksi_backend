const pool = require("../../../../config/database");
const db = pool; // Alias agar kompatibel dengan query yang menggunakan variabel 'db'
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const komitmenKirimService = require("../spk-order/komitmenKirimService");

// ==========================================
// 1. HELPER & UTILITY FUNCTIONS
// ==========================================

// --- GENERATE NOMOR ---
const generateNomor = async (perushKode, joKode) => {
  const query = `
    SELECT IFNULL(MAX(CAST(SUBSTR(mspk_nomor, 11, 6) AS UNSIGNED)), 0) AS max_val 
    FROM tmemospk 
    WHERE mspk_perush_kode = ? AND mspk_jo_kode = ?
  `;
  const [[row]] = await db.query(query, [perushKode, joKode]);

  // Base 1,000,000 (7 digit) agar slice(-6) mengambil 6 digit counter murni
  const nextNum = 1000000 + parseInt(row.max_val, 10) + 1;
  const numStr = String(nextNum).slice(-6);

  return `MAP-${perushKode}-${joKode}-${numStr}`;
};

// --- GET INIT GRIDS (SIZE & KOMPONEN) ---
const getInitGrids = async () => {
  const [sizes] = await db.query(
    `SELECT kode, ukuran FROM retail.tukuran 
     WHERE kategori = "" 
     ORDER BY CAST(kode AS UNSIGNED)`,
  );
  const formattedSizes = sizes.map((s) => ({
    no: String(100 + parseInt(s.kode)).slice(-2),
    size: s.ukuran,
    qty: 0,
    lb: 0,
    pb: 0,
  }));

  const [komponen] = await db.query(
    `SELECT kode, nama FROM tketkomponen ORDER BY kode`,
  );
  const formattedKomponen = komponen.map((k) => ({
    kode: String(k.kode),
    nama: k.nama,
    pakai: false,
    ket: "",
  }));

  return { sizes: formattedSizes, komponen: formattedKomponen };
};

// --- GET SPK INFORMASI (DROPDOWNS) ---
const getSpkInformasi = async (divisi) => {
  const query = `SELECT i_keterangan, i_nilai FROM tspk_informasi WHERE i_divisi = ? ORDER BY i_urut`;
  const [rows] = await db.query(query, [divisi]);

  const result = {
    PANJANG: [],
    LEBAR: [],
    BAHAN: [],
    GRAMASI: [],
    FINISHING: [],
  };
  rows.forEach((r) => {
    const key = r.i_keterangan.toUpperCase().replace("SPK_", "");
    if (result[key] !== undefined) result[key].push(r.i_nilai);
  });
  return result;
};

// --- LOAD MINTA HARGA ---
const loadMintaHarga = async (nomor) => {
  const query = `
    SELECT h.*, v.divisi, s.sal_nama, c.cus_nama, c.cus_perfect 
    FROM tmintaharga h
    LEFT JOIN tdivisi v ON v.kode = h.mh_divisi
    LEFT JOIN tsales s ON s.sal_kode = h.mh_sal_kode
    LEFT JOIN tcustomer c ON c.cus_kode = h.mh_cus_kode
    WHERE h.mh_nomor = ? AND h.mh_status <> "BELUM"
  `;
  const [rows] = await db.query(query, [nomor]);
  if (rows.length === 0) {
    throw new Error(
      "Nomor Permintaan Harga tersebut tidak ada atau berstatus BELUM.",
    );
  }
  return rows[0];
};

// --- AUTOCOMPLETE NAMA PEKERJAAN ---
const getNamaSuggestions = async (keyword, divisi, cusKode) => {
  const query = `
    SELECT mspk_nama AS nama, COUNT(*) AS frekuensi
    FROM tmemospk
    WHERE mspk_nama LIKE ?
      AND mspk_divisi = ?
      AND mspk_cus_kode = ?
      AND mspk_aktif = 'Y'
    GROUP BY mspk_nama
    ORDER BY frekuensi DESC, mspk_nama ASC
    LIMIT 10
  `;
  const [rows] = await db.query(query, [`%${keyword}%`, divisi, cusKode]);
  return rows.map((r) => ({ nama: r.nama, frekuensi: Number(r.frekuensi) }));
};

// --- CEK DUPLIKAT NAMA PEKERJAAN ---
const checkDuplikatNama = async (nama, divisi, cusKode, excludeNomor = "") => {
  let query = `
    SELECT mspk_nomor, mspk_tanggal, mspk_jo_kode,
           DATE_FORMAT(mspk_tanggal, '%d/%m/%Y') AS tgl_formatted
    FROM tmemospk
    WHERE mspk_nama = ?
      AND mspk_divisi = ?
      AND mspk_cus_kode = ?
      AND mspk_aktif = 'Y'
      AND mspk_revisi = 'N'
  `;
  const params = [nama, divisi, cusKode];

  if (excludeNomor) {
    query += ` AND mspk_nomor <> ?`;
    params.push(excludeNomor);
  }

  query += ` ORDER BY mspk_tanggal DESC LIMIT 5`;

  const [rows] = await db.query(query, params);
  return rows;
};

// --- GET KATALOG HISTORI PESANAN CUSTOMER (LAZY LOADING) ---
const getKatalogCustomer = async (
  cusKode,
  divisi = "",
  keyword = "",
  page = 1,
  limit = 20,
) => {
  const offset = (page - 1) * limit;

  let countQuery = `SELECT COUNT(*) AS total FROM tmemospk WHERE mspk_cus_kode = ? AND mspk_aktif = 'Y' AND mspk_revisi = 'N'`;
  const countParams = [cusKode];

  if (divisi && divisi !== "SEMUA") {
    countQuery += ` AND mspk_divisi = ?`;
    countParams.push(divisi);
  }
  if (keyword) {
    countQuery += ` AND mspk_nama LIKE ?`;
    countParams.push(`%${keyword}%`);
  }
  const [countRows] = await db.query(countQuery, countParams);
  const totalData = countRows[0].total;

  let query = `
    SELECT 
      mspk_nomor, mspk_nama, DATE_FORMAT(mspk_tanggal, '%d/%m/%Y') AS tanggal_pesanan,
      mspk_tanggal, mspk_jumlah, mspk_harga, mspk_kain, mspk_gramasi, 
      mspk_keterangan, mspk_cab, mspk_divisi, mspk_statuskerja
    FROM tmemospk
    WHERE mspk_cus_kode = ? AND mspk_aktif = 'Y' AND mspk_revisi = 'N'
  `;
  const params = [cusKode];

  if (divisi && divisi !== "SEMUA") {
    query += ` AND mspk_divisi = ?`;
    params.push(divisi);
  }
  if (keyword) {
    query += ` AND mspk_nama LIKE ?`;
    params.push(`%${keyword}%`);
  }

  query += ` ORDER BY mspk_tanggal DESC LIMIT ? OFFSET ?`;
  params.push(Number(limit), Number(offset));

  const [rows] = await db.query(query, params);

  return { items: rows, total: totalData };
};

// --- SYNC APPROVAL NOPO ---
const syncNoPoApproval = async (conn, nomor, data, userKode) => {
  if (String(data.Divisi).charAt(0) === "3") {
    await conn.query(
      `DELETE FROM tspk_pin5 WHERE pin_trs = "MAP" AND pin_jenis = "NOPO" AND pin_nomor = ? AND pin_dipakai = ""`,
      [nomor],
    );
    return false;
  }

  const isKosong = !data.NomorPO || String(data.NomorPO).trim() === "";
  if (isKosong) {
    const [existingPin] = await conn.query(
      `SELECT pin_urut, pin_acc, pin_dipakai FROM tspk_pin5
       WHERE pin_trs = "MAP" AND pin_jenis = "NOPO" AND pin_nomor = ?
       ORDER BY pin_urut DESC LIMIT 1`,
      [nomor],
    );

    if (
      existingPin.length > 0 &&
      existingPin[0].pin_acc === "Y" &&
      existingPin[0].pin_dipakai === ""
    ) {
      return false;
    }

    let urut = 1;
    if (existingPin.length > 0) {
      urut = existingPin[0].pin_dipakai
        ? existingPin[0].pin_urut + 1
        : existingPin[0].pin_urut;
    }
    await conn.query(
      `INSERT INTO tspk_pin5
         (pin_trs, pin_jenis, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta)
       VALUES ("MAP", "NOPO", ?, ?, ?, ?, NOW(), ?)
       ON DUPLICATE KEY UPDATE
         pin_tgl_trs = ?, pin_ket = ?, pin_acc = "", pin_tgl_minta = NOW(), pin_user_minta = ?`,
      [
        nomor,
        urut,
        data.Tanggal,
        "MAP dibuat/diubah tanpa Nomor PO",
        userKode,
        data.Tanggal,
        "MAP dibuat/diubah tanpa Nomor PO",
        userKode,
      ],
    );
    return true;
  }
  await conn.query(
    `DELETE FROM tspk_pin5
     WHERE pin_trs = "MAP" AND pin_jenis = "NOPO" AND pin_nomor = ? AND pin_dipakai = ""`,
    [nomor],
  );
  return false;
};

// --- GET STATUS APPROVAL NOPO ---
const getNoPoStatus = async (nomor) => {
  const [rows] = await db.query(
    `SELECT pin_acc FROM tspk_pin5
     WHERE pin_trs = "MAP" AND pin_jenis = "NOPO" AND pin_nomor = ?
     ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );
  if (rows.length === 0) return "";
  const acc = rows[0].pin_acc;
  if (acc === "Y") return "ACC";
  if (acc === "N") return "TOLAK";
  return "MINTA";
};

// ==========================================
// 2. BROWSE & LIST DATA
// ==========================================

// --- GET BROWSE LIST ---
const getBrowseList = async (
  filters,
  canLihatCus = false,
  canLihatHarga = false,
) => {
  const { startDate, endDate, cabang, isKaosan } = filters;

  if (!startDate || !endDate) {
    throw new Error(
      "Tanggal awal (startDate) dan tanggal akhir (endDate) harus diisi.",
    );
  }

  let params = [`${startDate} 00:00:00`, `${endDate} 23:59:59`];
  let whereClause = `WHERE x.mspk_tanggal >= ? AND x.mspk_tanggal <= ?`;

  const normCab = String(cabang || "")
    .trim()
    .toUpperCase();

  // User cabang P05 hanya boleh melihat data MAP cabang P05
  // atau data yang ditandai sublim (mspk_sublim = 'Y').
  if (normCab === "P05") {
    whereClause += ` AND (UPPER(TRIM(x.mspk_cab)) = 'P05' OR UPPER(TRIM(x.mspk_sublim)) = 'Y')`;
  }

  if (normCab === "P02") {
    whereClause += ` AND x.mspk_divisi IN (1,5)`;
  }
  if (isKaosan && isKaosan !== "KDC") {
    whereClause += ` AND x.mspk_divisi = 3`;
  } else if (normCab === "P03" && isKaosan === "KDC") {
    whereClause += ` AND x.mspk_divisi IN (3,6)`;
  }

  const custCol = canLihatCus ? "c.cus_nama AS Customer," : `"" AS Customer,`;
  const hargaCol = canLihatHarga
    ? "x.mspk_harga AS Harga, x.mspk_hargariil AS HargaRiil,"
    : `NULL AS Harga, NULL AS HargaRiil,`;

  const query = `
    SELECT 
      x.mspk_nomor AS Nomor, x.user_create AS MO, x.mspk_cmo AS CMO, 
      DATE_FORMAT(x.mspk_tanggal, '%Y-%m-%d') AS Tanggal,
      DATE_FORMAT(x.mspk_dateline, '%Y-%m-%d') AS Dateline,
      IFNULL(DATE_FORMAT(IFNULL(k.date_modify, k.date_create), '%Y-%m-%d'), "") AS TglBast, 
      IFNULL(DATEDIFF(IFNULL(k.date_modify, k.date_create), x.mspk_tanggal), 0) AS SelisihBastMap,
      IF(k.date_create IS NULL, "BELUM", "SUDAH") AS Berita_Acara,
      d.divisi AS Divisi, x.mspk_cab AS Cab, x.mspk_workshop AS Workshop, 
      CONCAT(x.mspk_cab2, " ", x.mspk_workshop2) AS WorkshopSPK, 
      x.mspk_aktif AS Aktif, x.mspk_nama AS Nama,
      (SELECT sjd_sj_nomor FROM tsj_dtl_memo INNER JOIN tsj_hdr_memo ON sj_nomor=sjd_sj_nomor WHERE sjd_mspk_nomor=x.mspk_nomor ORDER BY sj_tanggal DESC LIMIT 1) AS Surat_Jalan,
      x.mspk_ukuran AS Ukuran, x.mspk_panjang AS Panjang, x.mspk_lebar AS Lebar, 
      x.mspk_gramasi AS Gramasi, x.mspk_kain AS Kain, x.mspk_finishing AS Finishing,
      x.mspk_jumlah AS Jumlah, x.mspk_jumlah_kirim AS Kirim, ${custCol}
      x.mspk_rencana_order AS Rencana, x.mspk_tipe AS Tipe, ${hargaCol}
      s.sal_nama AS Salesman, x.date_create AS Created, 
      x.mspk_revisi_no AS Revisi, x.mspk_referensi AS NoReferensi,
      IF(x.mspk_estimasijadi="1899-12-30", "", DATE_FORMAT(x.mspk_estimasijadi, '%Y-%m-%d')) AS EstimasiJadi, 
      x.mspk_close AS CloseStatus,
      IFNULL(
        (SELECT so_nomor FROM tsalesorder WHERE so_memo = x.mspk_nomor ORDER BY so_tanggal DESC LIMIT 1),
        (SELECT spk_nomor FROM tspk WHERE spk_memo = x.mspk_nomor ORDER BY spk_tanggal DESC LIMIT 1)
      ) AS SPK, 
      DATE_FORMAT(IF(x.mspk_divisi=5, m.lpr_tanggal, z.lds_tgl), '%Y-%m-%d') AS Design_Tanggal,
      z.lds_user AS Design_User, z.lds_note AS Design_Note, 
      IFNULL((
        SELECT IFNULL(IF(pin_acc="" AND pin_dipakai="","WAIT",IF(pin_acc="Y" AND pin_dipakai="","ACC",IF(pin_acc="Y" AND pin_dipakai="Y","",IF(pin_acc="N","TOLAK","")))), "")
        FROM tspk_pin5 WHERE pin_trs="MAP" AND pin_nomor=x.mspk_nomor ORDER BY pin_urut DESC LIMIT 1
      ),"") AS Ngedit,
      x.mspk_newdesign AS Design_Baru, x.mspk_designdone AS Design_Done, x.mspk_keterangan AS Keterangan,
      x.mspk_acc_customer AS AccCustomer, DATE_FORMAT(x.mspk_acc_tanggal, '%Y-%m-%d') AS AccTanggal
    FROM tmemospk x
    LEFT JOIN tcustomer c ON x.mspk_cus_kode = c.cus_kode
    LEFT JOIN tsales s ON x.mspk_sal_kode = s.sal_kode
    LEFT JOIN tkesesuaianmap k ON k.mspk_nomor = x.mspk_nomor AND k.kode_sesuai = 1
    
    LEFT JOIN (
      SELECT lds_spk, lds_user, lds_tgl, lds_note,
             ROW_NUMBER() OVER (PARTITION BY lds_spk ORDER BY lds_tgl DESC) AS rn
      FROM tlhkdesign_status 
      WHERE UPPER(lds_status) = 'DONE'
    ) z ON z.lds_spk = x.mspk_nomor AND z.rn = 1

    LEFT JOIN tdivisi d ON d.kode = x.mspk_divisi
    LEFT JOIN (
      SELECT lprd_spk_nomor, MIN(lpr_tanggal) AS lpr_tanggal 
      FROM tlhk_proofmmt_dtl 
      INNER JOIN tlhk_proofmmt_hdr ON (lpr_nomor=lprd_lpr_nomor) 
      GROUP BY lprd_spk_nomor
    ) m ON m.lprd_spk_nomor = x.mspk_nomor 
    ${whereClause}
    ORDER BY x.date_create DESC
  `;

  const [rows] = await pool.query(query, params);
  return rows;
};

// --- GET BY ID (LOAD DATA MAP DETAIL) ---
const getById = async (nomor) => {
  const query = `
    SELECT m.*, c.cus_nama, c.cus_perfect, j.jo_nama, s.sal_nama, p.Perush_nama
    FROM tmemospk m
    LEFT JOIN tcustomer c ON m.mspk_cus_kode = c.cus_kode
    LEFT JOIN tjenisorder j ON m.mspk_jo_kode = j.jo_kode
    LEFT JOIN tsales s ON m.mspk_sal_kode = s.sal_kode
    LEFT JOIN tperusahaan p ON m.mspk_perush_kode = p.perush_kode
    WHERE m.mspk_nomor = ?
  `;
  const [rows] = await db.query(query, [nomor]);
  if (rows.length === 0) return null;
  const data = rows[0];

  // Load Sizes
  const [spkSizes] = await db.query(
    `SELECT * FROM tmemospk_size WHERE mspks_nomor = ?`,
    [nomor],
  );
  const grids = await getInitGrids();
  data.Sizes = grids.sizes.map((sz) => {
    const found = spkSizes.find((s) => s.mspks_size === sz.size);
    if (found) {
      return {
        ...sz,
        qty: Number(found.mspks_qty),
        lb: Number(found.mspks_a),
        pb: Number(found.mspks_b),
      };
    }
    return sz;
  });

  // Load Komponen
  const [spkKomp] = await db.query(
    `SELECT * FROM tmemospk_ketkomponen WHERE mkk_spk = ?`,
    [nomor],
  );
  data.Komponen = grids.komponen.map((k) => {
    const found = spkKomp.find((s) => s.mkk_kode === k.kode);
    if (found) {
      return { ...k, pakai: true, ket: found.mkk_ket };
    }
    return k;
  });

  // Status Approval (PIN 5)
  const [pinRows] = await db.query(
    `SELECT pin_urut, pin_acc, pin_dipakai FROM tspk_pin5 WHERE pin_trs = "MAP" AND pin_nomor = ? ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );
  data.StatusEdit = "";
  data.UrutPin = 0;
  if (pinRows.length > 0) {
    const pin = pinRows[0];
    data.UrutPin = pin.pin_urut;
    if (pin.pin_acc === "" && pin.pin_dipakai === "") data.StatusEdit = "WAIT";
    else if (pin.pin_acc === "Y" && pin.pin_dipakai === "")
      data.StatusEdit = "ACC";
    else if (pin.pin_acc === "N") data.StatusEdit = "TOLAK";
  }

  // Set default Tutup Buku ke false
  data.isTutupBuku = false;

  data.nopo_acc = await getNoPoStatus(nomor);

  return data;
};

// ==========================================
// 3. TRANSACTION / MUTATION LOGIC
// ==========================================

// --- SAVE MAP ---
const save = async (data, userKode, isNewMode) => {
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const tglMap = new Date(data.Tanggal);
    const now = new Date();

    // 1. Validasi Tanggal Mundur
    if (isNewMode && tglMap.setHours(0, 0, 0, 0) < now.setHours(0, 0, 0, 0)) {
      throw new Error("Tanggal MAP tidak boleh mundur.");
    }

    // 2. Validasi Hari Libur & Jam 5 Sore (Hanya saat Input Baru)
    if (isNewMode) {
      const day = tglMap.getDay();
      if (day === 0 || day === 6) {
        throw new Error(
          "Hari sabtu dan minggu HO libur bosku. Masukkan inputan ke hari senin saja.",
        );
      }

      const tglMapDay = new Date(data.Tanggal);
      tglMapDay.setHours(0, 0, 0, 0);
      const nowDay = new Date();
      if (nowDay.getHours() >= 17 && tglMapDay <= nowDay) {
        throw new Error(
          "Sudah lewat jam 5 sore bosku. Masukkan inputan ke hari berikutnya.",
        );
      }
    }

    // 3. Validasi Deadline
    if (
      new Date(data.DateLine).setHours(0, 0, 0, 0) < tglMap.setHours(0, 0, 0, 0)
    ) {
      throw new Error("Tanggal deadline harus >= tanggal memo.");
    }

    // Sanitasi Data Numerik Kosong
    const safeNum = (val) => {
      const parsed = parseFloat(String(val).replace(/,/g, ""));
      return isNaN(parsed) ? 0 : parsed;
    };

    const hargaJual = safeNum(data.HargaJual);
    const hargaRiil = safeNum(data.HargaRiil);
    const rencanaOrder = safeNum(data.RencanaOrder);
    const jumlah = safeNum(data.Jumlah);
    const panjang = safeNum(data.Panjang);
    const lebar = safeNum(data.Lebar);

    // 4. Validasi Panjang Lebar (Divisi 1 & 5)
    if (data.Divisi === "1" || data.Divisi === "5") {
      if (panjang === 0) throw new Error("Ukuran panjang harus di isi.");
      if (lebar === 0) throw new Error("Ukuran lebar harus di isi.");
    }

    // 5. Validasi Revisi
    if (data.IsRevisi === "Y") {
      if (!data.RevisiNo) throw new Error("Revisi ke harus di isi.");
      if (!data.Referensi) throw new Error("Nomor Referensi harus di isi.");
    }

    // 6. Validasi Qty Rencana Order vs Detail Size
    let totalSizeQty = data.Sizes
      ? data.Sizes.reduce((sum, item) => sum + safeNum(item.qty), 0)
      : 0;

    if (totalSizeQty !== 0 && totalSizeQty !== rencanaOrder) {
      throw new Error(
        "Rencana Order vs Total Detail Qty Rencana Order harus sama.",
      );
    }

    // 7. Validasi Keterangan Komponen
    if (data.Komponen) {
      for (const k of data.Komponen) {
        if (k.pakai && !k.ket)
          throw new Error(
            `Jika komponen [${k.nama}] dicentang, keterangan harus di isi.`,
          );
      }
    }

    if (!data.PerushKode || !String(data.PerushKode).trim()) {
      throw new Error("Perusahaan harus diisi.");
    }

    const isDivisi3 = String(data.Divisi).charAt(0) === "3";

    if (isNewMode) {
      if (!isDivisi3) {
        if (data.AccCustomer !== "Y") {
          throw new Error(
            "Customer belum menyetujui pesanan ini. MAP tidak bisa disimpan.",
          );
        }
        if (!data.AccTanggal) {
          throw new Error("Tanggal persetujuan customer wajib diisi.");
        }
      }
    } else {
      const [existingRows] = await conn.query(
        `SELECT mspk_acc_customer FROM tmemospk WHERE mspk_nomor = ?`,
        [data.Nomor],
      );
      const wasAlreadyApproved = existingRows[0]?.mspk_acc_customer === "Y";

      if (!isDivisi3 && !wasAlreadyApproved) {
        if (data.AccCustomer === "Y" && !data.AccTanggal) {
          throw new Error("Tanggal persetujuan customer wajib diisi.");
        }
      }
    }

    let nomorMap = data.Nomor;

    // --- INSERT / UPDATE HEADER ---
    if (isNewMode) {
      if (!nomorMap || nomorMap === "Baru= Nomor Otomatis") {
        nomorMap = await generateNomor(data.PerushKode, data.JoKode);
      }

      const noPoPendingCreate = await syncNoPoApproval(
        conn,
        nomorMap,
        data,
        userKode,
      );
      const mspkAktif = noPoPendingCreate ? "N" : "Y";

      const insertQ = `
        INSERT INTO tmemospk (
          mspk_nomor, mspk_nama, mspk_nama2, mspk_divisi, mspk_cus_kode, mspk_sal_kode,
          mspk_statuskerja, mspk_ukuran, mspk_gramasi, mspk_panjang, mspk_lebar, mspk_kain,
          mspk_finishing, mspk_sablon, mspk_bordir, mspk_sublim, mspk_jumlah, mspk_harga,
          mspk_hargariil, mspk_keterangan, mspk_cab, mspk_cab2, mspk_workshop, mspk_workshop2,
          mspk_jo_kode, mspk_tanggal, mspk_dateline, mspk_pen_nomor, mspk_pen_id, mspk_mh_nomor,
          mspk_nomor_po, mspk_tgl_po, mspk_perush_kode, mspk_rencana_order, date_create, user_create,
          mspk_revisi, mspk_tipe_revisi, mspk_revisi_no, mspk_referensi, mspk_revisi_note,
          mspk_estimasijadi, mspk_tipe, mspk_cmo, mspk_newdesign, mspk_rencana_size,
          mspk_acc_customer, mspk_acc_tanggal, mspk_aktif
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `;
      const insertParams = [
        nomorMap,
        data.Nama,
        data.Nama2 || data.Nama,
        data.Divisi,
        data.CustKode,
        data.SalesKode,
        data.StatusKerja,
        data.KetUkuran || "",
        data.Gramasi,
        panjang,
        lebar,
        data.Kain,
        data.Finishing,
        data.Sablon,
        data.Bordir,
        data.Sublim,
        jumlah,
        hargaJual,
        hargaRiil,
        data.Keterangan,
        data.Cab,
        data.Cab2,
        data.Workshop,
        data.Workshop2,
        data.JoKode,
        data.Tanggal,
        data.DateLine,
        data.Penawaran || "",
        data.PenawaranId || "",
        data.MintaHarga || "",
        data.NomorPO || null,
        data.TglPO || null,
        data.PerushKode,
        rencanaOrder,
        userKode,
        "N",
        data.TipeRevisi || 1,
        data.RevisiNo || 0,
        data.Referensi || "",
        data.RevisiNote || "",
        data.EstimasiJadi || "1899-12-30",
        data.TipeSpk,
        data.Cmo || "",
        data.DesignBaru || "N",
        data.RencanaSize || "",
        data.AccCustomer || "N",
        data.AccTanggal || null,
        mspkAktif,
      ];

      await conn.query(insertQ, insertParams);

      if (data.IsRevisi === "Y" && data.Referensi) {
        await conn.query(
          `UPDATE tmemospk SET mspk_revisi="Y", mspk_aktif="N" WHERE mspk_nomor=?`,
          [data.Referensi],
        );
      }
    } else {
      const noPoPendingEdit = await syncNoPoApproval(
        conn,
        nomorMap,
        data,
        userKode,
      );
      const mspkAktif = noPoPendingEdit ? "N" : "Y";

      const updateQ = `
        UPDATE tmemospk SET 
          mspk_nama=?, mspk_nama2=?, mspk_divisi=?, mspk_cus_kode=?, mspk_sal_kode=?,
          mspk_jo_kode=?, 
          mspk_statuskerja=?, mspk_ukuran=?, mspk_gramasi=?, mspk_panjang=?, mspk_lebar=?, mspk_kain=?,
          mspk_finishing=?, mspk_sablon=?, mspk_bordir=?, mspk_sublim=?, mspk_jumlah=?, mspk_harga=?,
          mspk_hargariil=?, mspk_keterangan=?, mspk_cab=?, mspk_cab2=?, mspk_workshop=?, mspk_workshop2=?,
          mspk_tanggal=?, mspk_dateline=?, mspk_pen_nomor=?, mspk_pen_id=?, mspk_mh_nomor=?,
          mspk_nomor_po=?, mspk_tgl_po=?, mspk_rencana_order=?, date_modified=NOW(), user_modified=?,
          mspk_tipe_revisi=?, mspk_estimasijadi=?, mspk_tipe=?, mspk_cmo=?, mspk_newdesign=?, mspk_rencana_size=?,
          mspk_acc_customer=?, mspk_acc_tanggal=?, mspk_aktif=?
        WHERE mspk_nomor=?
      `;
      const updateParams = [
        data.Nama,
        data.Nama2 || data.Nama,
        data.Divisi,
        data.CustKode,
        data.SalesKode,
        data.JoKode,
        data.StatusKerja,
        data.KetUkuran || "",
        data.Gramasi,
        panjang,
        lebar,
        data.Kain,
        data.Finishing,
        data.Sablon,
        data.Bordir,
        data.Sublim,
        jumlah,
        hargaJual,
        hargaRiil,
        data.Keterangan,
        data.Cab,
        data.Cab2,
        data.Workshop,
        data.Workshop2,
        data.Tanggal,
        data.DateLine,
        data.Penawaran || "",
        data.PenawaranId || "",
        data.MintaHarga || "",
        data.NomorPO || null,
        data.TglPO || null,
        rencanaOrder,
        userKode,
        data.TipeRevisi || 1,
        data.EstimasiJadi || "1899-12-30",
        data.TipeSpk,
        data.Cmo || "",
        data.DesignBaru || "N",
        data.RencanaSize || "",
        data.AccCustomer || "N",
        data.AccTanggal || null,
        mspkAktif,
        nomorMap,
      ];
      await conn.query(updateQ, updateParams);

      if (data.StatusEdit === "ACC") {
        await conn.query(
          `UPDATE tspk_pin5 SET pin_dipakai="Y" WHERE pin_trs="MAP" AND pin_nomor=? AND pin_dipakai=""`,
          [nomorMap],
        );
      }
    }

    // --- INSERT DETAIL SIZES ---
    await conn.query(`DELETE FROM tmemospk_size WHERE mspks_nomor = ?`, [
      nomorMap,
    ]);
    if (data.Sizes && Array.isArray(data.Sizes)) {
      for (let s of data.Sizes) {
        if (Number(s.qty) > 0) {
          await conn.query(
            `INSERT INTO tmemospk_size (mspks_nomor, mspks_size, mspks_qty, mspks_a, mspks_b) VALUES (?,?,?,?,?)`,
            [nomorMap, s.size, s.qty, s.lb || 0, s.pb || 0],
          );
        }
      }
    }

    // --- INSERT DETAIL KOMPONEN ---
    await conn.query(`DELETE FROM tmemospk_ketkomponen WHERE mkk_spk = ?`, [
      nomorMap,
    ]);
    if (data.Komponen && Array.isArray(data.Komponen)) {
      for (let k of data.Komponen) {
        if (k.pakai) {
          await conn.query(
            `INSERT INTO tmemospk_ketkomponen (mkk_spk, mkk_kode, mkk_ket) VALUES (?,?,?)`,
            [nomorMap, k.kode, k.ket],
          );
        }
      }
    }

    // --- UPDATE STATUS PENAWARAN JIKA ADA ---
    if (data.Penawaran && data.PenawaranId) {
      let sqlPen = `UPDATE tpenawaran_dtl SET pend_status="CLOSE"`;
      const paramsPen = [];
      if (data.MintaHarga) {
        sqlPen += `, pend_minta=?`;
        paramsPen.push(data.MintaHarga);
      }
      sqlPen += ` WHERE pend_pen_nomor=? AND pend_id=?`;
      paramsPen.push(data.Penawaran, data.PenawaranId);
      await conn.query(sqlPen, paramsPen);
    }

    await conn.commit();

    // Sinkron Komitmen Kirim MAP/Sampel (best-effort, di luar transaksi —
    // cerminan mapFormService Manksi Web). Kegagalan di sini tidak
    // menggagalkan save MAP (service-nya sendiri try/catch).
    if (data.IsRevisi === "Y" && data.Referensi) {
      await komitmenKirimService.removeMapFromKomitmenKirim(data.Referensi);
    }
    const [[aktifRow]] = await pool.query(
      `SELECT mspk_aktif FROM tmemospk WHERE mspk_nomor = ?`,
      [nomorMap],
    );
    if (aktifRow?.mspk_aktif === "N") {
      await komitmenKirimService.removeMapFromKomitmenKirim(nomorMap);
    } else if (data.Cmo && String(data.Cmo).trim()) {
      await komitmenKirimService.pushMapToKomitmenKirim(nomorMap, userKode);
    }

    return nomorMap;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// --- DELETE MAP ---
const deleteMap = async (nomor, userDetails) => {
  const [mapRows] = await pool.query(
    `SELECT mspk_jumlah_kirim, mspk_tanggal, mspk_divisi FROM tmemospk WHERE mspk_nomor = ?`,
    [nomor],
  );
  if (mapRows.length === 0) throw new Error("Data MAP tidak ditemukan.");

  const mapData = mapRows[0];

  // Validasi 1: Sudah dikirim
  if (Number(mapData.mspk_jumlah_kirim) !== 0) {
    throw new Error("MAP tersebut sudah dikirim. Tidak bisa dihapus.");
  }

  // Validasi 2: Keamanan Lintas Divisi (Kaosan/Fit U)
  const strDivisi = String(mapData.mspk_divisi || "");
  if (
    userDetails?.cabKaos &&
    !strDivisi.includes("KAOSAN") &&
    !strDivisi.includes("FIT U")
  ) {
    // Sesuaikan logika divisi jika diperlukan
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM tbarang WHERE brg_kode = ?`, [nomor]);
    await conn.query(`DELETE FROM tmemospk WHERE mspk_nomor = ?`, [nomor]);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  await komitmenKirimService.removeMapFromKomitmenKirim(nomor);
};

// ==========================================
// 4. APPROVAL & STATUS MANAGEMENT
// ==========================================

// --- TOGGLE CLOSE / OPEN ---
const toggleClose = async (nomor, isClose) => {
  if (isClose === "N") {
    const [spkRows] = await pool.query(
      `SELECT spk_nomor FROM tspk WHERE spk_memo = ? LIMIT 1`,
      [nomor],
    );
    if (spkRows.length > 0) {
      throw new Error(
        `MAP ini sudah jadi SPK dengan Nomor: ${spkRows[0].spk_nomor}. Tidak bisa Open.`,
      );
    }
  }

  await pool.query(`UPDATE tmemospk SET mspk_close = ? WHERE mspk_nomor = ?`, [
    isClose,
    nomor,
  ]);
};

// --- APPROVAL CMO ---
const approveCmo = async (nomor, userKode) => {
  await pool.query(`UPDATE tmemospk SET mspk_cmo = ? WHERE mspk_nomor = ?`, [
    userKode,
    nomor,
  ]);
  await komitmenKirimService.pushMapToKomitmenKirim(nomor, userKode);
};

// --- PENGAJUAN PIN 5 (EDIT CLOSED DATA) ---
const requestPin5 = async (nomor, alasan, userKode) => {
  const [mapRows] = await pool.query(
    `SELECT mspk_nama, mspk_tanggal FROM tmemospk WHERE mspk_nomor = ?`,
    [nomor],
  );
  if (mapRows.length === 0) throw new Error("Data tidak ditemukan.");

  const nama = mapRows[0].mspk_nama;
  const tgl = mapRows[0].mspk_tanggal;

  const [pinRows] = await pool.query(
    `SELECT pin_urut, pin_dipakai FROM tspk_pin5 WHERE pin_trs = "MAP" AND pin_nomor = ? ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );

  let urut = 1;
  if (pinRows.length > 0) {
    const lastPin = pinRows[0];
    urut = lastPin.pin_dipakai === "" ? lastPin.pin_urut : lastPin.pin_urut + 1;
  }

  const query = `
    INSERT INTO tspk_pin5 (
      pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan
    ) VALUES (
      "MAP", ?, ?, ?, ?, NOW(), ?, ?
    ) ON DUPLICATE KEY UPDATE 
      pin_tgl_trs = VALUES(pin_tgl_trs), 
      pin_ket = VALUES(pin_ket), 
      pin_acc = "", 
      pin_tgl_minta = NOW(), 
      pin_user_minta = VALUES(pin_user_minta), 
      pin_alasan = VALUES(pin_alasan)
  `;

  await pool.query(query, [nomor, urut, tgl, nama, userKode, alasan]);
};

// --- GET DESIGN LIST ---
const getDesignList = async (startDate, endDate) => {
  const [rows] = await pool.query(
    `SELECT mspk_nomor AS Nomor, mspk_nama AS Nama, mspk_designdone AS DesignDone
     FROM tmemospk
     WHERE mspk_newdesign = 'Y'
       AND mspk_designdone = 'N'
       AND mspk_tanggal >= ?
       AND mspk_tanggal <= ?
     ORDER BY mspk_tanggal`,
    [`${startDate} 00:00:00`, `${endDate} 23:59:59`],
  );
  return rows;
};

// --- UPDATE DESIGN STATUS ---
const updateDesignStatus = async (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Tidak ada data untuk disimpan.");
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const r of rows) {
      const done = r.DesignDone === "Y" ? "Y" : "N";
      await conn.query(
        `UPDATE tmemospk SET mspk_designdone = ? WHERE mspk_nomor = ?`,
        [done, r.Nomor],
      );
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// ==========================================
// 5. FILE PROCESSING & PRINT DATA
// ==========================================

// --- UPLOAD IMAGE/PDF (MAIN, PO, ACC) ---
const processImage = async (tempFilePath, cabang, type, mapNomor, mimetype) => {
  if (!fs.existsSync(tempFilePath))
    throw new Error("File sumber sementara tidak ditemukan.");

  const isPdf = mimetype === "application/pdf";
  const ext = isPdf ? "pdf" : "jpg";

  let finalFileName;
  if (type === "PO") finalFileName = `${mapNomor}-po.${ext}`;
  else if (type === "ACC") finalFileName = `${mapNomor}-acc.jpg`;
  else finalFileName = `${mapNomor}.jpg`;

  const branchFolderPath = path.join(
    process.cwd(),
    "public",
    "images",
    cabang,
    "map",
  );
  if (!fs.existsSync(branchFolderPath)) {
    fs.mkdirSync(branchFolderPath, { recursive: true });
  }
  const finalPath = path.join(branchFolderPath, finalFileName);

  try {
    if (isPdf) {
      fs.copyFileSync(tempFilePath, finalPath);
      fs.unlinkSync(tempFilePath);
    } else {
      await sharp(tempFilePath)
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .toFormat("jpeg")
        .jpeg({ quality: 80 })
        .toFile(finalPath);
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    }
    return finalFileName;
  } catch (error) {
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    throw new Error(`Gagal memproses file ${type}.`);
  }
};

// --- KOMPONEN MAP (tmemospk_ketkomponen + master tketkomponen) ---
// Dipakai pemilih komponen (mis. lookup SPK sublimasi) agar baris MAP
// yang tak punya baris PO-item tetap punya daftar komponen.
const getKomponenByMap = async (nomor) => {
  const [rows] = await db.query(
    `SELECT b.mkk_kode AS kode, a.nama AS nama, b.mkk_ket AS ket
     FROM tmemospk_ketkomponen b
     LEFT JOIN tketkomponen a ON a.kode = b.mkk_kode
     WHERE b.mkk_spk = ? ORDER BY b.mkk_kode`,
    [nomor],
  );
  return rows;
};

// --- GET DATA UNTUK CETAK ---
const getPrintData = async (nomor) => {
  const query = `
    SELECT 
      m.*, 
      o.jo_nama, 
      u.user_nama, 
      DATE_FORMAT(m.date_create, "%d/%m/%Y %H:%i:%s") as created_formatted,
      tc.cus_perfect,
      tc.cus_nama,
      e.sal_nama,
      p.Perush_nama,
      (
        SELECT GROUP_CONCAT(CONCAT(b.mkk_kode, "= ", a.nama, ": ", b.mkk_ket) SEPARATOR '\n')
        FROM tmemospk_ketkomponen b
        LEFT JOIN tketkomponen a ON a.kode = b.mkk_kode
        WHERE b.mkk_spk = m.mspk_nomor
      ) AS ketkomponen,
      (
        SELECT GROUP_CONCAT(CONCAT(z.mspks_size, "=  L: ", z.mspks_a, "   P: ", z.mspks_b) SEPARATOR '\n')
        FROM tmemospk_size z
        LEFT JOIN tukuran u ON u.ukuran = z.mspks_size
        WHERE z.mspks_nomor = m.mspk_nomor
        ORDER BY u.kode
      ) AS size_detail
    FROM tmemospk m
    LEFT JOIN tcustomer tc ON tc.cus_kode = m.mspk_cus_kode 
    LEFT JOIN tuser u ON u.user_kode = m.user_create 
    LEFT JOIN tsales e ON e.sal_kode = m.mspk_sal_kode 
    LEFT JOIN tjenisorder o ON m.mspk_jo_kode = o.jo_kode
    LEFT JOIN tperusahaan p ON m.mspk_perush_kode = p.perush_kode
    WHERE m.mspk_nomor = ?
  `;
  const [rows] = await db.query(query, [nomor]);
  if (rows.length === 0) return null;
  return rows[0];
};

// ==========================================
// 6. MODULE EXPORTS
// ==========================================
module.exports = {
  getBrowseList,
  deleteMap,
  toggleClose,
  approveCmo,
  requestPin5,
  getDesignList,
  updateDesignStatus,
  generateNomor,
  getInitGrids,
  getSpkInformasi,
  loadMintaHarga,
  getById,
  save,
  processImage,
  getPrintData,
  getNamaSuggestions,
  checkDuplikatNama,
  getKatalogCustomer,
  syncNoPoApproval,
  getNoPoStatus,
  getKomponenByMap,
};
