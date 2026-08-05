const db = require("../../config/database");

const GDG_JADI_FLAG = 4;
const BRG_DIVISI = [3, 4, 6];

/**
 * loaddataall — ambil header + detail utk edit/print.
 * ⚠️ Beda dari source: query INI ikut select kor_gdg_kode + gdg_nama
 * dari record aslinya (fix bug field Gudang yang tidak ke-refresh di
 * source Delphi saat load record lain). Lihat catatan di response.
 */
const getFormData = async (nomor) => {
  const qHeader = `
    SELECT h.kor_nomor, h.kor_tanggal, h.kor_ket,
      h.kor_gdg_kode, g.gdg_nama
    FROM tkor_hdr h
    LEFT JOIN tgudang g ON g.gdg_kode = h.kor_gdg_kode
    WHERE h.kor_nomor = ?
  `;
  const [headerRows] = await db.query(qHeader, [nomor]);
  if (headerRows.length === 0) return null; // "Nomor tersebut belum ada."

  const qDetail = `
    SELECT d.kord_brg_kode AS kode, b.brg_name AS nama, "PCS" AS satuan,
      d.kord_stok AS stok, d.kord_qty AS jumlah, d.kord_selisih AS selisih,
      d.kord_hpp AS hpp, (d.kord_selisih * d.kord_hpp) AS total,
      d.kord_ket AS ket
    FROM tkor_dtl d
    LEFT JOIN tbarang b ON b.brg_kode = d.kord_brg_kode AND b.brg_divisi IN (?, ?, ?)
    WHERE d.kord_kor_nomor = ?
    ORDER BY d.kord_kor_nomor
  `;
  const [detailRows] = await db.query(qDetail, [...BRG_DIVISI, nomor]);

  return { ...headerRows[0], details: detailRows };
};

/**
 * edtgdgkodeExit — validasi kode gudang barang-jadi (gdg_jadi=4).
 */
const validateGudang = async (kode) => {
  const [rows] = await db.query(
    `SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_jadi = ? AND gdg_kode = ?`,
    [GDG_JADI_FLAG, kode],
  );
  if (rows.length === 0) return null; // "Kode gudang tsb tidak ada."
  return rows[0];
};

/**
 * cekkor — cek apakah barang ini SUDAH ada koreksi lain di tanggal yang
 * sama (ke tmasterstok_jadi, bukan tkor_hdr — replikasi persis).
 * excludeNomor = nomor koreksi yg lagi diedit (biar tidak nabrak diri
 * sendiri, sama seperti `edtNomor.Text<>FieldByName('mst_noreferensi')`).
 */
const cekKorDuplikat = async (tanggal, brgKode, excludeNomor) => {
  const [rows] = await db.query(
    `SELECT mst_noreferensi FROM tmasterstok_jadi
     WHERE LEFT(mst_noreferensi, 3) = 'KOR' AND mst_tanggal = ? AND mst_brg_kode = ?
     LIMIT 1`,
    [tanggal, brgKode],
  );
  if (rows.length === 0) return null;
  if (rows[0].mst_noreferensi === excludeNomor) return null;
  return rows[0].mst_noreferensi; // nomor koreksi yg bentrok
};

/**
 * loadbrg — resolve barang + stok real-time dari tmasterstok_jadi, plus
 * cek cekkor. Dipakai baik utk F1-search-confirm maupun manual-type+blur.
 */
const lookupBarang = async (kode, gdgKode, tanggal, excludeNomor) => {
  const qBarang = `
    SELECT b.brg_kode AS kode, b.brg_name AS nama, "PCS" AS satuan, b.brg_hpp AS hpp,
      IFNULL((
        SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok_jadi m
        WHERE m.mst_gdg_kode = ? AND m.mst_brg_kode = b.brg_kode
      ), 0) AS stok
    FROM tbarang b
    WHERE b.brg_divisi IN (?, ?, ?) AND b.brg_kode = ?
  `;
  const [rows] = await db.query(qBarang, [gdgKode, ...BRG_DIVISI, kode]);
  if (rows.length === 0) {
    return { found: false }; // "Kode tsb tidak ada."
  }

  const bentrokNomor = await cekKorDuplikat(tanggal, kode, excludeNomor);
  if (bentrokNomor) {
    return { found: true, duplikat: true, nomorBentrok: bentrokNomor };
  }

  const barang = rows[0];
  const jumlah = 0;
  const selisih = jumlah - barang.stok;
  return {
    found: true,
    duplikat: false,
    data: {
      kode: barang.kode,
      nama: barang.nama,
      satuan: barang.satuan,
      stok: barang.stok,
      jumlah,
      selisih,
      hpp: barang.hpp,
      total: selisih * barang.hpp,
    },
  };
};

const getMaxNomor = async (conn, tanggal) => {
  // ⚠️ Source .pas TIDAK pakai FOR UPDATE (race condition). Di sini
  // dikunci dalam transaction — pola established project.
  const [rows] = await conn.query(
    `SELECT IFNULL(MAX(RIGHT(kor_nomor, 4)), 0) AS mx FROM tkor_hdr
     WHERE LEFT(kor_nomor, 8) = ? FOR UPDATE`,
    [`KOR.${formatYYMM(tanggal)}`],
  );
  const next = Number(rows[0].mx) + 1;
  return `KOR.${formatYYMM(tanggal)}.${String(next).padStart(4, "0")}`;
};

const formatYYMM = (tanggal) => {
  const d = new Date(tanggal);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yy}${mm}`;
};

/**
 * simpandata — replikasi F10 SIMPAN: validasi header ket wajib, minimal
 * 1 detail, tiap detail wajib ket. Delete-then-reinsert tkor_dtl (trigger
 * yg urus tmasterstok_jadi). Re-cek cekkor di server (defense-in-depth,
 * tidak ada di source tapi perlu krn race condition antar user).
 */
const saveData = async (payload, user, isEdit) => {
  const { nomor, tanggal, keterangan, gdgKode, details } = payload;

  // Validasi 1: Keterangan header wajib
  if (!keterangan || !keterangan.trim()) {
    throw new Error("Keterangan harus diisi.");
  }

  const validDetails = (details || []).filter((d) => d.kode && d.kode.trim());

  // Validasi 2: minimal 1 detail barang
  if (validDetails.length === 0) {
    throw new Error("Detail barang harus diisi.");
  }

  // Validasi 3: tiap baris wajib keterangan
  for (const d of validDetails) {
    if (!d.ket || !d.ket.trim()) {
      throw new Error("Detail Keterangan harus diisi.");
    }
  }

  // Validasi tambahan (bukan dari source, defense-in-depth): duplikat
  // kode dalam 1 payload
  const kodeSet = new Set();
  for (const d of validDetails) {
    if (kodeSet.has(d.kode)) {
      throw new Error(`Barang ${d.kode} terduplikasi dalam 1 transaksi.`);
    }
    kodeSet.add(d.kode);
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let finalNomor = nomor;
    let finalGdgKode = gdgKode;

    if (isEdit) {
      const [rows] = await conn.query(
        `SELECT kor_nomor, kor_gdg_kode FROM tkor_hdr WHERE kor_nomor = ? FOR UPDATE`,
        [nomor],
      );
      if (rows.length === 0) throw new Error("Data koreksi tidak ditemukan.");

      // ⚠️ Gudang immutable saat edit (readonly di UI) — abaikan gdgKode
      // dari payload, pakai nilai asli di DB.
      finalGdgKode = rows[0].kor_gdg_kode;

      await conn.query(
        `UPDATE tkor_hdr SET kor_tanggal = ?, kor_ket = ?,
           user_modified = ?, date_modified = NOW()
         WHERE kor_nomor = ?`,
        [tanggal, keterangan, user.kode, nomor],
      );
    } else {
      const gudang = await validateGudang(gdgKode);
      if (!gudang) throw new Error("Kode gudang tsb tidak ada.");

      finalNomor = await getMaxNomor(conn, tanggal);

      await conn.query(
        `INSERT INTO tkor_hdr
           (kor_nomor, kor_tanggal, kor_gdg_kode, kor_ket, user_create, date_create)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [finalNomor, tanggal, gdgKode, keterangan, user.kode],
      );
    }

    // Re-cek cekkor di server, exclude diri sendiri
    for (const d of validDetails) {
      const bentrok = await cekKorDuplikat(tanggal, d.kode, finalNomor);
      if (bentrok) {
        throw new Error(
          `Barang ${d.kode} sudah ada koreksi pada tgl tsb dengan No: ${bentrok}`,
        );
      }
    }

    // Delete-then-reinsert-all (replikasi persis — trigger urus
    // tmasterstok_jadi saat insert/delete tkor_dtl)
    await conn.query(`DELETE FROM tkor_dtl WHERE kord_kor_nomor = ?`, [
      finalNomor,
    ]);

    for (const d of validDetails) {
      const selisih = Number(d.jumlah) - Number(d.stok);
      await conn.query(
        `INSERT INTO tkor_dtl
           (kord_kor_nomor, kord_brg_kode, kord_stok, kord_qty, kord_selisih, kord_hpp, kord_ket)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [finalNomor, d.kode, d.stok, d.jumlah, selisih, d.hpp, d.ket],
      );
    }

    await conn.commit();
    return { nomor: finalNomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

/**
 * Search barang buat modal pencarian (F1 pada kolom Kode) — replikasi
 * generic frmbantuan Delphi: filter Nama+Kode, order by nama, plus
 * hitung stok real-time per gdgKode.
 */
const searchBarang = async (q, gdgKode, page = 1, limit = 50) => {
  const offset = (page - 1) * limit;
  const like = `%${q || ""}%`;

  const qList = `
    SELECT b.brg_kode AS Kode, b.brg_name AS Nama, "PCS" AS Satuan, b.brg_hpp AS Hpp,
      IFNULL((
        SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok_jadi m
        WHERE m.mst_gdg_kode = ? AND m.mst_brg_kode = b.brg_kode
      ), 0) AS Stok
    FROM tbarang b
    WHERE b.brg_divisi IN (3, 4, 6) AND (b.brg_name LIKE ? OR b.brg_kode LIKE ?)
    ORDER BY b.brg_name
    LIMIT ? OFFSET ?
  `;
  const [items] = await db.query(qList, [gdgKode, like, like, limit, offset]);

  const [countRows] = await db.query(
    `SELECT COUNT(*) AS total FROM tbarang b
     WHERE b.brg_divisi IN (3, 4, 6) AND (b.brg_name LIKE ? OR b.brg_kode LIKE ?)`,
    [like, like],
  );

  return { items, total: countRows[0].total };
};

module.exports = {
  getFormData,
  validateGudang,
  lookupBarang,
  searchBarang,
  saveData,
};
