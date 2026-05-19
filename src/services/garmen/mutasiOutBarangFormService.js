const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// --- GENERATE NOMOR MUTASI OUT ---
const generateNomor = async (tanggal, jenis) => {
  const d = new Date(tanggal);
  const tahun = d.getFullYear(); // ex: 2026

  let prefix = "";
  if (jenis === "ACCESORIES") prefix = "MSOA";
  else if (jenis === "OBAT") prefix = "MSOO";
  else if (jenis === "SPAREPART") prefix = "MSOS";
  else prefix = "MSOK"; // ATK/RTK

  const prefixTahun = `${prefix}${tahun}`; // MSOA2026

  const query = `
    SELECT IFNULL(MAX(CAST(RIGHT(mso_nomor, 5) AS UNSIGNED)), 0) AS max_val 
    FROM tgarmenmso_hdr 
    WHERE LEFT(mso_nomor, 8) = ?
  `;
  const [[row]] = await db.query(query, [prefixTahun]);

  // Sesuai Delphi: ajumlah := 100001 + fields[0].AsFloat -> di string jadi RightStr(floatToStr(ajumlah), 5)
  const nextNum = parseInt(row.max_val, 10) + 1;
  const incrementStr = String(nextNum).padStart(5, "0"); // ex: 00001

  return `${prefixTahun}${incrementStr}`;
};

// --- AMBIL STOK REAL BERDASARKAN JENIS & CABANG ---
// Delphi: getstok() dan getmso()
const getStokReal = async (
  conn,
  kodeBahan,
  jenis,
  bagian,
  cabang,
  nomorSaatIni,
) => {
  let stokQuery = "";
  if (bagian === "FINANCE") {
    stokQuery = `SELECT IFNULL(SUM(mst_stok_in - mst_stok_out), 0) AS stk FROM finance.tmasterstok_finance WHERE mst_aktif="Y" AND mst_brg_kode=? AND mst_cab=?`;
  } else {
    if (jenis === "ACCESORIES") {
      stokQuery = `SELECT IFNULL(SUM(mst_stok_in - mst_stok_out), 0) AS stk FROM tmasterstok_acc WHERE mst_aktif="Y" AND mst_brg_kode=? AND mst_cab=?`;
    } else if (jenis === "OBAT") {
      stokQuery = `SELECT IFNULL(SUM(mst_stok_in - mst_stok_out), 0) AS stk FROM tmasterstok_obat WHERE mst_aktif="Y" AND mst_brg_kode=? AND mst_cab=?`;
    } else if (jenis === "SPAREPART") {
      stokQuery = `SELECT IFNULL(SUM(mst_stok_in - mst_stok_out), 0) AS stk FROM tmasterstok_sparepart WHERE mst_aktif="Y" AND mst_brg_kode=? AND mst_cab=?`;
    } else {
      stokQuery = `SELECT IFNULL(SUM(mst_stok_in - mst_stok_out), 0) AS stk FROM tmasterstok_atk WHERE mst_aktif="Y" AND mst_brg_kode=? AND mst_cab=?`;
    }
  }

  const [[rowStok]] = await conn.query(stokQuery, [kodeBahan, cabang]);
  const stok = Number(rowStok?.stk || 0);

  // LOGIKA 1:1 DENGAN DELPHI LOADDATAALL
  // Pengurangan Stok Real dan pencarian "msoSisa" HANYA terjadi jika bagian === "FINANCE"
  if (bagian === "FINANCE") {
    const [[rowMso]] = await conn.query(
      `SELECT IFNULL(SUM(d.msod_jumlah), 0) AS jml 
       FROM tgarmenmso_hdr h 
       INNER JOIN tgarmenmso_dtl d ON d.msod_nomor=h.mso_nomor 
       WHERE h.mso_msi_nomor="" AND h.mso_nomor <> ? AND d.msod_brg_kode=?`,
      [nomorSaatIni || "", kodeBahan],
    );
    const msoSisa = Number(rowMso?.jml || 0);
    return { stok, msoSisa, real: stok - msoSisa };
  } else {
    // Jika bukan FINANCE, mso (Belum Diterima) dan real (Stok Real) dikosongkan (0)
    return { stok, msoSisa: 0, real: 0 };
  }
};

// --- GET BY ID (LOAD DATA) ---
const getDetail = async (nomor) => {
  const queryHdr = `
    SELECT 
      mso_nomor AS Nomor,
      mso_jenis AS Jenis,
      DATE_FORMAT(mso_tanggal, "%Y-%m-%d") AS Tanggal,
      mso_cab AS CabangAsal,
      mso_kecab AS CabangTujuan,
      mso_bagian AS Bagian,
      mso_ket AS Keterangan,
      mso_msi_nomor AS NoTerima,
      user_create AS Usr,
      
      IFNULL((
        SELECT IFNULL(
          IF(pin_acc="" AND pin_dipakai="", "WAIT",
            IF(pin_acc="Y" AND pin_dipakai="", "ACC",
              IF(pin_acc="Y" AND pin_dipakai="Y", "",
                IF(pin_acc="N", "TOLAK", "")
              )
            )
          ), ""
        )
        FROM tspk_pin5 
        WHERE pin_trs="MUTASI OUT" AND pin_nomor=mso_nomor 
        ORDER BY pin_urut DESC LIMIT 1
      ), "") AS StatusEdit
      
    FROM tgarmenmso_hdr
    WHERE mso_nomor = ?
  `;

  const [rowsHdr] = await db.query(queryHdr, [nomor]);
  if (rowsHdr.length === 0) return null;

  const data = { ...rowsHdr[0], Detail: [] };

  const queryDtl = `
    SELECT 
      d.msod_mb_nomor AS NoPermintaan,
      d.msod_brg_kode AS Kode,
      IF(b.brg_note="", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
      b.brg_satuan AS Satuan,
      d.msod_ket AS Spesifikasi,
      d.msod_jumlah AS Jumlah
    FROM tgarmenmso_dtl d
    LEFT JOIN tgarmen_brg b ON b.brg_kode = d.msod_brg_kode
    WHERE d.msod_nomor = ?
    ORDER BY d.msod_urut ASC
  `;

  const [rowsDtl] = await db.query(queryDtl, [nomor]);

  // Lengkapi dengan Stok Real (seperti saat buka di Delphi)
  const conn = await db.getConnection();
  try {
    for (const dtl of rowsDtl) {
      const stokInfo = await getStokReal(
        conn,
        dtl.Kode,
        data.Jenis,
        data.Bagian,
        data.CabangAsal,
        data.Nomor,
      );
      data.Detail.push({
        ...dtl,
        Stok: stokInfo.stok,
        StokBelumDiterima: stokInfo.msoSisa,
        StokReal: stokInfo.real,
      });
    }
  } finally {
    conn.release();
  }

  // --- LOGIKA TUTUP BUKU ---
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  const tglDokumen = new Date(data.Tanggal);

  data.isTutupBuku = false;
  if (zdtClose && tglDokumen < zdtClose) {
    data.isTutupBuku = true;
  }

  return data;
};

// --- CARI BARANG BERDASARKAN JENIS & BAGIAN (Lookup API) ---
const searchBarang = async (query) => {
  const { jenis, bagian, cabang, search } = query;

  let sql = `
    SELECT 
      b.brg_kode AS Kode,
      IF(b.brg_note="", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
      b.brg_satuan AS Satuan
  `;

  if (bagian === "FINANCE") {
    sql += `, IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM finance.tmasterstok_finance m WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_brg_kode=b.brg_kode), 0) AS Stok `;
  } else {
    if (jenis === "ACCESORIES")
      sql += `, IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok_acc m WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_brg_kode=b.brg_kode), 0) AS Stok `;
    else if (jenis === "OBAT")
      sql += `, IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok_obat m WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_brg_kode=b.brg_kode), 0) AS Stok `;
    else if (jenis === "SPAREPART")
      sql += `, IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok_sparepart m WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_brg_kode=b.brg_kode), 0) AS Stok `;
    else
      sql += `, IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok_atk m WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_brg_kode=b.brg_kode), 0) AS Stok `;
  }

  sql += `
    FROM tgarmen_brg b
    WHERE b.brg_aktif="Y" AND b.brg_jenis = ?
  `;
  const params = [cabang, jenis];

  if (bagian === "TEKNISI") {
    sql += ` AND b.brg_ktg <> "IT"`;
  } else if (bagian === "IT") {
    sql += ` AND b.brg_ktg = "IT"`;
  }

  if (search) {
    sql += ` AND (b.brg_nama LIKE ? OR b.brg_kode LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }

  sql += ` ORDER BY b.brg_nama LIMIT 100`;

  const [rows] = await db.query(sql, params);
  return rows;
};

// --- SAVE TRANSAKSI ---
const save = async (data, userKode, userBagian, isNewMode) => {
  // 1. Validasi Tutup Buku
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  const tglInput = new Date(data.Tanggal);

  if (zdtClose && tglInput < zdtClose) {
    throw new Error(
      "Anda tidak boleh input/edit di tanggal periode yang sudah diclose.",
    );
  }

  // 2. Validasi Mutasi sudah diterima
  if (!isNewMode && data.NoTerima && data.NoTerima.trim() !== "") {
    throw new Error("Mutasi tersebut sudah diterima. Tidak bisa diubah.");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomorMutasi = data.Nomor;

    // --- HEADER ---
    if (isNewMode) {
      nomorMutasi = await generateNomor(data.Tanggal, data.Jenis);

      const insertHdr = `
        INSERT INTO tgarmenmso_hdr (
          mso_jenis, mso_nomor, mso_tanggal, mso_cab, mso_kecab, mso_bagian, mso_ket, date_create, user_create
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?)
      `;
      await conn.query(insertHdr, [
        data.Jenis,
        nomorMutasi,
        data.Tanggal,
        data.CabangAsal,
        data.CabangTujuan,
        data.Bagian || userBagian,
        data.Keterangan || "",
        userKode,
      ]);
    } else {
      const updateHdr = `
        UPDATE tgarmenmso_hdr SET 
          mso_tanggal=?, mso_kecab=?, mso_ket=?, date_modified=NOW(), user_modified=?
        WHERE mso_nomor=?
      `;
      await conn.query(updateHdr, [
        data.Tanggal,
        data.CabangTujuan,
        data.Keterangan || "",
        userKode,
        nomorMutasi,
      ]);

      // Hapus detail lama
      await conn.query(`DELETE FROM tgarmenmso_dtl WHERE msod_nomor=?`, [
        nomorMutasi,
      ]);

      // Update PIN Jika Mode ACC
      if (data.StatusEdit === "ACC") {
        const [lastPin] = await conn.query(
          `SELECT pin_urut FROM tspk_pin5 WHERE pin_trs="MUTASI OUT" AND pin_nomor=? ORDER BY pin_urut DESC LIMIT 1`,
          [nomorMutasi],
        );
        if (lastPin.length > 0) {
          await conn.query(
            `UPDATE tspk_pin5 SET pin_dipakai="Y" WHERE pin_trs="MUTASI OUT" AND pin_nomor=? AND pin_urut=?`,
            [nomorMutasi, lastPin[0].pin_urut],
          );
        }
      }
    }

    // --- DETAIL ---
    if (data.Detail && data.Detail.length > 0) {
      const validDetails = data.Detail.filter(
        (d) => d.Kode && Number(d.Jumlah) > 0,
      );

      if (validDetails.length === 0) {
        throw new Error("Detail barang harus diisi (jumlah harus > 0).");
      }

      const values = validDetails.map((d, index) => [
        nomorMutasi,
        d.NoPermintaan || "",
        d.Kode,
        Number(d.Jumlah),
        d.Spesifikasi || "",
        index + 1, // Urut
      ]);

      await conn.query(
        `INSERT INTO tgarmenmso_dtl (msod_nomor, msod_mb_nomor, msod_brg_kode, msod_jumlah, msod_ket, msod_urut) VALUES ?`,
        [values],
      );
    }

    await conn.commit();
    return nomorMutasi;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// --- CARI NO. PERMINTAAN (KHUSUS FINANCE) ---
const searchPermintaanFinance = async (jenis, cabangTujuan, search) => {
  let sql = `
    SELECT 
      h.mb_jenis AS Jenis,
      h.mb_nomor AS NoPermintaan,
      DATE_FORMAT(h.mb_tanggal, '%Y-%m-%d') AS Tanggal,
      h.mb_ket AS Keterangan,
      h.mb_cab AS Cab,
      h.user_create AS Peminta
    FROM tgarmenmintabeli_hdr h
    WHERE h.mb_nomor IN (SELECT DISTINCT c.bond2_link FROM finance.tkasbonitem2 c WHERE LEFT(c.bond2_link, 2) = "MB")
    AND h.mb_jenis = ?
    AND h.mb_cab = ?
  `;
  const params = [jenis, cabangTujuan];

  if (search) {
    sql += ` AND (h.mb_nomor LIKE ? OR h.mb_ket LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }

  sql += ` ORDER BY h.mb_tanggal DESC LIMIT 50`;

  const [rows] = await db.query(sql, params);
  return rows;
};

// --- AMBIL DETAIL DARI NO PERMINTAAN (KHUSUS FINANCE) ---
const getDetailPermintaanFinance = async (
  noPermintaan,
  cabangAsal,
  nomorMso,
) => {
  const sql = `
    SELECT 
      k.bond2_link AS NoPermintaan,
      k.bond2_brg_kode AS Kode,
      IF(b.brg_note="", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
      b.brg_satuan AS Satuan,
      k.bond2_spesifikasi AS Spesifikasi,
      k.bond2_qty_realisasi AS QtyRealisasi,
      IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM finance.tmasterstok_finance m WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_brg_kode=k.bond2_brg_kode), 0) AS Stok,
      IFNULL((SELECT SUM(d.msod_jumlah) FROM kencanaprint.tgarmenmso_hdr h INNER JOIN kencanaprint.tgarmenmso_dtl d ON d.msod_nomor=h.mso_nomor WHERE h.mso_msi_nomor="" AND h.mso_nomor <> ? AND d.msod_brg_kode=k.bond2_brg_kode), 0) AS Belum
    FROM finance.tkasbonitem2 k
    LEFT JOIN kencanaprint.tgarmen_brg b ON b.brg_kode = k.bond2_brg_kode
    WHERE k.bond2_link = ?
  `;

  const [rows] = await db.query(sql, [
    cabangAsal,
    nomorMso || "",
    noPermintaan,
  ]);

  // Hitung Stok Real = Stok - Belum
  return rows.map((r) => ({
    NoPermintaan: r.NoPermintaan,
    Kode: r.Kode,
    Nama: r.Nama,
    Satuan: r.Satuan,
    Spesifikasi: r.Spesifikasi,
    Stok: Number(r.Stok),
    StokBelumDiterima: Number(r.Belum),
    StokReal: Number(r.Stok) - Number(r.Belum),
    // Sesuai Delphi: Jika Finance, Jumlah default = StokReal. Jika tidak, Jumlah = QtyRealisasi
    Jumlah: Number(r.Stok) - Number(r.Belum),
  }));
};

module.exports = {
  getDetail,
  searchBarang,
  save,
  searchPermintaanFinance,
  getDetailPermintaanFinance,
};
