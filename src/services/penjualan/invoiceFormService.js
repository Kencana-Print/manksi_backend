const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

const TANGGAL_CUTOFF_SJ = "2020-08-24";

// ─────────────────────────────────────────────────────────
// GENERATE NOMOR INVOICE
// Format: ING/{kodePerush}/{NNNNN}/{YYYY}
// ─────────────────────────────────────────────────────────
const generateNomor = async (kodePerush, tanggal, conn) => {
  const tahun = new Date(tanggal).getFullYear();
  const prefix = `ING/${kodePerush}`;

  const [[row]] = await conn.query(
    `SELECT IFNULL(MAX(CAST(SUBSTR(inv_nomor, 8, 5) AS UNSIGNED)), 0) AS max_val
     FROM tinv_hdr
     WHERE LEFT(inv_nomor, 6) = ?
       AND RIGHT(inv_nomor, 4) = ?
     FOR UPDATE`,
    [prefix, String(tahun)],
  );
  const next = parseInt(row.max_val, 10) + 1;
  return `${prefix}/${String(next).padStart(5, "0")}/${tahun}`;
};

// ─────────────────────────────────────────────────────────
// GET BY NOMOR (load edit — loaddataall)
// ─────────────────────────────────────────────────────────
const getById = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT
       a.inv_nomor, DATE_FORMAT(a.inv_tanggal,'%Y-%m-%d') AS inv_tanggal,
       a.inv_divisi, a.inv_keterangan,
       a.inv_perush_kode, p.perush_nama,
       a.inv_cus_kode, c.cus_nama, c.cus_alamat, c.cus_kota,
       a.inv_cus_alamat,
       DATE_FORMAT(a.inv_tanggal_tempo,'%Y-%m-%d') AS inv_tanggal_tempo,
       a.inv_rekening, pd.perushd_bank, pd.perushd_atasnama,
       a.inv_invpro,
       a.inv_sts_ppn, a.inv_ppn, a.inv_pph,
       a.inv_disc, a.inv_flag, a.inv_apvnosj,
       a.inv_no_fp
     FROM tinv_hdr a
     INNER JOIN tperusahaan p ON p.perush_kode = a.inv_perush_kode
     INNER JOIN tcustomer c ON c.cus_kode = a.inv_cus_kode
     LEFT JOIN tperusahaan_dtl pd
       ON pd.perushd_perush_kode = p.perush_kode
       AND pd.perushd_rekening = a.inv_rekening
     WHERE a.inv_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Nomor tersebut belum ada.");

  // ── Uang Muka — sesuai Delphi hitung() yang selalu panggil getdebet() ──
  hdr.uang_muka = await getDebet(nomor);

  // Detail — sesuai Delphi loaddataall, JOIN tspk + tbarang
  const [dtl] = await db.query(
    `SELECT
       d.invd_sj_nomor, d.invd_spk_nomor, d.invd_ukuran,
       d.invd_jumlah, d.invd_harga, d.invd_nourut,
       IFNULL(s.spk_nama2, x.brg_name) AS spk_nama2,
       (s.spk_jumlah_inv - d.invd_jumlah) AS jml_inv,
       (s.spk_jumlah - s.spk_jumlah_inv + d.invd_jumlah) AS kurang
     FROM tinv_dtl d
     LEFT JOIN tspk s ON s.spk_nomor = d.invd_spk_nomor
     LEFT JOIN tbarang x ON x.brg_kode = d.invd_spk_nomor
     WHERE d.invd_inv_nomor = ?
     ORDER BY d.invd_nourut, d.invd_sj_nomor DESC`,
    [nomor],
  );

  // Untuk tiap baris — cek isSPK, lalu re-fetch daftar SJ terkait (getsj)
  for (const row of dtl) {
    const soCheck = await isSpk(row.invd_spk_nomor);
    if (soCheck) {
      row.sjList = await getSjForSpk(row.invd_spk_nomor, hdr.inv_perush_kode);
    } else {
      row.sjList = "-";
    }
  }

  // PIN5 status
  const [[pin5]] = await db.query(
    `SELECT pin_urut, pin_acc, pin_dipakai, pin_alasan
     FROM tspk_pin5
     WHERE pin_trs = 'INV' AND pin_nomor = ?
     ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );
  let xminta5 = "";
  let xurut5 = 0;
  if (pin5) {
    xurut5 = pin5.pin_urut;
    if (!pin5.pin_acc && !pin5.pin_dipakai) xminta5 = "WAIT";
    else if (pin5.pin_acc === "Y" && !pin5.pin_dipakai) xminta5 = "ACC";
    else if (pin5.pin_acc === "N") xminta5 = "TOLAK";
    else if (pin5.pin_acc === "Y" && pin5.pin_dipakai === "Y")
      xminta5 = ""; // sudah dipakai — closed loop, tidak perlu approval baru
    else xminta5 = "MINTA";
  }

  // Cek status tutup buku — pola sama seperti SJ
  const tglTrs = new Date(hdr.inv_tanggal);
  const zMonth = tglTrs.getMonth();
  const zYear = tglTrs.getFullYear();
  let ztglclose = 0;
  const [verRows] = await db.query(
    `SELECT tgl_close FROM tversi WHERE aplikasi = 'MANKSI' LIMIT 1`,
  );
  if (verRows.length > 0) ztglclose = parseInt(verRows[0].tgl_close, 10) || 0;
  const limitDate = new Date(zYear, zMonth + 1, ztglclose);
  limitDate.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const zCloseManual = await tutupBukuService.getManualTutupBuku("INV");
  let isTutupBuku = false;
  if (zCloseManual) {
    zCloseManual.setHours(0, 0, 0, 0);
    if (tglTrs < zCloseManual) isTutupBuku = true;
  } else {
    if (limitDate < today) isTutupBuku = true;
  }
  hdr.isTutupBuku = isTutupBuku;

  return { header: hdr, detail: dtl, xminta5, xurut5 };
};

// ─────────────────────────────────────────────────────────
// CEK STATUS PELUNASAN — sesuai Delphi cekstatuspelunasan
// ─────────────────────────────────────────────────────────
const cekStatusPelunasan = async (nomor) => {
  const total = await getDebet(nomor);
  return total > 0;
};

// ─────────────────────────────────────────────────────────
// GET DEBET (uang muka) — sesuai Delphi getdebet
// ─────────────────────────────────────────────────────────
const getDebet = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT IFNULL(SUM(kredit), 0) AS total_kredit
     FROM piutang_kredit_detail WHERE nota = ?`,
    [nomor],
  );
  return row ? Number(row.total_kredit) || 0 : 0;
};

// ─────────────────────────────────────────────────────────
// IS SPK — cek apakah kode adalah SO aktif (bukan SPK turunan)
// FIX: UNION-aware — SO bisa ada di tsalesorder (baru) ATAU
// tspk legacy (spk_is_so=1, data lama pre-migrasi). Sebelumnya
// cuma cek tspk, jadi SO baru selalu dianggap "bukan SO".
// ─────────────────────────────────────────────────────────
const isSpk = async (kode) => {
  const [newRows] = await db.query(
    `SELECT so_nomor FROM tsalesorder WHERE so_nomor = ?`,
    [kode],
  );
  if (newRows.length > 0) return true;

  const [[row]] = await db.query(
    `SELECT spk_nomor FROM tspk WHERE spk_nomor = ?`,
    [kode],
  );
  return !!row;
};

// ─────────────────────────────────────────────────────────
// GET SJ LIST untuk SO tertentu — tidak berubah, SPK turunan
// (spk_so_ref) selalu hidup di tspk apapun sumber SO-nya.
// ─────────────────────────────────────────────────────────
const getSjForSpk = async (soNomor, perushKode) => {
  const [rows] = await db.query(
    `SELECT DISTINCT d.sjd_sj_nomor
     FROM tsj_dtl d
     INNER JOIN tsj_hdr h ON h.sj_nomor = d.sjd_sj_nomor AND h.sj_perush_kode = ?
     LEFT JOIN tspk turunan ON turunan.spk_nomor = d.sjd_spk_nomor AND turunan.spk_is_so = 0
     WHERE d.sjd_spk_nomor = ? OR turunan.spk_so_ref = ?`,
    [perushKode, soNomor, soNomor],
  );
  return rows.map((r) => r.sjd_sj_nomor).join(",");
};

// ─────────────────────────────────────────────────────────
// SEARCH BARANG/SPK untuk modal F1 di grid
// FIX: UNION-aware — kode barang (brg_kode) yang merujuk ke SO
// aktif sekarang bisa cocok ke tsalesorder ATAU tspk legacy.
// Sebelumnya cuma cek tspk, jadi SO baru gak pernah match filter
// perusahaan/customer, sehingga selalu lolos sebagai "barang non-SO"
// (Kurang/JmlInv selalu 0) meski sebenarnya SO valid.
// ─────────────────────────────────────────────────────────
const searchBarang = async (
  perushKode,
  cusKode,
  q = "",
  page = 1,
  limit = 50,
) => {
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;
  const like = `%${q}%`;

  // ── Cabang 1: barang master reguler — SO check HANYA dari tsalesorder ──
  let whereBarang = `(
  NOT EXISTS (
    SELECT 1 FROM tsalesorder so WHERE so.so_nomor = b.brg_kode
  )
  OR EXISTS (
    SELECT 1 FROM tsalesorder so
    WHERE so.so_nomor = b.brg_kode
      AND so.so_perush_kode = ?
      AND so.so_cus_kode = ?
  )
)`;
  const paramsBarang = [perushKode, cusKode];

  if (q) {
    whereBarang += ` AND (b.brg_kode LIKE ? OR b.brg_name LIKE ?)`;
    paramsBarang.push(like, like);
  }

  // ── Cabang 2 (BARU): SPK turunan custom job — spk_is_so = 0 ──
  let whereSpk = `
    WHERE s2.spk_is_so = 0
      AND s2.spk_perush_kode = ?
      AND s2.spk_cus_kode = ?
  `;
  const paramsSpk = [perushKode, cusKode];

  if (q) {
    whereSpk += ` AND (s2.spk_nomor LIKE ? OR s2.spk_nama LIKE ?)`;
    paramsSpk.push(like, like);
  }

  // ── Count gabungan ──
  const [[{ total }]] = await db.query(
    `SELECT
      (SELECT COUNT(*) FROM tbarang b WHERE ${whereBarang})
      +
      (SELECT COUNT(*) FROM tspk s2 ${whereSpk})
      AS total`,
    [...paramsBarang, ...paramsSpk],
  );

  const [rows] = await db.query(
    `SELECT b.brg_kode AS Kode, b.brg_name AS Nama,
            b.brg_ukuran AS Ukuran, b.brg_harga AS Harga
     FROM tbarang b
     WHERE ${whereBarang}

     UNION ALL

    SELECT s2.spk_nomor AS Kode, s2.spk_nama AS Nama,
           s2.spk_ukuran AS Ukuran, s2.spk_harga AS Harga
     FROM tspk s2
     ${whereSpk}

     ORDER BY Kode
     LIMIT ? OFFSET ?`,
    [...paramsBarang, ...paramsSpk, limitNum, offset],
  );

  return { items: rows, total, page: Number(page), limit: limitNum };
};

// ─────────────────────────────────────────────────────────
// LOAD DETAIL BARANG (saat barang dipilih dari modal/manual)
// FIX 2: sekarang juga fallback ke SPK custom job (spk_is_so = 0)
// kalau kode tidak ditemukan di tbarang — item seperti banner/custom
// yang murni turunan SPK, tidak punya representasi di tbarang.
// Jumlah/Kurang untuk item custom diambil langsung dari
// spk_jumlah - spk_jumlah_inv (SPK ini sendiri yang nyimpan qty,
// bukan lewat SO induk).
// ─────────────────────────────────────────────────────────
const loadBarangDetail = async (kode, perushKode) => {
  const [[barang]] = await db.query(
    `SELECT brg_kode, brg_name, brg_ukuran, brg_harga FROM tbarang WHERE brg_kode = ?`,
    [kode],
  );

  let itemInfo;
  let jumlahTotal = 0;
  let jumlahInv = 0;

  if (barang) {
    // ── Cabang 1: barang master reguler (logic lama, tidak berubah) ──
    itemInfo = {
      Kode: barang.brg_kode,
      Nama: barang.brg_name,
      Ukuran: barang.brg_ukuran,
      Harga: barang.brg_harga,
    };

    const [[soNew]] = await db.query(
      `SELECT
          so.so_jumlah AS jumlah_total,
          IFNULL((
            SELECT SUM(d.invd_jumlah)
            FROM tinv_dtl d
            WHERE d.invd_spk_nomor = so.so_nomor
          ), 0) AS jumlah_inv
       FROM tsalesorder so
       WHERE so.so_nomor = ? AND so.so_aktif = 'Y'`,
      [kode],
    );

    const [[soLegacy]] = !soNew
      ? await db.query(
          `SELECT spk_jumlah AS jumlah_total, spk_jumlah_inv AS jumlah_inv
           FROM tspk WHERE spk_nomor = ? AND spk_is_so = 1 AND spk_aktif = 'Y'`,
          [kode],
        )
      : [[null]];

    const so = soNew || soLegacy;
    if (so) {
      jumlahTotal = Number(so.jumlah_total) || 0;
      jumlahInv = Number(so.jumlah_inv) || 0;
    }
  } else {
    // ── Cabang 2 (BARU): SPK turunan custom job — spk_is_so = 0 ──
    // Kode/nama custom (banner, dsb) tidak ada di tbarang, cuma di tspk.
    // Jumlah/Kurang dihitung langsung dari SPK ini (bukan via SO induk),
    // karena SPK turunan punya spk_jumlah/spk_jumlah_inv sendiri.
    const [[spkCustom]] = await db.query(
      `SELECT spk_nomor, spk_nama, spk_ukuran, spk_harga,
        spk_jumlah, spk_jumlah_inv
       FROM tspk
       WHERE spk_nomor = ?
        AND spk_is_so = 0
        AND spk_perush_kode = ?
        AND spk_aktif = 'Y'`,
      [kode, perushKode],
    );
    if (!spkCustom) throw new Error("Barang Tidak di temukan.");

    itemInfo = {
      Kode: spkCustom.spk_nomor,
      Nama: spkCustom.spk_nama, // ← ganti dari spk_nama2
      Ukuran: spkCustom.spk_ukuran,
      Harga: spkCustom.spk_harga,
    };
    jumlahTotal = Number(spkCustom.spk_jumlah) || 0;
    jumlahInv = Number(spkCustom.spk_jumlah_inv) || 0;
  }

  const spkAda = await isSpk(kode);
  let sjList = "-";
  if (spkAda) {
    sjList = await getSjForSpk(kode, perushKode);
  }

  const sisa = jumlahTotal - jumlahInv;

  return {
    Kode: itemInfo.Kode,
    Nama: itemInfo.Nama,
    Ukuran: itemInfo.Ukuran,
    Jumlah: sisa,
    Harga: itemInfo.Harga,
    Total: Number(itemInfo.Harga) * sisa,
    SjNomor: sjList,
    JmlInv: jumlahInv,
    Kurang: sisa,
  };
};

// ─────────────────────────────────────────────────────────
// GET ADA SJ — tidak berubah, logic-nya tetap sama
// karena cuma cek field SjNomor di level row, bukan struktur DB
// ─────────────────────────────────────────────────────────
const cekAdaSjSemua = (detail) => {
  for (const row of detail) {
    const namaSpk = row.NamaSpk || row.spk_nama2 || "";
    const sjNomor = row.SjNomor ?? "";
    if (namaSpk && sjNomor === "") {
      return false;
    }
  }
  return true;
};

// ─────────────────────────────────────────────────────────
// CEK IN TINV_FLAG (invoice tidak normal) — sesuai cekinINT
// ─────────────────────────────────────────────────────────
const cekInINT = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT invf_normal FROM tinv_flag WHERE invf_normal = ?`,
    [nomor],
  );
  return !!row;
};

// ─────────────────────────────────────────────────────────
// CEK TUTUP BUKU — sesuai pola SJ
// ─────────────────────────────────────────────────────────
const cekTutupBuku = async (tanggal, xminta5 = "") => {
  if (["MINTA", "WAIT", "TOLAK"].includes(xminta5)) {
    return {
      boleh: false,
      message:
        "Transaksi tsb sudah diclose.\nSilahkan minta approve untuk bisa menyimpan perubahan data.",
    };
  }
  if (xminta5 === "ACC") return { boleh: true };

  const tgl = new Date(tanggal);
  const zMonth = tgl.getMonth();
  const zYear = tgl.getFullYear();

  let ztglclose = 0;
  const [verRows] = await db.query(
    `SELECT tgl_close FROM tversi WHERE aplikasi = 'MANKSI' LIMIT 1`,
  );
  if (verRows.length > 0) ztglclose = parseInt(verRows[0].tgl_close, 10) || 0;

  const limitDate = new Date(zYear, zMonth + 1, ztglclose);
  limitDate.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const zCloseManual = await tutupBukuService.getManualTutupBuku("INV");

  let boleh = true;
  if (zCloseManual) {
    zCloseManual.setHours(0, 0, 0, 0);
    if (tgl < zCloseManual) boleh = false;
  } else {
    if (limitDate < today) boleh = false;
  }

  if (!boleh) {
    return {
      boleh: false,
      message: "Anda tidak boleh input di tanggal periode yg sudah diclose.",
    };
  }
  return { boleh: true };
};

// ─────────────────────────────────────────────────────────
// SAVE — sesuai Delphi simpandata
// ─────────────────────────────────────────────────────────
const save = async (data, userKode, isNew) => {
  const {
    Divisi,
    KodePerush,
    Tanggal,
    Keterangan,
    KodeCus,
    AlamatCus,
    TanggalTempo,
    RekBank = "",
    InvPro = "",
    StsPpn = 0,
    Ppn = 0,
    Pph = "",
    Disc: DiscRaw = 0,
    Detail = [],
    NomorInv = "",
    Xminta5 = "",
    Xurut5 = 0,
    ApvOverride,
  } = data;

  const Disc = Number(DiscRaw) || 0;

  // ── Validasi dasar ──────────────────────────────────────
  if (!KodePerush) throw new Error("Perusahaan belum di isi.");
  if (!KodeCus) throw new Error("Customer belum di isi.");

  const validDetail = Detail.filter((r) => r.NamaSpk || r.Kode);
  if (!validDetail.length)
    throw new Error("Tidak ada detail, tidak dapat di simpan.");

  // Cek tutup buku dulu — hasilnya juga dipakai utk keputusan gate
  // pelunasan di bawah (bukan cuma buat error periode di akhir).
  const tutupBuku = await cekTutupBuku(Tanggal, Xminta5);

  // Cek status pelunasan saat edit — HANYA diblokir kalau periode
  // invoice ini SUDAH closing (tutupBuku.boleh === false). Selama masih
  // dalam periode terbuka (bulan berjalan) atau sudah ACC pengajuan
  // perubahan, invoice yang sudah dibuat pelunasan tetap boleh diedit —
  // gate ini cuma relevan buat mencegah edit invoice lunas di periode
  // yang sudah closing dan belum diajukan perubahannya.
  if (!isNew) {
    const sudahLunas = await cekStatusPelunasan(NomorInv);
    if (sudahLunas && !tutupBuku.boleh) {
      throw new Error(
        "Invoice ini sudah dibuat pelunasan, tidak bisa di edit.",
      );
    }
  }

  if (!tutupBuku.boleh) {
    throw new Error(tutupBuku.message);
  }

  const divisiStr = String(Divisi).charAt(0);

  // ── Logic apv & pro — sesuai Delphi simpandata ──────────
  // ⚠️ FIX: sebelumnya `apv` HANYA dari ApvOverride (parameter luar).
  // Kalau ApvOverride tidak dikirim, apv selalu "" — sehingga invoice
  // yang SUDAH PERNAH di-ACC (inv_apvnosj berisi timestamp ACC, bukan
  // "N"/"T") dianggap seolah belum pernah diajukan, dan approval
  // diminta ulang setiap kali header diedit walau kondisi SJ tidak
  // berubah. Sekarang: kalau ApvOverride tidak dikirim eksplisit, baca
  // status apv SAAT INI dari database (khusus mode edit) sebagai basis,
  // meniru variabel form-level Delphi yang otomatis "ingat" status lama.
  let apv;
  if (ApvOverride !== undefined) {
    apv = ApvOverride;
  } else if (!isNew) {
    const [[current]] = await db.query(
      `SELECT inv_apvnosj FROM tinv_hdr WHERE inv_nomor = ?`,
      [NomorInv],
    );
    apv = current ? current.inv_apvnosj || "" : "";
  } else {
    apv = "";
  }

  let pro;
  if (!InvPro || !InvPro.trim()) {
    const adaSjSemua = cekAdaSjSemua(validDetail);
    if (adaSjSemua) {
      pro = 0;
      apv = "";
    } else {
      if (apv && apv !== "N" && apv !== "T") {
        pro = 0;
      } else {
        pro = 1;
        apv = "N";
      }
    }
  } else {
    pro = 1;
    apv = "";
  }

  const xppn = StsPpn ? Number(Ppn) : 0;
  const cpph = Pph === "PPh" ? "PPh" : "";

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomor = isNew
      ? await generateNomor(KodePerush, Tanggal, conn)
      : NomorInv;
    const isFlagExcluded = !isNew ? await cekInINT(nomor) : false;

    // ── Header ────────────────────────────────────────────
    if (isNew) {
      await conn.query(
        `INSERT INTO tinv_hdr
           (inv_nomor, inv_divisi, inv_tanggal, inv_keterangan,
            inv_perush_kode, inv_cus_kode, inv_cus_alamat,
            inv_tanggal_tempo, inv_rekening, inv_invpro,
            inv_sts_ppn, inv_ppn, inv_flag, inv_disc, inv_pph,
            inv_apvnosj, date_create, user_create)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),?)`,
        [
          nomor,
          divisiStr,
          Tanggal,
          Keterangan,
          KodePerush,
          KodeCus,
          AlamatCus,
          TanggalTempo,
          RekBank,
          InvPro,
          StsPpn,
          xppn,
          pro,
          Disc,
          cpph,
          apv,
          userKode,
        ],
      );
    } else {
      let updateFields = `
        inv_divisi = ?, inv_tanggal = ?, inv_keterangan = ?,
        inv_perush_kode = ?, inv_cus_kode = ?, inv_cus_alamat = ?,
        inv_tanggal_tempo = ?, inv_rekening = ?, inv_invpro = ?,
        inv_sts_ppn = ?, inv_ppn = ?,`;
      const updateParams = [
        divisiStr,
        Tanggal,
        Keterangan,
        KodePerush,
        KodeCus,
        AlamatCus,
        TanggalTempo,
        RekBank,
        InvPro,
        StsPpn,
        xppn,
      ];

      if (!isFlagExcluded) {
        updateFields += ` inv_flag = ?,`;
        updateParams.push(pro);
      }

      updateFields += `
        inv_disc = ?, inv_pph = ?, inv_apvnosj = ?,
        date_modified = NOW(), user_modified = ?
        WHERE inv_nomor = ?`;
      updateParams.push(Disc, cpph, apv, userKode, nomor);

      await conn.query(`UPDATE tinv_hdr SET ${updateFields}`, updateParams);
    }

    // ── Detail ─────────────────────────────────────────────
    await conn.query(`DELETE FROM tinv_dtl WHERE invd_inv_nomor = ?`, [nomor]);
    await conn.query(
      `UPDATE tsj_hdr SET sj_inv_nomor = "" WHERE sj_inv_nomor = ?`,
      [nomor],
    );

    let urut = 1;
    for (const row of validDetail) {
      const sjNomor = row.SjNomor && row.SjNomor !== "-" ? row.SjNomor : "";

      await conn.query(
        `INSERT INTO tinv_dtl
          (invd_inv_nomor, invd_sj_nomor, invd_spk_nomor,
            invd_ukuran, invd_jumlah, invd_harga, invd_nourut)
        VALUES (?,?,?,?,?,?,?)`,
        [
          nomor,
          sjNomor,
          row.Kode,
          row.Ukuran || "",
          Number(row.Jumlah),
          Number(row.Harga || 0), // ⚠️ FIX: simpan apa adanya, jangan dibulatkan
          urut,
        ],
      );

      // ── Update SJ terkait + auto-approval ────────────────
      if (sjNomor) {
        const sjArray = sjNomor
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        for (const csj of sjArray) {
          await conn.query(
            `UPDATE tsj_hdr SET sj_approve = 1, sj_inv_nomor = ? WHERE sj_nomor = ?`,
            [nomor, csj],
          );

          // Cari SPK turunan yang terkait dengan SO ini & SJ ini
          const [[sjInfo]] = await conn.query(
            `SELECT h.sj_gdg_kode, d.sjd_jumlah, h.date_create, d.sjd_spk_nomor AS spk_turunan
       FROM tsj_hdr h
       INNER JOIN tsj_dtl d ON d.sjd_sj_nomor = h.sj_nomor
       INNER JOIN tspk turunan ON turunan.spk_nomor = d.sjd_spk_nomor
         AND turunan.spk_so_ref = ?
         AND turunan.spk_is_so = 0
       WHERE h.sj_nomor = ?`,
            [row.Kode, csj], // row.Kode = nomor SO
          );

          if (
            sjInfo &&
            new Date(sjInfo.date_create) >= new Date(TANGGAL_CUTOFF_SJ)
          ) {
            const [[existing]] = await conn.query(
              `SELECT * FROM tsj_approve
         WHERE sja_nomor = ? AND sja_spk_nomor = ? AND sja_gdg_kode = ?`,
              [csj, sjInfo.spk_turunan, sjInfo.sj_gdg_kode],
            );
            if (!existing) {
              await conn.query(
                `INSERT INTO tsj_approve (sja_nomor, sja_spk_nomor, sja_jumlah, sja_gdg_kode)
           VALUES (?, ?, ?, ?)`,
                [
                  csj,
                  sjInfo.spk_turunan,
                  sjInfo.sjd_jumlah,
                  sjInfo.sj_gdg_kode,
                ],
              );
            }
          }
        }
      }
      urut++;
    }

    // ── Approval invoice belum buat SJ (tapprove) ──────────
    if (apv === "") {
      await conn.query(
        `DELETE FROM tapprove WHERE pin_jenis = 'INVBLMSJ' AND pin_nomor = ? AND pin_acc = ''`,
        [nomor],
      );
    } else if (apv === "N") {
      await conn.query(
        `INSERT INTO tapprove (pin_jenis, pin_nomor, pin_tgl_minta, pin_user_minta)
         VALUES ('INVBLMSJ', ?, NOW(), ?)
         ON DUPLICATE KEY UPDATE
           pin_tgl_pin = NULL, pin_user_pin = '', pin_acc = '',
           pin_tgl_minta = NOW(), pin_user_minta = ?`,
        [nomor, userKode, userKode],
      );
    }

    // ── PIN5 ACC dipakai ────────────────────────────────────
    if (Xminta5 === "ACC" && Xurut5) {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai = 'Y'
         WHERE pin_trs = 'INV' AND pin_nomor = ? AND pin_urut = ?`,
        [nomor, Xurut5],
      );
    }

    // ── Update piutang_debet.flag (exclude jika invoice tidak normal) ──
    if (!isFlagExcluded) {
      await conn.query(`UPDATE piutang_debet SET flag = ? WHERE nota = ?`, [
        pro,
        nomor,
      ]);
    }

    await conn.commit();
    return { nomor, apv };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────
// VALIDASI: ada SPK baru tanpa SJ saat invoice sudah approved
// Sesuai Delphi pengecekan sebelum tombol simpan
// ─────────────────────────────────────────────────────────
const cekSpkBaruTanpaSj = (detail, currentApv) => {
  if (!currentApv || currentApv === "N" || currentApv === "T") return false;
  for (const row of detail) {
    const isNewRow = !row.IsExisting; // baris baru ditambahkan user
    if (row.NamaSpk && (!row.SjNomor || row.SjNomor === "") && isNewRow) {
      return true;
    }
  }
  return false;
};

// ─────────────────────────────────────────────────────────
// GET DIVISI LIST
// ─────────────────────────────────────────────────────────
const getDivisiList = async () => {
  const [rows] = await db.query(
    `SELECT kode, divisi AS nama FROM tdivisi WHERE kode <> 0 ORDER BY kode`,
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// CUSTOMER EXIT — get TOP untuk jatuh tempo otomatis
// ─────────────────────────────────────────────────────────
const getCustomerInfo = async (kode) => {
  const [[row]] = await db.query(
    `SELECT cus_kode, cus_nama, cus_alamat, cus_kota, cus_top, cus_aktif
     FROM tcustomer WHERE cus_kode = ?`,
    [kode],
  );
  if (!row) throw new Error("Kode tidak ditemukan.");
  if (row.cus_aktif === 1) throw new Error("Status pasif.");
  return row;
};

// ─────────────────────────────────────────────────────────
// VALIDASI INVOICE PROFORMA — sesuai edtinvproExit
// ─────────────────────────────────────────────────────────
const validateInvPro = async (nomorPro, cusKode) => {
  const [[row]] = await db.query(
    `SELECT inv_nomor, inv_sts_pro FROM tinv_hdr
     WHERE inv_nomor = ? AND inv_cus_kode = ?`,
    [nomorPro, cusKode],
  );
  if (!row) throw new Error("Invoice tidak ditemukan di Customer ini.");
  if (row.inv_sts_pro !== 1)
    throw new Error("Invoice ini bukan Invoice Proforma.");
  return row;
};

// ─────────────────────────────────────────────────────────
// GET REKENING PERUSAHAAN (lookup bank)
// ─────────────────────────────────────────────────────────
const getRekeningPerush = async (perushKode) => {
  const [rows] = await db.query(
    `SELECT perushd_rekening AS Rekening,
            perushd_bank AS Bank,
            perushd_atasnama AS AtasNama
     FROM tperusahaan_dtl
     WHERE perushd_perush_kode = ?`,
    [perushKode],
  );
  return rows;
};

const getDataCetak = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT
       a.inv_nomor, DATE_FORMAT(a.inv_tanggal,'%d-%m-%Y') AS inv_tanggal_fmt,
       a.inv_keterangan, a.inv_cus_alamat,
       a.inv_disc, a.inv_sts_ppn, a.inv_ppn, a.inv_pph,
       a.inv_rekening, a.inv_perush_kode,
       a.user_create,
       p.perush_nama, p.perush_alamat, p.perush_kota, p.perush_telp,
       c.cus_nama, c.cus_alamat, c.cus_telp, c.cus_fax,
       pd.perushd_bank, pd.perushd_atasnama,
       DATE_FORMAT(a.date_create,'%d-%m-%Y %T') AS created
     FROM tinv_hdr a
     INNER JOIN tperusahaan p ON p.perush_kode = a.inv_perush_kode
     INNER JOIN tcustomer c   ON c.cus_kode    = a.inv_cus_kode
     LEFT JOIN tperusahaan_dtl pd
       ON pd.perushd_perush_kode = p.perush_kode
       AND pd.perushd_rekening = a.inv_rekening
     WHERE a.inv_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");

  const [dtl] = await db.query(
    `SELECT
       d.invd_spk_nomor, d.invd_ukuran, d.invd_jumlah, d.invd_harga,
       d.invd_nourut,
       IFNULL(s.spk_nama2, x.brg_name) AS nama_barang
     FROM tinv_dtl d
     LEFT JOIN tspk s    ON s.spk_nomor = d.invd_spk_nomor
     LEFT JOIN tbarang x ON x.brg_kode  = d.invd_spk_nomor
     WHERE d.invd_inv_nomor = ?
     ORDER BY d.invd_nourut, d.invd_sj_nomor DESC`,
    [nomor],
  );

  const round = (v) => Math.round(Number(v) || 0);

  const totalBarang = dtl.reduce(
    (s, r) => s + round(Number(r.invd_jumlah || 0) * Number(r.invd_harga || 0)),
    0,
  );
  const disc = round(hdr.inv_disc || 0);

  let totalPpn = 0;
  let grandTotal;
  if (hdr.inv_sts_ppn === 1) {
    if (hdr.inv_pph === "PPh") {
      totalPpn = round(totalBarang * (Number(hdr.inv_ppn) / 100));
      grandTotal = totalBarang - disc + totalPpn;
    } else {
      const baseAfterDisc = totalBarang - disc;
      totalPpn = round(baseAfterDisc * (Number(hdr.inv_ppn) / 100));
      grandTotal = baseAfterDisc + totalPpn;
    }
  } else {
    grandTotal = totalBarang - disc;
  }

  const uangMuka = round(await getDebet(nomor));
  const nilaiPiutang = grandTotal - uangMuka;

  return {
    header: hdr,
    detail: dtl,
    totalBarang,
    totalPpn,
    grandTotal,
    uangMuka,
    nilaiPiutang,
    disc,
  };
};

module.exports = {
  generateNomor,
  getById,
  cekStatusPelunasan,
  getDebet,
  isSpk,
  getSjForSpk,
  searchBarang,
  loadBarangDetail,
  cekAdaSjSemua,
  cekInINT,
  cekTutupBuku,
  save,
  cekSpkBaruTanpaSj,
  getDivisiList,
  getCustomerInfo,
  validateInvPro,
  getRekeningPerush,
  getDataCetak,
};
