const db = require("../../config/database");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const tutupBukuService = require("../tutupBukuService");

// ============================================================
// HELPER MAPPING — spk_* (kontrak field frontend, TIDAK berubah)
// <-> so_* (kolom fisik tsalesorder). Translasi terjadi HANYA di
// boundary SQL; seluruh logic bisnis di tengah tetap pakai nama
// field spk_* seperti kode asli, supaya frontend nol perubahan.
// ============================================================
const mapSoHeaderRow = (row) => {
  if (!row) return row;
  const out = {};
  for (const [key, val] of Object.entries(row)) {
    out[key.startsWith("so_") ? "spk_" + key.slice(3) : key] = val;
  }
  return out;
};
const mapSpkHeaderToSo = (header) => {
  const out = {};
  for (const [key, val] of Object.entries(header)) {
    out[key.startsWith("spk_") ? "so_" + key.slice(4) : key] = val;
  }
  return out;
};

// --- 1. GENERATE NOMOR SO OTOMATIS — algoritma TIDAK diubah,
// hanya sumber tabel diarahkan ke tsalesorder (bukan tspk lagi) ---
const generateNomor = async (conn, perushKode, joKode) => {
  const prefix = `SO-${perushKode}-${joKode}-`;
  const [rows] = await conn.query(
    `SELECT IFNULL(MAX(CAST(SUBSTR(so_nomor, ?, 6) AS UNSIGNED)), 0) AS jumlah
     FROM tsalesorder
     WHERE so_perush_kode = ? AND so_jo_kode = ? AND so_nomor LIKE ?
     FOR UPDATE`,
    [prefix.length + 1, perushKode, joKode, `${prefix}%`],
  );
  const nextVal = Number(rows[0].jumlah) + 1;
  return `${prefix}${String(nextVal).padStart(6, "0")}`;
};

// --- 2. GET DETAIL UNTUK MODE UBAH ---
const getDetail = async (nomor) => {
  // A. Header
  const [headerRows] = await db.query(
    `SELECT s.*, j.jo_nama, a.sal_nama, p.perush_nama, c.cus_nama, k.cus_nama AS cusk, c.cus_perfect,
      IFNULL((SELECT mkb_nomor FROM tmkb_hdr WHERE mkb_spk_nomor = s.so_nomor ORDER BY mkb_tanggal DESC LIMIT 1), "") AS mkb,
      IFNULL((SELECT DATE_FORMAT(mkb_tanggal,"%Y-%m-%d") FROM tmkb_hdr WHERE mkb_spk_nomor = s.so_nomor ORDER BY mkb_tanggal DESC LIMIT 1), "") AS dtmkb,
      IFNULL(m.mpb_jmlorder, 0) AS jmlmppb,
      IFNULL((
        SELECT SUM(d.invd_jumlah)
        FROM retail.tinv_hdr h
        INNER JOIN retail.tinv_dtl d ON d.invd_inv_nomor = h.inv_nomor
        WHERE h.inv_nomor = s.so_invdc AND LEFT(s.so_divisi, 1) <> '3'
      ), 0) AS jmlinvdc,
      map.mspk_acc_customer AS map_acc_customer,
      map.mspk_acc_tanggal AS map_acc_tanggal
     FROM tsalesorder s
     LEFT JOIN tjenisorder j ON s.so_jo_kode = j.jo_kode
     LEFT JOIN tsales a ON s.so_sal_kode = a.sal_kode
     LEFT JOIN tperusahaan p ON s.so_perush_kode = p.perush_kode
     LEFT JOIN tcustomer c ON s.so_cus_kode = c.cus_kode
     LEFT JOIN retail.tcustomer k ON s.so_cus_kaosan = k.cus_kode
     LEFT JOIN tmpb m ON s.so_mppb = m.mpb_nomor
     LEFT JOIN tmemospk map ON map.mspk_nomor = s.so_memo
     WHERE s.so_nomor = ?`,
    [nomor],
  );
  if (headerRows.length === 0) throw new Error("Data SO tidak ditemukan.");

  // Translasi so_* -> spk_* SEKALI di sini; sisa function di bawah
  // 100% identik dengan versi asli (operasi terhadap field spk_*).
  const header = [mapSoHeaderRow(headerRows[0])];

  // --- CEK 3 STATUS PIN (APPROVAL) — TIDAK BERUBAH, tabel-tabel
  // approval ini murni keyed by string nomor, tidak tergantung
  // header-nya hidup di tspk atau tsalesorder ---
  const [pinCus] = await db.query(
    `SELECT IF(cusp_acc="Y", "ACC", IF(cusp_acc="N", "TOLAK", "Y")) AS acc FROM tcustomer_pin WHERE cusp_nomor=?`,
    [nomor],
  );
  const pin_customer = pinCus.length > 0 ? pinCus[0].acc : "N";

  const [pinHarga] = await db.query(
    `SELECT IF(pin_acc="Y", "ACC", IF(pin_acc="N", "TOLAK", "MINTA ACC")) AS acc FROM tspk_pin WHERE pin_nomor=?`,
    [nomor],
  );
  const ketpo_acc = pinHarga.length > 0 ? pinHarga[0].acc : "";

  const [pinPrio] = await db.query(
    `SELECT IF(pin_acc="Y", "ACC", IF(pin_acc="N", "TOLAK", "MINTA ACC")) AS acc 
   FROM tspk_pin_prioritas WHERE pin_nomor=?`,
    [nomor],
  );
  let kepentingan_acc = pinPrio.length > 0 ? pinPrio[0].acc : "";

  const [pinNoPo] = await db.query(
    `SELECT IF(pin_acc="Y","ACC",IF(pin_acc="N","TOLAK","MINTA ACC")) AS acc
   FROM tspk_pin5
   WHERE pin_trs = "SO" AND pin_jenis = "NOPO" AND pin_nomor = ?
   ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );
  const nopo_acc = pinNoPo.length > 0 ? pinNoPo[0].acc : "";

  if (
    header[0].spk_statuskerja === "TOP URGENT" &&
    kepentingan_acc === "" &&
    String(header[0].spk_divisi).charAt(0) !== "3" &&
    header[0].spk_jo_kode !== "KS"
  ) {
    const berhak = await checkHakTopUrgent(
      header[0].spk_cus_kode,
      header[0].spk_divisi,
    );
    if (!berhak) {
      kepentingan_acc = "MINTA ACC";
    }
  }

  const pin_jo = header[0].spk_pinjo || "";
  let spk_aktif = header[0].spk_aktif;
  if (
    pin_customer === "TOLAK" ||
    ketpo_acc === "MINTA ACC" ||
    ketpo_acc === "TOLAK" ||
    kepentingan_acc === "MINTA ACC" ||
    kepentingan_acc === "TOLAK" ||
    pin_jo === "MINTA ACC" ||
    pin_jo === "TOLAK" ||
    nopo_acc === "MINTA ACC" ||
    nopo_acc === "TOLAK"
  ) {
    spk_aktif = "N";
  } else {
    spk_aktif = header[0].spk_aktif;
  }

  header[0].isSalesOrder = true; // selalu true — service ini khusus tsalesorder
  header[0].pin_customer = pin_customer;
  header[0].ketpo_acc = ketpo_acc;
  header[0].kepentingan_acc = kepentingan_acc;
  header[0].nopo_acc = nopo_acc;
  header[0].spk_aktif = spk_aktif;

  // B. Detail Alokasi — dari tsalesorder_alokasi
  const [alokasi] = await db.query(
    `SELECT soa_urut AS urut, soa_alamat AS alamat, soa_kota AS kota,
            soa_person AS person, soa_hp AS hp, soa_jumlah AS jumlah
     FROM tsalesorder_alokasi WHERE soa_so_nomor = ? ORDER BY soa_urut`,
    [nomor],
  );

  // C. Detail Kaosan — dari tsalesorder_kaosan (nama tetap di-JOIN
  // read-time, TIDAK disimpan, sama seperti perilaku tspk_dc asli)
  const [dtlKaosan] = await db.query(
    `SELECT d.sok_kode AS kode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            d.sok_ukuran AS ukuran, d.sok_qtyorder AS qtyorder
     FROM tsalesorder_kaosan d
     LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.sok_kode
     WHERE d.sok_so_nomor = ?`,
    [nomor],
  );

  // D. Detail Size — dari tsalesorder_size
  const [dtlSize] = await db.query(
    `SELECT sos_size AS size, sos_qty AS qty,
            sos_ld AS ld, sos_pb AS pb,
            sos_pl_pendek AS pl_pendek, sos_pl_panjang AS pl_panjang,
            sos_p_bahu AS p_bahu, sos_l_lengan AS l_lengan, sos_l_manset AS l_manset,
            sos_l_pinggang AS l_pinggang, sos_p_celana AS p_celana,
            sos_l_panggul AS l_panggul, sos_l_paha AS l_paha,
            sos_pesak AS pesak, sos_l_lutut AS l_lutut, sos_l_bawah AS l_bawah
     FROM tsalesorder_size WHERE sos_so_nomor = ? AND sos_qty > 0`,
    [nomor],
  );

  // E. Keterangan Komponen — TIDAK dimigrasi (tspk_ketkomponen tidak
  // punya FK ke tspk, murni keyed by string nomor; tabel ini juga
  // tidak pernah di-INSERT dari service ini, hanya dibaca)
  const [ketKomponen] = await db.query(
    `SELECT CAST(
     GROUP_CONCAT(
       CONCAT(b.skk_kode, '= ', a.nama, ': ', b.skk_ket)
       ORDER BY b.skk_kode
       SEPARATOR '\r\n'
     ) AS CHAR
   ) AS ketKomponen
   FROM tspk_ketkomponen b
   LEFT JOIN tketkomponen a ON a.kode = b.skk_kode
   WHERE b.skk_spk = ?`,
    [nomor],
  );

  const komponen = await getKetKomponenGrid(nomor);

  return {
    header: header[0],
    alokasi,
    dtlKaosan,
    dtlSize,
    komponen,
    ketKomponen: ketKomponen[0]?.ketKomponen || "",
  };
};

// --- HELPER: GET OMZET CUSTOMER — TIDAK BERUBAH ---
const getOmzet = async (cusKode, tahun, kurangTahun) => {
  const targetTahun = parseInt(tahun) - parseInt(kurangTahun);
  const [cus] = await db.query(
    `SELECT cus_kodei FROM tcustomer WHERE cus_kode = ?`,
    [cusKode],
  );
  let kodeCari = cusKode;
  if (cus.length > 0 && cus[0].cus_kodei) {
    kodeCari = cus[0].cus_kodei;
  }
  const [rows] = await db.query(
    `SELECT IFNULL(SUM(debet), 0) AS nominal 
     FROM piutang_debet 
     WHERE flag = 0 
       AND YEAR(tanggal) = ? 
       AND customer IN (SELECT cus_kode FROM tcustomer WHERE cus_kodei = ? OR cus_kode = ?)`,
    [targetTahun, kodeCari, kodeCari],
  );
  return rows[0].nominal;
};

// --- MENU_ID 268: Approve SO Tanpa Nomor PO ---
// ⚠️ FITUR BARU (tidak ada referensi Delphi) — desain mengikuti pola
// tspk_pin5 generik yang sudah dipakai utk Perubahan Data/Hapus Data.
const syncNoPoApproval = async (conn, nomor, header, user) => {
  const isKosong =
    !header.spk_nomor_po || String(header.spk_nomor_po).trim() === "";

  if (isKosong) {
    const [existingPin] = await conn.query(
      `SELECT pin_urut, pin_acc, pin_dipakai FROM tspk_pin5
       WHERE pin_trs = "SO" AND pin_jenis = "NOPO" AND pin_nomor = ?
       ORDER BY pin_urut DESC LIMIT 1`,
      [nomor],
    );

    // ⚠️ FIX: sama seperti bug MAP — kalau pengajuan NOPO sudah ACC
    // dan belum "dipakai", jangan reset ke pending lagi. SO tetap AKTIF.
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
       VALUES ("SO", "NOPO", ?, ?, ?, ?, NOW(), ?)
       ON DUPLICATE KEY UPDATE
         pin_tgl_trs = ?, pin_ket = ?, pin_acc = "", pin_tgl_minta = NOW(), pin_user_minta = ?`,
      [
        nomor,
        urut,
        header.spk_tanggal,
        "SO dibuat/diubah tanpa Nomor PO",
        user.kode,
        header.spk_tanggal,
        "SO dibuat/diubah tanpa Nomor PO",
        user.kode,
      ],
    );
    return true;
  }

  await conn.query(
    `DELETE FROM tspk_pin5
     WHERE pin_trs = "SO" AND pin_jenis = "NOPO" AND pin_nomor = ? AND pin_dipakai = ""`,
    [nomor],
  );
  return false;
};

const HEADER_EXTRA_FIELDS = [
  "kepentingan_acc",
  "ketpo_acc",
  "pin_customer",
  "Customer",
  "Sales",
  "JenisOrder",
  "NamaPerusahaan",
  "CustKaosanNama",
  "isCmoChecked",
  "jmlmppb",
  "jmlinvdc",
  "mkb",
  "dtmkb",
  "spk_iscetak",
  "spk_isupdate",
  "MainImageBlob",
  "MainImageName",
  "isSalesOrder",
];
const cleanHeader = (h) => {
  const result = { ...h };
  HEADER_EXTRA_FIELDS.forEach((f) => delete result[f]);
  return result;
};

// --- 3. SAVE DATA (INSERT & UPDATE) ---
const saveData = async (payload, user) => {
  const {
    header,
    alokasi,
    dtlKaosan,
    dtlSize,
    dtlKetKomponen,
    isEdit,
    xminta5,
    xurut5,
    isSalesOrder,
  } = payload;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    let nomor = header.spk_nomor;
    const divisiStr = String(header.spk_divisi).charAt(0);

    // ==========================================
    // 1. VALIDASI DATA — TIDAK BERUBAH
    // ==========================================
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    if (zdtClose && new Date(header.spk_tanggal) < zdtClose) {
      throw new Error(
        "Anda tidak boleh input/ubah di tanggal periode yang sudah diclose.",
      );
    }
    if (!header.spk_perush_kode) throw new Error("Perusahaan belum diisi.");
    if (!header.spk_cus_kode) throw new Error("Customer belum diisi.");
    if (!header.spk_sal_kode) throw new Error("Sales belum diisi.");
    if (!header.spk_jo_kode) throw new Error("Jenis Order belum diisi.");
    if (!header.spk_nama) throw new Error("Nama SO belum diisi.");
    if (!header.spk_cab) throw new Error("Kode Workshop (Cabang) harus diisi.");

    if (!header.spk_nomor_po || String(header.spk_nomor_po).trim() === "") {
      header.spk_tgl_po = null;
      header.spk_datelinepo = null;
    } else if (
      header.spk_datelinepo &&
      header.spk_tgl_po &&
      new Date(header.spk_datelinepo) < new Date(header.spk_tgl_po)
    ) {
      throw new Error(
        "Tanggal Dateline PO harus lebih besar atau sama dengan Tanggal PO.",
      );
    }
    if (
      (divisiStr === "1" || divisiStr === "5") &&
      (!header.spk_panjang || !header.spk_lebar)
    ) {
      throw new Error(
        "Ukuran Panjang dan Lebar harus diisi untuk divisi MMT/Spanduk.",
      );
    }
    if (
      Number(header.spk_harga) === 0 &&
      !header.spk_ketpo &&
      divisiStr !== "3"
    ) {
      throw new Error("Jika harga 0, Ket.PO wajib dipilih.");
    }
    const spkLamaClean = header.spk_lama ? String(header.spk_lama).trim() : "";
    header.spk_lama = spkLamaClean;
    const reqSpkLama = [
      "BARANG PENDUKUNG",
      "BARANG PER SET",
      "PRODUK PENGGANTI",
      "JASA TAMBAHAN",
    ];
    if (reqSpkLama.includes(header.spk_ketpo) && spkLamaClean === "") {
      throw new Error(
        `Untuk Ket.Po '${header.spk_ketpo}', SO Lama wajib diisi.`,
      );
    }
    const qtyPesan = Number(header.spk_jumlah);
    if (alokasi && alokasi.length > 0) {
      const sumAlokasi = alokasi.reduce(
        (acc, curr) => acc + Number(curr.jumlah || 0),
        0,
      );
      if (sumAlokasi > 0 && sumAlokasi !== qtyPesan) {
        throw new Error(
          "Jumlah SO vs Total Qty Alokasi beda. Silahkan cek dulu.",
        );
      }
    }
    if (divisiStr === "3") {
      if (!dtlKaosan || dtlKaosan.length === 0)
        throw new Error("Detail barang kaosan harus diisi.");
      const sumKaosan = dtlKaosan.reduce(
        (acc, curr) => acc + Number(curr.qtyorder || 0),
        0,
      );
      if (sumKaosan === 0)
        throw new Error("Detail barang kaosan Qty Order harus diisi.");
      if (sumKaosan !== qtyPesan)
        throw new Error(
          "Jumlah SO vs Total Qty Order di Detail Barang Kaosan harus sama.",
        );
    }
    header.spk_cabkaos = user.cabangKaos || "";

    // ==========================================
    // 2. EKSEKUSI HEADER — target tsalesorder
    // ==========================================
    const currentYear = new Date().getFullYear();
    const piutang = isSalesOrder
      ? 0
      : await getOmzet(header.spk_cus_kode, currentYear, 0);

    if (!isEdit) {
      nomor = await generateNomor(
        conn,
        header.spk_perush_kode,
        header.spk_jo_kode,
      );
      header.spk_nomor = nomor;
      header.user_create = user.kode;
      header.date_create = new Date();
      header.spk_aktif = piutang > 100 ? "N" : "Y";
      const noPoPendingCreate = await syncNoPoApproval(
        conn,
        nomor,
        header,
        user,
      );
      if (noPoPendingCreate) header.spk_aktif = "N";
      if (!header.spk_memo) {
        if (header.spk_acc_customer !== "Y") {
          throw new Error(
            "Customer belum menyetujui pesanan ini. SO tidak bisa disimpan.",
          );
        }
        if (!header.spk_acc_tanggal) {
          throw new Error("Tanggal persetujuan customer wajib diisi.");
        }
      }
      await conn.query(`INSERT INTO tsalesorder SET ?`, [
        mapSpkHeaderToSo(cleanHeader(header)),
      ]);
    } else {
      if (!header.spk_memo) {
        const [existingRows] = await conn.query(
          `SELECT so_acc_customer FROM tsalesorder WHERE so_nomor = ?`,
          [nomor],
        );
        const wasAlreadyApproved = existingRows[0]?.so_acc_customer === "Y";
        if (
          !wasAlreadyApproved &&
          header.spk_acc_customer === "Y" &&
          !header.spk_acc_tanggal
        ) {
          throw new Error("Tanggal persetujuan customer wajib diisi.");
        }
      }
      header.user_modified = user.kode;
      header.date_modified = new Date();
      if (piutang > 100) header.spk_aktif = "N";
      if (
        header.kepentingan_acc === "MINTA ACC" ||
        header.kepentingan_acc === "TOLAK"
      ) {
        header.spk_aktif = "N";
      }
      if (header.ketpo_acc === "MINTA ACC" || header.ketpo_acc === "TOLAK") {
        header.spk_aktif = "N";
      }
      if (header.spk_pinjo === "MINTA ACC" || header.spk_pinjo === "TOLAK") {
        header.spk_aktif = "N";
      }
      const noPoPendingEdit = await syncNoPoApproval(conn, nomor, header, user);
      if (noPoPendingEdit) header.spk_aktif = "N";
      if (header.kepentingan_acc === "MINTA ACC") {
        await conn.query(
          `INSERT INTO tspk_pin_prioritas (pin_nomor, pin_tgl_minta, pin_user_minta)
            VALUES (?, NOW(), ?)
            ON DUPLICATE KEY UPDATE pin_tgl_minta=NOW(), pin_user_minta=?`,
          [nomor, user.kode, user.kode],
        );
      } else if (!header.kepentingan_acc) {
        await conn.query(`DELETE FROM tspk_pin_prioritas WHERE pin_nomor=?`, [
          nomor,
        ]);
      }
      await conn.query(`UPDATE tsalesorder SET ? WHERE so_nomor = ?`, [
        mapSpkHeaderToSo(cleanHeader(header)),
        nomor,
      ]);
      await conn.query(
        `DELETE FROM tsalesorder_alokasi WHERE soa_so_nomor = ?`,
        [nomor],
      );
      await conn.query(
        `DELETE FROM tsalesorder_kaosan WHERE sok_so_nomor = ?`,
        [nomor],
      );
      await conn.query(`DELETE FROM tsalesorder_size WHERE sos_so_nomor = ?`, [
        nomor,
      ]);
    }

    const kodeCusUtama = String(header.spk_divisi).startsWith("3")
      ? header.spk_cus_kaosan
      : header.spk_cus_kode;
    if (piutang > 100) {
      await conn.query(
        `INSERT INTO tcustomer_pin (cusp_kode, cusp_nomor, cusp_tgl_minta, cusp_user_minta) 
          VALUES (?, ?, NOW(), ?) 
          ON DUPLICATE KEY UPDATE cusp_tgl_minta=NOW(), cusp_user_minta=?`,
        [kodeCusUtama, nomor, user.kode, user.kode],
      );
    } else {
      await conn.query(`DELETE FROM tcustomer_pin WHERE cusp_nomor = ?`, [
        nomor,
      ]);
    }

    // Sinkronisasi tbarang — tabel master eksternal, TIDAK BERUBAH
    await conn.query(`DELETE FROM tbarang WHERE brg_kode = ?`, [nomor]);
    await conn.query(
      `INSERT INTO tbarang (brg_kode, brg_name, brg_ukuran, brg_kain, brg_finishing, brg_harga, brg_divisi, user_create, date_create) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        nomor,
        header.spk_nama,
        header.spk_ukuran,
        header.spk_kain,
        header.spk_finishing,
        header.spk_harga,
        header.spk_divisi,
        user.kode,
      ],
    );

    // ==========================================
    // 3. DETAIL ALOKASI — target tsalesorder_alokasi
    // ==========================================
    if (alokasi && alokasi.length > 0) {
      for (let i = 0; i < alokasi.length; i++) {
        const item = alokasi[i];
        if (item.alamat || item.kota) {
          await conn.query(
            `INSERT INTO tsalesorder_alokasi
               (soa_so_nomor, soa_urut, soa_alamat, soa_kota, soa_person, soa_hp, soa_jumlah)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              nomor,
              i + 1,
              item.alamat,
              item.kota,
              item.person,
              item.hp,
              item.jumlah,
            ],
          );
        }
      }
    }

    // ==========================================
    // 4. DETAIL KAOSAN — target tsalesorder_kaosan
    // ==========================================
    if (divisiStr === "3" && dtlKaosan && dtlKaosan.length > 0) {
      for (const item of dtlKaosan) {
        if (item.ukuran) {
          const kodeItem = ["BR", "SB", "SD", "PL", "DP", "TG", "PM"].some(
            (sub) => header.spk_jo_kode.includes(sub),
          )
            ? nomor
            : item.kode;
          await conn.query(
            `INSERT INTO tsalesorder_kaosan (sok_so_nomor, sok_kode, sok_ukuran, sok_qtyorder) VALUES (?, ?, ?, ?)`,
            [nomor, kodeItem, item.ukuran, item.qtyorder],
          );
          await conn.query(
            `INSERT IGNORE INTO retail.tbarangdc_dtl (brgd_kode, brgd_ukuran, brgd_hrg1) VALUES (?, ?, 0)`,
            [nomor, item.ukuran],
          );
        }
      }
      if (
        ["BR", "SB", "SD", "PL", "DP", "TG", "PM"].some((sub) =>
          header.spk_jo_kode.includes(sub),
        )
      ) {
        await conn.query(`DELETE FROM retail.tbarangdc WHERE brg_kode = ?`, [
          nomor,
        ]);
        await conn.query(
          `INSERT INTO retail.tbarangdc (brg_kode, brg_warna, brg_otomatis, brg_cab, user_create, date_create) 
           VALUES (?, ?, 1, ?, ?, NOW())`,
          [
            nomor,
            header.spk_nama.substring(0, 50),
            user.cabangKaos || "",
            user.kode,
          ],
        );
      }
    }

    if (
      ["4", "6"].includes(divisiStr) &&
      !["BR", "SB", "SD", "PL", "DP", "TG", "PM"].some((sub) =>
        header.spk_jo_kode.includes(sub),
      )
    ) {
      const totalSize = (dtlSize || []).reduce(
        (s, r) => s + Number(r.qty || 0),
        0,
      );
      if (totalSize === 0) {
        throw new Error("Divisi Garmen: Qty Order di Detail Size harus diisi.");
      }
      if (totalSize !== qtyPesan) {
        throw new Error(
          "Jumlah SO vs Total Qty Order di detail size harus sama.",
        );
      }
    }

    // ==========================================
    // 5. DETAIL SIZE — target tsalesorder_size
    // ==========================================
    if (
      ["3", "4", "6"].includes(divisiStr) &&
      !["BR", "SB", "SD", "PL", "DP", "TG", "PM"].some((sub) =>
        header.spk_jo_kode.includes(sub),
      )
    ) {
      if (dtlSize && dtlSize.length > 0) {
        for (const item of dtlSize) {
          if (Number(item.qty) > 0) {
            let barcode = "";
            if (divisiStr === "4" && header.spk_tipe === "Premium") {
              barcode = `99${nomor}`;
            }
            await conn.query(
              `INSERT INTO tsalesorder_size
                 (sos_so_nomor, sos_size, sos_qty, sos_barcode,
                  sos_ld, sos_pb, sos_pl_pendek, sos_pl_panjang, sos_p_bahu,
                  sos_l_lengan, sos_l_manset, sos_l_pinggang, sos_p_celana,
                  sos_l_panggul, sos_l_paha, sos_pesak, sos_l_lutut, sos_l_bawah)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                nomor,
                item.size,
                item.qty,
                barcode,
                item.ld || 0,
                item.pb || 0,
                item.pl_pendek || 0,
                item.pl_panjang || 0,
                item.p_bahu || 0,
                item.l_lengan || 0,
                item.l_manset || 0,
                item.l_pinggang || 0,
                item.p_celana || 0,
                item.l_panggul || 0,
                item.l_paha || 0,
                item.pesak || 0,
                item.l_lutut || 0,
                item.l_bawah || 0,
              ],
            );
          }
        }
      }
    }

    // ==========================================
    // 6. DETAIL KETERANGAN KOMPONEN — target tspk_ketkomponen
    // FIX: sebelumnya di-DELETE saat edit tapi TIDAK PERNAH di-INSERT
    // ulang, jadi data ini hilang tiap kali SO di-edit. Sekarang
    // delete + insert dijalankan sepasang, konsisten untuk create & edit.
    // ==========================================
    await conn.query(`DELETE FROM tspk_ketkomponen WHERE skk_spk = ?`, [nomor]);
    if (dtlKetKomponen && Array.isArray(dtlKetKomponen)) {
      for (const k of dtlKetKomponen) {
        if (k.pakai) {
          await conn.query(
            `INSERT INTO tspk_ketkomponen (skk_spk, skk_kode, skk_ket) VALUES (?,?,?)`,
            [nomor, k.kode, k.ket],
          );
        }
      }
    }

    // ==========================================
    // 7. UPDATE STATUS TRANSAKSI TERKAIT — tabel eksternal, TIDAK BERUBAH
    // ==========================================
    if (!isEdit) {
      if (header.spk_pen_nomor) {
        await conn.query(
          `UPDATE tpenawaran_dtl SET pend_status="CLOSE" WHERE pend_pen_nomor=? AND pend_id=?`,
          [header.spk_pen_nomor, header.spk_pen_id || ""],
        );
      }
      if (header.spk_memo) {
        await conn.query(
          `UPDATE tmemospk SET mspk_close="Y" WHERE mspk_nomor=?`,
          [header.spk_memo],
        );
      }
    }

    // ==========================================
    // 7. PATCH: SINKRONISASI PABRIK & CABANG KAOSAN
    // ⚠ CATATAN: log_tabel masih hardcode "tspk" di bawah — kalau ada
    // proses sync eksternal yang membaca tlog_sync.log_tabel untuk
    // menentukan tabel sumber re-sync, nilai ini PERLU dikonfirmasi
    // apakah harus diganti "tsalesorder". Belum diubah karena aku
    // tidak tahu detail proses konsumennya.
    // ==========================================
    if (!isEdit && header.spk_jo_kode && header.spk_jo_kode.includes("BR")) {
      const cabKaos = user.cabangKaos || "";
      const nomorPO = header.spk_nomor_po
        ? String(header.spk_nomor_po).trim()
        : "";
      if (cabKaos !== "" && cabKaos !== "KDC" && nomorPO !== "") {
        const prefixPO = nomorPO.substring(0, 3);
        await conn.query(
          `UPDATE retail.tsodtf_hdr SET sd_spk_nomor=? WHERE sd_nomor=?`,
          [nomor, nomorPO],
        );
        await conn.query(
          `INSERT INTO tlog_sync (log_tabel, log_nomor, log_cab, log_task, log_sync) 
           VALUES ("tspk", ?, ?, "INSERT", "Y") 
           ON DUPLICATE KEY UPDATE log_sync="Y"`,
          [nomor, prefixPO],
        );
      }
    }

    // ==========================================
    // 8. PATCH: UPDATE PIN 5 BULAN BERIKUTNYA — TIDAK BERUBAH
    // ==========================================
    if (xminta5 === "ACC" && xurut5) {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai="Y" WHERE pin_trs="SO" AND pin_nomor=? AND pin_urut=?`,
        [nomor, xurut5],
      );
    }

    await conn.commit();
    return { nomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// --- VALIDASI FIELD FORM — UNION tspk + tsalesorder karena data
// historis (Delphi-created) tetap di tspk, data baru di tsalesorder.
// Duplikasi/keberadaan harus dicek di KEDUANYA. ---
const validateField = async (type, value, extraParam = "") => {
  if (!value) return { valid: true };

  if (type === "memo") {
    const [memo] = await db.query(
      `SELECT mspk_nomor FROM tmemospk WHERE mspk_nomor=?`,
      [value],
    );
    if (memo.length === 0) throw new Error("Map/Memo tsb tidak ada.");
    const [used] = await db.query(
      `SELECT Nomor FROM (
         SELECT spk_nomor AS Nomor FROM tspk WHERE spk_memo = ?
         UNION ALL
         SELECT so_nomor AS Nomor FROM tsalesorder WHERE so_memo = ?
       ) x LIMIT 1`,
      [value, value],
    );
    if (used.length > 0 && used[0].Nomor !== extraParam) {
      return {
        valid: false,
        warn: `MAP tsb sudah dipakai oleh ${used[0].Nomor}. Yakin akan dilanjutkan?`,
      };
    }
    return { valid: true };
  }

  if (type === "mppb") {
    const [mppb] = await db.query(
      `SELECT mpb_approve, mpb_jmlorder FROM tmpb WHERE mpb_nomor=?`,
      [value],
    );
    if (mppb.length === 0) throw new Error("No.MPPB tsb tidak ada.");
    if (mppb[0].mpb_approve === "N")
      throw new Error("MPPB tsb belum di approve oleh PPIC.");
    return { valid: true, data: { jumlah: mppb[0].mpb_jmlorder } };
  }

  if (type === "invdc") {
    const [inv] = await db.query(
      `SELECT SUM(d.invd_jumlah) AS jml FROM retail.tinv_hdr h INNER JOIN retail.tinv_dtl d ON d.invd_inv_nomor=h.inv_nomor WHERE h.inv_nomor=?`,
      [value],
    );
    if (!inv[0].jml)
      throw new Error("No.Invoice tsb tidak ada atau jumlah kosong.");
    const [used] = await db.query(
      `SELECT Nomor FROM (
         SELECT spk_nomor AS Nomor FROM tspk WHERE spk_invdc = ?
         UNION ALL
         SELECT so_nomor AS Nomor FROM tsalesorder WHERE so_invdc = ?
       ) x LIMIT 1`,
      [value, value],
    );
    if (used.length > 0 && used[0].Nomor !== extraParam) {
      throw new Error(
        `No.Invoice dari DC tsb sudah dibuatkan SO Nomor: ${used[0].Nomor}`,
      );
    }
    return { valid: true, data: { jumlah: inv[0].jml } };
  }

  if (type === "spklama") {
    const [found] = await db.query(
      `SELECT Nomor FROM (
         SELECT spk_nomor AS Nomor FROM tspk WHERE spk_aktif="Y" AND spk_nomor=?
         UNION ALL
         SELECT so_nomor AS Nomor FROM tsalesorder WHERE so_aktif="Y" AND so_nomor=?
       ) x LIMIT 1`,
      [value, value],
    );
    if (found.length === 0)
      throw new Error("SO Lama tsb tidak ada atau tidak aktif.");
    return { valid: true };
  }

  // Validasi Customer & Customer Kaosan — TIDAK BERUBAH (tidak
  // menyentuh tspk/tsalesorder sama sekali)
  if (type === "customer") {
    const [cus] = await db.query(
      `SELECT cus_aktif, cus_piutang FROM tcustomer WHERE cus_kode=?`,
      [value],
    );
    if (cus.length === 0) throw new Error("Kode customer ini belum ada.");
    if (cus[0].cus_aktif === 1) throw new Error("Status customer ini pasif.");
    if (cus[0].cus_piutang !== "N") {
      const [tunggakan] = await db.query(
        `
        SELECT COUNT(p.Nota) as jmlTunggakan
        FROM piutang_debet p
        WHERE p.flag=0 AND (debet-kredit)>100 AND DATEDIFF(CURDATE(), p.tanggal)>90
          AND p.tanggal >= "2021-01-01"
          AND p.nota NOT IN (SELECT x.inv_nomor FROM tinv_hdr x WHERE x.INV_Keterangan LIKE "%INV YG DIKIRIM%")
          AND customer=?
      `,
        [value],
      );
      if (tunggakan[0].jmlTunggakan > 0) {
        return {
          valid: true,
          pin: "Y",
          warn: `Customer ini memiliki ${tunggakan[0].jmlTunggakan} Invoice Umum yang menunggak lebih dari 90 hari!`,
        };
      }
    }
    return { valid: true, pin: "N" };
  }

  if (type === "custKaosan") {
    const [cus] = await db.query(
      `SELECT cus_aktif, cus_piutang FROM retail.tcustomer WHERE cus_kode=?`,
      [value],
    );
    if (cus.length === 0)
      throw new Error("Kode customer kaosan ini belum ada.");
    if (cus[0].cus_aktif === 1)
      throw new Error("Status customer kaosan ini pasif.");
    if (cus[0].cus_piutang !== "N") {
      const [tunggakan] = await db.query(
        `
        SELECT COUNT(x.Invoice) as jmlTunggakan FROM (
          SELECT RIGHT(d.pd_ph_nomor,17) as Invoice, d.pd_tanggal, SUM(d.pd_debet) debet, SUM(d.pd_kredit) kredit
          FROM retail.tpiutang_dtl d
          WHERE LEFT(d.pd_ph_nomor,7)=?
          GROUP BY d.pd_ph_nomor
        ) X
        WHERE DATEDIFF(CURDATE(), x.pd_tanggal) > 30 AND (x.debet - x.kredit) > 100
      `,
        [value],
      );
      if (tunggakan[0].jmlTunggakan > 0) {
        return {
          valid: true,
          pin: "Y",
          warn: `Customer Kaosan ini memiliki ${tunggakan[0].jmlTunggakan} Invoice yang menunggak lebih dari 30 hari!`,
        };
      }
    }
    return { valid: true, pin: "N" };
  }

  return { valid: true };
};

const normalizeKeys = (obj) => {
  if (!obj) return obj;
  return Object.keys(obj).reduce((acc, key) => {
    acc[key.toLowerCase()] = obj[key];
    return acc;
  }, {});
};

const getMemoDetail = async (nomor) => {
  const [header] = await db.query(
    `SELECT m.*, e.sal_nama, j.jo_nama, c.cus_nama, c.cus_perfect, p.perush_nama, 
            p1.pab_nama AS workshop, p2.pab_nama AS workshop2 
     FROM tmemospk m 
     LEFT JOIN tsales e ON e.sal_kode = m.mspk_sal_kode 
     LEFT JOIN tjenisorder j ON j.jo_kode = m.mspk_jo_kode 
     LEFT JOIN tcustomer c ON c.cus_kode = m.mspk_cus_kode 
     LEFT JOIN tperusahaan p ON p.perush_kode = m.mspk_perush_kode
     LEFT JOIN tpabrik p1 ON p1.pab_kode = m.mspk_cab 
     LEFT JOIN tpabrik p2 ON p2.pab_kode = m.mspk_cab2 
     WHERE m.mspk_nomor = ?`,
    [nomor],
  );
  if (header.length === 0) throw new Error("Memo/MAP tidak ditemukan.");
  const [sizes] = await db.query(
    `SELECT mspks_size, mspks_qty, mspks_a, mspks_b 
     FROM tmemospk_size 
     WHERE mspks_nomor = ? AND mspks_qty > 0`,
    [nomor],
  );
  const normalizedHeader = normalizeKeys(header[0]);
  const normalizedSizes = sizes.map(normalizeKeys);
  return { header: normalizedHeader, sizes: normalizedSizes };
};

const processImage = async (tempFilePath, cabang, spkNomor, type = "MAIN") => {
  if (!fs.existsSync(tempFilePath))
    throw new Error("File sumber sementara tidak ditemukan.");
  const finalFileName =
    type === "ACC" ? `${spkNomor}-acc.jpg` : `${spkNomor}.jpg`;
  const branchFolderPath = path.join(process.cwd(), "public", "images", cabang);
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
    throw new Error(`Gagal memproses gambar ke format JPG.`);
  }
};

const getDatelineLimits = async (divisi, joKode, kepentingan, cabKaos) => {
  const divStr = String(divisi).charAt(0);
  const joStr = String(joKode).toUpperCase();
  const [rows] = await db.query(
    `SELECT * FROM tspk_kepentingan WHERE kepentingan = ?`,
    [kepentingan],
  );
  let minHari = 0;
  let maxHari = 0;
  let isKebal = false;
  if (rows.length > 0) {
    const rules = rows[0];
    if (divStr === "1") {
      minHari = Number(rules.spanduk1) || 0;
      maxHari = Number(rules.spanduk2) || 0;
    } else if (divStr === "5") {
      minHari = Number(rules.mmt1) || 0;
      maxHari = Number(rules.mmt2) || 0;
    } else if (divStr === "3") {
      const isPengerjaan = ["BR", "SB", "SD", "PL", "DP", "TG", "PM"].some(
        (sub) => joStr.includes(sub),
      );
      if (isPengerjaan) {
        minHari = Number(rules.kaosan1sb) || 0;
        maxHari = Number(rules.kaosan2sb) || 0;
        if (cabKaos && cabKaos !== "KDC") isKebal = true;
      } else {
        minHari = Number(rules.kaosan1) || 0;
        maxHari = Number(rules.kaosan2) || 0;
      }
    } else if (divStr === "4" || divStr === "6") {
      if (joStr === "KS") {
        minHari = 0;
        maxHari = 30;
      } else {
        minHari = Number(rules.garmen1) || 0;
        maxHari = Number(rules.garmen2) || 0;
      }
    }
  }
  return { minHari, maxHari, isKebal };
};

const checkHakTopUrgent = async (cusKode, divisi) => {
  const divStr = String(divisi).charAt(0);
  const currentYear = new Date().getFullYear();
  const omzetTahunIni = await getOmzet(cusKode, currentYear, 0);
  const omzetTahunLalu = await getOmzet(cusKode, currentYear, 1);
  if (omzetTahunIni > 250_000_000 || omzetTahunLalu > 100_000_000) {
    return true;
  }
  const [rows] = await db.query(
    `SELECT cus_prioritas, cus_spanduk, cus_garmen, cus_mmt 
     FROM tcustomer WHERE Cus_kode = ?`,
    [cusKode],
  );
  if (rows.length > 0) {
    const c = rows[0];
    if (c.cus_prioritas === "Y") {
      if (divStr === "1" && c.cus_spanduk === "Y") return true;
      if (divStr === "5" && c.cus_mmt === "Y") return true;
      if ((divStr === "4" || divStr === "6") && c.cus_garmen === "Y")
        return true;
    }
  }
  return false;
};

const getInitSizes = async () => {
  const [rows] = await db.query(
    `SELECT ukuran AS size FROM retail.tukuran WHERE kategori = "" ORDER BY kode`,
  );
  return rows.map((r) => ({
    size: r.size,
    qty: 0,
    ld: 0,
    pb: 0,
    pl_pendek: 0,
    pl_panjang: 0,
    p_bahu: 0,
    l_lengan: 0,
    l_manset: 0,
    l_pinggang: 0,
    p_celana: 0,
    l_panggul: 0,
    l_paha: 0,
    pesak: 0,
    l_lutut: 0,
    l_bawah: 0,
  }));
};

// ← BARU: gabungkan master tketkomponen + data existing tspk_ketkomponen
// jadi format checkbox — sama pola kayak mapFormService.getById().
const getKetKomponenGrid = async (nomor) => {
  const [master] = await db.query(
    `SELECT kode, nama FROM tketkomponen ORDER BY kode`,
  );
  const [existing] = await db.query(
    `SELECT skk_kode, skk_ket FROM tspk_ketkomponen WHERE skk_spk = ?`,
    [nomor],
  );
  return master.map((k) => {
    const found = existing.find((e) => e.skk_kode === k.kode);
    return {
      kode: String(k.kode),
      nama: k.nama,
      pakai: !!found,
      ket: found ? found.skk_ket : "",
    };
  });
};

// ← BARU: dipakai mode Create (belum ada nomor, jadi tidak ada existing data)
const getKomponenMaster = async () => {
  const [master] = await db.query(
    `SELECT kode, nama FROM tketkomponen ORDER BY kode`,
  );
  return master.map((k) => ({
    kode: String(k.kode),
    nama: k.nama,
    pakai: false,
    ket: "",
  }));
};

const JO_KATEGORI = {
  BB: "ATASAN",
  BU: "ATASAN",
  JK: "ATASAN",
  JS: "ATASAN",
  KK: "ATASAN",
  KO: "ATASAN",
  KS: "ATASAN",
  CL: "BAWAHAN",
  WP: "WEARPACK",
};
const getStandarUkuran = async (joKode, varian = "STANDAR") => {
  const jo = String(joKode || "").toUpperCase();
  const kategori = JO_KATEGORI[jo];
  if (!kategori) return [];
  const kategoriList =
    kategori === "WEARPACK" ? ["ATASAN", "BAWAHAN"] : [kategori];
  const [allSizes] = await db.query(
    `SELECT ukuran AS size FROM retail.tukuran WHERE kategori = "" ORDER BY kode`,
  );
  const placeholders = kategoriList.map(() => "?").join(",");
  const [standar] = await db.query(
    `SELECT * FROM retail.tukuran_standar 
     WHERE ts_kategori IN (${placeholders}) AND ts_varian = ?`,
    [...kategoriList, varian],
  );
  const standarMap = {};
  for (const row of standar) {
    if (!standarMap[row.ts_ukuran]) standarMap[row.ts_ukuran] = {};
    Object.assign(standarMap[row.ts_ukuran], row);
  }
  return allSizes.map((s) => {
    const d = standarMap[s.size] || {};
    return {
      size: s.size,
      qty: 0,
      ld: Number(d.ts_ld) || 0,
      pb: Number(d.ts_pb) || 0,
      pl_pendek: Number(d.ts_pl_pendek) || 0,
      pl_panjang: Number(d.ts_pl_panjang) || 0,
      p_bahu: Number(d.ts_p_bahu) || 0,
      l_lengan: Number(d.ts_l_lengan) || 0,
      l_manset: Number(d.ts_l_manset) || 0,
      l_pinggang: Number(d.ts_l_pinggang) || 0,
      p_celana: Number(d.ts_p_celana) || 0,
      l_panggul: Number(d.ts_l_panggul) || 0,
      l_paha: Number(d.ts_l_paha) || 0,
      pesak: Number(d.ts_pesak) || 0,
      l_lutut: Number(d.ts_l_lutut) || 0,
      l_bawah: Number(d.ts_l_bawah) || 0,
    };
  });
};

// --- Katalog SO (SalesOrderTabKatalog.vue) — target tsalesorder ---
const getKatalogCustomer = async (
  cusKode,
  divisi = "",
  keyword = "",
  page = 1,
  limit = 20,
) => {
  const offset = (page - 1) * limit;
  let whereBase = `WHERE s.so_cus_kode = ? AND s.so_aktif = 'Y'`;
  const baseParams = [cusKode];
  if (divisi && divisi !== "SEMUA") {
    whereBase += ` AND LEFT(s.so_divisi, 1) = ?`;
    baseParams.push(String(divisi).charAt(0));
  }
  if (keyword) {
    whereBase += ` AND (s.so_nama LIKE ? OR s.so_nomor LIKE ?)`;
    baseParams.push(`%${keyword}%`, `%${keyword}%`);
  }
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM tsalesorder s ${whereBase}`,
    baseParams,
  );
  const [rows] = await db.query(
    `SELECT
       s.so_nomor        AS nomor,
       s.so_nama         AS nama,
       DATE_FORMAT(s.so_tanggal, '%d-%b-%Y') AS tanggal_pesanan,
       s.so_tanggal       AS spk_tanggal,
       s.so_jumlah        AS jumlah,
       s.so_memo          AS memo,
       s.so_harga         AS harga,
       s.so_kain          AS kain,
       s.so_ukuran        AS ukuran,
       s.so_finishing     AS finishing,
       s.so_keterangan    AS keterangan,
       s.so_cab           AS cab,
       s.so_divisi        AS divisi,
       s.so_statuskerja   AS statuskerja,
       j.jo_nama          AS jenis_order,
       p.perush_nama      AS perusahaan
     FROM tsalesorder s
     LEFT JOIN tjenisorder j ON j.jo_kode = s.so_jo_kode
     LEFT JOIN tperusahaan p ON p.perush_kode = s.so_perush_kode
     ${whereBase}
     ORDER BY s.so_tanggal DESC
     LIMIT ? OFFSET ?`,
    [...baseParams, Number(limit), Number(offset)],
  );
  return { items: rows, total };
};

// --- CROSS-REFERENCE SJ MEMO <-> MAP (untuk auto-fill & lock di SO Form) ---

// Ambil daftar MAP yang tercakup dalam 1 SJ Memo
const getSjMemoMapList = async (nomorSj) => {
  const [rows] = await db.query(
    `SELECT d.sjd_mspk_nomor AS kode, m.mspk_nama AS nama,
            d.sjd_jumlah AS jumlah, d.sjd_ukuran AS ukuran
     FROM tsj_dtl_memo d
     LEFT JOIN tmemospk m ON m.mspk_nomor = d.sjd_mspk_nomor
     WHERE d.sjd_sj_nomor = ?`,
    [nomorSj],
  );
  if (rows.length === 0) {
    throw new Error(
      "SJ Memo tersebut tidak ditemukan atau tidak memiliki detail MAP.",
    );
  }
  return rows;
};

// Reverse lookup: cari SJ Memo yang mereferensikan 1 nomor MAP tertentu
const findSjMemoByMap = async (nomorMap) => {
  const [rows] = await db.query(
    `SELECT DISTINCT d.sjd_sj_nomor AS nomor
     FROM tsj_dtl_memo d
     WHERE d.sjd_mspk_nomor = ?`,
    [nomorMap],
  );
  return rows;
};

module.exports = {
  getDetail,
  saveData,
  validateField,
  getMemoDetail,
  processImage,
  getDatelineLimits,
  checkHakTopUrgent,
  getInitSizes,
  getStandarUkuran,
  getKatalogCustomer,
  getKomponenMaster,
  getSjMemoMapList,
  findSjMemoByMap,
};
