const db = require("../../config/database");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const tutupBukuService = require("../tutupBukuService");

// --- GENERATE NOMOR PERMINTAAN HARGA ---
const generateNomor = async (tanggal) => {
  const d = new Date(tanggal);
  const tahun = d.getFullYear(); // ex: 2026

  const query = `
    SELECT IFNULL(MAX(CAST(RIGHT(mh_nomor, 4) AS UNSIGNED)), 0) AS max_val 
    FROM tmintaharga 
    WHERE MID(mh_nomor, 4, 4) = ?
  `;
  const [[row]] = await db.query(query, [tahun]);

  const nextNum = parseInt(row.max_val, 10) + 1;
  const incrementStr = String(nextNum).padStart(4, "0"); // ex: 0001

  return `MH.${tahun}.${incrementStr}`;
};

// --- GENERATE NOMOR KALKULASI ---
const generateKalkulasiNomor = async (tanggal) => {
  const d = new Date(tanggal);
  const tahunStr = String(d.getFullYear()).slice(-2); // ex: 26
  const bulanStr = String(d.getMonth() + 1).padStart(2, "0"); // ex: 04
  const prefix = `KAL-${tahunStr}${bulanStr}`; // KAL-2604

  const query = `
    SELECT IFNULL(MAX(CAST(RIGHT(kal_nomor, 4) AS UNSIGNED)), 0) AS max_val 
    FROM kalkulasi.tkalkulasi2_hdr 
    WHERE kal_nomor LIKE ? AND LEFT(kal_nomor, 3) = "KAL"
  `;
  const [[row]] = await db.query(query, [`%${tahunStr}${bulanStr}%`]);

  const nextNum = parseInt(row.max_val, 10) + 1;
  const incrementStr = String(nextNum).padStart(4, "0");

  return `${prefix}${incrementStr}`;
};

/**
 * @description Meniru procedure loadKomponen di Delphi.
 * Mengambil biaya potong, jahit, daftar komponen kain, margin, dan allowance.
 */
const getKalkulasiMetadata = async (model, jenisKain, warna, qty) => {
  // 1. Ambil Biaya Potong
  const [potongRows] = await db.query(
    `SELECT mhb_biaya FROM tmintaharga_biaya WHERE mhb_biaya <> 0 AND mhb_jenis = "POTONG" LIMIT 1`,
  );

  // 2. Ambil Biaya Jahit (Berdasarkan prefiks nama kain)
  const [jahitRows] = await db.query(
    `SELECT mhb_biaya FROM tmintaharga_biaya 
     WHERE mhb_biaya <> 0 AND mhb_jenis = "JAHIT" 
     AND ? LIKE CONCAT(mhb_ket, '%') 
     ORDER BY CHAR_LENGTH(mhb_ket) DESC LIMIT 1`,
    [jenisKain],
  );

  let biayaJahit = jahitRows.length > 0 ? jahitRows[0].mhb_biaya : 0;
  if (biayaJahit === 0) {
    const [defaultJahit] = await db.query(
      `SELECT mhb_biaya FROM tmintaharga_biaya WHERE mhb_jenis="JAHIT" AND mhb_ket="-" LIMIT 1`,
    );
    biayaJahit = defaultJahit[0]?.mhb_biaya || 0;
  }

  // ⬅ BARU: cek dulu apakah kombinasi kode+jeniskain ini BENAR-BENAR ADA
  // di master, sebelum lanjut ambil komponen. Kalau tidak ada sama
  // sekali, ini data lama/stale (jenisKain sudah tidak valid di master
  // saat ini) — kirim flag eksplisit, JANGAN diam-diam balikin array
  // komponen kosong yang bikin HPP jadi 0 tanpa penjelasan.
  const [existRows] = await db.query(
    `SELECT 1 FROM tmintaharga_kain WHERE mhk_kode = ? AND TRIM(mhk_jeniskain) = TRIM(?) LIMIT 1`,
    [model, jenisKain],
  );
  const jenisKainValid = existRows.length > 0;

  if (!jenisKainValid) {
    return {
      rpPotong: potongRows[0]?.mhb_biaya || 0,
      rpJahit: biayaJahit,
      komponen: [],
      margin: { laba: 0, persen: "Y" },
      allowancePersen: 0,
      jenisKainValid: false, // ⬅ flag utama yang dibaca frontend
    };
  }

  // 3. Ambil Komponen Kain (yield/babaran & harga)
  const [komponenRows] = await db.query(
    `SELECT k.mhk_komponen AS komponen, k.mhk_lengan AS lengan, k.mhk_babaran AS babaran,
     (SELECT a.mhk_harga FROM tmintaharga_kain a 
      WHERE TRIM(a.mhk_warna) = TRIM(?) 
      AND a.mhk_kode = k.mhk_kode 
      AND TRIM(a.mhk_jeniskain) = TRIM(?) 
      LIMIT 1) AS harga,
     k.mhk_allow AS allowance
     FROM tmintaharga_kain k
     WHERE k.mhk_komponen <> "" 
     AND k.mhk_kode = ? 
     AND TRIM(k.mhk_jeniskain) = TRIM(?)`,
    [warna, jenisKain, model, jenisKain],
  );

  // 4. Ambil Margin (Tangga Laba berdasarkan Qty)
  const [marginRows] = await db.query(
    `SELECT margin AS laba, persen FROM tmintaharga_margin 
     WHERE ? <= qmax AND model = ? 
     ORDER BY qmin LIMIT 1`,
    [qty, model],
  );

  return {
    rpPotong: potongRows[0]?.mhb_biaya || 0,
    rpJahit: biayaJahit,
    komponen: komponenRows,
    margin: marginRows[0] || { laba: 0, persen: "Y" },
    allowancePersen: komponenRows[0]?.allowance || 0,
    jenisKainValid: true,
  };
};

// --- GET BY ID (LOAD DATA) ---
const getById = async (nomor, currentUser) => {
  // 1. Ambil Header Permintaan Harga
  const queryMh = `
    SELECT h.*, v.divisi AS DivisiNama, s.sal_nama AS SalesNama, tc.cus_perfect,
           h.user_create as usr, -- Tambahkan alias usr sesuai Delphi
           DATE_FORMAT(h.date_create, '%d-%m-%Y %T') AS tglCreateFormat,
           DATE_FORMAT(h.mh_apv, '%d-%m-%Y %T') AS tglApvFormat
    FROM tmintaharga h
    LEFT JOIN tdivisi v ON v.kode = h.mh_divisi
    LEFT JOIN tsales s ON s.sal_kode = h.mh_sal_kode
    LEFT JOIN tcustomer tc ON tc.cus_kode = h.mh_cus_kode
    WHERE h.mh_nomor = ?
  `;
  const [rowsMh] = await db.query(queryMh, [nomor]);
  if (rowsMh.length === 0) return null;

  // Mapping awal agar field 'usr' dan 'cus_perfect' tersedia
  const data = {
    ...rowsMh[0],
    Kalkulasi: null,
    User: rowsMh[0].usr, // Sesuai Delphi: edtusr.Text := tsql.fieldbyname('usr').asstring;
    Created: rowsMh[0].tglCreateFormat, // Sesuai Delphi: edtCreated.Text
    Perfect: rowsMh[0].cus_perfect, // Sesuai Delphi: cbperfect.Text
  };

  // --- CEK URL GAMBAR (Perbaikan Scan Kategori Cabang Dinamis) ---
  // --- CEK URL GAMBAR ---
  let urlDitemukan = null;

  // 1. Cek prioritas pertama di folder sentral /mnt/image/mintaharga
  const checkPathCentral = path.join(
    "/mnt",
    "image",
    "mintaharga",
    `${nomor}.jpg`,
  );
  if (fs.existsSync(checkPathCentral)) {
    urlDitemukan = `/file-gambar/mintaharga/${nomor}.jpg`; // Mengarah ke rute statis /file-gambar
  } else {
    // 2. Fallback cek folder cabang lama (Legacy)
    const cabangRecord = rowsMh[0].mh_cabkaos
      ? rowsMh[0].mh_cabkaos.trim()
      : "";
    const daftarCabang = [
      cabangRecord,
      currentUser?.cabang,
      "HO-",
      "P01",
      "P02",
      "P03",
      "P04",
      "P05",
    ].filter(Boolean);

    for (const cab of daftarCabang) {
      const checkPathLocal = path.join(
        process.cwd(),
        "public",
        "images",
        cab,
        "mintaharga",
        `${nomor}.jpg`,
      );
      if (fs.existsSync(checkPathLocal)) {
        urlDitemukan = `/images/${cab}/mintaharga/${nomor}.jpg`;
        break;
      }
    }
  }

  data.imageUrl = urlDitemukan;

  // Status PIN 5
  const [pinRows] = await db.query(
    `
    SELECT pin_urut, pin_acc, pin_dipakai FROM tspk_pin5 
    WHERE pin_trs = "PERMINTAAN HARGA" AND pin_nomor = ? ORDER BY pin_urut DESC LIMIT 1
  `,
    [nomor],
  );

  data.StatusEdit = "";
  if (pinRows.length > 0) {
    const pin = pinRows[0];
    if (pin.pin_acc === "" && pin.pin_dipakai === "") data.StatusEdit = "WAIT";
    else if (pin.pin_acc === "Y" && pin.pin_dipakai === "")
      data.StatusEdit = "ACC";
    else if (pin.pin_acc === "N") data.StatusEdit = "TOLAK";
    else if (pin.pin_acc === "Y" && pin.pin_dipakai === "Y")
      data.StatusEdit = "";
    else data.StatusEdit = "MINTA";
  }

  // Default Kalkulasi Access
  data.isKalkulasiLocked = false;
  data.KalkulasiInfo = ""; // Untuk menampung string "Created: X, Modified: Y"

  // 2. Ambil Data Kalkulasi (Jika Ada)
  if (data.mh_nomor_kalkulasi) {
    const kalNo = data.mh_nomor_kalkulasi;
    const [kalHdr] = await db.query(
      `SELECT h.*, 
        IF(h.date_modified IS NOT NULL, DATE_FORMAT(h.date_modified,"%d-%m-%Y %T"), DATE_FORMAT(h.date_create,"%d-%m-%Y %T")) as tglFormat 
       FROM kalkulasi.tkalkulasi2_hdr h WHERE h.kal_nomor = ?`,
      [kalNo],
    );

    if (kalHdr.length > 0) {
      const h = kalHdr[0];

      // --- LOGIKA CREATOR & MODIFIER ---
      let cusra = h.user_create || "";
      let cusrb = h.user_modified || "";
      data.KalkulasiInfo =
        cusrb === ""
          ? `Created: ${cusra}`
          : `Created: ${cusra}, Modified: ${cusrb}`;

      // --- LOGIKA PROTEKSI DIVISI FINANCE (Seperti Delphi) ---
      if (currentUser && currentUser.kode !== "ADMIN") {
        // Admin bebas
        const userToLogic = cusrb === "" ? cusra : cusrb;
        if (userToLogic) {
          const [userRows] = await db.query(
            `SELECT user_bagian FROM tuser WHERE user_kode = ?`,
            [userToLogic],
          );
          if (userRows.length > 0) {
            const xbagian = userRows[0].user_bagian;
            // Jika yang terakhir edit adalah FINANCE, dan yang buka BUKAN FINANCE
            if (xbagian === "FINANCE" && currentUser.bagian !== "FINANCE") {
              data.isKalkulasiLocked = true;
            }
          }
        }
      }
    }

    const [kalDtl] = await db.query(
      `SELECT * FROM kalkulasi.tkalkulasi2_dtl WHERE kald_nomor = ?`,
      [kalNo],
    );
    const [kalCtk] = await db.query(
      `SELECT * FROM kalkulasi.tkalkulasi2_cetak WHERE kald_nomor = ?`,
      [kalNo],
    );
    const [kalBordir] = await db.query(
      `SELECT * FROM kalkulasi.tkalkulasi2_bordir WHERE kald_nomor = ?`,
      [kalNo],
    );
    const [kalDtf] = await db.query(
      `SELECT * FROM kalkulasi.tkalkulasi2_dtf WHERE kald_nomor = ?`,
      [kalNo],
    );

    const [gridKomponen] = await db.query(
      `SELECT * FROM kalkulasi.tkalkulasi2_komponen WHERE kk_nomor = ? ORDER BY kk_nourut`,
      [kalNo],
    );

    const bodyKomp = gridKomponen.find((k) => k.kk_komponen === "BODY");

    const [gridCetak] = await db.query(
      `SELECT * FROM kalkulasi.tkalkulasi2_ctk WHERE kc_nomor = ? ORDER BY kc_nourut`,
      [kalNo],
    );
    const [gridAksesoris] = await db.query(
      `SELECT * FROM kalkulasi.tkalkulasi2_aksesories WHERE ka_nomor = ? ORDER BY ka_nourut`,
      [kalNo],
    );

    data.Kalkulasi = {
      Header: kalHdr[0] || {},
      Detail: kalDtl[0] || {},
      Cetak: kalCtk[0] || {},
      Bordir: kalBordir[0] || {},
      Dtf: kalDtf[0] || {},
      GridKomponen: gridKomponen,
      GridCetak: gridCetak,
      GridAksesoris: gridAksesoris,
      LoadedJenisKain: bodyKomp ? bodyKomp.kk_jeniskain : "",
      LoadedWarna: bodyKomp ? bodyKomp.kk_warna : "MUDA",
    };
  }

  // --- LOGIKA TUTUP BUKU (Sesuai zdtClose Delphi) ---
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  const tglDokumen = new Date(data.mh_tanggal);

  data.isTutupBuku = false;
  // Jika tanggal dokumen < zdtClose, maka dikunci.
  // (Delphi: if (EncodeDate(zYear,zMonth,zDay)<cgetcurdate) and (zclose=0) ... cekClose;)
  if (zdtClose && tglDokumen < zdtClose) {
    data.isTutupBuku = true;
  }

  return data;
};

// --- SAVE TRANSAKSI ---
const save = async (data, userKode, userCabang, isNewMode) => {
  // 1. VALIDASI TUTUP BUKU (Sesuai Logic Delphi zClose)
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  const tglInput = new Date(data.Tanggal);

  if (zdtClose && tglInput < zdtClose) {
    throw new Error(
      "Anda tidak boleh input/edit di tanggal periode yang sudah diclose.",
    );
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomorMh = data.Nomor;

    // --- TAB 1: SIMPAN PERMINTAAN HARGA ---
    if (isNewMode) {
      nomorMh = await generateNomor(data.Tanggal);

      const insertMh = `
        INSERT INTO tmintaharga (
          mh_nomor, mh_tanggal, mh_divisi, mh_cus_kode, mh_cus_nama, mh_sal_kode, mh_nama,
          mh_jmlorder, mh_harga, mh_budget, mh_dateorder, mh_kain, mh_panjang, mh_lebar, mh_ukuran,
          mh_gramasi, mh_finishing, mh_sublim, mh_cabkaos, mh_ket, mh_status, date_create, user_create
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
      `;
      await conn.query(insertMh, [
        nomorMh,
        data.Tanggal,
        data.Divisi,
        data.CustKode,
        data.CustNama,
        data.SalesKode,
        data.NamaPekerjaan,
        data.RencanaOrder || 0,
        data.HargaLama || 0,
        data.HargaBudget || 0,
        data.TanggalOrderTerakhir,
        data.Kain,
        data.Panjang || 0,
        data.Lebar || 0,
        data.Ukuran,
        data.Gramasi,
        data.Finishing,
        data.Sublim,
        userCabang, // <-- 3. Gunakan Cabang dari session user
        data.Keterangan,
        data.Status,
        userKode,
      ]);
    } else {
      let updateMh = `
        UPDATE tmintaharga SET 
          mh_tanggal=?, mh_divisi=?, mh_cus_kode=?, mh_cus_nama=?, mh_sal_kode=?, mh_nama=?,
          mh_jmlorder=?, mh_harga=?, mh_budget=?, mh_dateorder=?, mh_kain=?, mh_panjang=?, mh_lebar=?, mh_ukuran=?,
          mh_gramasi=?, mh_finishing=?, mh_sublim=?, mh_ket=?, date_modified=NOW(), user_modified=?
      `;
      const updateParams = [
        data.Tanggal,
        data.Divisi,
        data.CustKode,
        data.CustNama,
        data.SalesKode,
        data.NamaPekerjaan,
        data.RencanaOrder || 0,
        data.HargaLama || 0,
        data.HargaBudget || 0,
        data.TanggalOrderTerakhir,
        data.Kain,
        data.Panjang || 0,
        data.Lebar || 0,
        data.Ukuran,
        data.Gramasi,
        data.Finishing,
        data.Sublim,
        data.Keterangan,
        userKode,
      ];

      // 1. Proteksi Status: Hanya update jika BELUM, MINTA, CANCEL
      if (["BELUM", "MINTA", "CANCEL"].includes(data.Status)) {
        updateMh += `, mh_status=? `;
        updateParams.push(data.Status);
      }

      // 2. Auto-Approve Logic
      // Pastikan dari frontend mengirim data.TglApv dan data.UserCreate saat isEditMode
      if (
        !data.TglApv &&
        data.Status === "MINTA" &&
        data.UserCreate &&
        data.UserCreate !== userKode
      ) {
        updateMh += `, mh_apv=NOW(), mh_apv_usr=? `;
        updateParams.push(userKode);
      }

      updateMh += ` WHERE mh_nomor=?`;
      updateParams.push(nomorMh);

      await conn.query(updateMh, updateParams);

      // Update PIN 5 jika ACC
      if (data.StatusEdit === "ACC") {
        await conn.query(
          `UPDATE tspk_pin5 SET pin_dipakai="Y" WHERE pin_trs="PERMINTAAN HARGA" AND pin_nomor=? AND pin_dipakai=""`,
          [nomorMh],
        );
      }
    }

    // --- TAB 2: SIMPAN KALKULASI (Jika Diaktifkan) ---
    if (data.SimpanKalkulasi && data.Kalkulasi) {
      const kal = data.Kalkulasi;
      let nomorKal = kal.NomorKalkulasi;

      if (!nomorKal) {
        nomorKal = await generateKalkulasiNomor(data.Tanggal);
        await conn.query(
          `
            INSERT INTO kalkulasi.tkalkulasi2_hdr (
              kal_nomor, kal_project, kal_tanggal, kal_cus, kal_kh_kode, kal_rpallowance, kal_allowance, 
              kal_rpsesuai, kal_ppn, kal_rpsesuaippn, kal_rencanaorder, kal_rplaba, kal_laba, kal_persen, kal_pakaiobat, user_create, date_create
            ) VALUES (?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "Y", "N", ?, NOW())
          `,
          [
            nomorKal,
            data.NamaPekerjaan,
            data.CustKode,
            kal.Model,
            kal.RpAllowance || 0,
            kal.PersenAllowance || 0,
            kal.HargaSesuai || 0,
            kal.PersenPpn || 0, // ⬅ BARU
            kal.HargaSesuaiPpn || 0, // ⬅ BARU
            data.RencanaOrder || 0,
            kal.RpLaba || 0,
            kal.PersenLaba || 0,
            userKode,
          ],
        );

        // ⬅ FIX: pakai HargaSesuaiPpn (harga final+PPN), BUKAN HargaSesuai
        // (harga penyesuaian mentah) — HargaSesuaiPpn inilah yang jadi acuan
        // harga jual sebenarnya (dipakai Penawaran/dsb).
        await conn.query(
          `UPDATE tmintaharga SET mh_nomor_kalkulasi=?, mh_harga_kalkulasi=? WHERE mh_nomor=?`,
          [nomorKal, kal.HargaSesuaiPpn || 0, nomorMh],
        );
      } else {
        await conn.query(
          `
            UPDATE kalkulasi.tkalkulasi2_hdr SET 
              kal_project=?, kal_cus=?, kal_kh_kode=?, kal_rpallowance=?, kal_allowance=?, 
              kal_rpsesuai=?, kal_ppn=?, kal_rpsesuaippn=?, kal_rencanaorder=?, kal_rplaba=?, kal_laba=?, user_modified=?, date_modified=NOW()
            WHERE kal_nomor=?
          `,
          [
            data.NamaPekerjaan,
            data.CustKode,
            kal.Model,
            kal.RpAllowance || 0,
            kal.PersenAllowance || 0,
            kal.HargaSesuai || 0,
            kal.PersenPpn || 0, // ⬅ BARU
            kal.HargaSesuaiPpn || 0, // ⬅ BARU
            data.RencanaOrder || 0,
            kal.RpLaba || 0,
            kal.PersenLaba || 0,
            userKode,
            nomorKal,
          ],
        );
        // ⬅ FIX: sama, pakai HargaSesuaiPpn
        await conn.query(
          `UPDATE tmintaharga SET mh_harga_kalkulasi=? WHERE mh_nomor=?`,
          [kal.HargaSesuaiPpn || 0, nomorMh],
        );
      }

      // Hapus detail lama (Metode standar Delphi)
      await conn.query(
        `DELETE FROM kalkulasi.tkalkulasi2_dtl WHERE kald_nomor=?`,
        [nomorKal],
      );
      await conn.query(
        `DELETE FROM kalkulasi.tkalkulasi2_komponen WHERE kk_nomor=?`,
        [nomorKal],
      );
      await conn.query(
        `DELETE FROM kalkulasi.tkalkulasi2_aksesories WHERE ka_nomor=?`,
        [nomorKal],
      );
      await conn.query(
        `DELETE FROM kalkulasi.tkalkulasi2_ctk WHERE kc_nomor=?`,
        [nomorKal],
      );
      await conn.query(
        `DELETE FROM kalkulasi.tkalkulasi2_cetak WHERE kald_nomor=?`,
        [nomorKal],
      );
      await conn.query(
        `DELETE FROM kalkulasi.tkalkulasi2_bordir WHERE kald_nomor=?`,
        [nomorKal],
      );
      await conn.query(
        `DELETE FROM kalkulasi.tkalkulasi2_dtf WHERE kald_nomor=?`,
        [nomorKal],
      );

      // Re-insert Dtl
      await conn.query(
        `
        INSERT INTO kalkulasi.tkalkulasi2_dtl (kald_nomor, kald_rppotong, kald_rpjahit, kald_rpfinishing, kald_rpkirim, kald_rpbiayaobat) 
        VALUES (?, ?, ?, ?, ?, ?)
      `,
        [
          nomorKal,
          kal.RpPotong || 0,
          kal.RpJahit || 0,
          kal.RpFinishing || 0,
          kal.RpKirim || 0,
          kal.RpObat || 0,
        ],
      );

      // Re-insert Komponen Grid
      if (kal.GridKomponen && kal.GridKomponen.length > 0) {
        const values = kal.GridKomponen.map((k, i) => [
          nomorKal,
          k.Komponen,
          k.Kg ? "Y" : "N",
          k.Pabrik ? "Y" : "N",
          k.JenisKain,
          k.Lengan,
          k.Warna,
          k.Harga || 0,
          k.Babaran || 0,
          k.Pcs || 0,
          k.LogBody || 0,
          k.LogLengan || 0,
          i + 1,
        ]);
        await conn.query(
          `INSERT INTO kalkulasi.tkalkulasi2_komponen (kk_nomor, kk_komponen, kk_kg, kk_pabrik, kk_jeniskain, kk_lengan, kk_warna, kk_harga, kk_babaran, kk_pcs, kald_logbody, kald_loglengan, kk_nourut) VALUES ?`,
          [values],
        );
      }

      // Re-insert Aksesories Grid
      if (kal.GridAksesoris && kal.GridAksesoris.length > 0) {
        const values = kal.GridAksesoris.map((a, i) => [
          nomorKal,
          a.Keterangan,
          a.Harga || 0,
          i + 1,
        ]);
        await conn.query(
          `INSERT INTO kalkulasi.tkalkulasi2_aksesories (ka_nomor, ka_aksesories, ka_biaya, ka_nourut) VALUES ?`,
          [values],
        );
      }

      // Re-insert Cetak Grid
      if (kal.GridCetak && kal.GridCetak.length > 0) {
        const values = kal.GridCetak.map((c, i) => [
          nomorKal,
          c.Keterangan,
          c.Harga || 0,
          i + 1,
        ]);
        await conn.query(
          `INSERT INTO kalkulasi.tkalkulasi2_ctk (kc_nomor, kc_ket, kc_biaya, kc_nourut) VALUES ?`,
          [values],
        );
      }

      // Re-insert Cetak, Bordir, DTF Hdr
      await conn.query(
        `INSERT INTO kalkulasi.tkalkulasi2_cetak (kald_nomor, kald_rpcetak) VALUES (?, ?)`,
        [nomorKal, kal.RpCetakTotal || 0],
      );

      const bd = kal.Bordir || {};
      await conn.query(
        `
        INSERT INTO kalkulasi.tkalkulasi2_bordir (
          kald_nomor, kald_cmbordir, kald_bordirp1, kald_bordirp2, kald_bordirp3, kald_bordirp4, kald_bordirp5, kald_bordirp6, kald_bordirp7, kald_bordirp8,
          kald_bordirl1, kald_bordirl2, kald_bordirl3, kald_bordirl4, kald_bordirl5, kald_bordirl6, kald_bordirl7, kald_bordirl8, kald_rpbordir
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          nomorKal,
          bd.Cm || 0,
          bd.P1 || 0,
          bd.P2 || 0,
          bd.P3 || 0,
          bd.P4 || 0,
          bd.P5 || 0,
          bd.P6 || 0,
          bd.P7 || 0,
          bd.P8 || 0,
          bd.L1 || 0,
          bd.L2 || 0,
          bd.L3 || 0,
          bd.L4 || 0,
          bd.L5 || 0,
          bd.L6 || 0,
          bd.L7 || 0,
          bd.L8 || 0,
          kal.RpBordirTotal || 0,
        ],
      );

      const df = kal.Dtf || {};
      await conn.query(
        `
        INSERT INTO kalkulasi.tkalkulasi2_dtf (
          kald_nomor, kald_cmdtf, kald_dtfp1, kald_dtfp2, kald_dtfp3, kald_dtfp4, kald_dtfp5, kald_dtfp6, kald_dtfp7, kald_dtfp8,
          kald_dtfl1, kald_dtfl2, kald_dtfl3, kald_dtfl4, kald_dtfl5, kald_dtfl6, kald_dtfl7, kald_dtfl8, kald_rpdtf
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          nomorKal,
          df.Cm || 0,
          df.P1 || 0,
          df.P2 || 0,
          df.P3 || 0,
          df.P4 || 0,
          df.P5 || 0,
          df.P6 || 0,
          df.P7 || 0,
          df.P8 || 0,
          df.L1 || 0,
          df.L2 || 0,
          df.L3 || 0,
          df.L4 || 0,
          df.L5 || 0,
          df.L6 || 0,
          df.L7 || 0,
          df.L8 || 0,
          kal.RpDtfTotal || 0,
        ],
      );
    }

    await conn.commit();
    return nomorMh;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

const updateNomorKalkulasi = async (nomorMintaHarga, nomorKalkulasi) => {
  const query = `UPDATE tmintaharga SET mh_nomor_kalkulasi = ? WHERE mh_nomor = ?`;
  await db.query(query, [nomorKalkulasi, nomorMintaHarga]);
};

/**
 * @description Memproses gambar Minta Harga: Konversi ke JPG, rename, dan pindah ke folder cabang.
 */
const processImage = async (tempFilePath, nomorMh, cabang) => {
  if (!fs.existsSync(tempFilePath)) {
    throw new Error("File sumber sementara tidak ditemukan.");
  }

  const finalFileName = `${nomorMh}.jpg`;

  // Path Sentralisasi Baru
  const branchFolderPath = path.join("/mnt", "image", "mintaharga");

  if (!fs.existsSync(branchFolderPath)) {
    fs.mkdirSync(branchFolderPath, { recursive: true });
  }

  const finalPath = path.join(branchFolderPath, finalFileName);

  try {
    // Konversi dengan Sharp agar ukurannya terkompresi dan format seragam
    await sharp(tempFilePath)
      .flatten({ background: { r: 255, g: 255, b: 255 } }) // Jika PNG transparan, beri background putih
      .toFormat("jpeg")
      .jpeg({ quality: 90 })
      .toFile(finalPath);

    // Hapus file temp
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

    return finalPath;
  } catch (error) {
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    console.error("Gagal memproses gambar Minta Harga:", error);
    throw new Error("Gagal memproses gambar ke format JPG.");
  }
};

// --- GET KATALOG HISTORI PERMINTAAN HARGA CUSTOMER (LAZY LOADING) ---
const getKatalogCustomer = async (
  cusKode,
  divisi = "",
  keyword = "",
  page = 1,
  limit = 20,
) => {
  const offset = (page - 1) * limit;

  // 1. Hitung Total Data (Tanpa Limit)
  // Asumsi: Kita tampilkan semua yang bukan CANCEL
  let countQuery = `
    SELECT COUNT(*) AS total 
    FROM tmintaharga 
    WHERE mh_cus_kode = ? AND mh_status <> 'CANCEL'
  `;
  const countParams = [cusKode];

  if (divisi && divisi !== "SEMUA") {
    countQuery += ` AND mh_divisi = ?`;
    countParams.push(divisi);
  }
  if (keyword) {
    countQuery += ` AND mh_nama LIKE ?`;
    countParams.push(`%${keyword}%`);
  }

  const [countRows] = await db.query(countQuery, countParams);
  const totalData = countRows[0].total;

  // 2. Ambil Data Sesuai Halaman (Limit & Offset)
  let query = `
    SELECT 
      mh_nomor, 
      mh_nama, 
      DATE_FORMAT(mh_tanggal, '%d-%b-%Y') AS tanggal_pesanan,
      mh_tanggal, 
      mh_jmlorder AS jumlah, 
      mh_harga AS harga, 
      mh_kain, 
      mh_gramasi, 
      mh_ket AS keterangan, 
      mh_cabkaos AS cabang, 
      mh_divisi, 
      mh_status
    FROM tmintaharga
    WHERE mh_cus_kode = ? AND mh_status <> 'CANCEL'
  `;
  const params = [cusKode];

  if (divisi && divisi !== "SEMUA") {
    query += ` AND mh_divisi = ?`;
    params.push(divisi);
  }
  if (keyword) {
    query += ` AND mh_nama LIKE ?`;
    params.push(`%${keyword}%`);
  }

  query += ` ORDER BY mh_tanggal DESC, mh_nomor DESC LIMIT ? OFFSET ?`;
  params.push(Number(limit), Number(offset));

  const [rows] = await db.query(query, params);

  return { items: rows, total: totalData };
};

module.exports = {
  getById,
  getKalkulasiMetadata,
  save,
  updateNomorKalkulasi,
  processImage,
  getKatalogCustomer,
};
