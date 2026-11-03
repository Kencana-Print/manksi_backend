// backend/src/services/jadwalKirim.service.js
const pool = require("../../../../config/database");

const { format } = require('date-fns'); // Tambahkan ini

/**
 * Mengambil data Jadwal Kirim (Master) 
 * Sesuai logika SQLMaster di ufrmBrowseJadwalKirim2
 */

const getJadwalKirimData = async (startDate, endDate, gudang, search) => {
  // Guard: tanggal kosong ("") di-skip agar tidak jadi klausa zero-date.
  let params = [];
  let dateClause = "";
  if (startDate && endDate) {
    dateClause = `a.Tanggal >= ? AND a.Tanggal <= ?`;
    params = [startDate, endDate];
  } else if (startDate) {
    dateClause = `a.Tanggal >= ?`;
    params = [startDate];
  } else if (endDate) {
    dateClause = `a.Tanggal <= ?`;
    params = [endDate];
  }
  
  let sql = `
    SELECT 
      a.Nomor_Kirim AS Nomor, 
      a.Gudang, 
      gdg.gdg_nama AS Nama_Gudang, 
      DATE_FORMAT(a.Tanggal, '%Y-%m-%d') AS Tanggal,
      a.spk_nomor AS No_SPK, 
      b.spk_nama AS Nama_Spk, 
      b.spk_ukuran AS Ukuran,
      b.spk_kain AS Kain,
      IFNULL(a.Jumlah, 0) AS Jumlah, 
      IFNULL(a.Koli, 0) AS Koli, 
      IFNULL(a.Realisasi, 0) AS Realisasi,
      IFNULL(a.koli_Realisasi, 0) AS Koli_Realisasi, 
      (IFNULL(a.Realisasi, 0) - IFNULL(a.Jumlah, 0)) AS Selisih_Jumlah,
      (IFNULL(a.koli_Realisasi, 0) - IFNULL(a.koli, 0)) AS Selisih_Koli,
      a.usr_create 
    FROM tjadwalkirim a 
    LEFT JOIN (
      SELECT spk_nomor, spk_nama, spk_ukuran, spk_kain FROM tspk WHERE spk_aktif = 'Y'
      UNION ALL 
      SELECT mspk_nomor, mspk_nama, mspk_ukuran, mspk_kain FROM tmemospk
    ) b ON b.spk_nomor = a.spk_nomor
    LEFT JOIN tgudang gdg ON gdg.gdg_kode = a.gudang 
    WHERE ${dateClause || "1=1"}
  `;

  // 1. Filter Gudang (LIKE match)
  if (gudang) {
    sql += ` AND a.Gudang LIKE ?`;
    params.push(`%${gudang}%`);
  }

  // 2. Tambahan: Filter Nama SPK atau Nomor SPK
  if (search) {
    sql += ` AND (a.spk_nomor LIKE ? OR b.spk_nama LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }

  sql += ` ORDER BY a.Tanggal DESC, a.Nomor_Kirim DESC`;

  try {
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (error) {
    console.error("Database Master Error:", error.message);
    throw new Error("Gagal mengambil data Jadwal Kirim: " + error.message);
  }
};


/**
 * Mengambil satu data Jadwal Kirim beserta Detailnya untuk form EDIT
 */
const getJadwalKirimByNomor = async (nomor) => {
    try {
        // 1. Ambil Data Header
        const [headerRows] = await pool.query(`
            SELECT 
                a.Nomor_Kirim AS Nomor, 
                a.Gudang, 
                gdg.gdg_nama AS Nama_Gudang, 
                DATE_FORMAT(a.Tanggal, '%Y-%m-%d') AS Tanggal,
                a.spk_nomor AS No_SPK, 
                b.spk_nama AS Nama_Spk, 
                b.spk_ukuran AS Ukuran,
                b.spk_kain AS Kain,
                a.usr_create
            FROM tjadwalkirim a 
            LEFT JOIN (
                SELECT spk_nomor, spk_nama, spk_ukuran, spk_kain FROM tspk WHERE spk_aktif = 'Y'
                UNION ALL 
                SELECT mspk_nomor, mspk_nama, mspk_ukuran, mspk_kain FROM tmemospk
            ) b ON b.spk_nomor = a.spk_nomor
            LEFT JOIN tgudang gdg ON gdg.gdg_kode = a.gudang 
            WHERE a.Nomor_Kirim = ?
        `, [nomor]);

        if (headerRows.length === 0) return null;

        const header = headerRows[0];

        // 2. Ambil Data Detail
        const [detailRows] = await pool.query(`
            SELECT 
                No_urut,
                kota,
                uraian,
                size,
                jumlah AS Jumlah,
                koli AS Koli,
                jami AS JamInput,
                Jam,
                expedisi
            FROM tjadwalkirim_dtl
            WHERE nomor_kirim = ?
            ORDER BY No_urut ASC
        `, [nomor]);

        // Gabungkan Header dan Detail
        return {
            ...header,
            Detail: detailRows
        };
    } catch (error) {
        console.error("Error getJadwalKirimByNomor:", error);
        throw error;
    }
};
  /**
 * Generate Nomor Kirim otomatis (KRM.YYMM.XXXX)
 * Berdasarkan logika getmaxkode di Delphi
 */
const generateNomorKirim = async (tanggal) => {
  const dateObj = new Date(tanggal);
  const yy = dateObj.getFullYear().toString().substring(2); // Ambil 2 digit tahun
  const mm = ("0" + (dateObj.getMonth() + 1)).slice(-2);    // Ambil 2 digit bulan
  
  const prefix = `KRM.${yy}${mm}.`; // Hasil: KRM.2604.
  const pattern = `${prefix}%`;

  const sql = `
    SELECT IFNULL(MAX(RIGHT(nomor_kirim, 4)), 0) AS last_counter 
    FROM tjadwalkirim 
    WHERE nomor_kirim LIKE ?
  `;

  try {
    const [rows] = await pool.query(sql, [pattern]);
    const lastCounter = parseInt(rows[0].last_counter);
    const nextCounter = (lastCounter + 1).toString().padStart(4, '0');
    
    return `${prefix}${nextCounter}`;
  } catch (error) {
    console.error("Error Generate Nomor Kirim:", error);
    throw new Error("Gagal generate nomor kirim otomatis.");
  }
};

/**
 * Menghapus data Jadwal Kirim
 * Sesuai logika cxButton4Click di ufrmBrowseJadwalKirim2
 */
const deleteJadwalKirim = async (params) => {
  // Di versi JadwalKirim2, penghapusan cukup menggunakan nomor_kirim
  const { nomor } = params; 
  
  const sql = `DELETE FROM tjadwalkirim WHERE nomor_kirim = ?`;

  try {
    const [result] = await pool.query(sql, [nomor]);
    return result.affectedRows > 0;
  } catch (error) {
    console.error("Delete Error:", error);
    throw new Error("Gagal menghapus data jadwal kirim.");
  }
};

const saveJadwalKirim = async (data, nomorToEdit, userLogin) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const serverTime = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
        const isUpdating = !!nomorToEdit;

        // 1. LOGIKA NOMOR (Auto Number)
        let currentNomor = nomorToEdit;
        if (!isUpdating) {
            // Jika nomorToEdit kosong, generate nomor baru
            // generateNomorKirim disesuaikan agar menerima parameter koneksi untuk transaksi
            currentNomor = await generateNomorKirim(data.Tanggal, connection);
        }

        // 1b. VALIDASI STATUS SPK (server-side, anti-bypass):
        // SPK close / sudah selesai dijadwalkan tidak boleh dijadwalkan lagi.
        const spkNomor = (data.No_SPK || '').trim();
        if (!spkNomor) {
            throw new Error('Nomor SPK wajib diisi.');
        }
        const [[spkReg]] = await connection.query(
            `SELECT spk_nomor, spk_jumlah, spk_close, spk_aktif FROM tspk WHERE spk_nomor = ? LIMIT 1`,
            [spkNomor]
        );
        const [[spkMemo]] = spkReg ? [[]] : await connection.query(
            `SELECT mspk_nomor AS spk_nomor, mspk_jumlah AS spk_jumlah, mspk_close AS spk_close, mspk_aktif AS spk_aktif FROM tmemospk WHERE mspk_nomor = ? LIMIT 1`,
            [spkNomor]
        );
        const spkRow = spkReg || spkMemo;
        if (!spkRow) {
            throw new Error(`SPK ${spkNomor} tidak ditemukan.`);
        }
        // Catatan: tspk.spk_close numerik (0/1), tmemospk.mspk_close char (Y/N)
        const closeVal = String(spkRow.spk_close ?? '').toUpperCase();
        const isClosed =
            closeVal === '1' || closeVal === 'Y' ||
            String(spkRow.spk_aktif || '').toUpperCase() !== 'Y';
        if (isClosed) {
            throw new Error(`SPK ${spkNomor} sudah CLOSE dan tidak bisa dijadwalkan untuk kirim.`);
        }
        const orderQty = Number(spkRow.spk_jumlah) || 0;
        const [terjadwalRows] = await connection.query(
            `SELECT IFNULL(SUM(Jumlah), 0) AS total FROM tjadwalkirim
             WHERE spk_nomor = ? ${isUpdating ? 'AND Nomor_Kirim <> ?' : ''}`,
            isUpdating ? [spkNomor, currentNomor] : [spkNomor]
        );
        const sudahTerjadwal = Number(terjadwalRows[0]?.total) || 0;
        const qtyBaru = Number(data.Jumlah) || 0;
        if (sudahTerjadwal >= orderQty) {
            throw new Error(`SPK ${spkNomor} sudah selesai dijadwalkan untuk kirim (sisa 0) dan tidak bisa dijadwalkan lagi.`);
        }
        if (sudahTerjadwal + qtyBaru > orderQty) {
            const sisaOrder = orderQty - sudahTerjadwal;
            throw new Error(`Gagal Simpan! Jumlah kirim melebihi sisa yang belum dijadwalkan: input ${qtyBaru}, sisa ${sisaOrder} (order SPK ${spkNomor} = ${orderQty}, sudah terjadwal ${sudahTerjadwal}).`);
        }

        // 2. SIMPAN HEADER (tjadwalkirim)
        if (isUpdating) {
            await connection.query(`
                UPDATE tjadwalkirim SET 
                    Gudang = ?, 
                    Tanggal = ?, 
                    spk_nomor = ?, 
                    Jumlah = ?, 
                    Koli = ?, 
                    Realisasi = ?, 
                    koli_Realisasi = ?, 
                    usr_modify = ?, 
                    date_modify = ?
                WHERE Nomor_Kirim = ?
            `, [
                data.Gudang, 
                data.Tanggal, 
                data.No_SPK, 
                data.Jumlah || 0, 
                data.Koli || 0, 
                data.Realisasi || 0, 
                data.Koli_Realisasi || 0, 
                userLogin, 
                serverTime, 
                currentNomor
            ]);
        } else {
            await connection.query(`
                INSERT INTO tjadwalkirim 
                (Nomor_Kirim, Gudang, Tanggal, spk_nomor, Jumlah, Koli, Realisasi, koli_Realisasi, usr_create, date_create) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                currentNomor, 
                data.Gudang, 
                data.Tanggal, 
                data.No_SPK, 
                data.Jumlah || 0, 
                data.Koli || 0, 
                data.Realisasi || 0, 
                data.Koli_Realisasi || 0, 
                userLogin, 
                serverTime
            ]);
        }

        // 3. LOGIKA DETAIL (Hapus Lama, Insert Baru)
        // Selalu hapus detail berdasarkan Nomor_Kirim sebelum insert (Logic Delphi)
       await connection.query("DELETE FROM tjadwalkirim_dtl WHERE nomor_kirim = ?", [currentNomor]);

if (Array.isArray(data.Detail) && data.Detail.length > 0) {
    // jami = jam input jadwal (server time saat save). Delphi mengisinya
    // otomatis serupa; frontend tak mengirimnya sehingga selalu kosong.
    // Hormati nilai eksplisit bila ada (jangan timpa input manual).
    // (serverTime di file ini string 'yyyy-MM-dd HH:mm:ss' → pakai Date baru.)
    const jamSave = format(new Date(), 'HH:mm:ss');
    const detailValues = data.Detail
        .filter(d => (Number(d.qty) || 0) > 0) 
        .map((d, index) => [
            currentNomor,        // nomor_kirim (1)
            index + 1,           // No_urut (2)
            d.kota || '',        // kota (3)
            d.uraian || '',      // uraian (4)
            d.size || '',        // size (5)
            parseFloat(d.qty) || 0, // jumlah (6)
            parseInt(d.koli) || 0,  // koli (7)
            (d.jamInput || '').trim() || jamSave, // jami (8) = jam input/save
            d.jamReady || '',    // Jam (9)
            d.expedisi || ''     // expedisi (10)
        ]);

    if (detailValues.length > 0) {
        await connection.query(`
            INSERT INTO tjadwalkirim_dtl 
            (nomor_kirim, No_urut, kota, uraian, size, jumlah, koli, jami, Jam, expedisi) 
            VALUES ?
        `, [detailValues]); // Menghapus 'keterangan' dari sini
    }
}
        await connection.commit();
        return { success: true, Nomor: currentNomor, message: "Data berhasil disimpan" };

    } catch (error) {
        await connection.rollback();
        console.error("Error in saveJadwalKirim:", error);
        throw error;
    } finally {
        connection.release();
    }
};


const getPrintData = async (startDate, endDate, gudang) => {
  let params = [startDate, endDate];
  let sql = `
    SELECT 
      a.Gudang, a.nomor_kirim, gdg.gdg_nama AS Nama_Gudang, 
      DATE_FORMAT(a.Tanggal, '%d/%m/%Y') AS Tanggal, 
      a.spk_nomor No_SPK,
      c.spk_nama Nama_Spk, c.spk_ukuran Ukuran, c.spk_kain Kain,
      b.no_urut, 
      b.kota, 
      /* GABUNGKAN KOTA DAN URAIAN DI SINI */
      CONCAT_WS(' - ', NULLIF(TRIM(b.kota), ''), NULLIF(TRIM(b.uraian), '')) AS Uraian, 
      b.jumlah AS Jml_Pcs, 
      b.koli AS Jml_Koli,
      b.jam AS Jam_Ready,
      b.expedisi AS Expedisi, 
      e.Cus_kode AS Customer,
      IFNULL((SELECT DISTINCT d.SJD_SJ_Nomor FROM tsj_dtl d 
              INNER JOIN tsj_hdr h ON h.SJ_Nomor=d.SJD_SJ_Nomor 
              WHERE h.SJ_Status_otomatis=0 AND d.sjd_nokirim=a.nomor_kirim 
              AND d.sjd_idkirim=b.no_urut LIMIT 1), "") AS Nomor_SJ,
      IFNULL((SELECT SUM(d.SJD_Jumlah) FROM tsj_dtl d 
              INNER JOIN tsj_hdr h ON h.SJ_Nomor=d.SJD_SJ_Nomor 
              WHERE h.SJ_Status_otomatis=0 AND d.sjd_nokirim=a.nomor_kirim 
              AND d.sjd_idkirim=b.no_urut), 0) AS Realisasi_Kirim
    FROM tjadwalkirim a
    INNER JOIN tjadwalkirim_dtl b ON a.nomor_kirim = b.nomor_kirim
    LEFT JOIN (
      SELECT spk_nomor, spk_nama, spk_ukuran, spk_cus_kode, spk_kain FROM tspk WHERE spk_aktif='Y'
      UNION ALL
      SELECT mspk_nomor, mspk_nama, mspk_ukuran, mspk_cus_kode, mspk_kain FROM tmemospk
    ) c ON c.spk_nomor = a.spk_nomor
    LEFT JOIN tcustomer e ON e.Cus_kode = c.spk_cus_kode
    LEFT JOIN tgudang gdg ON gdg.gdg_kode = a.gudang
    WHERE a.tanggal >= ? AND a.tanggal <= ?
  `;

  if (gudang && gudang !== '') {
    sql += ` AND a.gudang = ?`;
    params.push(gudang);
  }
  
  sql += ` ORDER BY a.tanggal ASC, a.nomor_kirim ASC, b.no_urut ASC`;

  const [rows] = await pool.query(sql, params);
  return rows;
};

// Properti module.exports tetap sama agar tidak merusak pemanggilan di Controller
module.exports = {
  getJadwalKirimData,
  deleteJadwalKirim,
  getJadwalKirimByNomor,
  saveJadwalKirim,
  generateNomorKirim,
  getPrintData
};