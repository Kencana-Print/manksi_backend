const db = require("../../config/database");

// ─────────────────────────────────────────────────────────
// GENERATE NOMOR
// Format Delphi: KRM.YYMM.XXXX (4 digit urut per bulan)
// getmaxkode: max(right(nomor_kirim,4)) LIKE 'KRM.YYMM.%'
// ─────────────────────────────────────────────────────────
const generateNomor = async (tanggal) => {
  const d = new Date(tanggal);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const prefix = `KRM.${yy}${mm}.`;

  const [[row]] = await db.query(
    `SELECT IFNULL(MAX(CAST(RIGHT(Nomor_Kirim, 4) AS UNSIGNED)), 0) AS max_val
     FROM tjadwalkirim
     WHERE Nomor_Kirim LIKE ?`,
    [`${prefix}%`],
  );
  const next = parseInt(row.max_val, 10) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
};

// ─────────────────────────────────────────────────────────
// GET SPK INFO (setelah input No SPK)
// UNION tspk + tmemospk, join tcustomer
// Return: nama, ukuran, cus_kode, cus_nama, cus_alamat, divisi, jumlah_spk
// ─────────────────────────────────────────────────────────
const getSpkInfo = async (nomorSpk) => {
  const query = `
    SELECT a.spk_nomor, a.spk_nama, a.spk_ukuran, a.spk_cus_kode,
           a.divisi, a.spk_jumlah,
           b.Cus_nama, b.Cus_alamat
    FROM (
      SELECT spk_nomor, spk_nama, spk_ukuran, spk_cus_kode,
             spk_divisi AS divisi, spk_jumlah
      FROM tspk WHERE spk_aktif = 'Y'
      UNION ALL
      SELECT mspk_nomor, mspk_nama, mspk_ukuran, mspk_cus_kode,
             mspk_divisi AS divisi, mspk_jumlah
      FROM tmemospk
    ) a
    LEFT JOIN tcustomer b ON b.Cus_kode = a.spk_cus_kode
    WHERE a.spk_nomor = ?
    LIMIT 1
  `;
  const [rows] = await db.query(query, [nomorSpk]);
  return rows[0] || null;
};

// ─────────────────────────────────────────────────────────
// GET SUDAH DIJADWALKAN
// SUM jumlah dari tjadwalkirim_dtl untuk SPK yang sama,
// exclude nomor kirim yang sedang diedit (sesuai Delphi getsudah)
// ─────────────────────────────────────────────────────────
const getSudahDijadwalkan = async (nomorSpk, excludeNomor = "") => {
  let query = `
    SELECT IFNULL(SUM(d.jumlah), 0) AS sudah
    FROM tjadwalkirim h
    LEFT JOIN tjadwalkirim_dtl d ON d.nomor_kirim = h.Nomor_Kirim
    WHERE h.spk_nomor = ?
  `;
  const params = [nomorSpk];
  if (excludeNomor) {
    query += ` AND h.Nomor_Kirim <> ?`;
    params.push(excludeNomor);
  }
  const [[row]] = await db.query(query, params);
  return Number(row.sudah) || 0;
};

// ─────────────────────────────────────────────────────────
// GET PLANNING PPIC (procedure isiplan Delphi)
// tplan_ppic_dtl2 join tplan_ppic_hdr
// WHERE pl_close='N' AND plan_spk=? AND plan_kirim<>0
// ─────────────────────────────────────────────────────────
const getPlanningPpic = async (nomorSpk) => {
  const query = `
    SELECT
      d.plan_pl_nomor                              AS no_planning,
      DATE_FORMAT(d.plan_tgl_jadwal, '%Y-%m-%d')   AS tanggal,
      d.plan_qty_jadwal                            AS jumlah,
      d.plan_divisi                                AS status,
      d.plan_line_kelompok                         AS line_kelompok
    FROM tplan_ppic_dtl2 d
    INNER JOIN tplan_ppic_hdr h ON h.pl_nomor = d.plan_pl_nomor
    WHERE h.pl_close = 'N'
      AND d.plan_spk = ?
      AND d.plan_qty_jadwal <> 0
    ORDER BY d.plan_tgl_jadwal, d.plan_divisi
  `;
  const [rows] = await db.query(query, [nomorSpk]);
  return rows;
};

// ─────────────────────────────────────────────────────────
// CEK DUPLIKAT KOTA (Delphi: cekKota)
// Cek apakah kota sudah ada di jadwal kirim lain untuk SPK yang sama
// ─────────────────────────────────────────────────────────
const cekDuplikatKota = async (nomorSpk, kota, excludeNomor = "") => {
  let query = `
    SELECT h.Nomor_Kirim
    FROM tjadwalkirim h
    LEFT JOIN tjadwalkirim_dtl d ON d.nomor_kirim = h.Nomor_Kirim
    WHERE h.spk_nomor = ?
      AND d.kota = ?
  `;
  const params = [nomorSpk, kota];
  if (excludeNomor) {
    query += ` AND h.Nomor_Kirim <> ?`;
    params.push(excludeNomor);
  }
  query += ` LIMIT 1`;
  const [rows] = await db.query(query, params);
  return rows.length > 0 ? rows[0].Nomor_Kirim : null;
};

// CEK apakah SPK sudah ada jadwal di tanggal tertentu
// Sesuai Delphi: SELECT nomor_kirim FROM tjadwalkirim WHERE tanggal=? AND spk_nomor=?
const cekJadwalByTanggal = async (nomorSpk, tanggal) => {
  const [rows] = await db.query(
    `SELECT Nomor_Kirim AS nomor FROM tjadwalkirim
     WHERE spk_nomor = ? AND Tanggal = ?
     LIMIT 1`,
    [nomorSpk, tanggal],
  );
  return rows[0] || null;
};

// ─────────────────────────────────────────────────────────
// GET LOOKUP SPK (untuk search modal)
// Sesuai Delphi edtnospkClickBtn:
// - divisi 1 → tspk divisi 1/5 + tmemospk divisi 1/5
// - divisi lain → tspk divisi 3/4/6 + tmemospk divisi 3/4/6
// Filter: aktif, SPK_closed_produksi=0, tanggal >= 3 bulan lalu
// ─────────────────────────────────────────────────────────
const searchSpk = async (
  keyword = "",
  divisiUser = 0,
  page = 1,
  limit = 30,
) => {
  const offset = (page - 1) * limit;

  // Tentukan filter divisi sesuai Delphi
  let divisiFilter;
  if (divisiUser === 1) {
    divisiFilter = "(1, 5)";
  } else {
    divisiFilter = "(3, 4, 6)"; // garmen (default jika bukan divisi 1)
  }

  const query = `
    SELECT Kode, Nama, Ukuran, Jorder
    FROM (
      SELECT spk_nomor AS Kode, spk_nama AS Nama, spk_ukuran AS Ukuran,
             IFNULL(spk_jumlah, 0) AS Jorder
      FROM tspk
      WHERE spk_divisi IN ${divisiFilter}
        AND spk_aktif = 'Y'
        AND spk_tanggal >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
      UNION ALL
      SELECT mspk_nomor AS Kode, mspk_nama AS Nama, mspk_ukuran AS Ukuran,
             IFNULL(mspk_jumlah, 0) AS Jorder
      FROM tmemospk
      WHERE mspk_divisi IN ${divisiFilter}
        AND mspk_jumlah > mspk_jumlah_kirim
        AND mspk_tanggal >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
    ) a
    WHERE Nama LIKE ? OR Kode LIKE ?
    ORDER BY Kode
    LIMIT ? OFFSET ?
  `;
  const kw = `%${keyword}%`;
  const [rows] = await db.query(query, [kw, kw, limit, offset]);
  return rows;
};

// ─────────────────────────────────────────────────────────
// GET BY NOMOR (load edit — loaddataall Delphi)
// Gabung tjadwalkirim + tjadwalkirim_dtl + tspk/tmemospk + tcustomer
// ─────────────────────────────────────────────────────────
const getById = async (nomor) => {
  // Header
  const headerQuery = `
    SELECT
      a.Nomor_Kirim,
      DATE_FORMAT(a.Tanggal, '%Y-%m-%d')         AS Tanggal,
      a.spk_nomor,
      a.Gudang,
      a.jk_plan_nomor,
      DATE_FORMAT(a.jk_plan_tanggal, '%Y-%m-%d') AS jk_plan_tanggal,
      a.jk_plan_jumlah,
      IFNULL(c.spk_jumlah, d.mspk_jumlah)        AS jumlah_spk,
      IF(c.spk_nama = '' OR c.spk_nama IS NULL, d.mspk_nama, c.spk_nama) AS spk_nama,
      IF(c.spk_ukuran = '' OR c.spk_ukuran IS NULL, d.mspk_ukuran, c.spk_ukuran) AS spk_ukuran,
      IFNULL(c.spk_cus_kode, d.mspk_cus_kode)    AS spk_cus_kode,
      e.Cus_nama,
      e.Cus_alamat,
      g.gdg_nama
    FROM tjadwalkirim a
    LEFT JOIN tspk c ON a.spk_nomor = c.spk_nomor
    LEFT JOIN tmemospk d ON a.spk_nomor = d.mspk_nomor
    LEFT JOIN tcustomer e ON e.Cus_kode = IFNULL(c.spk_cus_kode, d.mspk_cus_kode)
    LEFT JOIN tgudang g ON g.gdg_kode = a.Gudang
    WHERE a.Nomor_Kirim = ?
  `;
  const [headerRows] = await db.query(headerQuery, [nomor]);
  if (headerRows.length === 0) return null;
  const header = headerRows[0];

  // Detail baris
  const detailQuery = `
    SELECT
      No_urut, kota, uraian, jumlah, koli,
      jami AS jam_input,
      jam  AS jam_ready,
      jumlah_kirim, koli_kirim, jam_kirim, expedisi, jam_ambil
    FROM tjadwalkirim_dtl
    WHERE nomor_kirim = ?
    ORDER BY No_urut
  `;
  const [detailRows] = await db.query(detailQuery, [nomor]);

  // Sudah dijadwalkan (exclude nomor ini sendiri)
  const sudah = await getSudahDijadwalkan(header.spk_nomor, nomor);

  return {
    ...header,
    sudah_dijadwalkan: sudah,
    belum_dijadwalkan: Number(header.jumlah_spk || 0) - sudah,
    detail: detailRows,
  };
};

// ─────────────────────────────────────────────────────────
// SAVE (simpandata Delphi)
// Insert/Update header + delete+insert detail
// Validasi backend:
//   1. Gudang kosong
//   2. SPK kosong
//   3. Detail kosong
//   4. Tiap baris: kota kosong, uraian kosong
//   5. Jika jumlah > 0 → jam_ready wajib diisi
//   6. Total jumlah detail <= belum dijadwalkan
// ─────────────────────────────────────────────────────────
const save = async (data, userKode, isNewMode) => {
  const {
    Gudang,
    NomorSpk,
    Tanggal,
    JkPlanNomor = "",
    JkPlanTanggal = null,
    JkPlanJumlah = 0,
    Detail = [],
  } = data;

  // ── Validasi ──────────────────────────────────────────
  if (!Gudang?.trim()) throw new Error("Kode Gudang belum diisi.");
  if (!NomorSpk?.trim()) throw new Error("SPK belum diisi.");

  // Filter baris kosong (jumlah = 0 tidak disimpan, sesuai Delphi)
  const validDetail = Detail.filter((d) => Number(d.jumlah) !== 0);

  if (validDetail.length === 0) {
    throw new Error("Detail harus diisi.");
  }

  for (const row of validDetail) {
    if (!row.kota?.trim())
      throw new Error("Kota belum diisi pada salah satu baris.");
    if (!row.uraian?.trim())
      throw new Error("Uraian belum diisi pada salah satu baris.");
    if (Number(row.jumlah) > 0 && !row.jam_ready?.trim()) {
      throw new Error("Jam Barang Ready harus diisi jika Jumlah > 0.");
    }
  }

  // Hitung total jumlah dari detail
  const totalJumlah = validDetail.reduce((sum, d) => sum + Number(d.jumlah), 0);

  // Cek belum dijadwalkan
  const excludeNomor = isNewMode ? "" : data.NomorKirim;
  const sudah = await getSudahDijadwalkan(NomorSpk, excludeNomor);
  const spkInfo = await getSpkInfo(NomorSpk);
  if (!spkInfo) throw new Error("Nomor SPK tidak ditemukan.");

  const jumlahSpk = Number(spkInfo.spk_jumlah) || 0;
  const belum = jumlahSpk - sudah;

  if (totalJumlah > belum) {
    throw new Error(
      `Total Jumlah (${totalJumlah}) melebihi Qty yang belum dijadwalkan (${belum}).`,
    );
  }

  // ── Hitung summary footer (sesuai Delphi GetFooterSummary) ───────
  const totalKoli = validDetail.reduce((s, d) => s + Number(d.koli || 0), 0);
  const totalRealisasi = validDetail.reduce(
    (s, d) => s + Number(d.jumlah_kirim || 0),
    0,
  );
  const totalKoliRealisasi = validDetail.reduce(
    (s, d) => s + Number(d.koli_kirim || 0),
    0,
  );

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomorKirim = isNewMode ? null : data.NomorKirim;

    if (isNewMode) {
      nomorKirim = await generateNomor(Tanggal);
      await conn.query(
        `INSERT INTO tjadwalkirim
           (Nomor_Kirim, Gudang, Tanggal, spk_nomor, Jumlah, Koli,
            Realisasi, koli_Realisasi, date_Create, usr_Create,
            jk_plan_nomor, jk_plan_tanggal, jk_plan_jumlah)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?)`,
        [
          nomorKirim,
          Gudang,
          Tanggal,
          NomorSpk,
          totalJumlah,
          totalKoli,
          totalRealisasi,
          totalKoliRealisasi,
          userKode,
          JkPlanNomor || "",
          JkPlanTanggal || null,
          JkPlanJumlah || 0,
        ],
      );
    } else {
      await conn.query(
        `UPDATE tjadwalkirim SET
           Gudang = ?, Tanggal = ?, spk_nomor = ?,
           Jumlah = ?, Koli = ?, Realisasi = ?, koli_Realisasi = ?,
           jk_plan_nomor = ?, jk_plan_tanggal = ?, jk_plan_jumlah = ?
         WHERE Nomor_Kirim = ?`,
        [
          Gudang,
          Tanggal,
          NomorSpk,
          totalJumlah,
          totalKoli,
          totalRealisasi,
          totalKoliRealisasi,
          JkPlanNomor || "",
          JkPlanTanggal || null,
          JkPlanJumlah || 0,
          nomorKirim,
        ],
      );
    }

    // Delete + insert detail
    await conn.query(`DELETE FROM tjadwalkirim_dtl WHERE nomor_kirim = ?`, [
      nomorKirim,
    ]);

    let urut = 1;
    for (const row of validDetail) {
      await conn.query(
        `INSERT INTO tjadwalkirim_dtl
           (nomor_kirim, no_urut, kota, uraian, jumlah, koli,
            jami, jam, jumlah_kirim, koli_kirim, jam_kirim, expedisi, jam_ambil)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nomorKirim,
          urut,
          row.kota || "",
          row.uraian || "",
          Number(row.jumlah) || 0,
          Number(row.koli) || 0,
          row.jam_input || "", // jami = jam input (auto saat jumlah diisi)
          row.jam_ready || "", // jam = jam barang ready
          Number(row.jumlah_kirim) || 0,
          Number(row.koli_kirim) || 0,
          row.jam_kirim || "",
          row.expedisi || "",
          row.jam_ambil || "",
        ],
      );
      urut++;
    }

    await conn.commit();
    return nomorKirim;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

module.exports = {
  generateNomor,
  getSpkInfo,
  getSudahDijadwalkan,
  getPlanningPpic,
  cekDuplikatKota,
  cekJadwalByTanggal,
  searchSpk,
  getById,
  save,
};
