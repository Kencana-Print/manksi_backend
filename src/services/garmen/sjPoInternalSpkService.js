const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// ─────────────────────────────────────────────────────────
// MASTER — replikasi persis query btnRefreshClick, tanpa pendekatan
// temp table Delphi (di-refactor jadi 1 SELECT set-based).
//
// ⚠️ CATATAN SEMANTIK "Tujuan": kolom ini diambil dari o.poi_cab
// (Gudang ASAL milik PO Internal referensinya), BUKAN o.poi_sup
// (Tujuan asli PO itu). Ini persis query Delphi apa adanya
// (`o.poi_cab Tujuan`) — kemungkinan penamaan yang membingungkan di
// source asli, direplikasi tanpa diubah. Konfirmasi ke user kalau
// ini perlu dibetulkan jadi o.poi_sup.
//
// ⚠️ FITUR YANG SENGAJA DILEWATI: kolom "Ngedit" (status PIN5
// approval buat "Pengajuan Perubahan Data") dan seluruh alur
// pengajuan/approve perubahan data terkunci tutup buku TIDAK
// direplikasi — di luar scope tombol Baru/Ubah/Hapus/Cetak/Export/
// Export Detail. Highlight WAIT/TOLAK/ACC di Delphi juga mengecek
// `Caption='Nomor'` padahal kolom grid ini bernama 'NomorSJ' —
// kemungkinan dead code yang gak pernah match, jadi wajar diabaikan.
// ─────────────────────────────────────────────────────────
const getBrowseList = async (query) => {
  const today = new Date();
  const defaultStart = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .substring(0, 10);
  const defaultEnd = today.toISOString().substring(0, 10);

  const startDate = query.startDate || defaultStart;
  const endDate = query.endDate || defaultEnd;
  const cabang = query.cabang || "ALL";
  const spkNomor = query.spkNomor || "";
  const komponenKode = query.komponenKode || "";

  const params = [startDate, endDate];
  let extraFilter = "";

  if (cabang && cabang !== "ALL") {
    extraFilter += ` AND h.poisj_cab = ?`;
    params.push(cabang);
  }
  if (spkNomor) {
    extraFilter += ` AND h.poisj_spk_nomor = ?`;
    params.push(spkNomor);
  }
  if (komponenKode) {
    extraFilter += ` AND EXISTS (
      SELECT 1 FROM tpointernalsj_dtl x
      WHERE x.poisjd_nomor = h.poisj_nomor AND x.poisjd_bhn_kode = ?
    )`;
    params.push(komponenKode);
  }

  const sql = `
    SELECT
      h.poisj_nomor AS NomorSJ,
      DATE_FORMAT(h.poisj_tanggal, '%Y-%m-%d') AS Tanggal,
      h.poisj_nomorpo AS NomorPO,
      h.poisj_spk_nomor AS SPK,
      j.jasa_nama AS Jasa,
      h.poisj_cab AS Cab,
      o.poi_cab AS Tujuan,
      h.poisj_ket AS Keterangan,
      h.poisj_cmt AS Cmt,
      h.poisj_approve AS Approve,
      IFNULL((
        SELECT GROUP_CONCAT(m.mph_nomor SEPARATOR ', ')
        FROM tmutasiproduksi_hdr m
        WHERE m.mph_nomor_opr = h.poisj_nomor
      ), '') AS NoMutasi
    FROM tpointernalsj_hdr h
    LEFT JOIN tpointernal_hdr o ON o.poi_nomor = h.poisj_nomorpo
    LEFT JOIN tjasa j ON j.jasa_kode = o.poi_jasa_kode
    WHERE h.poisj_tanggal >= ? AND h.poisj_tanggal <= ?
      ${extraFilter}
    ORDER BY h.poisj_nomor
  `;

  const [rows] = await db.query(sql, params);
  return rows;
};

// ─────────────────────────────────────────────────────────
// DETAIL — dipanggil on-demand saat row di-expand
// ─────────────────────────────────────────────────────────
const getDetailByNomor = async (nomor) => {
  const sql = `
    SELECT
      d.poisjd_nomor AS NomorSJ,
      d.poisjd_bhn_kode AS Kode,
      b.Bhn_Name AS Komponen,
      b.Bhn_satuan AS Satuan,
      d.poisjd_size AS Size,
      d.poisjd_jumlah AS Jumlah,
      d.poisjd_bs AS BsLini,
      d.poisjd_sablon AS BsSablon,
      d.poisjd_kain AS BsKain,
      d.poisjd_koli AS Koli,
      d.poisjd_ket AS Keterangan
    FROM tpointernalsj_dtl d
    LEFT JOIN tbahan b ON b.Bhn_kode = d.poisjd_bhn_kode
    WHERE d.poisjd_nomor = ?
    ORDER BY d.poisjd_bhn_kode
  `;
  const [rows] = await db.query(sql, [nomor]);
  return rows;
};

// ─────────────────────────────────────────────────────────
// Helper — ambil status buat validasi Ubah/Hapus
// ─────────────────────────────────────────────────────────
const getStatusForValidation = async (nomor) => {
  const [[row]] = await db.query(
    `SELECT poisj_cab AS Cab, poisj_approve AS Approve,
            poisj_tanggal AS Tanggal, poisj_nomorpo AS NomorPO
     FROM tpointernalsj_hdr WHERE poisj_nomor = ?`,
    [nomor],
  );
  return row || null;
};

// ✅ "HO-" diperlakukan sama kayak cabang kosong (akses semua
// cabang) — konsisten sama pola inferensi di modul lain.
const isHeadOffice = (userCabang) => !userCabang || userCabang === "HO-";

// ─────────────────────────────────────────────────────────
// CEK BOLEH DIUBAH — replikasi cxButton1Click: cabang match + belum
// di-approve. TIDAK ada cek tutup buku di sini (persis Delphi — Ubah
// gak dibatasi periode, cuma Hapus yang dibatasi).
// ─────────────────────────────────────────────────────────
const checkModifiable = async (nomor, userCabang) => {
  const row = await getStatusForValidation(nomor);
  if (!row) return { allowed: false, message: "Data tidak ditemukan." };

  if (!isHeadOffice(userCabang) && row.Cab !== userCabang) {
    return { allowed: false, message: "Data tsb bukan cabang anda." };
  }
  if (row.Approve === "Y") {
    return { allowed: false, message: "Sudah di Approve." };
  }
  return { allowed: true, message: "" };
};

// ─────────────────────────────────────────────────────────
// CEK BOLEH DIHAPUS — replikasi cxButton4Click: cabang match + belum
// di-approve + BELUM tutup buku (pakai tutupBukuService, padanan
// modern dari perhitungan zDay/zMonth/zYear manual di Delphi).
// ─────────────────────────────────────────────────────────
const checkDeletable = async (nomor, userCabang) => {
  const row = await getStatusForValidation(nomor);
  if (!row) return { allowed: false, message: "Data tidak ditemukan." };

  if (!isHeadOffice(userCabang) && row.Cab !== userCabang) {
    return { allowed: false, message: "Data tsb bukan cabang anda." };
  }
  if (row.Approve === "Y") {
    return { allowed: false, message: "Sudah di Approve." };
  }

  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  if (zdtClose && new Date(row.Tanggal) < zdtClose) {
    return {
      allowed: false,
      message: "Transaksi tsb sudah close.\nTidak bisa dihapus.",
    };
  }

  return { allowed: true, message: "", nomorPO: row.NomorPO };
};

// ─────────────────────────────────────────────────────────
// REKALKULASI STATUS CLOSE PO INTERNAL — replikasi persis logic di
// cxButton4Click sesudah hapus SJ: hitung ulang total "sudah
// dikirim" (dibatasi max = qty PO per baris, biar surplus di 1 baris
// gak nutupin kekurangan baris lain) VS total qty PO, lalu update
// poi_close jadi Y (kalau sudah terkirim penuh) atau N (kalau jadi
// kurang lagi setelah SJ ini dihapus).
// ─────────────────────────────────────────────────────────
const recalcPoCloseStatus = async (conn, nomorPO) => {
  if (!nomorPO) return;
  const [[row]] = await conn.query(
    `SELECT SUM(x.po) AS po, SUM(IF(x.bpb > x.po, x.po, x.bpb)) AS sj
     FROM (
       SELECT d.poid_jumlah AS po,
         IFNULL((
           SELECT IFNULL(SUM(b.poisjd_jumlah), 0)
           FROM tpointernalsj_dtl b
           INNER JOIN tpointernalsj_hdr a ON a.poisj_nomor = b.poisjd_nomor
           WHERE a.poisj_nomorpo = d.poid_nomor AND b.poisjd_bhn_kode = d.poid_bhn_kode
         ), 0) AS bpb
       FROM tpointernal_dtl d
       WHERE d.poid_nomor = ?
     ) x`,
    [nomorPO],
  );

  const totalPo = Number(row?.po) || 0;
  const totalSj = Number(row?.sj) || 0;
  const closeStatus = totalSj >= totalPo ? "Y" : "N";

  await conn.query(
    `UPDATE tpointernal_hdr SET poi_close = ? WHERE poi_nomor = ?`,
    [closeStatus, nomorPO],
  );
};

// ─────────────────────────────────────────────────────────
// DELETE — replikasi cxButton4Click lengkap: validasi, hapus header
// (cascade detail diasumsikan trigger, konsisten pola modul lain),
// lalu rekalkulasi status close PO Internal asalnya.
// ─────────────────────────────────────────────────────────
const deleteData = async (nomor, userCabang) => {
  const check = await checkDeletable(nomor, userCabang);
  if (!check.allowed) throw new Error(check.message);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `DELETE FROM tpointernalsj_hdr WHERE poisj_nomor = ?`,
      [nomor],
    );
    if (result.affectedRows === 0) throw new Error("Data tidak ditemukan.");

    await recalcPoCloseStatus(conn, check.nomorPO);

    await conn.commit();
    return { nomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = {
  getBrowseList,
  getDetailByNomor,
  checkModifiable,
  deleteData,
};
