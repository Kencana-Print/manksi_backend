const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

const MODUL_TUTUP_BUKU = "KOREKSI GARMEN";

const PREFIX_MAP = {
  ACCESORIES: "KRA",
  OBAT: "KRO",
  SPAREPART: "KRS",
  "ATK/RTK": "KRK",
};
const STOK_TABLE_MAP = {
  ACCESORIES: "tmasterstok_acc",
  OBAT: "tmasterstok_obat",
  SPAREPART: "tmasterstok_sparepart",
  "ATK/RTK": "tmasterstok_atk",
};

// ── generateNomor: KRA+tahun+5digit, TANPA separator ──
const generateNomor = async (conn, jenis, tahun) => {
  const prefix = PREFIX_MAP[jenis];
  const [rows] = await conn.query(
    `SELECT IFNULL(MAX(RIGHT(kor_nomor, 5)), 0) AS jumlah FROM tgarmenkor_hdr
     WHERE LEFT(kor_nomor, 7) = ? FOR UPDATE`,
    [prefix + tahun],
  );
  const next = 100001 + Number(rows[0].jumlah);
  return `${prefix}${tahun}${String(next).slice(-5)}`;
};

// ── cekkor: validasi kode+tanggal belum dikoreksi di nomor LAIN ──
const cekKor = async (jenis, kode, tanggal, currentNomor) => {
  const table = STOK_TABLE_MAP[jenis];
  const prefix = PREFIX_MAP[jenis];
  const [rows] = await db.query(
    `SELECT mst_noreferensi FROM ${table}
     WHERE mst_aktif = "Y" AND LEFT(mst_noreferensi, 3) = ?
       AND mst_tanggal = ? AND mst_brg_kode = ?
     LIMIT 1`,
    [prefix, tanggal, kode],
  );
  if (rows.length > 0 && rows[0].mst_noreferensi !== (currentNomor || "")) {
    return { duplicate: true, existingNomor: rows[0].mst_noreferensi };
  }
  return { duplicate: false };
};

// ── resolveKode: dipanggil saat kode dipilih/diketik (loadkode) ──
// Menjalankan cekKor DULU (sesuai urutan Delphi), baru fetch info barang.
// Dedup "sudah ada di baris lain dalam grid" TIDAK dicek di sini —
// itu murni client-side (Delphi loop cxGrdMaster di memory, bukan query
// DB), jadi frontend yang tanggung jawab cek itu sebelum insert row.
const resolveKode = async (
  jenis,
  kode,
  cabang,
  tanggal,
  currentNomor,
  bagian,
) => {
  const cekResult = await cekKor(jenis, kode, tanggal, currentNomor);
  if (cekResult.duplicate) {
    throw new Error(
      `Sudah ada koreksi pada tgl tsb dengan No: ${cekResult.existingNomor}`,
    );
  }

  const stokTable = STOK_TABLE_MAP[jenis];
  let where = `b.brg_aktif = "Y" AND b.brg_kode = ? AND b.brg_jenis = ?`;
  const params = [cabang, kode, jenis];
  // Perhatikan: cabang jadi param PERTAMA krn dipakai di subquery SELECT
  // (muncul lebih dulu secara tekstual), bukan di WHERE
  if (bagian === "TEKNISI") where += ` AND b.brg_ktg <> "IT"`;
  else if (bagian === "IT") where += ` AND b.brg_ktg = "IT"`;

  const [rows] = await db.query(
    `SELECT b.brg_kode AS Kode,
       IF(b.brg_note = "", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
       b.brg_satuan AS Satuan,
       IFNULL((
         SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM ${stokTable} m
         WHERE m.mst_aktif = "Y" AND m.mst_cab = ? AND m.mst_brg_kode = b.brg_kode
       ), 0) AS Stok
     FROM tgarmen_brg b
     WHERE ${where}`,
    params,
  );

  if (rows.length === 0) {
    throw new Error("Kode tsb tidak ada.");
  }
  return rows[0];
};

// ── search barang untuk modal F1/F2 (list, bukan resolve tunggal) ──
const searchBarang = async (
  jenis,
  cabang,
  bagian,
  keyword,
  page = 1,
  limit = 50,
) => {
  const stokTable = STOK_TABLE_MAP[jenis];
  if (!stokTable) throw new Error("Jenis tidak valid.");

  const where = ['b.brg_aktif = "Y"', "b.brg_jenis = ?"];
  const params = [jenis];
  if (bagian === "TEKNISI") where.push('b.brg_ktg <> "IT"');
  else if (bagian === "IT") where.push('b.brg_ktg = "IT"');
  if (keyword) {
    where.push("(b.brg_kode LIKE ? OR b.brg_nama LIKE ?)");
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const whereSql = where.join(" AND ");

  const [countRows] = await db.query(
    `SELECT COUNT(*) AS total FROM tgarmen_brg b WHERE ${whereSql}`,
    params,
  );
  const total = Number(countRows[0].total);

  const offset = (page - 1) * limit;
  const [rows] = await db.query(
    `SELECT b.brg_kode AS Kode,
       IF(b.brg_note = "", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
       b.brg_satuan AS Satuan,
       IFNULL((
         SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM ${stokTable} m
         WHERE m.mst_aktif = "Y" AND m.mst_cab = ? AND m.mst_brg_kode = b.brg_kode
       ), 0) AS Stok
     FROM tgarmen_brg b
     WHERE ${whereSql}
     ORDER BY b.brg_nama
     LIMIT ? OFFSET ?`,
    [cabang, ...params, limit, offset],
  );

  return { items: rows, total };
};

// ── computeStatus & resolveEditStatus: status pengajuan tutup buku (PIN5),
// pola sama persis dgn Retur Barang, cuma pin_trs beda ──
const computeStatus = async (nomor) => {
  const [rows] = await db.query(
    `SELECT pin_urut, pin_acc, pin_dipakai FROM tspk_pin5
     WHERE pin_trs = "KOREKSI GARMEN" AND pin_nomor = ?
     ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );
  if (rows.length === 0) return { status: "MINTA", urut: 0 };
  const { pin_urut, pin_acc, pin_dipakai } = rows[0];
  if (pin_acc === "" && pin_dipakai === "")
    return { status: "WAIT", urut: pin_urut };
  if (pin_acc === "Y" && pin_dipakai === "")
    return { status: "ACC", urut: pin_urut };
  if (pin_acc === "N") return { status: "TOLAK", urut: pin_urut };
  return { status: "MINTA", urut: pin_urut };
};

const resolveEditStatus = async (nomor, tanggal) => {
  const boundary =
    await tutupBukuService.getTanggalTutupBukuUntukTanggal(tanggal);
  const zClose = await tutupBukuService.getManualTutupBuku(MODUL_TUTUP_BUKU);
  const today = new Date();
  const tglTrs = new Date(tanggal);

  const perluCek = zClose === null ? boundary < today : tglTrs < zClose;
  if (!perluCek) return { status: "", urut: 0 };

  if (zClose === null) return computeStatus(nomor);
  if (tglTrs >= zClose) return { status: "", urut: 0 };
  return computeStatus(nomor);
};

const checkCanSave = async (tanggal, statusPin5) => {
  if (["MINTA", "WAIT", "TOLAK"].includes(statusPin5)) {
    throw new Error(
      "Transaksi tsb sudah diclose. Silahkan minta approve untuk bisa menyimpan perubahan data.",
    );
  }

  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  const awalPeriode = new Date(zdtClose.getFullYear(), zdtClose.getMonth(), 1);
  const zClose = await tutupBukuService.getManualTutupBuku(MODUL_TUTUP_BUKU);
  const tglTrs = new Date(tanggal);

  const dalamPeriodeTerbuka = tglTrs <= zdtClose && tglTrs >= awalPeriode;
  const setelahBoundary = tglTrs >= zdtClose;

  const boleh =
    zClose === null
      ? dalamPeriodeTerbuka || setelahBoundary || statusPin5 === "ACC"
      : tglTrs >= zClose ||
        dalamPeriodeTerbuka ||
        setelahBoundary ||
        statusPin5 === "ACC";

  if (!boleh) {
    throw new Error(
      "Anda tidak boleh input di tanggal periode yg sudah diclose.",
    );
  }
};

// ── Load data untuk form edit (loaddataall) ──
const getFormData = async (nomor) => {
  const q = `
    SELECT h.kor_nomor, h.kor_jenis, h.kor_tanggal, h.kor_cab, h.kor_ket,
      d.kord_brg_kode, d.kord_stok, d.kord_qty, d.kord_selisih, d.kord_ket,
      IF(b.brg_note = "", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
      b.brg_satuan
    FROM tgarmenkor_hdr h
    INNER JOIN tgarmenkor_dtl d ON d.kord_nomor = h.kor_nomor
    LEFT JOIN tgarmen_brg b ON b.brg_kode = d.kord_brg_kode
    WHERE h.kor_nomor = ?
    ORDER BY d.kord_nomor
  `;
  const [rows] = await db.query(q, [nomor]);
  if (rows.length === 0) throw new Error("Nomor tersebut belum ada.");

  const header = rows[0];
  const details = rows
    .filter((r) => r.kord_brg_kode)
    .map((r) => ({
      kode: r.kord_brg_kode,
      nama: r.Nama,
      satuan: r.brg_satuan,
      stok: Number(r.kord_stok),
      jumlah: Number(r.kord_qty),
      selisih: Number(r.kord_selisih),
      keterangan: r.kord_ket,
    }));

  const { status } = await resolveEditStatus(nomor, header.kor_tanggal);

  return {
    nomor: header.kor_nomor,
    jenis: header.kor_jenis,
    tanggal: header.kor_tanggal,
    cabang: header.kor_cab,
    keterangan: header.kor_ket,
    statusPin5: status,
    details,
  };
};

// ── Validasi detail (replikasi VK_F10) ──
const validateDetails = (details) => {
  const filled = details.filter((d) => d.kode && d.kode.trim() !== "");
  if (filled.length === 0) {
    throw new Error("Detail barang harus diisi.");
  }
  for (const d of filled) {
    if (!d.keterangan || d.keterangan.trim() === "") {
      throw new Error("Detail Keterangan harus diisi.");
    }
    // ⚠️ Jumlah TIDAK divalidasi != 0 di source Delphi — beda dari Retur
    // Barang. Jumlah 0 valid (bisa saja koreksi memang menyatakan stok
    // seharusnya 0 di tanggal itu).
  }
  return filled;
};

/**
 * Simpan data (create baru atau update existing)
 */
const saveData = async (payload, user, existingNomor = null) => {
  const { jenis, tanggal, cabang, keterangan, details } = payload;

  if (!PREFIX_MAP[jenis]) throw new Error("Jenis tidak valid.");
  if (!keterangan || keterangan.trim() === "") {
    throw new Error("Keterangan harus diisi.");
  }

  const filledDetails = validateDetails(details);

  const isEdit = !!existingNomor;

  let statusPin5 = "";
  let urutPin5 = 0;
  if (isEdit) {
    const resolved = await resolveEditStatus(existingNomor, tanggal);
    statusPin5 = resolved.status;
    urutPin5 = resolved.urut;
  }

  await checkCanSave(tanggal, statusPin5);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomor = existingNomor;

    if (isEdit) {
      // ⚠️ kor_jenis TIDAK diupdate (immutable setelah create). kor_cab
      // BISA diupdate (cabang boleh diganti saat edit, sesuai source).
      await conn.query(
        `UPDATE tgarmenkor_hdr SET
           kor_tanggal = ?, kor_ket = ?, kor_cab = ?,
           date_modified = NOW(), user_modified = ?
         WHERE kor_nomor = ?`,
        [tanggal, keterangan, cabang, user.kode, nomor],
      );
    } else {
      const tahun = new Date(tanggal).getFullYear().toString();
      nomor = await generateNomor(conn, jenis, tahun);

      await conn.query(
        `INSERT INTO tgarmenkor_hdr
           (kor_jenis, kor_nomor, kor_tanggal, kor_ket, kor_cab, kor_bagian, user_create, date_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [jenis, nomor, tanggal, keterangan, cabang, user.bagian, user.kode],
      );
    }

    await conn.query(`DELETE FROM tgarmenkor_dtl WHERE kord_nomor = ?`, [
      nomor,
    ]);

    let urut = 0;
    for (const d of filledDetails) {
      urut += 1;
      await conn.query(
        `INSERT INTO tgarmenkor_dtl
           (kord_nomor, kord_brg_kode, kord_stok, kord_qty, kord_selisih, kord_ket, kord_nourut)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          nomor,
          d.kode,
          Number(d.stok) || 0,
          Number(d.jumlah) || 0,
          Number(d.selisih) || 0,
          d.keterangan,
          urut,
        ],
      );
    }

    if (isEdit && statusPin5 === "ACC") {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai = "Y"
         WHERE pin_trs = "KOREKSI GARMEN" AND pin_nomor = ? AND pin_urut = ?`,
        [nomor, urutPin5],
      );
    }

    await conn.commit();
    return nomor;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// ── Data untuk halaman cetak ──
// ⚠️ Source Delphi cetak() cuma ambil data mentah (header+detail+nama
// barang) — layout kop surat/garis/TTD didesain statis di file report
// FastReport (.fr3), tidak dari SQL. Info perusahaan (nama/alamat/telp)
// di sini diambil dari tperusahaan kode 'KP' — home company tetap,
// modul internal ini tidak multi-perusahaan seperti Invoice/SJ.
const getDataCetak = async (nomor) => {
  const [[header]] = await db.query(
    `SELECT h.kor_nomor, h.kor_jenis, h.kor_tanggal, h.kor_cab, h.kor_ket,
       h.user_create,
       p.perush_nama, p.perush_alamat, p.perush_telp
     FROM tgarmenkor_hdr h
     LEFT JOIN tperusahaan p ON p.perush_kode = "KP"
     WHERE h.kor_nomor = ?`,
    [nomor],
  );
  if (!header) throw new Error("Data tidak ditemukan.");

  const [detail] = await db.query(
    `SELECT d.kord_brg_kode AS Kode,
       IF(b.brg_note = "", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
       b.brg_satuan AS Satuan, d.kord_stok AS Stok, d.kord_qty AS Koreksi,
       d.kord_selisih AS Selisih, d.kord_ket AS Keterangan
     FROM tgarmenkor_dtl d
     LEFT JOIN tgarmen_brg b ON b.brg_kode = d.kord_brg_kode
     WHERE d.kord_nomor = ?
     ORDER BY d.kord_nourut`,
    [nomor],
  );

  const totalSelisih = detail.reduce((s, r) => s + Number(r.Selisih || 0), 0);

  return { header, detail, totalSelisih };
};

module.exports = {
  getFormData,
  saveData,
  resolveKode,
  searchBarang,
  getDataCetak,
};
