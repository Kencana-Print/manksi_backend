const pool = require("../../../config/database");
const { format } = require("date-fns");

const throwDbError = (message, error) => {
  console.error(message, error.message);
  throw new Error(message + ": " + error.message);
};

// Generate nomor untuk pengajuan (prefix KOR tetap, tapi query ke tabel pengajuan)
exports.generateMaxKodePengajuan = async (tanggal) => {
  const NOMERATOR = "KOR";
  const yyMm = format(new Date(tanggal), "yyMM");
  const prefix = `${NOMERATOR}.${yyMm}.%`;
  const [rows] = await pool.query(
    `SELECT MAX(RIGHT(korh_nomor, 3)) AS max_num FROM tkor_pengajuan_hdr_mmt WHERE korh_nomor LIKE ?`,
    [prefix]
  );
  const maxNum = rows[0].max_num ? parseInt(rows[0].max_num) : 0;
  return `${NOMERATOR}.${yyMm}.${String(maxNum + 1).padStart(3, "0")}`;
};

exports.getPengajuanData = async (startDate, endDate, user) => {
  try {
    // Guard: tanggal kosong ("") di-skip agar tidak jadi klausa zero-date
    // (format(new Date("")) melempar RangeError, jadi hanya format bila ada).
    const dateConds = [];
    const params = [];
    if (startDate) {
      dateConds.push(`a.korh_tanggal >= ?`);
      params.push(format(new Date(startDate), "yyyy-MM-dd"));
    }
    if (endDate) {
      dateConds.push(`a.korh_tanggal <= ?`);
      params.push(format(new Date(endDate), "yyyy-MM-dd"));
    }
    const sqlMaster = `
      SELECT 
        a.korh_nomor AS Nomor, 
        DATE_FORMAT(a.korh_tanggal, '%d/%m/%Y') AS Tanggal, 
        a.korh_tanggal AS TanggalRaw,
        a.korh_gdg_kode AS GudangKode,
        b.gdg_nama AS Gudang, 
        c.nama AS Tipe_Nama, 
        a.korh_notes AS Keterangan,
        a.korh_status AS Status,
        a.user_create AS Pengaju,
        a.korh_acc_user AS Approver,
        DATE_FORMAT(a.korh_acc_date, '%d/%m/%Y %H:%i') AS TglAcc,
        a.korh_reject_reason AS AlasanTolak,
        a.korh_total AS Total
      FROM tkor_pengajuan_hdr_mmt a
      LEFT JOIN tgudang b ON b.gdg_kode = a.korh_gdg_kode
      LEFT JOIN tkor_type_mmt c ON c.kode = a.korh_type
      WHERE ${dateConds.length ? dateConds.join(" AND ") : "1=1"}
      ORDER BY a.korh_tanggal DESC, a.korh_nomor DESC`;

    const [masterRows] = await pool.query(sqlMaster, params);
    if (masterRows.length === 0) return [];

    const nomorList = masterRows.map((m) => m.Nomor);
    const sqlDetail = `
      SELECT 
        d.kord_korh_nomor AS Nomor, 
        d.kord_brg_kode AS Kode, 
        b.brg_nama AS Nama_Bahan, 
        d.kord_stok AS Stock, 
        d.kord_panjang AS Panjang, 
        d.kord_lebar AS Lebar,
        d.kord_fisik AS Fisik, 
        d.kord_qty AS Koreksi,
        d.kord_satuan AS Satuan
      FROM tkor_pengajuan_dtl_mmt d
      LEFT JOIN tbarang_mmt b ON d.kord_brg_kode = b.brg_kode
      WHERE d.kord_korh_nomor IN (?)
      ORDER BY d.kord_korh_nomor, d.kord_nourut`;

    const [detailRows] = await pool.query(sqlDetail, [nomorList]);
    const dataMap = new Map();
    masterRows.forEach((item) => {
      dataMap.set(item.Nomor, { ...item, Detail: [] });
    });
    detailRows.forEach((d) => {
      if (dataMap.has(d.Nomor)) dataMap.get(d.Nomor).Detail.push(d);
    });
    return Array.from(dataMap.values());
  } catch (error) {
    console.error("Gagal mengambil data pengajuan koreksi:", error);
    throw error;
  }
};

exports.getPengajuanDetail = async (nomor) => {
  const [hdr] = await pool.query(`SELECT * FROM tkor_pengajuan_hdr_mmt WHERE korh_nomor = ?`, [nomor]);
  if (hdr.length === 0) throw new Error("Pengajuan tidak ditemukan");
  const [dtl] = await pool.query(`SELECT * FROM tkor_pengajuan_dtl_mmt WHERE kord_korh_nomor = ? ORDER BY kord_nourut`, [nomor]);
  return { header: hdr[0], details: dtl };
};

exports.savePengajuan = async (payload, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const { header, details } = payload;
    let nomor = header.Nomor;
    if (nomor === "AUTO" || !nomor) {
      nomor = await exports.generateMaxKodePengajuan(header.Tanggal);
    }
    const totalNilai = details.reduce((acc, curr) => acc + (Number(curr.Nilai) || 0), 0);
    // Insert header pengajuan dengan status PENDING
    const sqlHeader = `
      INSERT INTO tkor_pengajuan_hdr_mmt 
        (korh_nomor, korh_tanggal, korh_gdg_kode, korh_type, korh_notes, korh_total, date_create, user_create, korh_status)
      VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, 'PENDING')
      ON DUPLICATE KEY UPDATE 
        korh_tanggal=VALUES(korh_tanggal), 
        korh_gdg_kode=VALUES(korh_gdg_kode), 
        korh_type=VALUES(korh_type), 
        korh_notes=VALUES(korh_notes), 
        korh_total=VALUES(korh_total),
        date_modified=NOW(), user_modified=?
    `;
    await connection.query(sqlHeader, [
      nomor, header.Tanggal, header.GudangKode, header.TypeKor, header.Keterangan || "", totalNilai, user, user,
    ]);
    await connection.query(`DELETE FROM tkor_pengajuan_dtl_mmt WHERE kord_korh_nomor = ?`, [nomor]);
    const validDetails = details.filter((d) => d.SKU);
    if (validDetails.length > 0) {
      const vals = validDetails.map((d, i) => [
        nomor,
        d.KodeBarang || d.SKU,
        d.Satuan || "",
        header.Tanggal,
        Number(d.Qty) || 0,
        Number(d.Panjang) || 0,
        Number(d.Lebar) || 0,
        Number(d.Harga) || 0,
        Number(d.Nilai) || 0,
        Number(d.Fisik) || 0,
        Number(d.System) || 0,
        i + 1,
      ]);
      await connection.query(
        `INSERT INTO tkor_pengajuan_dtl_mmt 
          (kord_korh_nomor, kord_brg_kode, kord_satuan, kord_expired, kord_qty, kord_panjang, kord_lebar, kord_harga, kord_nilai, kord_fisik, kord_stok, kord_nourut) VALUES ?`,
        [vals]
      );
    }
    await connection.commit();
    return { success: true, nomor };
  } catch (e) {
    await connection.rollback();
    throw e;
  } finally {
    connection.release();
  }
};

exports.deletePengajuan = async (nomor, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [hdr] = await connection.query(`SELECT korh_status, user_create FROM tkor_pengajuan_hdr_mmt WHERE korh_nomor = ?`, [nomor]);
    if (hdr.length === 0) throw new Error("Pengajuan tidak ditemukan");
    if (hdr[0].korh_status !== 'PENDING') throw new Error("Hanya pengajuan PENDING yang bisa dihapus");
    // optional: hanya pengaju atau manager bisa hapus
    await connection.query(`DELETE FROM tkor_pengajuan_dtl_mmt WHERE kord_korh_nomor = ?`, [nomor]);
    await connection.query(`DELETE FROM tkor_pengajuan_hdr_mmt WHERE korh_nomor = ?`, [nomor]);
    await connection.commit();
    return true;
  } catch (e) {
    await connection.rollback();
    throw e;
  } finally {
    connection.release();
  }
};

exports.approvePengajuan = async (nomor, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [hdrRows] = await connection.query(`SELECT * FROM tkor_pengajuan_hdr_mmt WHERE korh_nomor = ? FOR UPDATE`, [nomor]);
    if (hdrRows.length === 0) throw new Error("Pengajuan tidak ditemukan");
    const hdr = hdrRows[0];
    if (hdr.korh_status !== 'PENDING') throw new Error("Pengajuan sudah diproses: " + hdr.korh_status);

    const [dtlRows] = await connection.query(`SELECT * FROM tkor_pengajuan_dtl_mmt WHERE kord_korh_nomor = ?`, [nomor]);

    // Insert ke tabel real tkor_hdr_mmt (akan memicu stok via trigger saat insert detail)
    // Gunakan INSERT ... ON DUPLICATE KEY UPDATE untuk header
    const totalNilai = dtlRows.reduce((a,c)=>a+(Number(c.kord_nilai)||0),0);
    await connection.query(`
      INSERT INTO tkor_hdr_mmt (korh_nomor, korh_tanggal, korh_gdg_kode, korh_type, korh_notes, korh_total, date_create, user_create, korh_typekor)
      VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, 0)
      ON DUPLICATE KEY UPDATE korh_tanggal=VALUES(korh_tanggal), korh_gdg_kode=VALUES(korh_gdg_kode), korh_type=VALUES(korh_type), korh_notes=VALUES(korh_notes), korh_total=VALUES(korh_total)
    `, [hdr.korh_nomor, hdr.korh_tanggal, hdr.korh_gdg_kode, hdr.korh_type, hdr.korh_notes, totalNilai, hdr.user_create]);

    // Hapus detail lama jika ada (untuk kasus re-approve)
    await connection.query(`DELETE FROM tkor_dtl_mmt WHERE kord_korh_nomor = ?`, [nomor]);
    await connection.query(`DELETE FROM tmasterstok_mmt WHERE mst_noreferensi = ?`, [nomor]);

    if (dtlRows.length > 0) {
      const vals = dtlRows.map((d, i) => [
        d.kord_korh_nomor, d.kord_brg_kode, d.kord_satuan, d.kord_expired, d.kord_qty, d.kord_panjang, d.kord_lebar, d.kord_harga, d.kord_nilai, d.kord_fisik, d.kord_stok, d.kord_nourut
      ]);
      await connection.query(`
        INSERT INTO tkor_dtl_mmt 
          (kord_korh_nomor, kord_brg_kode, kord_satuan, kord_expired, kord_qty, kord_panjang, kord_lebar, kord_harga, kord_nilai, kord_fisik, kord_stok, kord_nourut) VALUES ?
      `, [vals]);
    }

    // Update status pengajuan menjadi APPROVED
    await connection.query(`
      UPDATE tkor_pengajuan_hdr_mmt 
      SET korh_status='APPROVED', korh_acc_user=?, korh_acc_date=NOW() 
      WHERE korh_nomor=?
    `, [user, nomor]);

    await connection.commit();
    return { success: true, nomor };
  } catch (e) {
    await connection.rollback();
    throw e;
  } finally {
    connection.release();
  }
};

exports.rejectPengajuan = async (nomor, user, reason) => {
  const [hdr] = await pool.query(`SELECT korh_status FROM tkor_pengajuan_hdr_mmt WHERE korh_nomor = ?`, [nomor]);
  if (hdr.length === 0) throw new Error("Pengajuan tidak ditemukan");
  if (hdr[0].korh_status !== 'PENDING') throw new Error("Pengajuan sudah diproses");
  await pool.query(`
    UPDATE tkor_pengajuan_hdr_mmt 
    SET korh_status='REJECTED', korh_acc_user=?, korh_acc_date=NOW(), korh_reject_reason=? 
    WHERE korh_nomor=?
  `, [user, reason || "", nomor]);
  return true;
};
