const db = require("../../config/database");

const generateNomor = async (conn) => {
  const year = new Date().getFullYear();
  const [[last]] = await conn.query(
    `SELECT sjk_nomor FROM tmaklon_sj_keluar_hdr WHERE sjk_nomor LIKE ? ORDER BY sjk_nomor DESC LIMIT 1 FOR UPDATE`,
    [`SJ-MKL.${year}.%`],
  );
  const nextUrut = last ? parseInt(last.sjk_nomor.split(".")[2], 10) + 1 : 1;
  return `SJ-MKL.${year}.${String(nextUrut).padStart(5, "0")}`;
};

// ─────────────────────────────────────────────────────────
// Data untuk dialog — sisa qty per baris yang belum terkirim.
// Baris yang sisa=0 (sudah full terkirim sebelumnya) tetap
// ditampilkan sebagai info, tapi tidak bisa diisi lagi di frontend.
// ─────────────────────────────────────────────────────────
const getDetailUntukDialog = async (mklNomor) => {
  const [[header]] = await db.query(
    `SELECT h.mkl_nomor, h.mkl_tanggal, h.mkl_cab_asal, h.mkl_cab_tujuan, h.mkl_status,
            ga.pab_nama AS NamaCabAsal, gt.pab_nama AS NamaCabTujuan
     FROM tmaklon_hdr h
     LEFT JOIN tpabrik ga ON ga.pab_kode = h.mkl_cab_asal
     LEFT JOIN tpabrik gt ON gt.pab_kode = h.mkl_cab_tujuan
     WHERE h.mkl_nomor = ?`,
    [mklNomor],
  );
  if (!header) throw new Error("Nomor Maklon tidak ditemukan.");

  const [details] = await db.query(
    `SELECT d.mkld_id, d.mkld_kode_polos,
            IF(d.mkld_is_freetext = 1, d.mkld_nama_polos_manual, b.brg_nama) AS NamaPolos,
            d.mkld_qty_kirim, d.mkld_satuan_kirim, d.mkld_qty_sudah_kirim,
            (d.mkld_qty_kirim - d.mkld_qty_sudah_kirim) AS Sisa,
            d.mkld_keterangan
     FROM tmaklon_dtl d
     LEFT JOIN tgarmen_brg b ON b.brg_kode = d.mkld_kode_polos
     WHERE d.mkld_mkl_nomor = ?
     ORDER BY d.mkld_id`,
    [mklNomor],
  );

  return { header, details };
};

// ─────────────────────────────────────────────────────────
// CREATE — items: [{ mkld_id, qty }], boleh sebagian baris/qty.
// ─────────────────────────────────────────────────────────
const createSjKeluar = async (mklNomor, tanggal, items, user) => {
  if (!items || !items.length) {
    throw new Error("Minimal 1 baris harus diisi qty kirimnya.");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[hdr]] = await conn.query(
      `SELECT mkl_nomor, mkl_status FROM tmaklon_hdr WHERE mkl_nomor = ? FOR UPDATE`,
      [mklNomor],
    );
    if (!hdr) throw new Error("Nomor Maklon tidak ditemukan.");
    if (hdr.mkl_status === "DIKIRIM") {
      throw new Error("Semua barang pada Maklon ini sudah terkirim penuh.");
    }

    const nomor = await generateNomor(conn);
    await conn.query(
      `INSERT INTO tmaklon_sj_keluar_hdr (sjk_nomor, sjk_mkl_nomor, sjk_tanggal, sjk_user_create, sjk_date_create)
       VALUES (?, ?, ?, ?, NOW())`,
      [nomor, mklNomor, tanggal, user.kode],
    );

    for (const item of items) {
      const qty = Number(item.qty) || 0;
      if (qty <= 0) continue;

      const [[row]] = await conn.query(
        `SELECT mkld_qty_kirim, mkld_qty_sudah_kirim FROM tmaklon_dtl
         WHERE mkld_id = ? AND mkld_mkl_nomor = ? FOR UPDATE`,
        [item.mkld_id, mklNomor],
      );
      if (!row)
        throw new Error(`Baris detail ${item.mkld_id} tidak ditemukan.`);

      const sisa =
        Number(row.mkld_qty_kirim) - Number(row.mkld_qty_sudah_kirim);
      if (qty > sisa) {
        throw new Error(
          `Qty kirim (${qty}) melebihi sisa yang belum dikirim (${sisa}) pada baris ini.`,
        );
      }

      await conn.query(
        `INSERT INTO tmaklon_sj_keluar_dtl (sjkd_sjk_nomor, sjkd_mkld_id, sjkd_qty_kirim)
         VALUES (?, ?, ?)`,
        [nomor, item.mkld_id, qty],
      );
      // Trigger tmaklon_sj_keluar_dtl_after_insert otomatis: kurangi
      // stok polos, update mkld_qty_sudah_kirim, update status header.
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

const getPrintData = async (sjkNomor) => {
  const [[header]] = await db.query(
    `SELECT h.sjk_nomor, h.sjk_tanggal, h.sjk_mkl_nomor, h.sjk_user_create,
            m.mkl_cab_asal, m.mkl_cab_tujuan,
            ga.pab_nama AS NamaCabAsal, gt.pab_nama AS NamaCabTujuan
     FROM tmaklon_sj_keluar_hdr h
     JOIN tmaklon_hdr m ON m.mkl_nomor = h.sjk_mkl_nomor
     LEFT JOIN tpabrik ga ON ga.pab_kode = m.mkl_cab_asal
     LEFT JOIN tpabrik gt ON gt.pab_kode = m.mkl_cab_tujuan
     WHERE h.sjk_nomor = ?`,
    [sjkNomor],
  );
  if (!header) throw new Error("SJ Keluar tidak ditemukan.");

  const [details] = await db.query(
    `SELECT d.sjkd_qty_kirim, dd.mkld_kode_polos AS KodePolos,
            IF(dd.mkld_is_freetext = 1, dd.mkld_nama_polos_manual, b.brg_nama) AS NamaPolos,
            IF(dd.mkld_is_freetext = 1, dd.mkld_satuan_kirim, b.brg_satuan) AS Satuan,
            dd.mkld_keterangan AS Keterangan
     FROM tmaklon_sj_keluar_dtl d
     JOIN tmaklon_dtl dd ON dd.mkld_id = d.sjkd_mkld_id
     LEFT JOIN tgarmen_brg b ON b.brg_kode = dd.mkld_kode_polos
     WHERE d.sjkd_sjk_nomor = ?`,
    [sjkNomor],
  );

  return { header, details };
};

module.exports = { getDetailUntukDialog, createSjKeluar, getPrintData };
