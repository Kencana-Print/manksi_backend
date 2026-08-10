const db = require("../../config/database");

/**
 * Browse LHK SO DTF/DTG (tabel `tdtf`) — replikasi ufrmBrowseDtf.pas.
 * Filter tanggal WAJIB, filter Cab OPSIONAL ("ALL" = tanpa filter,
 * sesuai cbCab.Text='ALL' di Delphi).
 *
 * NamaOrder: fallback berantai tspk -> tmemospk -> retail.tsodtf_hdr
 * (IFNULL(spk_nama, IFNULL(mspk_nama, sd_nama))) — replikasi persis,
 * cross-database ke `retail.tsodtf_hdr` sama seperti source asli.
 */
const getBrowseData = async (startDate, endDate, cab) => {
  const params = [startDate, endDate];
  let cabFilter = "";
  if (cab && cab !== "ALL") {
    cabFilter = " AND d.Cab = ?";
    params.push(cab);
  }

  // Delphi asli: WHERE tanggal >= :start AND tanggal <= :end (tanpa DATE()).
  // Di sini dibungkus DATE(d.Tanggal) sebagai pengaman kalau kolom
  // ternyata DATETIME (bukan DATE murni) — pola bug yang sudah pernah
  // ditemukan berulang di modul lain (lihat tutup buku & modul tanggal
  // lainnya). Tidak mengubah hasil filter kalau kolom memang DATE.
  //
  // ⚠️ ORDER BY di source Delphi DI-COMMENT (urutan tampil aslinya
  // undefined) — ditambah ORDER BY di sini supaya tampilan web
  // konsisten, TIDAK mengubah data yang di-filter.
  const q = `
    SELECT
      d.Tanggal,
      d.Cab,
      d.spk_nomor AS SPK,
      IFNULL(s.spk_nama, IFNULL(m.mspk_nama, h.sd_nama)) AS NamaOrder,
      d.Depan,
      d.Belakang,
      d.Lengan,
      d.Variasi,
      d.Saku,
      d.Panjang AS PanjangM,
      d.Buangan,
      d.Keterangan
    FROM tdtf d
    LEFT JOIN tspk s ON s.spk_nomor = d.spk_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = d.spk_nomor
    LEFT JOIN retail.tsodtf_hdr h ON h.sd_nomor = d.spk_nomor
    WHERE DATE(d.Tanggal) BETWEEN ? AND ?
    ${cabFilter}
    ORDER BY d.Tanggal, d.spk_nomor
  `;
  const [rows] = await db.query(q, params);

  const data = rows.map((r) => ({
    ...r,
    Depan: Number(r.Depan) || 0,
    Belakang: Number(r.Belakang) || 0,
    Lengan: Number(r.Lengan) || 0,
    Variasi: Number(r.Variasi) || 0,
    Saku: Number(r.Saku) || 0,
    PanjangM: Number(r.PanjangM) || 0,
    Buangan: Number(r.Buangan) || 0,
  }));

  // Footer summary — replikasi FooterKind:=skSum pada Columns[4..10]
  // (Depan, Belakang, Lengan, Variasi, Saku, Panjang(M), Buangan).
  const summary = data.reduce(
    (acc, r) => {
      acc.Depan += r.Depan;
      acc.Belakang += r.Belakang;
      acc.Lengan += r.Lengan;
      acc.Variasi += r.Variasi;
      acc.Saku += r.Saku;
      acc.PanjangM += r.PanjangM;
      acc.Buangan += r.Buangan;
      return acc;
    },
    {
      Depan: 0,
      Belakang: 0,
      Lengan: 0,
      Variasi: 0,
      Saku: 0,
      PanjangM: 0,
      Buangan: 0,
    },
  );

  return { rows: data, summary };
};

/**
 * Replikasi logic default Cab saat buka form "Baru" (cxButton2Click):
 *  - userCab (frmMenu.CAB, cabang home user) diprioritaskan kalau ada
 *    (user terkunci ke cabangnya sendiri).
 *  - kalau user TIDAK terkunci cabang (userCab kosong) DAN filter
 *    browse sedang 'ALL' -> default 'P04' (hardcode di Delphi,
 *    workshop DTF utama).
 *  - kalau user TIDAK terkunci cabang DAN filter browse bukan 'ALL'
 *    -> pakai cabang filter yang sedang aktif.
 */
const getDefaultCabForInsert = (userCab, filterCab) => {
  if (userCab) return userCab;
  if (!filterCab || filterCab === "ALL") return "P04";
  return filterCab;
};

/**
 * Replikasi validasi "Data tsb bukan cabang anda." di cxButton1Click
 * (edit) & cxButton4Click (hapus) — user yang terkunci ke satu cabang
 * (userCab tidak kosong) tidak boleh edit/hapus data cabang lain.
 */
const assertCabAccess = (rowCab, userCab) => {
  if (userCab && rowCab !== userCab) {
    const err = new Error("Data tersebut bukan cabang anda.");
    err.statusCode = 403;
    throw err;
  }
};

/**
 * Hapus baris tdtf. Composite key (spk_nomor + Cab + Tanggal) —
 * replikasi PERSIS WHERE clause cxButton4Click. tdtf tidak punya
 * single PK, jadi ketiga kolom ini wajib match semua.
 */
const deleteData = async (spkNomor, cab, tanggal, userCab) => {
  const [[row]] = await db.query(
    `SELECT Cab FROM tdtf WHERE spk_nomor = ? AND Cab = ? AND Tanggal = ? LIMIT 1`,
    [spkNomor, cab, tanggal],
  );
  if (!row) {
    const err = new Error("Data tidak ditemukan.");
    err.statusCode = 404;
    throw err;
  }
  assertCabAccess(row.Cab, userCab);

  await db.query(
    `DELETE FROM tdtf WHERE spk_nomor = ? AND Cab = ? AND Tanggal = ?`,
    [spkNomor, cab, tanggal],
  );
  return true;
};

/**
 * ⚠️ BELUM BISA DIFINALKAN — ufrmDtf.pas (form input Baru/Ubah) belum
 * di-share. Field & validasi di bawah HANYA berdasar kolom yang
 * terlihat di SELECT ufrmBrowseDtf.pas. JANGAN dipakai production
 * sebelum cross-check ke ufrmDtf.pas untuk: field wajib, validasi
 * numerik, apakah spk_nomor perlu lookup wajib ke tspk/tmemospk/
 * retail.tsodtf_hdr, dan default value lain yang mungkin di-set form.
 */
const createData = async (payload, userCab, filterCab) => {
  const cab = payload.Cab || getDefaultCabForInsert(userCab, filterCab);
  const tanggal = payload.Tanggal || new Date().toISOString().substring(0, 10);

  // TODO: validasi field wajib & numerik menyusul setelah ufrmDtf.pas di-share
  await db.query(
    `INSERT INTO tdtf (spk_nomor, Cab, Tanggal, Depan, Belakang, Lengan, Variasi, Saku, Panjang, Buangan, Keterangan)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.spk_nomor,
      cab,
      tanggal,
      Number(payload.Depan) || 0,
      Number(payload.Belakang) || 0,
      Number(payload.Lengan) || 0,
      Number(payload.Variasi) || 0,
      Number(payload.Saku) || 0,
      Number(payload.Panjang) || 0,
      Number(payload.Buangan) || 0,
      payload.Keterangan || "",
    ],
  );
  return { spk_nomor: payload.spk_nomor, Cab: cab, Tanggal: tanggal };
};

/**
 * ⚠️ Sama seperti createData — TODO menyusul setelah ufrmDtf.pas
 * di-share. Validasi cabang (assertCabAccess) SUDAH pasti dari source
 * browse form, jadi sudah diterapkan di sini.
 */
const updateData = async ({ spkNomor, cab, tanggal }, payload, userCab) => {
  const [[row]] = await db.query(
    `SELECT Cab FROM tdtf WHERE spk_nomor = ? AND Cab = ? AND Tanggal = ? LIMIT 1`,
    [spkNomor, cab, tanggal],
  );
  if (!row) {
    const err = new Error("Data tidak ditemukan.");
    err.statusCode = 404;
    throw err;
  }
  assertCabAccess(row.Cab, userCab);

  // TODO: field yang boleh diedit menyusul setelah ufrmDtf.pas di-share
  await db.query(
    `UPDATE tdtf SET Depan=?, Belakang=?, Lengan=?, Variasi=?, Saku=?, Panjang=?, Buangan=?, Keterangan=?
     WHERE spk_nomor = ? AND Cab = ? AND Tanggal = ?`,
    [
      Number(payload.Depan) || 0,
      Number(payload.Belakang) || 0,
      Number(payload.Lengan) || 0,
      Number(payload.Variasi) || 0,
      Number(payload.Saku) || 0,
      Number(payload.Panjang) || 0,
      Number(payload.Buangan) || 0,
      payload.Keterangan || "",
      spkNomor,
      cab,
      tanggal,
    ],
  );
  return true;
};

module.exports = {
  getBrowseData,
  getDefaultCabForInsert,
  createData,
  updateData,
  deleteData,
};
