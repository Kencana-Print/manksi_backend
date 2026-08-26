const fs = require("fs");
const path = require("path");
const db = require("../../config/database");
const {
  isTutupBuku,
  getStatusPengajuan,
} = require("./poExternalGarmenService");

const PIN_TRS = "PO EXTERNAL";
const CAB_LIST = ["P01", "P04"];

// ⚠️ ASUMSI path gambar SPK = /mnt/image (sama dgn mount static
// `/file-gambar` di index.js). Kendala module katanya pakai dual-path
// (folder baru vs legacy /mnt/image) — kalau ada helper existing
// buat cek ini, kasih tau saya, biar saya pakai itu aja daripada
// duplikat logic.
const IMAGE_BASE_PATH = "/mnt/image";
const checkGambarExists = (spkNomor, cab) => {
  if (!spkNomor) return false;
  try {
    const cabFolder = cab || "HO-";
    const newPath = path.join(
      process.cwd(),
      "public",
      "images",
      cabFolder,
      `${spkNomor}.jpg`,
    );
    if (fs.existsSync(newPath)) return true;
    return fs.existsSync(path.join(IMAGE_BASE_PATH, `${spkNomor}.jpg`));
  } catch {
    return false;
  }
};

// ─────────────────────────────────────────────
// Master list ukuran — replika initgrid2 Delphi
// ─────────────────────────────────────────────
const getMasterSizeList = async () => {
  const [rows] = await db.query(
    `SELECT u.ukuran FROM retail.tukuran u
     WHERE u.kategori = "" AND u.kode <= 16 ORDER BY u.kode`,
  );
  return rows.map((r) => r.ukuran);
};

// ─────────────────────────────────────────────
// Komponen (bahan) dari MKB yg terkait SPK — dipakai baik dari
// edtNomorSPKExit maupun loaddataall (dua-duanya query MKB via SPK).
// ⚠️ ASUMSI nama kolom urutan tmkb_dtl = `mkbd_nourut` (pola sama dgn
// poed_nourut). Tolong SHOW COLUMNS FROM tmkb_dtl kalau beda.
// ─────────────────────────────────────────────
const getKomponenBySpk = async (spkNomor) => {
  if (!spkNomor) return [];
  const [rows] = await db.query(
    `SELECT h.mkb_nomor AS Mkb, d.mkbd_komponen AS Komponen,
       d.mkbd_bhn_kode AS KodeBahan, b.Bhn_Name AS NamaBahan,
       b.Bhn_satuan AS Satuan, d.mkbd_babaran AS Babaran,
       d.mkbd_jumlah AS Kebutuhan
     FROM tmkb_dtl d
     INNER JOIN tmkb_hdr h ON h.mkb_nomor = d.mkbd_mkb_nomor
     LEFT JOIN tbahan b ON b.Bhn_kode = d.mkbd_bhn_kode
     WHERE h.mkb_spk_nomor = ?
     ORDER BY d.mkbd_nourut`,
    [spkNomor],
  );
  return rows;
};

// ─────────────────────────────────────────────
// Cabang dropdown — replika persis FormCreate Delphi (cbCab.Items):
// user P01 → cuma P01; user P04 → cuma P04; user HO ('' ATAU 'HO-')
// → P04,P01 dgn P04 default; cabang lain → kosong.
// [FIX] Sebelumnya cuma cek falsy (''), padahal representasi HO di
// project ini bisa '' ATAU 'HO-' (lihat konvensi frmMenu.cab).
// ─────────────────────────────────────────────
const getCabangOptions = (userCabang) => {
  if (userCabang === "P01") return { options: ["P01"], default: "P01" };
  if (userCabang === "P04") return { options: ["P04"], default: "P04" };
  if (!userCabang || userCabang === "HO-") {
    return { options: ["P04", "P01"], default: "P04" };
  }
  return { options: [], default: "" };
};

const getFormInit = async (userCabang) => {
  const sizeList = await getMasterSizeList();
  const { options, default: defaultCabang } = getCabangOptions(userCabang);
  return {
    cabangOptions: options,
    defaultCabang,
    detailPo: sizeList.map((sz) => ({
      Size: sz,
      Jumlah: 0,
      Tarif: 0,
      Total: 0,
    })),
  };
};

// ─────────────────────────────────────────────
// GET FORM (mode edit) — replika persis loaddataall Delphi
// ─────────────────────────────────────────────
const getForm = async (nomor) => {
  const query = `
    SELECT h.*,
      IFNULL(s.spk_nama, m.mspk_nama) AS NamaSPK,
      IFNULL(s.spk_kain, m.mspk_kain) AS Bahan,
      IFNULL(s.spk_gramasi, m.mspk_gramasi) AS Gramasi,
      IFNULL(s.spk_finishing, m.mspk_finishing) AS Finishing,
      IFNULL(s.spk_ukuran, m.mspk_ukuran) AS Ukuran,
      IFNULL(s.spk_jumlah, m.mspk_jumlah) AS JumlahSpk,
      IFNULL(s.spk_cab, m.mspk_cab) AS SpkCab
      u.sup_nama AS SupNama, u.sup_alamat AS SupAlamat, u.sup_kota AS SupKota
    FROM tpoexternal_hdr h
    LEFT JOIN tspk s ON s.spk_nomor = h.poe_spk_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = h.poe_spk_nomor
    LEFT JOIN tsupplier u ON u.sup_kode = h.poe_sup
    WHERE h.poe_cab IN (${CAB_LIST.map(() => "?").join(",")}) AND h.poe_nomor = ?
  `;
  const [[header]] = await db.query(query, [...CAB_LIST, nomor]);
  if (!header) throw new Error("Nomor tersebut belum ada.");

  // Detail PO (grid ukuran) — merge master size list dgn baris tersimpan
  const sizeList = await getMasterSizeList();
  const [dtlRows] = await db.query(
    `SELECT poed_size AS Size, poed_jumlah AS Jumlah, poed_tarif AS Tarif
     FROM tpoexternal_dtl WHERE poed_nomor = ?`,
    [nomor],
  );
  const dtlMap = new Map(dtlRows.map((r) => [r.Size, r]));
  const detailPo = sizeList.map((sz) => {
    const saved = dtlMap.get(sz);
    const jumlah = saved ? Number(saved.Jumlah) : 0;
    const tarif = saved ? Number(saved.Tarif) : 0;
    return { Size: sz, Jumlah: jumlah, Tarif: tarif, Total: jumlah * tarif };
  });

  // DP (grid detail2)
  const [detailDp] = await db.query(
    `SELECT d.poed2_tanggal AS Tanggal, d.poed2_nominal AS Nominal,
       d.poed2_akun AS Akun, r.rek_nama AS NamaBank, d.poed2_link AS NoLink
     FROM tpoexternal_dtl2 d
     LEFT JOIN finance.trekening r ON r.rek_kode = d.poed2_akun
     WHERE d.poed2_nomor = ?
     ORDER BY d.poed2_tanggal`,
    [nomor],
  );

  const komponen = await getKomponenBySpk(header.poe_spk_nomor);
  const mkbNomor = komponen.length > 0 ? komponen[0].Mkb : "";

  const { status: statusEdit, urut } = await getStatusPengajuan(
    nomor,
    header.poe_tanggal,
  );

  return {
    Nomor: header.poe_nomor,
    Tanggal: header.poe_tanggal,
    DatelinePO: header.poe_dateline,
    Cab: header.poe_cab,
    NomorSPK: header.poe_spk_nomor,
    NamaSPK: header.NamaSPK,
    Bahan: header.Bahan,
    Ukuran: header.Ukuran,
    Gramasi: header.Gramasi,
    Finishing: header.Finishing,
    JumlahSpk: header.JumlahSpk,
    NomorMkb: mkbNomor,
    AdaGambar: checkGambarExists(header.poe_spk_nomor, header.SpkCab),
    SpkCab: header.SpkCab || "HO-",
    SupKode: header.poe_sup,
    SupNama: header.SupNama,
    SupAlamat: header.SupAlamat,
    SupKota: header.SupKota,
    Ket: header.poe_ket,
    Status: header.poe_status, // OPEN/PROSES/CLOSE — gate ubah SPK & Jumlah di FE
    BahanSendiri: header.poe_bahansendiri === "Y",
    TarifSama: header.poe_tarifsama === "Y",
    NominalPO: Number(header.poe_total),
    DetailPo: detailPo,
    DetailDp: detailDp,
    Komponen: komponen,
    StatusEdit: statusEdit,
    UrutPin5: urut,
  };
};

// ─────────────────────────────────────────────
// LOOKUP SPK — replika persis edtNomorSPKExit Delphi.
// isNewMode menentukan apakah Gramasi/Finishing/Ket ikut ditarik dari
// SPK (Delphi: `if FLAGEDIT=False then ...`) — di mode edit, field2
// itu TIDAK di-overwrite walau SPK diganti.
// ─────────────────────────────────────────────
const getSpkDetail = async (spkNomor, isNewMode) => {
  const [[spk]] = await db.query(
    `SELECT s.*, IFNULL(h.mkb_nomor, "") AS mkb
     FROM tspk s
     LEFT JOIN tmkb_hdr h ON h.mkb_spk_nomor = s.spk_nomor
     WHERE s.spk_divisi IN (3,4,6) AND s.spk_aktif = "Y" AND s.spk_nomor = ?`,
    [spkNomor],
  );
  if (!spk) {
    const err = new Error("Nomor Spk tsb tidak ada.");
    err.code = "SPK_NOT_FOUND";
    throw err;
  }
  if (spk.spk_cmo === "") {
    const err = new Error("SPK tsb belum di approve oleh Chief Marketing.");
    err.code = "SPK_NOT_APPROVED";
    throw err;
  }

  const result = {
    NamaSPK: spk.spk_nama,
    Bahan: spk.spk_kain,
    Ukuran: spk.spk_ukuran,
    JumlahSpk: spk.spk_jumlah,
    NomorMkb: spk.mkb,
    AdaGambar: checkGambarExists(spkNomor, spk.spk_cab),
    SpkCab: spk.spk_cab || "HO-",
    // replika: if edtMkb.Text='' then ckBahan:=False else ckBahan:=True
    BahanSendiri: !!spk.mkb,
    Komponen: spk.mkb ? await getKomponenBySpk(spkNomor) : [],
  };

  if (isNewMode) {
    result.Gramasi = spk.spk_gramasi;
    result.Finishing = spk.spk_finishing;
    result.Ket = spk.spk_keterangan;

    // prefill Detail PO dari tspk_size (hanya di mode Baru)
    const [sizeRows] = await db.query(
      `SELECT spks_size AS Size, spks_qty AS Jumlah FROM tspk_size WHERE spks_nomor = ?`,
      [spkNomor],
    );
    const sizeMap = new Map(sizeRows.map((r) => [r.Size, Number(r.Jumlah)]));
    const masterSizes = await getMasterSizeList();
    result.DetailPo = masterSizes.map((sz) => ({
      Size: sz,
      Jumlah: sizeMap.get(sz) || 0,
      Tarif: 0,
      Total: 0,
    }));
  }

  return result;
};

// ─────────────────────────────────────────────
// LOOKUP SUPPLIER — replika persis edtSupKodeExit Delphi
// ─────────────────────────────────────────────
const getSupplierDetail = async (kode) => {
  const [[row]] = await db.query(
    `SELECT sup_kode, sup_nama, sup_alamat, sup_kota
     FROM tsupplier WHERE sup_aktif = "Y" AND sup_kode = ?`,
    [kode],
  );
  if (!row) {
    const err = new Error("Kode Supplier tidak ditemukan");
    err.code = "SUPPLIER_NOT_FOUND";
    throw err;
  }
  return {
    SupKode: row.sup_kode,
    SupNama: row.sup_nama,
    SupAlamat: row.sup_alamat,
    SupKota: row.sup_kota,
  };
};

// ─────────────────────────────────────────────
// getbayar — replika persis
// ─────────────────────────────────────────────
const getBayarExists = async (nomor) => {
  const [rows] = await db.query(
    `SELECT 1 FROM tvoucher_dtl WHERE voud_nota = ? LIMIT 1`,
    [nomor],
  );
  return rows.length > 0;
};

// ─────────────────────────────────────────────
// getmaxnomor — replika persis, pakai FOR UPDATE dalam transaksi
// (pola sama dgn helper counter modul lain, hindari race condition)
// ─────────────────────────────────────────────
const getMaxNomor = async (conn, tanggal) => {
  const year = new Date(tanggal).getFullYear();
  const prefix = `POE.${year}`;
  const [[row]] = await conn.query(
    `SELECT IFNULL(MAX(RIGHT(poe_nomor,5)),0) AS maxNomor
     FROM tpoexternal_hdr WHERE LEFT(poe_nomor,8) = ? FOR UPDATE`,
    [prefix],
  );
  const next = Number(row.maxNomor) + 1;
  return prefix + String(next).padStart(5, "0");
};

// ─────────────────────────────────────────────
// SIMPAN — replika persis simpandata + urutan validasi FormKeyDown(F10)
// [DEVIASI SENGAJA]: poe_total dihitung ulang di server dari
// DetailPo (bukan trust nilai dari client) — sama-sama hasil SUM
// jumlah*tarif, cuma dipindah ke server biar ga bisa ditembak dari FE.
// ─────────────────────────────────────────────
const save = async (data, isNewMode, userKode) => {
  const {
    Nomor,
    Tanggal,
    DatelinePO,
    Cab,
    NomorSPK,
    SupKode,
    Ket,
    BahanSendiri,
    TarifSama,
    DetailPo = [],
    DetailDp = [],
  } = data;

  // 1) cek status pengajuan (existing) / tutup buku (baru)
  let statusPengajuan = { status: "", urut: 0 };
  if (!isNewMode) {
    statusPengajuan = await getStatusPengajuan(Nomor, Tanggal);
    if (["MINTA", "WAIT", "TOLAK"].includes(statusPengajuan.status)) {
      throw new Error(
        "Transaksi tsb sudah diclose.\nSilahkan minta approve untuk bisa menyimpan perubahan data.",
      );
    }
    // status === "ACC" atau "" (blm/tdk tutup buku) → boleh lanjut
  } else if (await isTutupBuku(Tanggal)) {
    throw new Error(
      "Anda tidak boleh input di tanggal periode yg sudah diclose.",
    );
  }

  // 2) dateline >= tanggal
  if (new Date(DatelinePO) < new Date(Tanggal)) {
    throw new Error("Dateline PO tidak boleh sebelum Tanggal.");
  }
  // 3) SPK wajib
  if (!NomorSPK || !NomorSPK.trim()) {
    throw new Error("Nomor SPK harus diisi.");
  }
  // 4) Supplier wajib
  if (!SupKode || !SupKode.trim()) {
    throw new Error("Supplier belum diisi.");
  }
  // 5) sudah ada pembayaran → block edit
  if (!isNewMode && (await getBayarExists(Nomor))) {
    throw new Error("PO tsb sudah ada pembayaran.\nTidak bisa disimpan.");
  }

  // filter baris valid — replika persis: jumlah<>0 (size), tanggal terisi (DP)
  const validDetailPo = DetailPo.filter((r) => Number(r.Jumlah) !== 0);
  const validDetailDp = DetailDp.filter((r) => r.Tanggal);
  const total = validDetailPo.reduce(
    (sum, r) => sum + Number(r.Jumlah) * Number(r.Tarif),
    0,
  );

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomor = Nomor;
    if (isNewMode) {
      nomor = await getMaxNomor(conn, Tanggal);
      // ⚠️ ASUMSI poe_status punya DEFAULT 'OPEN' di DB (Delphi tidak
      // set kolom ini eksplisit saat insert) — di sini di-set eksplisit
      // biar ga tergantung default, tolong konfirmasi kalau beda.
      await conn.query(
        `INSERT INTO tpoexternal_hdr
           (poe_nomor, poe_tanggal, poe_dateline, poe_spk_nomor, poe_cab,
            poe_sup, poe_ket, poe_total, poe_tarifsama, poe_bahansendiri,
            poe_status, date_create, user_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "OPEN", NOW(), ?)`,
        [
          nomor,
          Tanggal,
          DatelinePO,
          NomorSPK,
          Cab,
          SupKode,
          Ket || "",
          total,
          TarifSama ? "Y" : "N",
          BahanSendiri ? "Y" : "N",
          userKode,
        ],
      );
    } else {
      await conn.query(
        `UPDATE tpoexternal_hdr SET
           poe_tanggal = ?, poe_dateline = ?, poe_spk_nomor = ?, poe_cab = ?,
           poe_sup = ?, poe_total = ?, poe_ket = ?, poe_tarifsama = ?,
           poe_bahansendiri = ?, date_modified = NOW(), user_modified = ?
         WHERE poe_nomor = ?`,
        [
          Tanggal,
          DatelinePO,
          NomorSPK,
          Cab,
          SupKode,
          total,
          Ket || "",
          TarifSama ? "Y" : "N",
          BahanSendiri ? "Y" : "N",
          userKode,
          nomor,
        ],
      );
    }

    await conn.query(`DELETE FROM tpoexternal_dtl WHERE poed_nomor = ?`, [
      nomor,
    ]);
    let i = 0;
    for (const r of validDetailPo) {
      i += 1;
      await conn.query(
        `INSERT INTO tpoexternal_dtl (poed_nomor, poed_size, poed_jumlah, poed_tarif, poed_nourut)
         VALUES (?, ?, ?, ?, ?)`,
        [nomor, r.Size, r.Jumlah, r.Tarif, i],
      );
    }

    // Catatan: sama spt Delphi, delete+reinsert dtl2 ga bawa poed2_link
    // ikut. Ini AMAN karena getBayarExists sudah block save begitu ada
    // voucher (yg presumably ngisi poed2_link) — jadi ga pernah kejadian
    // link ke-reset sambil masih bisa disave.
    await conn.query(`DELETE FROM tpoexternal_dtl2 WHERE poed2_nomor = ?`, [
      nomor,
    ]);
    for (const r of validDetailDp) {
      await conn.query(
        `INSERT INTO tpoexternal_dtl2 (poed2_nomor, poed2_tanggal, poed2_nominal, poed2_akun)
         VALUES (?, ?, ?, ?)`,
        [nomor, r.Tanggal, r.Nominal, r.Akun || ""],
      );
    }

    if (!isNewMode && statusPengajuan.status === "ACC") {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai = "Y"
         WHERE pin_trs = ? AND pin_nomor = ? AND pin_urut = ?`,
        [PIN_TRS, nomor, statusPengajuan.urut],
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

// ─────────────────────────────────────────────
// CETAK — replika persis query cetak() Delphi.
// Catatan field "Kain" di Delphi agak menyesatkan namanya: itu BUKAN
// jenis bahan header (yg sudah ada di field "Bahan"/spk_kain), tapi
// daftar komponen dari MKB terkait SPK (Komponen: NamaBahan, Babaran)
// digabung jadi 1 blok teks multi-baris. Kosong kalau SPK-nya ga
// punya MKB (spt di contoh PO yg baru dites).
// ─────────────────────────────────────────────
const getCetak = async (nomor) => {
  const [[header]] = await db.query(
    `SELECT h.*,
        IFNULL(s.spk_nama, m.mspk_nama) AS NamaSPK,
        IFNULL(s.spk_cab, m.mspk_cab) AS SpkCab,
        IFNULL(s.spk_kain, m.mspk_kain) AS Bahan,
        IFNULL(s.spk_finishing, m.mspk_finishing) AS Finishing,
        IFNULL(s.spk_gramasi, m.mspk_gramasi) AS Gramasi,
        u.sup_nama AS SupNama, u.sup_alamat AS SupAlamat, u.sup_kota AS SupKota
     FROM tpoexternal_hdr h
     LEFT JOIN tspk s ON s.spk_nomor = h.poe_spk_nomor
     LEFT JOIN tmemospk m ON m.mspk_nomor = h.poe_spk_nomor
     LEFT JOIN tsupplier u ON u.sup_kode = h.poe_sup
     WHERE h.poe_nomor = ?`,
    [nomor],
  );
  if (!header) throw new Error("Data PO External tidak ditemukan.");

  const [detail] = await db.query(
    `SELECT poed_size AS Size, poed_jumlah AS Jumlah, poed_tarif AS Tarif,
        (poed_jumlah * poed_tarif) AS Total
     FROM tpoexternal_dtl WHERE poed_nomor = ? ORDER BY poed_nourut`,
    [nomor],
  );

  // Komponen MKB (field "Kain" versi Delphi) — subquery GROUP_CONCAT
  let kain = "";
  const [mkbRow] = await db.query(
    `SELECT h.mkb_nomor FROM tmkb_hdr h WHERE h.mkb_spk_nomor = ? LIMIT 1`,
    [header.poe_spk_nomor],
  );
  if (mkbRow.length > 0) {
    const [rows] = await db.query(
      `SELECT CONCAT(dd.mkbd_komponen, ": ", bb.Bhn_Name, ", Babaran: ",
          dd.mkbd_babaran, " (", bb.Bhn_satuan, ")") AS abc
       FROM tmkb_dtl dd
       LEFT JOIN tbahan bb ON bb.Bhn_kode = dd.mkbd_bhn_kode
       WHERE dd.mkbd_mkb_nomor = ?`,
      [mkbRow[0].mkb_nomor],
    );
    kain = rows.map((r) => r.abc).join("\r\n");
  }

  const total = detail.reduce(
    (s, r) => s + Number(r.Jumlah) * Number(r.Tarif),
    0,
  );

  return {
    Nomor: header.poe_nomor,
    Tanggal: header.poe_tanggal,
    DatelinePO: header.poe_dateline,
    NamaSPK: header.NamaSPK,
    Bahan: header.Bahan,
    Finishing: header.Finishing,
    Gramasi: header.Gramasi,
    SupNama: header.SupNama,
    SupAlamat: header.SupAlamat,
    SupKota: header.SupKota,
    Ket: header.poe_ket,
    Kain: kain,
    AdaGambar: checkGambarExists(header.poe_spk_nomor, header.SpkCab),
    SpkCab: header.SpkCab || "HO-",
    NomorSPK: header.poe_spk_nomor,
    Detail: detail,
    Total: total,
  };
};

module.exports = {
  getFormInit,
  getForm,
  getSpkDetail,
  getSupplierDetail,
  save,
  getCetak,
};
