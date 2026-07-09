const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

// --- GENERATE NOMOR ---
const generateNomor = async (perushKode, joKode) => {
  const query = `
    SELECT IFNULL(MAX(CAST(SUBSTR(mspk_nomor, 11, 6) AS UNSIGNED)), 0) AS max_val 
    FROM tmemospk 
    WHERE mspk_perush_kode = ? AND mspk_jo_kode = ?
  `;
  const [[row]] = await db.query(query, [perushKode, joKode]);

  // FIX: base harus 1,000,000 (7 digit) supaya slice(-6) benar-benar
  // membuang digit "1" di depan dan cuma nyisain 6 digit counter murni.
  // Base 6-digit (100000) sebelumnya bikin digit "1" itu ikut kesimpen
  // di nomor MAP, lalu ke-parse lagi jadi counter di generate berikutnya
  // → nomor meledak (001100 → 101101 → 201102 → ...).
  const nextNum = 1000000 + parseInt(row.max_val, 10) + 1;
  const numStr = String(nextNum).slice(-6);

  return `MAP-${perushKode}-${joKode}-${numStr}`;
};

// --- GET INIT GRIDS (SIZE & KOMPONEN) ---
const getInitGrids = async () => {
  // FIX: Hapus WHERE kategori="" karena kolom tidak ada di database
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

  // Load master komponen (Grid 6)
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
    // DB pakai lowercase "spk_finishing" → uppercase dulu baru strip prefix
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
  if (rows.length === 0)
    throw new Error(
      "Nomor Permintaan Harga tersebut tidak ada atau berstatus BELUM.",
    );
  return rows[0];
};

// --- GET BY ID (LOAD DATA MAP) ---
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

  // Tutup Buku
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  const tglDokumen = new Date(data.mspk_tanggal);
  data.isTutupBuku = false;
  if (zdtClose && tglDokumen < zdtClose && data.StatusEdit !== "ACC") {
    data.isTutupBuku = true;
  }

  return data;
};

// --- SAVE MAP ---
const save = async (data, userKode, isNewMode) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const tglMap = new Date(data.Tanggal);
    const now = new Date();

    // 1. Validasi Tutup Buku
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    if (zdtClose && tglMap < zdtClose && data.StatusEdit !== "ACC") {
      throw new Error(
        "Anda tidak boleh input di tanggal periode yang sudah diclose.",
      );
    }

    // 2. Validasi Tanggal Mundur
    if (isNewMode && tglMap.setHours(0, 0, 0, 0) < now.setHours(0, 0, 0, 0)) {
      throw new Error("Tanggal MAP tidak boleh mundur.");
    }

    // 3. Validasi Hari Libur & Jam 5 Sore (Hanya saat Input Baru)
    if (isNewMode) {
      const day = tglMap.getDay();
      if (day === 0 || day === 6) {
        throw new Error(
          "Hari sabtu dan minggu HO libur bosku. Masukkan inputan ke hari senin saja.",
        );
      }

      // Fix: jangan gunakan .setHours() langsung pada variable yang dipakai lagi
      const tglMapDay = new Date(data.Tanggal);
      tglMapDay.setHours(0, 0, 0, 0);
      const nowDay = new Date();
      // Jam 5 sore = 17:00
      if (nowDay.getHours() >= 17 && tglMapDay <= nowDay) {
        throw new Error(
          "Sudah lewat jam 5 sore bosku. Masukkan inputan ke hari berikutnya.",
        );
      }
    }

    // 4. Validasi Deadline
    if (
      new Date(data.DateLine).setHours(0, 0, 0, 0) < tglMap.setHours(0, 0, 0, 0)
    ) {
      throw new Error("Tanggal deadline harus >= tanggal memo.");
    }

    // ── 5. SANITASI DATA NUMERIK KOSONG (MENGGANTIKAN LOGIKA DELPHI) ──
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

    // 5. Validasi Panjang Lebar (Divisi 1 & 5)
    if (data.Divisi === "1" || data.Divisi === "5") {
      if (panjang === 0) throw new Error("Ukuran panjang harus di isi.");
      if (lebar === 0) throw new Error("Ukuran lebar harus di isi.");
    }

    // 6. Validasi Revisi
    if (data.IsRevisi === "Y") {
      if (!data.RevisiNo) throw new Error("Revisi ke harus di isi.");
      if (!data.Referensi) throw new Error("Nomor Referensi harus di isi.");
    }

    // 7. Validasi Qty Rencana Order vs Detail Size
    let totalSizeQty = data.Sizes
      ? data.Sizes.reduce((sum, item) => sum + safeNum(item.qty), 0)
      : 0;

    if (totalSizeQty !== 0 && totalSizeQty !== rencanaOrder) {
      throw new Error(
        "Rencana Order vs Total Detail Qty Rencana Order harus sama.",
      );
    }

    // 8. Validasi Keterangan Komponen
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

    if (isNewMode) {
      // CREATE — hard block sesuai permintaan asli, tidak ada pengecualian
      if (data.AccCustomer !== "Y") {
        throw new Error(
          "Customer belum menyetujui pesanan ini. MAP tidak bisa disimpan.",
        );
      }
      if (!data.AccTanggal) {
        throw new Error("Tanggal persetujuan customer wajib diisi.");
      }
    } else {
      // EDIT — cek state SEBELUMNYA di database, bukan cuma apa yang dikirim FE
      const [existingRows] = await conn.query(
        `SELECT mspk_acc_customer FROM tmemospk WHERE mspk_nomor = ?`,
        [data.Nomor],
      );
      const wasAlreadyApproved = existingRows[0]?.mspk_acc_customer === "Y";

      if (!wasAlreadyApproved) {
        // Record ini sebelumnya belum approved (termasuk semua MAP lama).
        // Boleh diedit bebas untuk hal lain — TAPI kalau user di form ini
        // MENCOBA set jadi Y, wajib lengkap dulu, gak boleh setengah-setengah.
        if (data.AccCustomer === "Y" && !data.AccTanggal) {
          throw new Error("Tanggal persetujuan customer wajib diisi.");
        }
      }
      // Kalau wasAlreadyApproved === true, tidak divalidasi ulang sama sekali —
      // edit lain (workshop, keterangan, dll) bebas jalan.
    }

    let nomorMap = data.Nomor;

    // --- INSERT / UPDATE HEADER ---
    if (isNewMode) {
      if (!nomorMap || nomorMap === "Baru= Nomor Otomatis") {
        nomorMap = await generateNomor(data.PerushKode, data.JoKode);
      }

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
          mspk_acc_customer, mspk_acc_tanggal
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),?,?,?,?,?,?,?,?,?,?,?)
      `;
      await conn.query(insertQ, [
        nomorMap,
        data.Nama,
        data.Nama2 || data.Nama,
        data.Divisi,
        data.CustKode,
        data.SalesKode,
        data.StatusKerja,
        data.KetUkuran || "", // Memasukkan "Ket. Ukuran" ke kolom mspk_ukuran
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
      ]);

      // Jika ini adalah revisi, matikan status aktif MAP Referensinya
      if (data.IsRevisi === "Y" && data.Referensi) {
        await conn.query(
          `UPDATE tmemospk SET mspk_revisi="Y", mspk_aktif="N" WHERE mspk_nomor=?`,
          [data.Referensi],
        );
      }
    } else {
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
          mspk_acc_customer=?, mspk_acc_tanggal=?
        WHERE mspk_nomor=?
      `;
      await conn.query(updateQ, [
        data.Nama,
        data.Nama2 || data.Nama,
        data.Divisi,
        data.CustKode,
        data.SalesKode,
        data.JoKode,
        data.StatusKerja,
        data.KetUkuran || "", // Memasukkan "Ket. Ukuran" ke kolom mspk_ukuran
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
        nomorMap,
        data.AccCustomer || "N",
        data.AccTanggal || null,
      ]);

      // Jika edit hasil ACC, matikan PIN
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
    return nomorMap;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// --- UPLOAD IMAGE (MAIN & EMAIL) ---
const processImage = async (tempFilePath, cabang, type, mapNomor) => {
  if (!fs.existsSync(tempFilePath))
    throw new Error("File sumber sementara tidak ditemukan.");

  // Format Nama: MAP-JA-KO-001001.jpg ATAU MAP-JA-KO-001001-email.jpg
  let finalFileName;
  if (type === "EMAIL") finalFileName = `${mapNomor}-email.jpg`;
  else if (type === "ACC") finalFileName = `${mapNomor}-acc.jpg`;
  else finalFileName = `${mapNomor}.jpg`;

  // Sesuai aturan: public/images/cabang/map
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
    await sharp(tempFilePath)
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .toFormat("jpeg")
      .jpeg({ quality: 80 })
      .toFile(finalPath);

    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    return finalFileName;
  } catch (error) {
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    throw new Error(`Gagal memproses gambar ${type} ke format JPG.`);
  }
};

// --- GET DATA UNTUK CETAK ---
const getPrintData = async (nomor) => {
  // Query ini mereplikasi logika cetak di Delphi
  const query = `
    SELECT 
      m.*, 
      o.jo_nama, 
      u.user_nama, 
      DATE_FORMAT(m.date_create, "%d-%b-%Y %H:%i:%s") as created_formatted,
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

// --- AUTOCOMPLETE NAMA PEKERJAAN ---
const getNamaSuggestions = async (keyword, divisi, cusKode) => {
  // Return nama unik yang pernah dipakai untuk kombinasi divisi + customer
  // Sorted by frekuensi pemakaian (paling sering muncul dulu)
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
  // Cek apakah nama yang sama pernah diinput untuk divisi + customer yang sama
  // dan masih aktif (bukan revisi)
  let query = `
    SELECT mspk_nomor, mspk_tanggal, mspk_jo_kode,
           DATE_FORMAT(mspk_tanggal, '%d-%b-%Y') AS tgl_formatted
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
  return rows; // array of { mspk_nomor, tgl_formatted, mspk_jo_kode }
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

  // 1. Ambil Total Data Keseluruhan (tanpa limit)
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

  // 2. Ambil Data Sesuai Halaman (Limit & Offset)
  let query = `
    SELECT 
      mspk_nomor, mspk_nama, DATE_FORMAT(mspk_tanggal, '%d-%b-%Y') AS tanggal_pesanan,
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

  // Kembalikan items dan totalnya
  return { items: rows, total: totalData };
};

module.exports = {
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
};
