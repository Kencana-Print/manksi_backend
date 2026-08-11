const db = require("../../config/database");

// ============================================================
// CETAK BARCODE KAOSAN — FORM SERVICE
// Replikasi ufrmBcd.pas. Header: tbarcode_hdr, Detail: tbarcode_dtl.
// Field CDS Delphi: kode (SPK nomor ATAU kode kaosan dasar — dua-duanya
// dipakai sebagai bcd_spk_nomor), kodek (kode item/variant — bcd_kode),
// tglspk, barcode, nama, ukuran, order (qty referensi, tidak disimpan),
// awal, akhir, jumlah, harga (referensi print, tidak disimpan), cetak,
// packing, kodex (duplikat kode, tidak dipakai backend).
// ============================================================

// ─────────────────────────────────────────────
// GENERATE NOMOR — format BCD.{yymm}{00001}, replikasi getmaxnomor()
// ─────────────────────────────────────────────
const getMaxNomor = async (conn, tanggal) => {
  const d = new Date(tanggal);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const prefix = `BCD.${yy}${mm}`; // 8 karakter: "BCD." + yymm

  const [rows] = await conn.query(
    `SELECT IFNULL(MAX(RIGHT(bch_nomor, 5)), 0) AS jumlah
     FROM tbarcode_hdr
     WHERE LEFT(bch_nomor, 8) = ?
     FOR UPDATE`,
    [prefix],
  );
  const next = Number(rows[0].jumlah) + 1;
  return `${prefix}${String(next).padStart(5, "0")}`;
};

// ─────────────────────────────────────────────
// GET DETAIL — mode Ubah, replikasi loaddataall()
// ⚠️ Field 'nama' berbeda sumber tergantung divisi SPK: divisi 4
// (Garmen) pakai spk_nama, selain itu (divisi 3/Kaosan) pakai nama
// hasil CONCAT dari retail.tbarangdc — replikasi persis kondisi
// `if spk_divisi=4 then spk_nama else nama` di Delphi.
// ─────────────────────────────────────────────
const getDetail = async (nomor) => {
  const [headerRows] = await db.query(
    `SELECT bch_nomor AS nomor,
            DATE_FORMAT(bch_tanggal, '%Y-%m-%d') AS tanggal,
            bch_cab AS cab
     FROM tbarcode_hdr
     WHERE bch_nomor = ?`,
    [nomor],
  );
  if (headerRows.length === 0) return null;

  const [rows] = await db.query(
    `SELECT
       d.bcd_spk_nomor AS kode,
       d.bcd_kode AS kodek,
       d.bcd_ukuran AS ukuran,
       d.bcd_awal AS awal,
       d.bcd_akhir AS akhir,
       d.bcd_jumlah AS jumlah,
       d.bcd_packing AS packing,
       s.spk_nama AS spkNama,
       s.spk_divisi AS spkDivisi,
       DATE_FORMAT(s.spk_tanggal, '%Y-%m-%d') AS tglspk,
       CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna) AS namaKaosan,
       IF(b.brgd_barcode IS NULL, z.spks_barcode, b.brgd_barcode) AS barcode,
       IFNULL(b.brgd_harga, 0) AS harga,
       IF(c.spkd_qtyorder IS NULL, z.spks_qty, c.spkd_qtyorder) AS qtyorder
     FROM tbarcode_dtl d
     LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.bcd_kode
     LEFT JOIN retail.tbarangdc_dtl b ON b.brgd_kode = d.bcd_kode AND b.brgd_ukuran = d.bcd_ukuran
     LEFT JOIN tspk_dc c ON c.spkd_nomor = d.bcd_spk_nomor AND c.spkd_ukuran = d.bcd_ukuran
     LEFT JOIN tspk_size z ON z.spks_nomor = d.bcd_spk_nomor AND z.spks_size = d.bcd_ukuran
     LEFT JOIN tspk s ON s.spk_nomor = d.bcd_spk_nomor
     WHERE d.bcd_nomor = ?
     ORDER BY d.bcd_nourut`,
    [nomor],
  );

  const detail = rows.map((r) => {
    const barcode = r.barcode || "";
    return {
      kode: r.kode || "",
      kodek: r.kodek || "",
      tglspk: r.tglspk || "",
      barcode,
      nama: Number(r.spkDivisi) === 4 ? r.spkNama || "" : r.namaKaosan || "",
      ukuran: r.ukuran || "",
      order: Number(r.qtyorder) || 0,
      awal: Number(r.awal) || 0,
      akhir: Number(r.akhir) || 0,
      jumlah: Number(r.jumlah) || 0,
      harga: Number(r.harga) || 0,
      cetak: barcode !== "",
      packing: r.packing || "",
    };
  });

  return { header: headerRows[0], detail };
};

const searchKaosanMaster = async (keyword = "", limit = 50) => {
  const like = `%${keyword}%`;
  const [rows] = await db.query(
    `SELECT a.brg_kode AS Kode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS Nama
     FROM retail.tbarangdc a
     WHERE a.brg_aktif = 0 AND a.brg_logstok = 'Y'
       AND (a.brg_kode LIKE ? OR TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) LIKE ?)
     ORDER BY Nama
     LIMIT ?`,
    [like, like, Number(limit)],
  );
  return rows;
};

// ─────────────────────────────────────────────
// LOOKUP SPK (F1) — replikasi loadbrg(). Cabang query beda tergantung
// spk_divisi: 3 (Kaosan) pakai tspk_dc, selain itu (4/6, Garmen) pakai
// tspk_size. Dedup (kode+kodek+ukuran sudah ada di grid) TIDAK di sini
// — itu tanggung jawab frontend karena tergantung state grid saat ini.
// ─────────────────────────────────────────────
const lookupSpk = async (nomor) => {
  const [spkRows] = await db.query(
    `SELECT spk_nomor, spk_divisi, DATE_FORMAT(spk_tanggal, '%Y-%m-%d') AS spk_tanggal
     FROM tspk
     WHERE spk_aktif = 'Y' AND spk_divisi IN (3, 4, 6) AND spk_nomor = ?`,
    [nomor],
  );
  if (spkRows.length === 0) {
    return { exists: false, error: "Spk tsb tidak ada." };
  }
  const spk = spkRows[0];
  const isDivisi3 = Number(spk.spk_divisi) === 3;

  let rows;
  if (isDivisi3) {
    [rows] = await db.query(
      `SELECT i.spkd_nomor AS kode, i.spkd_kode AS kodek,
              i.spkd_ukuran AS ukuran, i.spkd_qtyorder AS qtyorder,
              CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna) AS nama,
              b.brgd_barcode AS barcode, b.brgd_harga AS harga
       FROM tspk_dc i
       LEFT JOIN retail.tbarangdc a ON a.brg_kode = i.spkd_kode
       LEFT JOIN retail.tbarangdc_dtl b ON b.brgd_kode = i.spkd_kode AND b.brgd_ukuran = i.spkd_ukuran
       LEFT JOIN retail.tukuran u ON u.ukuran = i.spkd_ukuran AND u.kategori = ""
       WHERE i.spkd_nomor = ?
       ORDER BY u.kode`,
      [nomor],
    );
  } else {
    [rows] = await db.query(
      `SELECT s.spk_nomor AS kode, '' AS kodek, s.spk_nama AS nama,
              IFNULL(z.spks_size, '') AS ukuran,
              IFNULL(z.spks_barcode, '') AS barcode,
              IFNULL(z.spks_qty, 0) AS qtyorder,
              0 AS harga
       FROM tspk s
       LEFT JOIN tspk_size z ON z.spks_nomor = s.spk_nomor
       LEFT JOIN retail.tukuran u ON u.ukuran = z.spks_size AND u.kategori = ""
       WHERE s.spk_nomor = ?
       ORDER BY u.kode`,
      [nomor],
    );
  }

  const items = rows.map((r) => ({
    kode: r.kode,
    kodek: r.kodek || "",
    tglspk: spk.spk_tanggal || "",
    barcode: r.barcode || "",
    nama: r.nama || "",
    ukuran: r.ukuran || "",
    order: Number(r.qtyorder) || 0,
    harga: Number(r.harga) || 0,
    cetak: (r.barcode || "") !== "",
  }));

  return { exists: true, spkNomor: nomor, spkDivisi: spk.spk_divisi, items };
};

// ─────────────────────────────────────────────
// LOOKUP KODE KAOSAN (F2) — replikasi loadkaos(). Semua item hasil
// query di-set kode=kodek=kodex=parameter `kode` (base code) — replika
// persis Delphi (bukan brgd_kode per baris, tapi anomor itu sendiri).
// ─────────────────────────────────────────────
const lookupKodeKaosan = async (kode) => {
  const [rows] = await db.query(
    `SELECT b.brgd_barcode AS barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            b.brgd_ukuran AS ukuran, b.brgd_harga AS harga
     FROM retail.tbarangdc_dtl b
     INNER JOIN retail.tbarangdc a ON a.brg_kode = b.brgd_kode
     LEFT JOIN retail.tukuran u ON u.ukuran = b.brgd_ukuran AND u.kategori = ""
     WHERE b.brgd_kode = ?
     ORDER BY u.kode`,
    [kode],
  );

  const items = rows.map((r) => ({
    kode,
    kodek: kode,
    tglspk: "",
    barcode: r.barcode || "",
    nama: r.nama || "",
    ukuran: r.ukuran || "",
    order: 0,
    harga: Number(r.harga) || 0,
    cetak: (r.barcode || "") !== "",
  }));

  return { items };
};

// ─────────────────────────────────────────────
// LOOKUP BY BARCODE (scan) — replikasi edtBarcodeKeyPress(). Bisa
// return >1 kode dasar kalau barcode itu match ke beberapa brg_kode
// (jarang terjadi, tapi direplikasi apa adanya). Frontend nampilin
// pilihan (kalau >1 distinct Kode), user pilih satu, lalu panggil
// lookupKodeKaosan(kode) — sama seperti alur Delphi (loadkaos setelah
// user pilih dari modal bantu).
// ─────────────────────────────────────────────
const lookupByBarcode = async (barcode) => {
  const [rows] = await db.query(
    `SELECT a.brg_kode AS Kode, b.brgd_barcode AS Barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS Nama,
            b.brgd_ukuran AS Size, b.brgd_harga AS HargaJual
     FROM retail.tbarangdc a
     LEFT JOIN retail.tbarangdc_dtl b ON b.brgd_kode = a.brg_kode
     LEFT JOIN retail.tukuran u ON u.ukuran = b.brgd_ukuran AND u.kategori = ""
     WHERE a.brg_kode IN (
       SELECT i.brgd_kode FROM retail.tbarangdc_dtl i WHERE i.brgd_barcode = ?
     )
     ORDER BY u.kode`,
    [barcode],
  );
  return rows;
};

// ─────────────────────────────────────────────
// SAVE DATA — replikasi simpandata() + validasi F10 handler
// ─────────────────────────────────────────────
const saveData = async (payload, user) => {
  const { isEdit, nomor: nomorPayload, tanggal, cab, detail = [] } = payload;

  // Validasi — replikasi persis urutan & pesan Delphi
  const validRows = detail.filter((d) => (d.nama || "").trim() !== "");
  if (validRows.length === 0) {
    throw new Error("Detail harus diisi.");
  }
  for (const d of validRows) {
    if (d.cetak) {
      if (Number(d.awal) === 0 || Number(d.akhir) === 0) {
        throw new Error("Awal atau Akhir harus diisi.");
      }
      if (Number(d.awal) > Number(d.akhir)) {
        throw new Error("Awal tidak boleh > Akhir.");
      }
    }
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomor;
    if (isEdit) {
      nomor = nomorPayload;
      const [exist] = await conn.query(
        `SELECT bch_nomor FROM tbarcode_hdr WHERE bch_nomor = ? FOR UPDATE`,
        [nomor],
      );
      if (exist.length === 0) throw new Error("Data tidak ditemukan.");

      await conn.query(
        `UPDATE tbarcode_hdr
         SET bch_tanggal = ?, user_modified = ?, date_modified = NOW()
         WHERE bch_nomor = ?`,
        [tanggal, user.kode, nomor],
      );
    } else {
      nomor = await getMaxNomor(conn, tanggal);
      await conn.query(
        `INSERT INTO tbarcode_hdr (bch_nomor, bch_tanggal, bch_cab, user_create, date_create)
         VALUES (?, ?, ?, ?, NOW())`,
        [nomor, tanggal, cab, user.kode],
      );
    }

    // Replace detail — replikasi delete-all lalu insert ulang.
    // ⚠️ nourut = POSISI ASLI baris di array (1-based), BUKAN nomor
    // urut hasil filter — replikasi persis Delphi (`Inc(i)` jalan
    // tiap iterasi CDS.Next, terlepas baris itu di-insert atau di-skip
    // karena nama kosong).
    await conn.query(`DELETE FROM tbarcode_dtl WHERE bcd_nomor = ?`, [nomor]);

    for (let i = 0; i < detail.length; i++) {
      const d = detail[i];
      if ((d.nama || "").trim() === "") continue;
      await conn.query(
        `INSERT INTO tbarcode_dtl
           (bcd_nomor, bcd_spk_nomor, bcd_kode, bcd_ukuran, bcd_awal, bcd_akhir, bcd_jumlah, bcd_packing, bcd_nourut)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nomor,
          d.kode || "",
          d.kodek || "",
          d.ukuran || "",
          Number(d.awal) || 0,
          Number(d.akhir) || 0,
          Number(d.jumlah) || 0,
          d.packing || "",
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

module.exports = {
  getDetail,
  lookupSpk,
  searchKaosanMaster,
  lookupKodeKaosan,
  lookupByBarcode,
  saveData,
};
