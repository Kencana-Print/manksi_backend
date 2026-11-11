// services/garmen/mkaFormService.js
const db = require("../../config/database");

// ─────────────────────────────────────────────
// Generate nomor MKA: MKA/0001/2025
// FIX: sekarang terima conn (WAJIB dipanggil di dalam transaksi
// saveData) + pakai FOR UPDATE, supaya tidak race dengan request
// lain yang bersamaan. Juga wrap Number() karena mysql2 balikin
// hasil CAST(...AS UNSIGNED) sebagai string, bukan number murni.
// ─────────────────────────────────────────────
const generateNomor = async (conn, tahun) => {
  const [rows] = await conn.query(
    `SELECT IFNULL(MAX(CAST(SUBSTR(mkb_nomor, 5, 4) AS UNSIGNED)), 0) AS jumlah
     FROM tmka_hdr
     WHERE LEFT(mkb_nomor, 3) = 'MKA'
       AND RIGHT(mkb_nomor, 4) = ?
     FOR UPDATE`,
    [String(tahun)],
  );
  const nextVal = Number(rows[0].jumlah) + 1;
  return `MKA/${String(nextVal).padStart(4, "0")}/${tahun}`;
};

// ─────────────────────────────────────────────
// getmka(kode) — total MKA terpakai untuk satu kode bahan,
// dikurangi yang sudah direalisasi.
// Exclude: MKA sedang diedit (excludeNomor), SPK yang sudah close.
// Delphi: getmka() dipanggil saat load detail → hitung free = ready - getmka
// ─────────────────────────────────────────────
const getMkaTerpakai = async (brgKode, excludeNomor = "") => {
  const [rows] = await db.query(
    `SELECT SUM(y.mka - y.realisasi) AS mka
     FROM (
       SELECT x.*,
         IFNULL((
           SELECT SUM(d.red_jumlah)
           FROM tgarmenrealisasi_hdr h
           INNER JOIN tgarmenrealisasi_dtl d ON d.red_nomor = h.re_nomor
           WHERE h.re_spk_nomor = x.spk AND d.red_brg_kode = x.kode
         ), 0) AS realisasi
       FROM (
         SELECT a.mkb_nomor    AS nomor_mka,
                a.mkb_spk_nomor AS spk,
                b.mkbd_brg_kode AS kode,
                SUM(b.mkbd_jumlah) AS mka
         FROM tmka_hdr a
         INNER JOIN tmka_dtl b ON b.mkbd_nomor = a.mkb_nomor
         WHERE (? = '' OR a.mkb_nomor <> ?)
           AND b.mkbd_brg_kode = ?
           AND a.mkb_spk_nomor IN (
             SELECT spk_nomor FROM tspk WHERE spk_close = 0
           )
         GROUP BY b.mkbd_brg_kode, a.mkb_nomor
       ) x
     ) y
     WHERE y.mka > y.realisasi`,
    [excludeNomor, excludeNomor, brgKode],
  );
  return rows[0]?.mka || 0;
};

// ─────────────────────────────────────────────
// getDetail — load MKA existing untuk edit
// ─────────────────────────────────────────────
const getDetail = async (nomor) => {
  // Header
  const [hdrRows] = await db.query(
    `SELECT h.mkb_nomor,
            DATE_FORMAT(h.mkb_tanggal, '%Y-%m-%d') AS mkb_tanggal,
            h.mkb_spk_nomor,
            h.mkb_note,
            s.spk_so_ref AS so_nomor,
            s.spk_nama,
            s.spk_jumlah,
            s.spk_memo,
            v.divisi
     FROM tmka_hdr h
     LEFT JOIN tspk s ON s.spk_nomor = h.mkb_spk_nomor
     LEFT JOIN tdivisi v ON v.kode = s.spk_divisi
     WHERE h.mkb_nomor = ?`,
    [nomor],
  );

  if (!hdrRows.length) return null;
  const hdr = hdrRows[0];

  // Detail
  const [dtlRows] = await db.query(
    `SELECT d.mkbd_brg_kode AS kode,
            IF(b.brg_note = '', b.brg_nama,
               CONCAT(b.brg_nama, ' - ', b.brg_note)) AS nama,
            b.brg_satuan    AS satuan,
            d.mkbd_pemakaian AS pemakaian,
            d.mkbd_jumlah   AS jumlah,
            d.mkbd_jumlah_po AS po,
            d.mkbd_keterangan AS keterangan,
            d.mkbd_nourut   AS nourut,
            IFNULL((
              SELECT SUM(m.mst_stok_in - m.mst_stok_out)
              FROM tmasterstok_acc m
              WHERE m.mst_aktif = 'Y'
                AND m.mst_brg_kode = d.mkbd_brg_kode
            ), 0) AS ready
     FROM tmka_dtl d
     LEFT JOIN tgarmen_brg b ON b.brg_kode = d.mkbd_brg_kode
     WHERE d.mkbd_nomor = ?
     ORDER BY d.mkbd_nourut`,
    [nomor],
  );

  // Hitung free = ready - getMkaTerpakai per kode
  const detail = await Promise.all(
    dtlRows.map(async (row) => {
      const terpakai = await getMkaTerpakai(row.kode, nomor);
      return {
        ...row,
        ready: parseFloat(row.ready) || 0,
        free: (parseFloat(row.ready) || 0) - terpakai,
      };
    }),
  );

  return { ...hdr, detail };
};

// ─────────────────────────────────────────────
// Divisi yang boleh dibuatkan MKA baru
// ─────────────────────────────────────────────
const DIVISI_MKA = ["3", "4"];

// ─────────────────────────────────────────────
// resolveSpk — terjemahkan nomor input (SO, MAP, atau SPK) ke satu
// baris SPK aktif. Aturan: satu SO satu SPK.
//   SO  → tspk.spk_so_ref
//   MAP → tspk.spk_memo
//   SPK → tspk.spk_nomor (SPK legacy / dari lookup mode so)
// ─────────────────────────────────────────────
const resolveSpk = async (nomorInput) => {
  const nomor = String(nomorInput || "").trim();
  if (!nomor) return { error: "Nomor SO harus diisi" };

  const [rows] = await db.query(
    `SELECT s.spk_nomor, s.spk_nama, s.spk_jumlah, s.spk_jumlah_kirim,
            s.spk_memo, s.spk_so_ref, s.spk_cmo, s.spk_divisi, v.divisi
     FROM tspk s
     LEFT JOIN tdivisi v ON v.kode = s.spk_divisi
     WHERE s.spk_aktif = 'Y'
       AND (s.spk_nomor = ? OR s.spk_so_ref = ? OR s.spk_memo = ?)`,
    [nomor, nomor, nomor],
  );

  if (!rows.length) {
    return {
      error:
        "SPK belum ada untuk nomor ini. Pastikan SO/MAP sudah dibuatkan SPK oleh PPIC.",
    };
  }

  const aktif = rows.filter(
    (r) => r.spk_cmo && Number(r.spk_jumlah) !== Number(r.spk_jumlah_kirim),
  );
  if (!aktif.length) {
    return { error: "SPK belum di-CMO atau sudah selesai kirim" };
  }
  if (aktif.length > 1) {
    return {
      error: `Nomor ini terkait ${aktif.length} SPK (${aktif
        .map((r) => r.spk_nomor)
        .join(", ")}). Masukkan nomor SO-nya.`,
    };
  }
  return { spk: aktif[0] };
};

// ─────────────────────────────────────────────
// getSpkInfo — saat user mengisi nomor SO / MAP / SPK
// Cek apakah SPK turunannya sudah punya MKA → kalau ada, return MKA existing
// Kalau belum → return info SPK + pre-fill detail dari tkesesuaianmap_acc
// Delphi: edtNomorSPKExit
// ─────────────────────────────────────────────
const getSpkInfo = async (nomorInput) => {
  const hasil = await resolveSpk(nomorInput);
  if (hasil.error) return { exists: false, error: hasil.error };

  const spk = hasil.spk;
  const spkNomor = spk.spk_nomor;

  const [mkaRows] = await db.query(
    `SELECT mkb_nomor FROM tmka_hdr WHERE mkb_spk_nomor = ? LIMIT 1`,
    [spkNomor],
  );
  if (mkaRows.length) {
    const existing = await getDetail(mkaRows[0].mkb_nomor);
    return { exists: true, hasExisting: true, existing };
  }

  // MKA baru hanya untuk divisi 3 dan 4 (MKA lama divisi lain tetap bisa dibuka di atas)
  if (!DIVISI_MKA.includes(String(spk.spk_divisi))) {
    return { exists: false, error: "MKA hanya untuk divisi 3 dan 4" };
  }

  const prefillDetail = [];

  // ── Sumber 1: prefill dari MAP (tkesesuaianmap_acc) — TIDAK BERUBAH ──
  if (spk.spk_memo) {
    const [mapRows] = await db.query(
      `SELECT a.kode,
              IF(b.brg_note = '', b.brg_nama,
                 CONCAT(b.brg_nama, ' - ', b.brg_note)) AS nama,
              b.brg_satuan AS satuan,
              a.qty AS pemakaian,
              IFNULL((
                SELECT SUM(m.mst_stok_in - m.mst_stok_out)
                FROM tmasterstok_acc m
                WHERE m.mst_aktif = 'Y'
                  AND m.mst_brg_kode = a.kode
              ), 0) AS ready
       FROM tkesesuaianmap_acc a
       LEFT JOIN tgarmen_brg b ON b.brg_kode = a.kode
       WHERE a.nomor = ?
       ORDER BY a.no_urut`,
      [spk.spk_memo],
    );
    for (const row of mapRows) {
      const jumlah =
        (parseFloat(spk.spk_jumlah) || 0) * (parseFloat(row.pemakaian) || 0);
      const ready = parseFloat(row.ready) || 0;
      const terpakai = await getMkaTerpakai(row.kode, "");
      prefillDetail.push({
        kode: row.kode,
        nama: row.nama,
        satuan: row.satuan,
        pemakaian: parseFloat(row.pemakaian) || 0,
        jumlah,
        ready,
        free: ready - terpakai,
        po: ready >= jumlah ? 0 : jumlah - ready,
        keterangan: "",
      });
    }
  }

  // ── Sumber 2: template size dari tspk_size — replikasi spksize() Delphi.
  // Ini jalan untuk SEMUA divisi (spksize() Delphi dipanggil unconditional).
  let sizeRows = [];

  const [legacySize] = await db.query(
    `SELECT spks_size AS size, spks_qty AS qty
     FROM tspk_size
     WHERE spks_nomor = ? AND spks_qty > 0
     ORDER BY spks_size`,
    [spkNomor],
  );

  if (legacySize.length > 0) {
    sizeRows = legacySize;
  } else {
    const soRef = spk.spk_so_ref || "";
    if (soRef) {
      const [newSize] = await db.query(
        `SELECT sos_size AS size, sos_qty AS qty
         FROM tsalesorder_size
         WHERE sos_so_nomor = ? AND sos_qty > 0
         ORDER BY sos_size`,
        [soRef],
      );
      sizeRows = newSize;
    }
  }

  for (const sz of sizeRows) {
    const jumlah = parseFloat(sz.qty) || 0;

    // Baris default: template kosong menunggu kode diisi manual
    // (kalau lookup di bawah nggak nemu match)
    let templateRow = {
      kode: "",
      nama: "",
      satuan: "",
      pemakaian: 1,
      jumlah,
      ready: 0,
      free: 0,
      po: 0,
      keterangan: `Size ${sz.size}`,
      size: sz.size,
    };

    // Auto-lookup kode LABEL — SEMUA divisi (getkdacc() Delphi generic).
    const [labelRows] = await db.query(
      `SELECT b.brg_kode AS kode,
              IF(b.brg_note = '', b.brg_nama,
                 CONCAT(b.brg_nama, ' - ', b.brg_note)) AS nama,
              b.brg_satuan AS satuan,
              IFNULL((
                SELECT SUM(m.mst_stok_in - m.mst_stok_out)
                FROM tmasterstok_acc m
                WHERE m.mst_aktif = 'Y'
                  AND m.mst_brg_kode = b.brg_kode
              ), 0) AS ready
       FROM tgarmen_brg b
       WHERE b.brg_jenis = 'ACCESORIES'
         AND b.brg_aktif = 'Y'
         AND b.brg_nama LIKE '%LABEL%'
         AND b.brg_nama LIKE ?
         AND b.brg_nama LIKE ?
       LIMIT 1`,
      [`%- ${sz.size}%`, `%${spk.divisi}%`],
    );

    if (labelRows.length) {
      const row = labelRows[0];
      const ready = parseFloat(row.ready) || 0;
      const terpakai = await getMkaTerpakai(row.kode, "");
      const already = prefillDetail.find((d) => d.kode === row.kode);
      if (already) {
        already.jumlah += jumlah;
        already.po =
          already.ready >= already.jumlah ? 0 : already.jumlah - already.ready;
        continue;
      }
      templateRow = {
        ...templateRow,
        kode: row.kode,
        nama: row.nama,
        satuan: row.satuan,
        ready,
        free: ready - terpakai,
        po: ready >= jumlah ? 0 : jumlah - ready,
      };
    }

    prefillDetail.push(templateRow);
  }

  return {
    exists: true,
    hasExisting: false,
    spk: {
      spk_nomor: spk.spk_nomor, // ← yang disimpan ke mkb_spk_nomor
      so_nomor: spk.spk_so_ref || "", // ← untuk ditampilkan di field Nomor SO
      spk_nama: spk.spk_nama,
      spk_jumlah: parseFloat(spk.spk_jumlah) || 0,
      spk_memo: spk.spk_memo,
      divisi: spk.divisi,
    },
    prefillDetail,
  };
};

// ─────────────────────────────────────────────
// getAksesorisMaster — lookup kode bahan saat input di grid
// Delphi: loadkode(), F1/F2 handler
// ─────────────────────────────────────────────
const getAksesorisMaster = async (search = "", excludeKodes = []) => {
  const like = `%${search}%`;
  const [rows] = await db.query(
    `SELECT b.brg_kode AS kode,
            IF(b.brg_note = '', b.brg_nama,
               CONCAT(b.brg_nama, ' - ', b.brg_note)) AS nama,
            b.brg_satuan AS satuan,
            IFNULL((
              SELECT SUM(m.mst_stok_in - m.mst_stok_out)
              FROM tmasterstok_acc m
              WHERE m.mst_aktif = 'Y'
                AND m.mst_brg_kode = b.brg_kode
            ), 0) AS ready
     FROM tgarmen_brg b
     WHERE b.brg_aktif = 'Y'
       AND b.brg_jenis = 'ACCESORIES'
       AND (b.brg_kode LIKE ? OR b.brg_nama LIKE ? OR b.brg_note LIKE ?)
     ORDER BY b.brg_nama
     LIMIT 50`,
    [like, like, like],
  );
  return rows;
};

// ─────────────────────────────────────────────
// getAksesorisByKode — resolve satu kode saat diketik langsung di grid
// Delphi: loadkode(ckode) → validasi + isi nama, satuan, ready, free, po
// ─────────────────────────────────────────────
const getAksesorisByKode = async (
  kode,
  spkJumlah = 0,
  excludeMkaNomor = "",
) => {
  const [rows] = await db.query(
    `SELECT b.brg_kode AS kode,
            IF(b.brg_note = '', b.brg_nama,
               CONCAT(b.brg_nama, ' - ', b.brg_note)) AS nama,
            b.brg_satuan AS satuan,
            IFNULL((
              SELECT SUM(m.mst_stok_in - m.mst_stok_out)
              FROM tmasterstok_acc m
              WHERE m.mst_aktif = 'Y'
                AND m.mst_brg_kode = b.brg_kode
            ), 0) AS ready
     FROM tgarmen_brg b
     WHERE b.brg_jenis = 'ACCESORIES'
       AND b.brg_kode = ?`,
    [kode],
  );

  if (!rows.length) return null;

  const row = rows[0];
  const ready = parseFloat(row.ready) || 0;
  const terpakai = await getMkaTerpakai(kode, excludeMkaNomor);

  return {
    kode: row.kode,
    nama: row.nama,
    satuan: row.satuan,
    pemakaian: 0,
    jumlah: 0, // akan dihitung frontend saat pemakaian diisi
    ready,
    free: ready - terpakai,
    po: 0,
    keterangan: "",
  };
};

// ─────────────────────────────────────────────
// saveData — create / update
// Delphi: simpandata()
// Pattern: delete-all dtl dulu, insert ulang (replace pattern)
// ─────────────────────────────────────────────
const saveData = async (payload, userKode) => {
  const {
    mkb_nomor, // kosong = create baru
    mkb_tanggal,
    mkb_spk_nomor, // create: boleh nomor SO / MAP / SPK, diterjemahkan ke SPK
    mkb_note,
    detail = [],
  } = payload;

  // Validasi
  if (!detail.length) throw new Error("Detail tidak boleh kosong");

  const hasEmpty = detail.some((d) => !d.nama || parseFloat(d.jumlah) === 0);
  if (hasEmpty) throw new Error("Jumlah detail tidak boleh 0");

  // Create: terjemahkan input ke satu SPK + validasi divisi di server
  let spkNomor = "";
  if (!mkb_nomor) {
    const hasil = await resolveSpk(mkb_spk_nomor);
    if (hasil.error) throw new Error(hasil.error);
    if (!DIVISI_MKA.includes(String(hasil.spk.spk_divisi))) {
      throw new Error("MKA hanya untuk divisi 3 dan 4");
    }
    spkNomor = hasil.spk.spk_nomor;
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const tahun = new Date(mkb_tanggal).getFullYear();
    let nomor = mkb_nomor;

    if (nomor) {
      // UPDATE header
      await conn.query(
        `UPDATE tmka_hdr SET
           mkb_tanggal    = ?,
           mkb_note       = ?,
           date_modified  = NOW(),
           user_modified  = ?
         WHERE mkb_nomor = ?`,
        [mkb_tanggal, mkb_note || "", userKode, nomor],
      );
      // Catatan: mkb_spk_nomor tidak boleh diubah saat edit (Delphi: disabled)
    } else {
      // CREATE — generate nomor (mengunci tabel per tahun)
      nomor = await generateNomor(conn, tahun);

      // Cek duplikat setelah lock: satu SPK hanya boleh punya satu MKA
      const [dup] = await conn.query(
        `SELECT mkb_nomor FROM tmka_hdr WHERE mkb_spk_nomor = ? LIMIT 1`,
        [spkNomor],
      );
      if (dup.length) {
        throw new Error(`SPK ini sudah punya MKA (${dup[0].mkb_nomor})`);
      }

      await conn.query(
        `INSERT INTO tmka_hdr
          (mkb_nomor, mkb_tanggal, mkb_note, mkb_spk_nomor, date_create, user_create)
         VALUES (?, ?, ?, ?, NOW(), ?)`,
        [nomor, mkb_tanggal, mkb_note || "", spkNomor, userKode],
      );
    }

    // Delete semua detail lama → insert ulang
    await conn.query(`DELETE FROM tmka_dtl WHERE mkbd_nomor = ?`, [nomor]);

    for (let i = 0; i < detail.length; i++) {
      const d = detail[i];
      if (!d.nama) continue; // skip baris kosong
      await conn.query(
        `INSERT INTO tmka_dtl
           (mkbd_nomor, mkbd_brg_kode, mkbd_pemakaian, mkbd_jumlah,
            mkbd_jumlah_po, mkbd_keterangan, mkbd_nourut)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          nomor,
          d.kode,
          parseFloat(d.pemakaian) || 0,
          parseFloat(d.jumlah) || 0,
          parseFloat(d.po) || 0,
          d.keterangan || "",
          i + 1,
        ],
      );
    }

    await conn.commit();
    return { nomor };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────
// deleteData
// ─────────────────────────────────────────────
const deleteData = async (nomor) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM tmka_dtl WHERE mkbd_nomor = ?`, [nomor]);
    await conn.query(`DELETE FROM tmka_hdr WHERE mkb_nomor = ?`, [nomor]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

module.exports = {
  generateNomor,
  getMkaTerpakai,
  getDetail,
  getSpkInfo,
  getAksesorisMaster,
  getAksesorisByKode,
  saveData,
  deleteData,
};
