const db = require("../../config/database");

const CABANG_BROWSE = ["HO-", "P01", "P02", "P04", "P05"];

const getBrowse = async (jenis, cabang, bagian) => {
  const validJenis = ["ACCESORIES", "OBAT", "SPAREPART", "ATK/RTK"];
  const selectedJenis = validJenis.includes(jenis) ? jenis : "ACCESORIES";
  if (!CABANG_BROWSE.includes(cabang)) {
    throw new Error("Cabang tidak valid untuk browse barang garmen.");
  }

  let selectNote = "";
  let stokQuery = "";
  let whereClause = `WHERE b.brg_jenis = '${selectedJenis}'`;

  if (selectedJenis === "ACCESORIES") {
    selectNote = "x.Note,";
    stokQuery = `IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok_acc m WHERE m.mst_aktif="Y" AND m.mst_brg_kode=b.brg_kode AND m.mst_cab=?), 0) AS Stok`;
  } else if (selectedJenis === "OBAT") {
    stokQuery = `IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok_obat m WHERE m.mst_aktif="Y" AND m.mst_brg_kode=b.brg_kode AND m.mst_cab=?), 0) AS Stok`;
  } else if (selectedJenis === "SPAREPART") {
    stokQuery = `IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok_sparepart m WHERE m.mst_aktif="Y" AND m.mst_brg_kode=b.brg_kode AND m.mst_cab=?), 0) AS Stok`;
    if (bagian === "TEKNISI") whereClause += ` AND b.brg_ktg <> 'IT'`;
    else if (bagian === "IT") whereClause += ` AND b.brg_ktg = 'IT'`;
  } else if (selectedJenis === "ATK/RTK") {
    stokQuery = `IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok_atk m WHERE m.mst_aktif="Y" AND m.mst_brg_kode=b.brg_kode AND m.mst_cab=?), 0) AS Stok`;
  }

  const query = `
    SELECT 
      x.Jenis, x.Kategori, x.Kode, x.Nama, x.Satuan, 
      ${selectNote}
      x.Buffer, x.Stok, 
      IF(x.Buffer = 0, 0, IF(x.Stok < x.Buffer, x.Buffer - x.Stok, 0)) AS Safety, 
      x.Aktif,
      x.Usr,
      x.Created
    FROM (
      SELECT 
        b.brg_jenis AS Jenis, b.brg_ktg AS Kategori, b.brg_kode AS Kode, 
        b.brg_nama AS Nama, b.brg_satuan AS Satuan, b.brg_buffer AS Buffer, 
        b.brg_note AS Note, b.brg_aktif AS Aktif,
        b.user_create AS Usr, DATE_FORMAT(b.date_create, '%d/%m/%Y %H:%i:%s') AS Created,
        ${stokQuery}
      FROM tgarmen_brg b
      ${whereClause}
      ORDER BY b.brg_nama ASC
    ) x
  `;
  const [rows] = await db.query(query, [cabang]);
  return rows;
};

const getById = async (kode) => {
  const query = `
    SELECT b.*, 
      IFNULL(j.ab_nama, "") as nmBarang, 
      IFNULL(w.aw_nama, "") as nmWarna, 
      IFNULL(u.au_nama, "") as nmUkuran, 
      IFNULL(k.ak_nama, "") as nmKet, 
      IFNULL(p.project, "REGULER") as project
    FROM tgarmen_brg b
    LEFT JOIN taccesories_barang j ON j.ab_kode = LEFT(b.brg_kode, 2)
    LEFT JOIN taccesories_warna w ON w.aw_kode = MID(b.brg_kode, 3, 3)
    LEFT JOIN taccesories_ukuran u ON u.au_kode = MID(b.brg_kode, 6, 3)
    LEFT JOIN taccesories_ket k ON k.ak_kode = MID(b.brg_kode, 9, 2)
    LEFT JOIN tbahan_project p ON CHAR_LENGTH(b.brg_kode) > 10 AND p.kode = RIGHT(b.brg_kode, 1)
    WHERE b.brg_kode = ?
  `;
  const [rows] = await db.query(query, [kode]);
  return rows[0];
};

// --- LOGIKA PEMBENTUKAN KODE OTOMATIS (Migrasi Delphi getmaxnomor) ---
const generateKode = async (jenis, kategori, accKodeAssembled) => {
  if (jenis === "ACCESORIES") return accKodeAssembled; // Hasil jahitan 5 kode dari frontend

  const date = new Date();
  const yy = date.getFullYear().toString().slice(-2);

  if (jenis === "OBAT") {
    let prefix = kategori === "GARMEN" ? "G" : kategori === "MMT" ? "M" : "D";
    const [[row]] = await db.query(
      `SELECT IFNULL(MAX(RIGHT(brg_kode, 3)), 0) AS max_val FROM tgarmen_brg WHERE brg_jenis="OBAT" AND LEFT(brg_kode, 1) = ?`,
      [prefix],
    );
    const nextNum = parseInt(row.max_val, 10) + 1;
    return prefix + String(nextNum).padStart(3, "0"); // ex: G001
  }

  if (jenis === "SPAREPART") {
    let prefix =
      kategori === "MESIN"
        ? "MS"
        : kategori === "NONMESIN"
          ? "NM"
          : kategori === "LISTRIK"
            ? "LT"
            : kategori === "OIL"
              ? "OL"
              : "IT";
    const searchPrefix = prefix + yy;
    const [[row]] = await db.query(
      `SELECT IFNULL(MAX(RIGHT(brg_kode, 4)), 0) AS max_val FROM tgarmen_brg WHERE brg_jenis="SPAREPART" AND LEFT(brg_kode, 4) = ?`,
      [searchPrefix],
    );
    const nextNum = parseInt(row.max_val, 10) + 1;
    return searchPrefix + String(nextNum).padStart(4, "0"); // ex: MS260001
  }

  if (jenis === "ATK/RTK") {
    const searchPrefix = "AK" + yy;
    const [[row]] = await db.query(
      `SELECT IFNULL(MAX(RIGHT(brg_kode, 4)), 0) AS max_val FROM tgarmen_brg WHERE brg_jenis="ATK/RTK" AND LEFT(brg_kode, 4) = ?`,
      [searchPrefix],
    );
    const nextNum = parseInt(row.max_val, 10) + 1;
    return searchPrefix + String(nextNum).padStart(4, "0"); // ex: AK260001
  }

  return null;
};

const create = async (data, user) => {
  const generatedKode = await generateKode(
    data.brg_jenis,
    data.brg_ktg,
    data.accKodeAssembled,
  );

  if (data.brg_jenis === "ACCESORIES") {
    const [exist] = await db.query(
      "SELECT brg_kode FROM tgarmen_brg WHERE brg_kode = ?",
      [generatedKode],
    );
    if (exist.length > 0)
      throw new Error("Master Accesories yang akan dibuat sudah ada.");
  }

  const query = `
    INSERT INTO tgarmen_brg 
    (brg_jenis, brg_kode, brg_ktg, brg_nama, brg_satuan, brg_note, brg_buffer, brg_aktif, user_create, date_create)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
  `;
  await db.query(query, [
    data.brg_jenis,
    generatedKode,
    data.brg_ktg || "",
    data.brg_nama,
    data.brg_satuan,
    data.brg_note || "",
    data.brg_buffer || 0,
    data.brg_aktif || "Y",
    user,
  ]);
  return generatedKode;
};

const update = async (kode, data, user) => {
  const query = `
    UPDATE tgarmen_brg SET 
      brg_nama = ?, brg_satuan = ?, brg_note = ?, brg_buffer = ?, brg_aktif = ?, 
      user_modified = ?, date_modified = NOW()
    WHERE brg_kode = ?
  `;
  await db.query(query, [
    data.brg_nama,
    data.brg_satuan,
    data.brg_note || "",
    data.brg_buffer || 0,
    data.brg_aktif || "Y",
    user,
    kode,
  ]);
};

const remove = async (kode) => {
  await db.query("DELETE FROM tgarmen_brg WHERE brg_kode = ?", [kode]);
};

// Fungsi Lookups untuk dropdown form (Sesuai F1 dan FormCreate Delphi)
const getLookups = async (category) => {
  switch (category) {
    case "cabang":
      return (
        await db.query(
          "SELECT pab_kode AS Kode, pab_nama AS Nama FROM tpabrik ORDER BY pab_kode ASC",
        )
      )[0];
    case "cabang_browse":
      return (
        await db.query(
          "SELECT pab_kode AS Kode, pab_nama AS Nama FROM tpabrik WHERE pab_kode IN (?) ORDER BY FIELD(pab_kode, ?)",
          [CABANG_BROWSE, CABANG_BROWSE],
        )
      )[0];
    case "acc_barang":
      return (
        await db.query(
          "SELECT ab_kode AS Kode, ab_nama AS Nama FROM taccesories_barang ORDER BY ab_kode ASC",
        )
      )[0];
    case "acc_warna":
      return (
        await db.query(
          "SELECT aw_kode AS Kode, aw_nama AS Nama FROM taccesories_warna ORDER BY aw_kode ASC",
        )
      )[0];
    case "acc_ukuran":
      return (
        await db.query(
          "SELECT au_kode AS Kode, au_nama AS Nama FROM taccesories_ukuran ORDER BY au_kode ASC",
        )
      )[0];
    case "acc_ket":
      return (
        await db.query(
          "SELECT ak_kode AS Kode, ak_nama AS Nama FROM taccesories_ket ORDER BY ak_kode ASC",
        )
      )[0];
    case "project":
      return (
        await db.query(
          "SELECT kode AS Kode, project AS Nama FROM tbahan_project ORDER BY kode ASC",
        )
      )[0];

    // Satuan spesifik
    case "satuan_acc":
      return (
        await db.query(
          "SELECT gs_satuan AS Nama FROM tgarmen_satuan ORDER BY gs_satuan ASC",
        )
      )[0];
    case "satuan_obat":
      return (
        await db.query(
          "SELECT gs_satuan AS Nama FROM tgarmen_satuan ORDER BY gs_satuan ASC",
        )
      )[0];
    case "satuan_sparepart":
      return (
        await db.query(
          "SELECT gs_satuan AS Nama FROM tgarmen_satuan ORDER BY gs_satuan ASC",
        )
      )[0];
    case "satuan_atk":
      return (
        await db.query(
          "SELECT gs_satuan AS Nama FROM tgarmen_satuan ORDER BY gs_satuan ASC",
        )
      )[0];

    default:
      return [];
  }
};

// ── Kode barang garmen disimpan sebagai teks di banyak tabel (tanpa FK) ──
// KODE_BLOKIR: dokumen yang MENGUNCI kode. Satu dokumen saja sudah cukup untuk mengunci.
const KODE_BLOKIR = [
  {
    label: "BPB",
    sql: `SELECT COUNT(DISTINCT bpbd_nomor) AS jml
          FROM tgarmenbpb_dtl WHERE bpbd_brg_kode = ?`,
  },
  {
    // jalur 1: baris tkasbonitem2 yang menyimpan kode langsung
    label: "penyelesaian uang muka",
    sql: `SELECT COUNT(DISTINCT bond2_nomor) AS jml
          FROM finance.tkasbonitem2 WHERE bond2_brg_kode = ?`,
  },
  {
    // jalur 2: item Permintaan Pembelian di tkasbonitem tidak menyimpan kode,
    // hanya nomor+urut permintaan. Dihitung bila kasbon sudah diselesaikan.
    label: "penyelesaian uang muka",
    sql: `SELECT COUNT(DISTINCT k.bond_nomor) AS jml
          FROM finance.tkasbonitem k
          INNER JOIN finance.tkasbon b
            ON b.bon_nomor = k.bond_nomor AND b.bon_selesai <> 0
          INNER JOIN tgarmenmintabeli_dtl d
            ON d.mbd_nomor = k.bond_ref_nomor AND d.mbd_nourut = k.bond_ref_nourut
          WHERE k.bond_ref_tipe = 'PERMINTAAN_PEMBELIAN' AND d.mbd_brg_kode = ?`,
  },
  {
    // trigger tgarmenmso_dtl_after_update belum dibaca: aman = kunci dulu
    label: "mutasi stok",
    sql: `SELECT COUNT(DISTINCT msod_nomor) AS jml
          FROM tgarmenmso_dtl WHERE msod_brg_kode = ?`,
  },
  {
    label: "stok keuangan",
    sql: `SELECT COUNT(*) AS jml
          FROM finance.tmasterstok_finance WHERE mst_brg_kode = ?`,
  },

  {
    label: "pengajuan uang muka berjalan",
    sql: `SELECT COUNT(DISTINCT h.pum_nomor) AS jml
          FROM tpengajuan_uang_muka_dtl d
          INNER JOIN tpengajuan_uang_muka_hdr h ON h.pum_nomor = d.pumd_pum_nomor
          INNER JOIN tgarmenmintabeli_dtl m
            ON m.mbd_nomor = d.pumd_nomor_sumber AND m.mbd_nourut = d.pumd_item_nourut
          WHERE d.pumd_sumber = 'PERMINTAAN_PEMBELIAN'
            AND h.pum_status = 'DIAJUKAN' AND m.mbd_brg_kode = ?`,
  },
];

// KODE_IKUT: tabel yang kodenya ikut diganti. Trigger-nya hanya menyala saat
// insert/delete, jadi UPDATE kolom kode aman. Stok harus ikut supaya hapus
// dokumen di kemudian hari tetap mengurangi stok pada kode yang sama.
const KODE_IKUT = [
  ["tgarmenmintabeli_dtl", "mbd_brg_kode"],
  ["tgarmenmintabeli_dtl2", "mbd2_brg_kode"],
  ["tgarmenminta_dtl", "mind_brg_kode"],
  ["tgarmenpo_dtl", "pod_brg_kode"],
  ["tgarmeniv_dtl", "ivd_brg_kode"],
  ["tgarmenkor_dtl", "kord_brg_kode"],
  ["tgarmenrb_dtl", "rbd_brg_kode"],
  ["tgarmenrealisasi_dtl", "red_brg_kode"],
  ["tgarmenrealisasi_dtl2", "red2_brg_kode"],
  ["tgarmenretur_dtl", "retd_brg_kode"],
  ["tgarmenreturlog_dtl", "retd_brg_kode"],
  ["tmasterstok_acc", "mst_brg_kode"],
  ["tmasterstok_atk", "mst_brg_kode"],
  ["tmasterstok_obat", "mst_brg_kode"],
  ["tmasterstok_sparepart", "mst_brg_kode"],
];

// Hasil: daftar teks pemakaian, mis. ["2 BPB", "1 penyelesaian uang muka"]. Kosong = bebas.
const hitungPemakaianKode = async (executor, kode) => {
  const total = new Map();
  for (const { label, sql } of KODE_BLOKIR) {
    const [[row]] = await executor.query(sql, [kode]);
    const jml = Number(row.jml);
    if (jml) total.set(label, (total.get(label) || 0) + jml);
  }
  return [...total].map(([label, jml]) => `${jml} ${label}`);
};

const getKodeStatus = async (kode) => {
  const [[ada]] = await db.query(
    "SELECT brg_kode FROM tgarmen_brg WHERE brg_kode = ?",
    [kode],
  );
  if (!ada) throw new Error("Barang tidak ditemukan.");

  const pemakaian = await hitungPemakaianKode(db, kode);
  return { editable: pemakaian.length === 0, pemakaian };
};

// Kode baru tidak boleh sudah ada di tabel dokumen manapun (kode yatim sisa
// data lama). Ini juga yang membuat pembatalan manual di bawah aman dijalankan.
const kodeDipakaiDokumen = async (executor, kode) => {
  for (const [table, col] of KODE_IKUT) {
    const [[row]] = await executor.query(
      `SELECT 1 AS ada FROM ${table} WHERE ${col} = ? LIMIT 1`,
      [kode],
    );
    if (row) return table;
  }
  return null;
};

const changeKode = async (kodeLama, kodeBaruInput, user) => {
  const kodeBaru = String(kodeBaruInput || "")
    .trim()
    .toUpperCase();
  if (!kodeBaru) throw new Error("Kode baru wajib diisi.");
  if (/\s/.test(kodeBaru))
    throw new Error("Kode tidak boleh mengandung spasi.");

  const conn = await db.getConnection();
  // Tabel yang sudah diubah. Master dan banyak tabel dokumen bertipe MyISAM,
  // jadi rollback tidak membatalkannya: dibatalkan manual bila ada yang gagal.
  const sudahDiubah = [];
  try {
    const [[brg]] = await conn.query(
      "SELECT brg_kode, brg_nama FROM tgarmen_brg WHERE brg_kode = ?",
      [kodeLama],
    );
    if (!brg) throw new Error("Barang tidak ditemukan.");
    if (!brg.brg_kode.trim())
      throw new Error(
        "Master dengan kode kosong tidak bisa diganti lewat fitur ini. Perbaiki langsung di database.",
      );
    if (kodeBaru === brg.brg_kode)
      throw new Error("Kode baru sama dengan kode lama.");

    const [dup] = await conn.query(
      `SELECT brg_kode FROM tgarmen_brg
       WHERE brg_kode = ? AND brg_kode <> ? LIMIT 1`,
      [kodeBaru, brg.brg_kode],
    );
    if (dup.length)
      throw new Error(`Kode ${kodeBaru} sudah dipakai barang lain.`);

    const yatim = await kodeDipakaiDokumen(conn, kodeBaru);
    if (yatim)
      throw new Error(
        `Kode ${kodeBaru} masih tercatat di data lama (${yatim}). Gunakan kode lain.`,
      );

    // Cek ulang di sini, jangan percaya status dari dialog
    const pemakaian = await hitungPemakaianKode(conn, brg.brg_kode);
    if (pemakaian.length)
      throw new Error(
        `Kode tidak bisa diubah: sudah dipakai di ${pemakaian.join(" dan ")}.`,
      );

    await conn.beginTransaction(); // hanya melindungi tabel stok (InnoDB)

    // Master dulu: kegagalan paling mungkin ada di sini (kunci unik)
    await conn.query(
      `UPDATE tgarmen_brg
       SET brg_kode = ?, user_modified = ?, date_modified = NOW()
       WHERE brg_kode = ?`,
      [kodeBaru, user, brg.brg_kode],
    );
    sudahDiubah.push(["tgarmen_brg", "brg_kode"]);

    let barisDiperbarui = 0;
    for (const [table, col] of KODE_IKUT) {
      const [r] = await conn.query(
        `UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`,
        [kodeBaru, brg.brg_kode],
      );
      sudahDiubah.push([table, col]);
      barisDiperbarui += r.affectedRows;
    }

    await conn.query(
      `INSERT INTO tgarmen_brg_kode_log
         (log_kode_lama, log_kode_baru, log_nama, log_baris, log_user, log_date)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [brg.brg_kode, kodeBaru, brg.brg_nama || "", barisDiperbarui, user],
    );

    await conn.commit();
    return { kode: kodeBaru, barisDiperbarui };
  } catch (e) {
    try {
      await conn.rollback(); // membatalkan tabel InnoDB
    } catch {
      /* belum ada transaksi */
    }
    // Batalkan tabel MyISAM. Aman: kode baru dijamin belum dipakai siapa pun.
    for (const [table, col] of sudahDiubah.reverse()) {
      try {
        await conn.query(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`, [
          kodeLama,
          kodeBaru,
        ]);
      } catch {
        /* lanjutkan membatalkan tabel lain */
      }
    }
    throw e;
  } finally {
    conn.release();
  }
};

module.exports = {
  getBrowse,
  getById,
  create,
  update,
  remove,
  getLookups,
  getKodeStatus,
  changeKode,
};
