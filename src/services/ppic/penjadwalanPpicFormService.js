const db = require("../../config/database");

// ── Generate nomor: PJW.2026.00001 ── (tidak berubah)
const generateNomor = async (tahun) => {
  const prefix = `KK.${tahun}.`;
  const [[row]] = await db.query(
    `SELECT IFNULL(MAX(CAST(SUBSTRING(pjw_nomor, ?, 5) AS UNSIGNED)), 0) AS jumlah
     FROM tpenjadwalan_ppic_hdr WHERE pjw_nomor LIKE ?`,
    [prefix.length + 1, `${prefix}%`],
  );
  const nextVal = Number(row.jumlah) + 1;
  return `${prefix}${String(nextVal).padStart(5, "0")}`;
};

// ── Lookup Cabang (workshop) — dibatasi 4 cabang yang relevan utk
// Komitmen Kirim PPIC (P01/P02/P04/P05); cabang lain sengaja tidak
// ditampilkan sebagai opsi di form ini.
const getCabangOptions = async () => {
  const [rows] = await db.query(
    `SELECT pab_kode AS Kode, pab_nama AS Nama
     FROM tpabrik
     WHERE pab_kode IN ('P01','P02','P04','P05')
     ORDER BY pab_kode`,
  );
  return rows;
};

// ── Lookup Divisi ──
const getDivisiOptions = async () => {
  const [rows] = await db.query(
    `SELECT kode AS Kode, Divisi AS Nama FROM tdivisi ORDER BY kode`,
  );
  return rows;
};

// ── Tarik SO — sekarang dengan filter divisi opsional ──
const searchSoKandidat = async (startDate, endDate, divisi = "") => {
  const pakaiDivisi = divisi && divisi !== "0";
  const params = [
    startDate,
    endDate,
    ...(pakaiDivisi ? [divisi] : []),
    startDate,
    endDate,
    ...(pakaiDivisi ? [divisi] : []),
  ];
  const [rows] = await db.query(
    `SELECT so_nomor AS Nomor, so_nama AS Nama, DATE_FORMAT(so_tanggal,'%Y-%m-%d') AS Tanggal,
            so_jumlah AS Pesan, IFNULL(so_jumlah_kirim,0) AS Kirim,
            (so_jumlah - IFNULL(so_jumlah_kirim,0)) AS Kurang,
            so_dateline AS DatelineAsli
     FROM tsalesorder
     WHERE so_aktif = 'Y' AND so_close = 0
       AND so_dateline BETWEEN ? AND ?
       ${pakaiDivisi ? "AND so_divisi = ?" : ""}
     UNION ALL
     SELECT spk_nomor, spk_nama, DATE_FORMAT(spk_tanggal,'%Y-%m-%d'),
            spk_jumlah, IFNULL(spk_jumlah_kirim,0), (spk_jumlah - IFNULL(spk_jumlah_kirim,0)),
            spk_dateline
     FROM tspk
     WHERE spk_aktif = 'Y' AND spk_close = 0 AND spk_is_so = 0
       AND spk_dateline BETWEEN ? AND ?
       ${pakaiDivisi ? "AND spk_divisi = ?" : ""}
     ORDER BY DatelineAsli ASC`,
    params,
  );
  return rows;
};

// ── Tarik dari Pra Order — TIDAK menunggu pro_status_ppic='SANGGUP'.
// Syaratnya cukup pro_status='OPEN' (belum dikonversi ke Permintaan
// Harga) dan tanggal rencana kirim jatuh di periode ini. Tujuannya:
// PPIC memasukkan rencana order ke jadwal SEBAGAI bagian dari proses
// menimbang kesanggupan itu sendiri — bukan langkah sesudahnya.
const searchPraOrderKandidat = async (
  startDate,
  endDate,
  divisi = "",
  excludeNomor = "",
) => {
  let query = `
    SELECT
      h.pro_nomor AS Nomor,
      h.pro_nama_pekerjaan AS Nama,
      DATE_FORMAT(h.pro_tanggal, '%Y-%m-%d') AS Tanggal,
      h.pro_qty_rencana AS QtyRencana,
      DATE_FORMAT(h.pro_tgl_kirim, '%Y-%m-%d') AS TglKirim,
      h.pro_status_ppic AS StatusPpic,
      h.pro_divisi AS Divisi
    FROM tpraorder_hdr h
    WHERE h.pro_status = 'OPEN'
      AND h.pro_tgl_kirim BETWEEN ? AND ?
  `;
  const params = [startDate, endDate];

  if (divisi && divisi !== "0") {
    query += ` AND h.pro_divisi = ?`;
    params.push(divisi);
  }
  query += ` ORDER BY h.pro_tgl_kirim ASC`;

  const [rows] = await db.query(query, params);
  return rows;
};

// ── Info 1 SO (tambah manual) ── (tidak berubah)
const getSoInfo = async (soNomor, divisi = "", excludeNomor = "") => {
  const [rows] = await db.query(
    `SELECT Nomor, Nama, Tanggal, Pesan, Kirim, Kurang, Divisi, DatelineAsli FROM (
       SELECT so_nomor AS Nomor, so_nama AS Nama, DATE_FORMAT(so_tanggal,'%Y-%m-%d') AS Tanggal,
              so_jumlah AS Pesan, IFNULL(so_jumlah_kirim,0) AS Kirim,
              (so_jumlah - IFNULL(so_jumlah_kirim,0)) AS Kurang, so_divisi AS Divisi,
              DATE_FORMAT(so_dateline,'%Y-%m-%d') AS DatelineAsli
       FROM tsalesorder WHERE so_nomor = ?
       UNION ALL
       SELECT spk_nomor, spk_nama, DATE_FORMAT(spk_tanggal,'%Y-%m-%d'),
              spk_jumlah, IFNULL(spk_jumlah_kirim,0), (spk_jumlah - IFNULL(spk_jumlah_kirim,0)), spk_divisi,
              DATE_FORMAT(spk_dateline,'%Y-%m-%d')
       FROM tspk WHERE spk_nomor = ? AND spk_is_so = 0
     ) x LIMIT 1`,
    [soNomor, soNomor],
  );
  const row = rows[0];
  if (!row) return null;

  if (divisi && String(row.Divisi) !== String(divisi)) {
    throw new Error(
      `SO ${soNomor} bukan divisi yang sesuai dengan Cabang terpilih (Divisi SO: ${row.Divisi}).`,
    );
  }

  return row;
};

// ── Tarik dari MAP (Memo Approval Produk) — tahap sebelum SPK/SO,
// filter mspk_aktif='Y' AND mspk_close=0 (belum jadi SPK/SO), dan
// belum ditarik ke periode lain.
const searchMapKandidat = async (
  startDate,
  endDate,
  divisi = "",
  excludeNomor = "",
) => {
  let query = `
    SELECT mspk_nomor AS Nomor, mspk_nama AS Nama,
           DATE_FORMAT(mspk_tanggal,'%Y-%m-%d') AS Tanggal,
           mspk_rencana_order AS Pesan,
           0 AS Kirim,
           mspk_rencana_order AS Kurang,
           DATE_FORMAT(mspk_dateline, '%Y-%m-%d') AS DatelineAsli, mspk_divisi AS Divisi
    FROM tmemospk
    WHERE mspk_aktif = 'Y' AND mspk_close = 0
      AND mspk_dateline BETWEEN ? AND ?
  `;
  const params = [startDate, endDate];

  if (divisi && divisi !== "0") {
    query += ` AND mspk_divisi = ?`;
    params.push(divisi);
  }
  query += ` ORDER BY mspk_dateline ASC`;

  const [rows] = await db.query(query, params);
  return rows;
};

// ── Info 1 MAP (tambah manual) — dengan validasi Divisi ──
const getMapInfo = async (
  mapNomor,
  divisi = "",
  excludeNomor = "",
  periodeTgl1 = null,
  periodeTgl2 = null,
) => {
  const [rows] = await db.query(
    `SELECT
       m.mspk_nomor AS Nomor, m.mspk_nama AS Nama,
       DATE_FORMAT(m.mspk_tanggal,'%Y-%m-%d') AS Tanggal,
       m.mspk_jumlah AS Pesan,
       m.mspk_jumlah_kirim AS KirimTotal,
       m.mspk_jumlah_jadi AS RealisasiTotal,
       DATE_FORMAT(m.mspk_dateline, '%Y-%m-%d') AS DatelineAsli,
       m.mspk_divisi AS Divisi
     FROM tmemospk m WHERE m.mspk_nomor = ?`,
    [mapNomor],
  );
  const row = rows[0];
  if (!row) return null;

  if (divisi && String(row.Divisi) !== String(divisi)) {
    throw new Error(
      `MAP ${mapNomor} bukan divisi yang sesuai dengan Cabang terpilih (Divisi MAP: ${row.Divisi}).`,
    );
  }

  let kirimPeriode = 0;
  let realisasiPeriode = 0;

  if (periodeTgl1 && periodeTgl2) {
    const [[kirimRow]] = await db.query(
      `SELECT IFNULL(SUM(d.sjd_jumlah), 0) AS total
       FROM tsj_dtl_memo d
       INNER JOIN tsj_hdr_memo h ON h.sj_nomor = d.sjd_sj_nomor
       WHERE d.sjd_mspk_nomor = ? AND h.sj_tanggal BETWEEN ? AND ?`,
      [mapNomor, periodeTgl1, periodeTgl2],
    );
    kirimPeriode = Number(kirimRow.total) || 0;

    // BAST (tkesesuaianmap) yang disentuh (dibuat/diupdate) di periode
    // ini dianggap merepresentasikan realisasi periode ini — qty
    // jadinya tetap dari mspk_jumlah_jadi (satu-satunya sumber qty).
    const [[bastRow]] = await db.query(
      `SELECT COUNT(*) AS cnt FROM tkesesuaianmap
       WHERE mspk_nomor = ?
         AND (
           (date_create >= ? AND date_create < DATE_ADD(?, INTERVAL 1 DAY))
           OR (date_modify >= ? AND date_modify < DATE_ADD(?, INTERVAL 1 DAY))
         )`,
      [mapNomor, periodeTgl1, periodeTgl2, periodeTgl1, periodeTgl2],
    );
    if (Number(bastRow.cnt) > 0) {
      realisasiPeriode = Number(row.RealisasiTotal) || 0;
    }
  }

  return {
    ...row,
    Kirim: kirimPeriode,
    Kurang: Math.max(Number(row.Pesan) - Number(row.KirimTotal), 0),
    Realisasi: realisasiPeriode,
  };
};

/**
 * Lookup 1 Pra Order by nomor, untuk tombol "Tambah Baris Manual"
 * saat user ngetik nomor PRA langsung.
 * @param {string} proNomor
 * @param {string} pjwDivisi - KODE divisi header Komitmen Kirim (mis. "4"),
 *   sedangkan tpraorder_hdr.pro_divisi menyimpan NAMA divisi (mis. "GARMEN") —
 *   makanya harus dikonversi dulu, nggak bisa dibandingkan langsung.
 */
const getPraOrderInfo = async (proNomor, pjwDivisi) => {
  const [rows] = await db.query(
    `SELECT pro_nomor, pro_status, pro_divisi, pro_nama_pekerjaan,
            pro_tanggal, pro_tgl_kirim, pro_qty_rencana
     FROM tpraorder_hdr
     WHERE pro_nomor = ?`,
    [proNomor],
  );

  if (rows.length === 0) {
    throw new Error(`Pra Order ${proNomor} tidak ditemukan.`);
  }

  const pro = rows[0];

  if (pro.pro_status !== "OPEN") {
    throw new Error(
      `Pra Order ${proNomor} statusnya ${pro.pro_status}, bukan OPEN.`,
    );
  }

  if (String(pro.pro_divisi) !== String(pjwDivisi)) {
    throw new Error(
      `Pra Order ${proNomor} bukan divisi yang sesuai (divisi: ${pro.pro_divisi}).`,
    );
  }

  const [existing] = await db.query(
    `SELECT pjwd_pjw_nomor FROM tpenjadwalan_ppic_dtl WHERE pjwd_pro_nomor = ?`,
    [proNomor],
  );
  if (existing.length > 0) {
    throw new Error(
      `Pra Order ${proNomor} sudah ada di Komitmen Kirim ${existing[0].pjwd_pjw_nomor}.`,
    );
  }

  // Pesan = Total Rencana Order; belum ada yg dikirim karena belum jadi SO
  const pesan = Number(pro.pro_qty_rencana) || 0;

  return {
    Nomor: pro.pro_nomor,
    Nama: pro.pro_nama_pekerjaan,
    Tanggal: pro.pro_tanggal,
    Pesan: pesan,
    Kirim: 0,
    Kurang: pesan, // Kurang = Pesan - Kirim
    DatelineAsli: pro.pro_tgl_kirim, // ⬅ Permintaan Kirim baca dari sini
  };
};

// ── Info 1 MH (tambah manual) — dengan validasi Divisi & duplikasi ──
const getMhInfo = async (mhNomor, divisi = "", excludeNomor = "") => {
  const [rows] = await db.query(
    `SELECT mh_nomor AS Nomor, mh_nama AS Nama,
            DATE_FORMAT(mh_tanggal,'%Y-%m-%d') AS Tanggal,
            mh_jmlorder AS Pesan,
            0 AS Kirim,
            mh_jmlorder AS Kurang,
            mh_divisi AS Divisi,
            mh_status AS Status
     FROM tmintaharga WHERE mh_nomor = ?`,
    [mhNomor],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.Status === "CANCEL") {
    throw new Error(`MH ${mhNomor} sudah di-cancel.`);
  }
  if (divisi && String(row.Divisi) !== String(divisi)) {
    throw new Error(
      `MH ${mhNomor} bukan divisi yang sesuai dengan Cabang terpilih (Divisi MH: ${row.Divisi}).`,
    );
  }

  return row;
};

// ── Daftar baris detail 1 Penawaran (buat picker "pilih baris") ──
// Cuma baris yang belum jadi SPK/SO (spk kosong) DAN bukan status
// batal murni — supaya user nggak pilih baris yang udah nggak
// relevan lagi.
const getPenawaranDetailList = async (penNomor) => {
  const [hdrRows] = await db.query(
    `SELECT pen_nomor, pen_divisi FROM tpenawaran_hdr WHERE pen_nomor = ?`,
    [penNomor],
  );
  if (!hdrRows.length) return null;

  const [rows] = await db.query(
    `SELECT
       d.pend_id AS PendId,
       d.pend_nama_barang AS Nama,
       d.pend_ukuran AS Ukuran,
       d.pend_qty AS Qty,
       d.pend_harga AS Harga,
       d.pend_status AS Status,
       IFNULL(
         (SELECT so.so_nomor FROM tsalesorder so
          WHERE so.so_pen_nomor = d.pend_pen_nomor AND so.so_pen_id = d.pend_id
            AND so.so_aktif = 'Y' LIMIT 1),
         (SELECT s.spk_nomor FROM tspk s
          WHERE s.spk_pen_nomor = d.pend_pen_nomor AND s.spk_pen_id = d.pend_id
            AND s.spk_is_so = 1 AND s.spk_aktif = 'Y' LIMIT 1)
       ) AS SudahJadiSo
     FROM tpenawaran_dtl d
     WHERE d.pend_pen_nomor = ?
       AND d.pend_batal NOT LIKE 'HANYA ALTERNATIF%'
     ORDER BY d.pend_urutan`,
    [penNomor],
  );

  return { divisi: hdrRows[0].pen_divisi, items: rows };
};

// ── Info 1 baris Penawaran spesifik (setelah user pilih dari picker) ──
const getPenawaranItemInfo = async (
  penNomor,
  pendId,
  divisi = "",
  excludeNomor = "",
) => {
  const [rows] = await db.query(
    `SELECT
       h.pen_nomor AS PenNomor, h.pen_divisi AS Divisi,
       d.pend_id AS PendId, d.pend_nama_barang AS Nama,
       DATE_FORMAT(h.pen_tanggal,'%Y-%m-%d') AS Tanggal,
       d.pend_qty AS Pesan, 0 AS Kirim, d.pend_qty AS Kurang
     FROM tpenawaran_dtl d
     INNER JOIN tpenawaran_hdr h ON h.pen_nomor = d.pend_pen_nomor
     WHERE d.pend_pen_nomor = ? AND d.pend_id = ?`,
    [penNomor, pendId],
  );
  const row = rows[0];
  if (!row) return null;

  if (divisi && String(row.Divisi) !== String(divisi)) {
    throw new Error(
      `Penawaran ${penNomor} bukan divisi yang sesuai dengan Cabang terpilih (Divisi: ${row.Divisi}).`,
    );
  }

  return row;
};

// ── SINKRONISASI: cari baris MH/Penawaran yang belum resolve ke SO,
// coba resolve. Kalau resolve ke >1 SO, split jadi baris tambahan.
// Dipanggil dari getFormDetail() setiap form dibuka. ──
const resolveSourceForPeriod = async (pjwNomor) => {
  const [pendingRows] = await db.query(
    `SELECT pjwd_id, pjwd_mh_nomor, pjwd_pen_nomor, pjwd_pen_id
     FROM tpenjadwalan_ppic_dtl
     WHERE pjwd_pjw_nomor = ?
       AND pjwd_so_nomor IS NULL
       AND (pjwd_mh_nomor IS NOT NULL OR pjwd_pen_nomor IS NOT NULL)`,
    [pjwNomor],
  );
  if (!pendingRows.length) return;

  for (const row of pendingRows) {
    let soList = [];

    if (row.pjwd_mh_nomor) {
      const [found] = await db.query(
        `SELECT so.so_nomor AS SoNomor
         FROM tpenawaran_dtl pd
         INNER JOIN tsalesorder so
           ON so.so_pen_nomor = pd.pend_pen_nomor AND so.so_pen_id = pd.pend_id
           AND so.so_aktif = 'Y'
         WHERE pd.pend_minta = ?
         UNION
         SELECT s.spk_nomor
         FROM tpenawaran_dtl pd
         INNER JOIN tspk s
           ON s.spk_pen_nomor = pd.pend_pen_nomor AND s.spk_pen_id = pd.pend_id
           AND s.spk_is_so = 1 AND s.spk_aktif = 'Y'
         WHERE pd.pend_minta = ?
         UNION
         SELECT so2.so_nomor
         FROM tpenawaran_dtl pd2
         INNER JOIN tmemospk mp2
           ON mp2.mspk_pen_nomor = pd2.pend_pen_nomor AND mp2.mspk_pen_id = pd2.pend_id
         INNER JOIN tsalesorder so2 ON so2.so_memo = mp2.mspk_nomor AND so2.so_aktif = 'Y'
         WHERE pd2.pend_minta = ?`,
        [row.pjwd_mh_nomor, row.pjwd_mh_nomor, row.pjwd_mh_nomor],
      );
      soList = found.map((r) => r.SoNomor);
    } else if (row.pjwd_pen_nomor && row.pjwd_pen_id) {
      // Cek SO/SPK langsung dulu
      const [foundDirect] = await db.query(
        `SELECT so_nomor AS SoNomor FROM tsalesorder
     WHERE so_pen_nomor = ? AND so_pen_id = ? AND so_aktif = 'Y'
     UNION ALL
     SELECT spk_nomor AS SoNomor FROM tspk
     WHERE spk_pen_nomor = ? AND spk_pen_id = ? AND spk_is_so = 1 AND spk_aktif = 'Y'`,
        [
          row.pjwd_pen_nomor,
          row.pjwd_pen_id,
          row.pjwd_pen_nomor,
          row.pjwd_pen_id,
        ],
      );
      if (foundDirect.length > 0) {
        soList = foundDirect.map((r) => r.SoNomor);
      } else {
        // Belum jadi SO langsung — cek apakah udah jadi MAP dulu, lalu
        // cek apakah MAP itu udah jadi SO
        const [[mapRow]] = await db.query(
          `SELECT mspk_nomor FROM tmemospk WHERE mspk_pen_nomor = ? AND mspk_pen_id = ? LIMIT 1`,
          [row.pjwd_pen_nomor, row.pjwd_pen_id],
        );
        if (mapRow) {
          const [foundViaMap] = await db.query(
            `SELECT so_nomor AS SoNomor FROM tsalesorder WHERE so_memo = ? AND so_aktif = 'Y'`,
            [mapRow.mspk_nomor],
          );
          soList = foundViaMap.map((r) => r.SoNomor);
          // Kalau MAP-nya ketemu tapi belum jadi SO, "naikkan" baris ini
          // jadi MAP (bukan Penawaran lagi) — supaya Sumber-nya akurat
          if (soList.length === 0) {
            await db.query(
              `UPDATE tpenjadwalan_ppic_dtl SET pjwd_map_nomor = ? WHERE pjwd_id = ?`,
              [mapRow.mspk_nomor, row.pjwd_id],
            );
            continue; // lanjut ke row berikutnya, belum ada SO utk baris ini
          }
        }
      }
    }

    soList = [...new Set(soList)];

    // SO yang sudah punya baris di periode ini dilewati. Tanpa ini UPDATE/INSERT di
    // bawah menabrak UNIQUE uq_pjwd_so dan form periode tidak bisa dibuka sama sekali.
    if (soList.length) {
      const [sudah] = await db.query(
        `SELECT pjwd_so_nomor AS so FROM tpenjadwalan_ppic_dtl
         WHERE pjwd_pjw_nomor = ? AND pjwd_so_nomor IN (?)`,
        [pjwNomor, soList],
      );
      const terpakai = new Set(sudah.map((r) => r.so));
      soList = soList.filter((n) => !terpakai.has(n));
    }

    if (soList.length === 0) continue; // belum jadi SO / SO-nya sudah ada di periode ini

    // Baris pertama: update baris existing
    await db.query(
      `UPDATE tpenjadwalan_ppic_dtl SET pjwd_so_nomor = ? WHERE pjwd_id = ?`,
      [soList[0], row.pjwd_id],
    );

    // Sisanya (kalau pecah jadi >1 SO): insert baris BARU, salin
    // pjwd_mh_nomor/pjwd_pen_nomor asal untuk jejak asal-usul, tapi
    // dengan pjwd_so_nomor masing-masing yang berbeda.
    for (let i = 1; i < soList.length; i++) {
      await db.query(
        `INSERT INTO tpenjadwalan_ppic_dtl
           (pjwd_pjw_nomor, pjwd_so_nomor, pjwd_mh_nomor, pjwd_pen_nomor, pjwd_pen_id,
            pjwd_rencana, pjwd_status_permintaan)
         VALUES (?, ?, ?, ?, ?, 0, 'CLOSE')`,
        [
          pjwNomor,
          soList[i],
          row.pjwd_mh_nomor,
          row.pjwd_pen_nomor,
          row.pjwd_pen_id,
        ],
      );
    }
  }
};

// ── Load untuk mode edit ── (tidak berubah, tetap panggil getDetail dari service browse)
const getFormDetail = async (nomor) => {
  const [hdrRows] = await db.query(
    `SELECT h.pjw_nomor, DATE_FORMAT(h.pjw_tgl1, '%Y-%m-%d') AS pjw_tgl1,
          DATE_FORMAT(h.pjw_tgl2, '%Y-%m-%d') AS pjw_tgl2,
          h.pjw_cab, h.pjw_divisi, h.pjw_keterangan, h.pjw_close
     FROM tpenjadwalan_ppic_hdr h WHERE h.pjw_nomor = ?`,
    [nomor],
  );
  if (!hdrRows.length) return null;

  try {
    await resolveSourceForPeriod(nomor);
  } catch (e) {
    console.error(`Resolve sumber periode ${nomor} gagal:`, e.message);
  }
  await sinkronSoKePeriode(nomor);

  const penjadwalanPpicService = require("./penjadwalanPpicService");
  const detail = await penjadwalanPpicService.getDetail(nomor);
  return { header: hdrRows[0], detail };
};

// ── Save — sekarang so_nomor boleh kosong asal pro_nomor ada ──
const saveData = async (payload, userKode, userBagian) => {
  const {
    pjw_nomor,
    pjw_tgl1,
    pjw_tgl2,
    pjw_cab,
    pjw_divisi,
    pjw_keterangan,
    detail = [],
  } = payload;

  if (!pjw_tgl1 || !pjw_tgl2) throw new Error("Periode wajib diisi.");
  if (!detail.length)
    throw new Error("Minimal satu SO/Pra Order/MAP harus ditambahkan.");

  const isAdmin = (userKode || "").toUpperCase() === "ADMIN";
  const bagianUpper = (userBagian || "").toUpperCase();
  const isPpic = !isAdmin && bagianUpper === "PPIC";
  const isMarketing = !isAdmin && bagianUpper === "MARKETING";

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const tahun = new Date(pjw_tgl1).getFullYear();
    let nomor = pjw_nomor;

    let existingByKey = {};
    if (nomor) {
      const [oldRows] = await conn.query(
        `SELECT pjwd_so_nomor, pjwd_pro_nomor, pjwd_map_nomor,
                pjwd_rencana, pjwd_tgl_permintaan_kirim, pjwd_status_permintaan,
                pjwd_tgl_kesepakatan, pjwd_ket_kesepakatan
         FROM tpenjadwalan_ppic_dtl WHERE pjwd_pjw_nomor = ?`,
        [nomor],
      );
      for (const r of oldRows) {
        const key = r.pjwd_so_nomor || r.pjwd_pro_nomor || r.pjwd_map_nomor;
        existingByKey[key] = r;
      }
    }

    if (nomor) {
      await conn.query(
        `UPDATE tpenjadwalan_ppic_hdr SET
           pjw_tgl1 = ?, pjw_tgl2 = ?, pjw_cab = ?, pjw_divisi = ?, pjw_keterangan = ?,
           user_modified = ?, date_modified = NOW()
         WHERE pjw_nomor = ?`,
        [
          pjw_tgl1,
          pjw_tgl2,
          pjw_cab || "",
          pjw_divisi || null,
          pjw_keterangan || "",
          userKode,
          nomor,
        ],
      );
    } else {
      nomor = await generateNomor(tahun);
      await conn.query(
        `INSERT INTO tpenjadwalan_ppic_hdr
           (pjw_nomor, pjw_tgl1, pjw_tgl2, pjw_cab, pjw_divisi, pjw_keterangan, user_create, date_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          nomor,
          pjw_tgl1,
          pjw_tgl2,
          pjw_cab || "",
          pjw_divisi || null,
          pjw_keterangan || "",
          userKode,
        ],
      );
    }

    await conn.query(
      `DELETE FROM tpenjadwalan_ppic_dtl WHERE pjwd_pjw_nomor = ?`,
      [nomor],
    );

    for (const row of detail) {
      if (!row.SoNomor && !row.NomorPraOrder && !row.MapNomor) continue;

      const key = row.SoNomor || row.NomorPraOrder || row.MapNomor;
      const old = existingByKey[key];

      let rencana = Number(row.Rencana) || 0;
      let permintaanKirim = row.PermintaanKirim || null;
      let statusPermintaan = row.StatusPermintaan || "CLOSE";
      let kesepakatan = row.Kesepakatan || null;
      let ketKesepakatan = row.KetKesepakatan || "";

      if (isPpic) {
        rencana = old ? old.pjwd_rencana : rencana;
        permintaanKirim = old ? old.pjwd_tgl_permintaan_kirim : permintaanKirim;
        statusPermintaan = old ? old.pjwd_status_permintaan : statusPermintaan;
      } else if (isMarketing) {
        kesepakatan = old ? old.pjwd_tgl_kesepakatan : kesepakatan;
        ketKesepakatan = old ? old.pjwd_ket_kesepakatan : ketKesepakatan;
      }

      await conn.query(
        `INSERT INTO tpenjadwalan_ppic_dtl
           (pjwd_pjw_nomor, pjwd_so_nomor, pjwd_pro_nomor, pjwd_map_nomor, pjwd_rencana,
            pjwd_tgl_permintaan_kirim, pjwd_status_permintaan,
            pjwd_tgl_kesepakatan, pjwd_ket_kesepakatan)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nomor,
          row.SoNomor || null,
          row.NomorPraOrder || null,
          row.MapNomor || null,
          rencana,
          permintaanKirim,
          statusPermintaan,
          kesepakatan,
          ketKesepakatan,
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

// ═══════════════════════════════════════════════════════════
// GRANULAR ROW-LEVEL OPERATIONS — untuk realtime auto-save
// Menggantikan pola delete-lalu-insert-ulang saveData() lama.
// Setiap operasi langsung commit ke DB satu unit kerja saja.
// ═══════════════════════════════════════════════════════════

const FIELD_OWNERSHIP = {
  pjwd_rencana: "MARKETING",
  pjwd_ket_rencana: "MARKETING",
  pjwd_tgl_permintaan_kirim: "MARKETING",
  pjwd_status_permintaan: "MARKETING",
  pjwd_tgl_kesepakatan: "NOT_MARKETING", // ⬅ diubah dari "PPIC"
  pjwd_qty_kesepakatan: "NOT_MARKETING",
  pjwd_ket_kesepakatan: "NOT_MARKETING", // ⬅ diubah dari "PPIC"
  pjwd_nama_manual: "MARKETING",
  pjwd_pesan_manual: "MARKETING",
  pjwd_kirim_manual: "MARKETING",
  pjwd_realisasi_manual: "MARKETING",
};

const HEADER_FIELD_OWNERSHIP = {
  pjw_tgl1: "MARKETING",
  pjw_tgl2: "MARKETING",
  pjw_cab: "MARKETING",
  pjw_divisi: "MARKETING",
  pjw_keterangan: "MARKETING",
};

const assertFieldOwnership = (field, ownershipMap, userKode, userBagian) => {
  const isAdmin = (userKode || "").toUpperCase() === "ADMIN";
  if (isAdmin) return;

  const owner = ownershipMap[field];
  if (!owner) return;

  const bagianUpper = (userBagian || "").toUpperCase();

  if (owner === "NOT_MARKETING") {
    if (bagianUpper === "MARKETING") {
      throw new Error("Field ini tidak bisa diubah oleh bagian Marketing.");
    }
    return;
  }

  // AUDIT diberi akses sama seperti MARKETING untuk field-field ini
  // (Rencana, Ket Rencana, Permintaan Kirim, dst) — permintaan khusus.
  if (owner === "MARKETING" && bagianUpper === "AUDIT") return;

  if (bagianUpper !== owner) {
    throw new Error(`Field ini hanya bisa diubah oleh bagian ${owner}.`);
  }
};

// ── UPDATE HEADER — satu field per call (Periode/Cabang/Keterangan) ──
const updateHeaderField = async (
  pjwNomor,
  field,
  value,
  userKode,
  userBagian,
) => {
  if (!Object.prototype.hasOwnProperty.call(HEADER_FIELD_OWNERSHIP, field)) {
    throw new Error("Field header tidak dikenal.");
  }
  assertFieldOwnership(field, HEADER_FIELD_OWNERSHIP, userKode, userBagian);

  await db.query(
    `UPDATE tpenjadwalan_ppic_hdr SET ${field} = ?, user_modified = ?, date_modified = NOW() WHERE pjw_nomor = ?`,
    [value, userKode, pjwNomor],
  );
  return { pjw_nomor: pjwNomor, field, value };
};

// ── CREATE HEADER (baru — sebelumnya bagian dari saveData()) ──
const createHeader = async (payload, userKode, userBagian) => {
  const isAdmin = (userKode || "").toUpperCase() === "ADMIN";
  const bagianUpper = (userBagian || "").toUpperCase();
  if (!isAdmin && bagianUpper !== "MARKETING" && bagianUpper !== "AUDIT") {
    throw new Error(
      "Membuat Komitmen Kirim baru hanya bisa dilakukan oleh bagian MARKETING.",
    );
  }

  const { pjw_tgl1, pjw_tgl2, pjw_cab, pjw_divisi, pjw_keterangan } = payload;
  if (!pjw_tgl1 || !pjw_tgl2) throw new Error("Periode wajib diisi.");

  const tahun = new Date(pjw_tgl1).getFullYear();
  const nomor = await generateNomor(tahun);

  await db.query(
    `INSERT INTO tpenjadwalan_ppic_hdr
       (pjw_nomor, pjw_tgl1, pjw_tgl2, pjw_cab, pjw_divisi, pjw_keterangan, user_create, date_create)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      nomor,
      pjw_tgl1,
      pjw_tgl2,
      pjw_cab || "",
      pjw_divisi || null,
      pjw_keterangan || "",
      userKode,
    ],
  );
  const jumlahSo = await sinkronSoKePeriode(nomor, userKode);
  return { nomor, jumlahSo };
};

// ── Helper: total Rencana SAAT INI untuk satu periode, opsional exclude
// satu baris (dipakai saat update baris itu sendiri, supaya tidak
// menghitung nilai lamanya dobel dengan nilai barunya).
const getTotalRencana = async (pjwNomor, excludePjwdId = null, tipe = "SO") => {
  let query = `SELECT IFNULL(SUM(pjwd_rencana), 0) AS total FROM tpenjadwalan_ppic_dtl WHERE pjwd_pjw_nomor = ? AND pjwd_tipe = ?`;
  const params = [pjwNomor, tipe];
  if (excludePjwdId) {
    query += ` AND pjwd_id <> ?`;
    params.push(excludePjwdId);
  }
  const [[row]] = await db.query(query, params);
  return Number(row.total) || 0;
};

// Kapasitas kirim mingguan per cabang. Cabang yang tidak terdaftar
// pakai DEFAULT_CAPACITY.
const CABANG_CAPACITY = {
  P01: 75000,
  P04: 15000,
};
const DEFAULT_CAPACITY = 15000;

const getCapacity = (cabang) => CABANG_CAPACITY[cabang] || DEFAULT_CAPACITY;

// ── ADD DETAIL ROW — satu baris SO/Pra Order/MAP ──
const addDetailRow = async (pjwNomor, rowData, userKode, userBagian) => {
  const isAdmin = (userKode || "").toUpperCase() === "ADMIN";
  const bagianUpper = (userBagian || "").toUpperCase();
  if (!isAdmin && bagianUpper !== "MARKETING" && bagianUpper !== "AUDIT") {
    throw new Error(
      "Menambah baris hanya bisa dilakukan oleh bagian MARKETING.",
    );
  }
  const {
    Tipe,
    SoNomor,
    NomorPraOrder,
    MapNomor,
    MhNomor,
    PenNomor,
    PenId,
    Rencana,
    Realisasi,
    Pesan,
    Kirim,
    PermintaanKirim,
    NamaManual,
    PesanManual,
    KirimManual,
    RealisasiManual,
  } = rowData;
  const tipe = Tipe === "MAP" ? "MAP" : "SO";
  const isManual =
    !SoNomor && !NomorPraOrder && !MapNomor && !MhNomor && !PenNomor;
  if (isManual && !NamaManual) {
    throw new Error("Baris manual harus punya Nama.");
  }
  if (tipe === "MAP" && SoNomor) {
    throw new Error(
      "Nomor SO tidak bisa ditambahkan ke Komitmen Kirim MAP/Sampel. Tambahkan lewat tab Komitmen Kirim SO.",
    );
  }

  // Untuk tab MAP: Rencana otomatis = Pesan (qty penuh), bukan diisi
  // manual — beda dari keputusan awal ("qty sampel manual"), diganti
  // sesuai arahan terbaru: Rencana=Pesan berarti Close otomatis.
  const rencanaVal = tipe === "MAP" ? Number(Pesan) || 0 : Number(Rencana) || 0;
  const realisasiVal =
    tipe === "MAP" && !isManual ? Number(Realisasi) || 0 : null;
  // Pesan/Kirim untuk MAP: snapshot mspk_jumlah/qty kirim SJ dari
  // getMapInfo saat baris ditarik — sebelumnya salah dihardcode 0,
  // sekarang ambil dari nilai yang dikirim frontend.
  const pesanVal = tipe === "MAP" && !isManual ? Number(Pesan) || 0 : null;
  const kirimVal = tipe === "MAP" && !isManual ? Number(Kirim) || 0 : null;

  const [[hdrRow]] = await db.query(
    `SELECT pjw_cab FROM tpenjadwalan_ppic_hdr WHERE pjw_nomor = ?`,
    [pjwNomor],
  );
  const batasKapasitas = getCapacity(hdrRow?.pjw_cab);

  const totalSekarang = await getTotalRencana(pjwNomor, null, tipe);
  const totalSetelah = totalSekarang + rencanaVal;
  const melebihiBatas = tipe === "SO" && totalSetelah > batasKapasitas;
  const permintaanKirimSafe = PermintaanKirim
    ? String(PermintaanKirim).substring(0, 10)
    : null;
  const [result] = await db.query(
    `INSERT INTO tpenjadwalan_ppic_dtl
       (pjwd_pjw_nomor, pjwd_tipe, pjwd_so_nomor, pjwd_pro_nomor, pjwd_map_nomor, pjwd_mh_nomor, pjwd_pen_nomor, pjwd_pen_id, pjwd_rencana,
        pjwd_tgl_permintaan_kirim, pjwd_status_permintaan, pjwd_user_create,
        pjwd_nama_manual, pjwd_pesan_manual, pjwd_kirim_manual, pjwd_realisasi_manual)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CLOSE', ?, ?, ?, ?, ?)`,
    [
      pjwNomor,
      tipe,
      SoNomor || null,
      NomorPraOrder || null,
      MapNomor || null,
      MhNomor || null,
      PenNomor || null,
      PenId || null,
      rencanaVal,
      permintaanKirimSafe,
      userKode,
      isManual ? NamaManual : null,
      isManual ? Number(PesanManual) || 0 : pesanVal,
      isManual ? Number(KirimManual) || 0 : kirimVal,
      isManual ? Number(RealisasiManual) || 0 : realisasiVal,
    ],
  );
  if (SoNomor) {
    try {
      await db.query(
        `INSERT IGNORE INTO tpenjadwalan_ppic_so_log
           (pso_so_nomor, pso_pjw_nomor, pso_sumber) VALUES (?, ?, 'MANUAL')`,
        [SoNomor, pjwNomor],
      );
    } catch (e) {
      console.error("Gagal catat log SO manual:", e.message);
    }
  }
  return {
    pjwd_id: result.insertId,
    warning: melebihiBatas ? { totalSetelah, batas: batasKapasitas } : null,
  };
};

// ── UPDATE DETAIL FIELD — satu kolom di satu baris ──
const DATE_FIELDS = ["pjwd_tgl_permintaan_kirim", "pjwd_tgl_kesepakatan"];

const updateDetailField = async (
  pjwdId,
  field,
  value,
  userKode,
  userBagian,
) => {
  if (!Object.prototype.hasOwnProperty.call(FIELD_OWNERSHIP, field)) {
    throw new Error("Field detail tidak dikenal.");
  }
  assertFieldOwnership(field, FIELD_OWNERSHIP, userKode, userBagian);

  let sanitizedValue = value;
  if (DATE_FIELDS.includes(field) && (value === "" || value === undefined)) {
    sanitizedValue = null;
  }

  let breakdownDihapus = false;
  let rencanaBerubah = false;
  let melebihiBatas = false;
  let totalSetelah = null;
  let batasKapasitas = null;

  if (field === "pjwd_rencana") {
    const [[row]] = await db.query(
      `SELECT d.pjwd_pjw_nomor, d.pjwd_tipe, d.pjwd_rencana, h.pjw_cab
       FROM tpenjadwalan_ppic_dtl d
       INNER JOIN tpenjadwalan_ppic_hdr h ON h.pjw_nomor = d.pjwd_pjw_nomor
       WHERE d.pjwd_id = ?`,
      [pjwdId],
    );
    if (!row) throw new Error("Baris tidak ditemukan.");

    rencanaBerubah = (Number(value) || 0) !== (Number(row.pjwd_rencana) || 0);

    if (row.pjwd_tipe === "SO") {
      batasKapasitas = getCapacity(row.pjw_cab);
      const rencanaBaru = Number(value) || 0;
      const totalLain = await getTotalRencana(row.pjwd_pjw_nomor, pjwdId, "SO");
      totalSetelah = totalLain + rencanaBaru;
      melebihiBatas = totalSetelah > batasKapasitas;
    }
  }

  if (field === "pjwd_tgl_kesepakatan") {
    const [[b]] = await db.query(
      `SELECT COUNT(*) AS n FROM tpenjadwalan_ppic_kesepakatan WHERE pjwk_pjwd_id = ?`,
      [pjwdId],
    );
    if (Number(b.n) > 0)
      throw new Error(
        "Kesepakatan sudah dipecah (breakdown). Ubah lewat dialog breakdown.",
      );
  }

  await db.query(
    `UPDATE tpenjadwalan_ppic_dtl SET ${field} = ? WHERE pjwd_id = ?`,
    [sanitizedValue, pjwdId],
  );

  if (field === "pjwd_rencana" && rencanaBerubah) {
    const [del] = await db.query(
      `DELETE FROM tpenjadwalan_ppic_kesepakatan WHERE pjwk_pjwd_id = ?`,
      [pjwdId],
    );
    breakdownDihapus = del.affectedRows > 0;
  }

  return {
    pjwd_id: Number(pjwdId),
    field,
    value: sanitizedValue,
    warning: melebihiBatas ? { totalSetelah, batas: batasKapasitas } : null,
    breakdownDihapus,
  };
};

// ── DELETE DETAIL ROW ──
const deleteDetailRow = async (pjwdId, userKode, userBagian) => {
  const isAdmin = (userKode || "").toUpperCase() === "ADMIN";
  const bagianUpper = (userBagian || "").toUpperCase();
  if (!isAdmin && bagianUpper !== "MARKETING" && bagianUpper !== "AUDIT") {
    throw new Error(
      "Menghapus baris hanya bisa dilakukan oleh bagian MARKETING.",
    );
  }
  await db.query(
    `DELETE FROM tpenjadwalan_ppic_kesepakatan WHERE pjwk_pjwd_id = ?`,
    [pjwdId],
  );
  await db.query(`DELETE FROM tpenjadwalan_ppic_dtl WHERE pjwd_id = ?`, [
    pjwdId,
  ]);
  return { pjwd_id: Number(pjwdId) }; // ⬅ cast ke Number
};

// ═══════════════════════════════════════════════════════════
// PINDAH PERIODE OTOMATIS — saat Kesepakatan mundur/maju ke
// minggu lain. Dua tahap: cek target (utk dialog konfirmasi),
// lalu eksekusi (transaksional).
// ═══════════════════════════════════════════════════════════

const getMondayOfWeek = (dateStr) => {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diff);
  return mon;
};
const toLocalDate = (d) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const getWeekRange = (tanggal) => {
  const monday = getMondayOfWeek(tanggal);
  const saturday = new Date(monday);
  saturday.setDate(monday.getDate() + 5);
  return { tgl1: toLocalDate(monday), tgl2: toLocalDate(saturday) };
};

// ── CEK TARGET (dipanggil saat blur, SEBELUM pindah beneran) ──
const checkTargetPeriod = async (pjwdId, tanggalBaru) => {
  const [[row]] = await db.query(
    `SELECT d.pjwd_so_nomor, d.pjwd_pro_nomor, d.pjwd_map_nomor,
            h.pjw_tgl1, h.pjw_tgl2, h.pjw_cab
     FROM tpenjadwalan_ppic_dtl d
     INNER JOIN tpenjadwalan_ppic_hdr h ON h.pjw_nomor = d.pjwd_pjw_nomor
     WHERE d.pjwd_id = ?`,
    [pjwdId],
  );
  if (!row) throw new Error("Baris tidak ditemukan.");

  if (tanggalBaru >= row.pjw_tgl1 && tanggalBaru <= row.pjw_tgl2) {
    return { needMove: false };
  }

  const arah = tanggalBaru < row.pjw_tgl1 ? "MAJU" : "MUNDUR";

  const { tgl1, tgl2 } = getWeekRange(tanggalBaru);
  const [[target]] = await db.query(
    `SELECT pjw_nomor FROM tpenjadwalan_ppic_hdr
     WHERE pjw_cab = ? AND pjw_close = 'N' AND ? BETWEEN pjw_tgl1 AND pjw_tgl2
     LIMIT 1`,
    [row.pjw_cab, tanggalBaru],
  );

  return {
    needMove: true,
    arah,
    willCreateNew: !target,
    targetNomor: target ? target.pjw_nomor : null,
    targetTgl1: tgl1,
    targetTgl2: tgl2,
  };
};

// ── EKSEKUSI PINDAH (dipanggil setelah PPIC konfirmasi dialog) ──
const moveDetailRowToPeriod = async (
  pjwdId,
  tanggalBaru,
  userKode,
  userBagian,
) => {
  assertFieldOwnership(
    "pjwd_tgl_kesepakatan",
    FIELD_OWNERSHIP,
    userKode,
    userBagian,
  );

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[row]] = await conn.query(
      `SELECT d.pjwd_pjw_nomor, d.pjwd_so_nomor, d.pjwd_pro_nomor, d.pjwd_map_nomor, d.pjwd_rencana,
              h.pjw_cab, h.pjw_divisi, h.pjw_tgl1, h.pjw_tgl2
       FROM tpenjadwalan_ppic_dtl d
       INNER JOIN tpenjadwalan_ppic_hdr h ON h.pjw_nomor = d.pjwd_pjw_nomor
       WHERE d.pjwd_id = ? FOR UPDATE`,
      [pjwdId],
    );
    if (!row) throw new Error("Baris tidak ditemukan.");

    const [[adaBd]] = await conn.query(
      `SELECT COUNT(*) AS n FROM tpenjadwalan_ppic_kesepakatan WHERE pjwk_pjwd_id = ?`,
      [pjwdId],
    );
    if (Number(adaBd.n) > 0)
      throw new Error(
        "Kesepakatan sudah dipecah (breakdown). Ubah lewat dialog breakdown.",
      );

    if (tanggalBaru >= row.pjw_tgl1 && tanggalBaru <= row.pjw_tgl2) {
      await conn.query(
        `UPDATE tpenjadwalan_ppic_dtl SET pjwd_tgl_kesepakatan = ? WHERE pjwd_id = ?`,
        [tanggalBaru, pjwdId],
      );
      await conn.commit();
      return {
        moved: false,
        nomor: row.pjwd_pjw_nomor,
        pjwd_id: Number(pjwdId),
      };
    }

    const arah = tanggalBaru < row.pjw_tgl1 ? "MAJU" : "MUNDUR";

    const { tgl1, tgl2 } = getWeekRange(tanggalBaru);
    const [[target]] = await conn.query(
      `SELECT pjw_nomor FROM tpenjadwalan_ppic_hdr
       WHERE pjw_cab = ? AND pjw_close = 'N' AND ? BETWEEN pjw_tgl1 AND pjw_tgl2
       LIMIT 1 FOR UPDATE`,
      [row.pjw_cab, tanggalBaru],
    );

    const key = row.pjwd_so_nomor || row.pjwd_pro_nomor || row.pjwd_map_nomor;
    let targetNomor;

    if (target) {
      targetNomor = target.pjw_nomor;
    } else {
      targetNomor = await generateNomor(new Date(tgl1).getFullYear());
      await conn.query(
        `INSERT INTO tpenjadwalan_ppic_hdr
           (pjw_nomor, pjw_tgl1, pjw_tgl2, pjw_cab, pjw_divisi, pjw_keterangan, user_create, date_create)
         VALUES (?, ?, ?, ?, ?, '', ?, NOW())`,
        [targetNomor, tgl1, tgl2, row.pjw_cab, row.pjw_divisi, userKode],
      );
    }

    // BARU: cek apakah SO/PraOrder/MAP yang sama sudah ada baris lain
    // di periode tujuan (mis. hasil split PARTIAL sebelumnya). Kalau
    // ada — digabung (merge Rencana), bukan pindah-tabrak (yang akan
    // kena UNIQUE KEY constraint uq_pjwd_so).
    let merged = false;
    let mergedKe = null;
    let breakdownTargetDihapus = false;
    if (key && target) {
      const identifierCol = row.pjwd_so_nomor
        ? "pjwd_so_nomor"
        : row.pjwd_pro_nomor
          ? "pjwd_pro_nomor"
          : "pjwd_map_nomor";

      const [[existingTarget]] = await conn.query(
        `SELECT pjwd_id, pjwd_rencana FROM tpenjadwalan_ppic_dtl
         WHERE pjwd_pjw_nomor = ? AND ${identifierCol} = ?
         LIMIT 1 FOR UPDATE`,
        [targetNomor, key],
      );

      if (existingTarget) {
        // Gabung: tambahkan Rencana baris yang dipindah ke baris tujuan
        // yang sudah ada. Field lain (Permintaan Kirim, Kesepakatan,
        // dll) TETAP milik baris tujuan lama — tidak ditimpa.
        await conn.query(
          `UPDATE tpenjadwalan_ppic_dtl SET pjwd_rencana = pjwd_rencana + ? WHERE pjwd_id = ?`,
          [Number(row.pjwd_rencana) || 0, existingTarget.pjwd_id],
        );
        await conn.query(
          `DELETE FROM tpenjadwalan_ppic_dtl WHERE pjwd_id = ?`,
          [pjwdId],
        );
        const [delBd] = await conn.query(
          `DELETE FROM tpenjadwalan_ppic_kesepakatan WHERE pjwk_pjwd_id = ?`,
          [existingTarget.pjwd_id],
        );
        breakdownTargetDihapus = delBd.affectedRows > 0;
        mergedKe = existingTarget.pjwd_id;
        merged = true;
      }
    }

    if (!merged) {
      await conn.query(
        `UPDATE tpenjadwalan_ppic_dtl SET pjwd_pjw_nomor = ?, pjwd_tgl_kesepakatan = ? WHERE pjwd_id = ?`,
        [targetNomor, tanggalBaru, pjwdId],
      );
    }

    // Kalau MAJU, kredit sebagai Tambahan di Pencapaian periode tujuan
    // — produksi menyelesaikan pekerjaan periode depan lebih cepat.
    if (arah === "MAJU") {
      await conn.query(
        `INSERT INTO tpenjadwalan_ppic_pencapaian
           (pjwp_pjw_nomor, pjwp_tipe, pjwp_kategori, pjwp_keterangan, pjwp_pcs, pjwp_urutan)
         VALUES (?, 'TAMBAHAN', 'Produksi', ?, ?, 0)`,
        [
          targetNomor,
          `Maju dari periode ${row.pjwd_pjw_nomor} (${key || "-"})${merged ? " — digabung" : ""}`,
          Number(row.pjwd_rencana) || 0,
        ],
      );
    }

    await conn.commit();
    return {
      moved: true,
      merged,
      mergedKe,
      breakdownTargetDihapus,
      arah,
      fromNomor: row.pjwd_pjw_nomor,
      nomor: targetNomor,
      pjwd_id: Number(pjwdId),
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ── Revisi MAP: telusuri rantai referensi ─────────────────────────────
// Leluhur: MAP yang direvisi (referensi), lalu referensinya, dst.
const cariLeluhur = async (conn, mapNomor) => {
  const hasil = [];
  let cur = mapNomor;
  for (let i = 0; i < 20; i++) {
    const [[r]] = await conn.query(
      `SELECT mspk_referensi FROM tmemospk WHERE mspk_nomor = ?`,
      [cur],
    );
    const ref = r && r.mspk_referensi ? String(r.mspk_referensi) : "";
    if (!ref || ref === mapNomor || hasil.includes(ref)) break;
    hasil.push(ref);
    cur = ref;
  }
  return hasil;
};

// Keturunan: MAP revisi aktif terakhir yang sudah di-approve CMO.
const cariRevisiAkhir = async (conn, mapNomor) => {
  let frontier = [mapNomor];
  const sudah = new Set([mapNomor]);
  let terbaik = null;
  for (let depth = 0; depth < 20 && frontier.length; depth++) {
    const [anak] = await conn.query(
      `SELECT mspk_nomor, mspk_aktif, mspk_jumlah, mspk_cab,
              DATE_FORMAT(mspk_tgl_cmo, '%Y-%m-%d %H:%i:%s') AS tgl_cmo
       FROM tmemospk WHERE mspk_referensi IN (?)`,
      [frontier],
    );
    frontier = [];
    for (const a of anak) {
      if (sudah.has(a.mspk_nomor)) continue;
      sudah.add(a.mspk_nomor);
      if (a.mspk_aktif === "Y" && a.tgl_cmo) {
        if (!terbaik || a.tgl_cmo > terbaik.tgl_cmo) terbaik = a;
      }
      frontier.push(a.mspk_nomor);
    }
  }
  return terbaik;
};

// Satu garis MAP (MAP asal + semua revisinya) hanya menyisakan SATU baris
// tab MAP di periode Open: periode terbaru, lalu yang punya Kesepakatan,
// lalu yang paling baru dibuat. Baris yang menang diarahkan ke MAP revisi
// akhir; Rencana, Permintaan Kirim & Kesepakatannya tetap.
const arahkanRevisiMap = async (conn, akhir, { dryRun = false } = {}) => {
  const hasil = {
    map: akhir.mspk_nomor,
    dipertahankan: null,
    dihapus: [],
    dilewati: "",
  };
  const leluhur = await cariLeluhur(conn, akhir.mspk_nomor);
  const [rows] = await conn.query(
    `SELECT d.pjwd_id, d.pjwd_pjw_nomor AS periode, d.pjwd_map_nomor AS map,
            DATE_FORMAT(h.pjw_tgl1, '%Y-%m-%d') AS tgl1, h.pjw_cab,
            (d.pjwd_tgl_kesepakatan IS NOT NULL) AS ada_sepakat
     FROM tpenjadwalan_ppic_dtl d
     INNER JOIN tpenjadwalan_ppic_hdr h ON h.pjw_nomor = d.pjwd_pjw_nomor
     WHERE d.pjwd_tipe = 'MAP' AND h.pjw_close = 'N'
       AND d.pjwd_map_nomor IN (?)`,
    [[akhir.mspk_nomor, ...leluhur]],
  );
  if (!rows.length) return hasil;

  if (rows.some((r) => String(r.pjw_cab) !== String(akhir.mspk_cab || ""))) {
    hasil.dilewati = "cabang periode berbeda dengan cabang MAP";
    return hasil;
  }

  rows.sort(
    (a, b) =>
      b.tgl1.localeCompare(a.tgl1) ||
      Number(b.ada_sepakat) - Number(a.ada_sepakat) ||
      b.pjwd_id - a.pjwd_id,
  );
  const [menang, ...kalah] = rows;
  hasil.dipertahankan = `${menang.periode} (#${menang.pjwd_id}, dari ${menang.map})`;
  hasil.dihapus = kalah.map((k) => `${k.periode} (#${k.pjwd_id}, ${k.map})`);

  if (!dryRun) {
    if (kalah.length) {
      await conn.query(
        `DELETE FROM tpenjadwalan_ppic_dtl WHERE pjwd_id IN (?)`,
        [kalah.map((k) => k.pjwd_id)],
      );
    }
    await conn.query(
      `UPDATE tpenjadwalan_ppic_dtl
       SET pjwd_map_nomor = ?, pjwd_pesan_manual = ?
       WHERE pjwd_id = ?`,
      [akhir.mspk_nomor, Number(akhir.mspk_jumlah) || 0, menang.pjwd_id],
    );
  }
  return hasil;
};

// Pembersihan sekali jalan untuk baris Komitmen MAP (periode Open) yang
// masih menunjuk MAP nonaktif karena revisi. dryRun=true hanya melapor,
// tidak menulis apa pun.
const rapikanRevisiMapKomitmen = async ({ dryRun = true } = {}) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [penunjuk] = await conn.query(
      `SELECT DISTINCT d.pjwd_map_nomor AS map
       FROM tpenjadwalan_ppic_dtl d
       INNER JOIN tpenjadwalan_ppic_hdr h ON h.pjw_nomor = d.pjwd_pjw_nomor
       INNER JOIN tmemospk m
         ON m.mspk_nomor = CONVERT(d.pjwd_map_nomor USING latin1)
       WHERE d.pjwd_tipe = 'MAP' AND h.pjw_close = 'N' AND m.mspk_aktif <> 'Y'`,
    );

    const laporan = [];
    const sudah = new Set();
    for (const p of penunjuk) {
      const akhir = await cariRevisiAkhir(conn, p.map);
      if (!akhir) {
        laporan.push({
          map: p.map,
          dilewati: "tidak ada revisi aktif yang sudah di-approve CMO",
        });
        continue;
      }
      if (sudah.has(akhir.mspk_nomor)) continue;
      sudah.add(akhir.mspk_nomor);
      laporan.push(await arahkanRevisiMap(conn, akhir, { dryRun }));
    }

    // Baris yang MAP-nya sudah terhapus fisik dari tmemospk
    const sqlYatim = `FROM tpenjadwalan_ppic_dtl d
       INNER JOIN tpenjadwalan_ppic_hdr h ON h.pjw_nomor = d.pjwd_pjw_nomor
       LEFT JOIN tmemospk m
         ON m.mspk_nomor = CONVERT(d.pjwd_map_nomor USING latin1)
       WHERE d.pjwd_tipe = 'MAP' AND h.pjw_close = 'N'
         AND d.pjwd_map_nomor IS NOT NULL AND m.mspk_nomor IS NULL`;
    const [[yatim]] = await conn.query(`SELECT COUNT(*) AS jumlah ${sqlYatim}`);
    if (!dryRun) await conn.query(`DELETE d ${sqlYatim}`);

    await conn.commit();
    return { dryRun, barisMapTerhapusFisik: Number(yatim.jumlah), laporan };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ── Cabang yang didukung modul Komitmen Kirim (sama seperti getCabangOptions) ──
const KOMITMEN_KIRIM_CABANG = ["P01", "P02", "P04", "P05"];

// ── Auto-push MAP yang baru di-approve CMO ke Komitmen Kirim MAP/Sampel ──
// Dipanggil dari approveCmo (Browse) dan save (Form, saat Cmo terisi).
// Best-effort & idempotent — kegagalan di sini TIDAK boleh menggagalkan
// approve/save MAP itu sendiri.
const pushMapToKomitmenKirim = async (mapNomor, userKode = "SYSTEM") => {
  try {
    const [[map]] = await db.query(
      `SELECT mspk_nomor, mspk_nama, DATE_FORMAT(mspk_tgl_cmo, '%Y-%m-%d') AS tgl_approve,
              DATE_FORMAT(mspk_dateline, '%Y-%m-%d') AS tgl_dateline,
              mspk_cab, mspk_divisi, mspk_jumlah, mspk_referensi
       FROM tmemospk WHERE mspk_nomor = ? AND mspk_aktif = 'Y'`,
      [mapNomor],
    );
    if (!map || !map.tgl_approve) return;

    const cab = map.mspk_cab || "";
    if (!KOMITMEN_KIRIM_CABANG.includes(cab)) return;

    // MAP yang sudah jadi SO tidak masuk Komitmen Kirim MAP/Sampel
    const [[sudahJadiSo]] = await db.query(
      `SELECT so_nomor FROM tsalesorder
       WHERE so_memo = ? AND so_aktif = 'Y' LIMIT 1`,
      [mapNomor],
    );
    if (sudahJadiSo) return;

    // MAP revisi: telusuri rantai revisi ke atas. Baris tab SO yang masih
    // menunjuk MAP lama diarahkan ke MAP revisi ini; baris tab MAP dari satu
    // garis MAP disatukan jadi satu baris (periode Open terbaru).
    if (map.mspk_referensi) {
      const leluhur = await cariLeluhur(db, mapNomor);
      if (leluhur.length) {
        await db.query(
          `UPDATE tpenjadwalan_ppic_dtl SET pjwd_map_nomor = ?
           WHERE pjwd_tipe <> 'MAP' AND pjwd_map_nomor IN (?)`,
          [mapNomor, leluhur],
        );
      }
      const hasil = await arahkanRevisiMap(db, {
        mspk_nomor: mapNomor,
        mspk_jumlah: map.mspk_jumlah,
        mspk_cab: cab,
      });
      if (hasil.dipertahankan) return;
    }

    const [[existing]] = await db.query(
      `SELECT pjwd_id FROM tpenjadwalan_ppic_dtl WHERE pjwd_map_nomor = ? AND pjwd_tipe = 'MAP' LIMIT 1`,
      [mapNomor],
    );
    if (existing) return;

    const [[periode]] = await db.query(
      `SELECT pjw_nomor FROM tpenjadwalan_ppic_hdr
       WHERE pjw_cab = ? AND ? BETWEEN pjw_tgl1 AND pjw_tgl2
       ORDER BY pjw_tgl1 DESC LIMIT 1`,
      [cab, map.tgl_approve],
    );

    let pjwNomor;
    if (periode) {
      pjwNomor = periode.pjw_nomor;
    } else {
      const { tgl1, tgl2 } = getWeekRange(map.tgl_approve);
      pjwNomor = await generateNomor(new Date(tgl1).getFullYear());
      await db.query(
        `INSERT INTO tpenjadwalan_ppic_hdr
           (pjw_nomor, pjw_tgl1, pjw_tgl2, pjw_cab, pjw_divisi, pjw_keterangan, user_create, date_create)
         VALUES (?, ?, ?, ?, ?, '', ?, NOW())`,
        [pjwNomor, tgl1, tgl2, cab, map.mspk_divisi || null, userKode],
      );
    }

    await db.query(
      `INSERT INTO tpenjadwalan_ppic_dtl
         (pjwd_pjw_nomor, pjwd_tipe, pjwd_map_nomor, pjwd_rencana,
          pjwd_tgl_permintaan_kirim, pjwd_status_permintaan, pjwd_user_create,
          pjwd_pesan_manual, pjwd_kirim_manual)
       VALUES (?, 'MAP', ?, ?, ?, 'CLOSE', ?, ?, 0)`,
      [
        pjwNomor,
        mapNomor,
        Number(map.mspk_jumlah) || 0,
        map.tgl_dateline || null,
        userKode,
        Number(map.mspk_jumlah) || 0,
      ],
    );
  } catch (e) {
    console.error(`Gagal auto-push MAP ${mapNomor} ke Komitmen Kirim:`, e);
  }
};

// ── Hapus baris Komitmen Kirim MAP terkait — dipanggil saat MAP
// dihapus, dinonaktifkan (revisi/pending NOPO), atau batal approve
// CMO. Best-effort, tidak boleh menggagalkan aksi utamanya.
// Baris yang Rencana-nya sudah diisi user (>0) TIDAK dihapus otomatis
// — itu tanda PPIC/Marketing sudah mulai kerjakan, hapus manual saja
// supaya tidak kehilangan data kerja mereka tanpa sadar.
const removeMapFromKomitmenKirim = async (mapNomor) => {
  try {
    await db.query(
      `DELETE FROM tpenjadwalan_ppic_dtl
       WHERE pjwd_map_nomor = ? AND pjwd_tipe = 'MAP' AND pjwd_rencana = 0`,
      [mapNomor],
    );
  } catch (e) {
    console.error(`Gagal hapus MAP ${mapNomor} dari Komitmen Kirim:`, e);
  }
};

// ═══════════════════════════════════════════════════════════
// AUTO-PUSH SO KE KOMITMEN KIRIM — berdasarkan DATELINE SO
// Aturan (keputusan user 28 Okt 2026):
// - Periode ditentukan dari dateline SO + cabang SO (bukan tgl approve).
// - Hanya dateline mulai Senin minggu berjalan ke depan.
// - Periode HARUS sudah ada & Open; kalau belum, dilewati (tunggu Marketing).
// - SO yang sudah punya baris di periode mana pun, atau sudah pernah
//   masuk (log, termasuk yang dihapus), dilewati.
// - Rencana = Kurang, Permintaan Kirim = dateline (sama seperti Tarik SO).
// Best-effort: kegagalan TIDAK boleh menggagalkan aksi pemanggil.
// ═══════════════════════════════════════════════════════════
const cariKandidatSoPeriode = async (cab, tgl1, tgl2, hanyaNomor = null) => {
  const params = [cab, tgl1, tgl2];
  if (hanyaNomor) params.push(hanyaNomor);
  const [rows] = await db.query(
    `SELECT x.* FROM (
       SELECT so_nomor AS Nomor,
              (so_jumlah - IFNULL(so_jumlah_kirim,0)) AS Kurang,
              DATE_FORMAT(so_dateline,'%Y-%m-%d') AS Dateline,
              IFNULL(so_memo,'') AS Memo,
              IFNULL(so_pen_nomor,'') AS PenNomor,
              IFNULL(so_pen_id,'') AS PenId
       FROM tsalesorder
       WHERE so_aktif = 'Y' AND so_close = 0
         AND so_cab = ? AND so_dateline BETWEEN ? AND ?
     ) x
     WHERE x.Kurang > 0
       ${hanyaNomor ? "AND x.Nomor = ?" : ""}
       AND NOT EXISTS (
         SELECT 1 FROM tpenjadwalan_ppic_so_log l WHERE l.pso_so_nomor = x.Nomor
       )
       AND NOT EXISTS (
         SELECT 1 FROM tpenjadwalan_ppic_dtl d
         WHERE d.pjwd_so_nomor = x.Nomor
            OR (x.Memo <> '' AND d.pjwd_tipe <> 'MAP' AND d.pjwd_map_nomor = x.Memo)
            OR (x.PenNomor <> '' AND d.pjwd_pen_nomor = x.PenNomor
                AND d.pjwd_pen_id = x.PenId)
            OR (x.PenNomor <> '' AND d.pjwd_mh_nomor IS NOT NULL AND EXISTS (
                  SELECT 1 FROM tpenawaran_dtl pd
                  WHERE pd.pend_minta = d.pjwd_mh_nomor
                    AND pd.pend_pen_nomor = x.PenNomor AND pd.pend_id = x.PenId))
            -- SO hasil MAP: baris Permintaan Harga yang MAP-nya = memo SO ini
            OR (x.Memo <> '' AND d.pjwd_mh_nomor IS NOT NULL AND EXISTS (
                  SELECT 1 FROM tpenawaran_dtl pd2
                  INNER JOIN tmemospk mp2
                    ON mp2.mspk_pen_nomor = pd2.pend_pen_nomor
                   AND mp2.mspk_pen_id = pd2.pend_id
                  WHERE pd2.pend_minta = CONVERT(d.pjwd_mh_nomor USING latin1)
                    AND mp2.mspk_nomor = x.Memo))
            -- idem untuk baris Penawaran langsung
            OR (x.Memo <> '' AND d.pjwd_pen_nomor IS NOT NULL AND EXISTS (
                  SELECT 1 FROM tmemospk mp3
                  WHERE mp3.mspk_pen_nomor = CONVERT(d.pjwd_pen_nomor USING latin1)
                    AND mp3.mspk_pen_id = CONVERT(d.pjwd_pen_id USING latin1)
                    AND mp3.mspk_nomor = x.Memo))
       )
     ORDER BY x.Dateline, x.Nomor`,
    params,
  );
  return rows;
};

// Sapu satu periode: masukkan SO yang dateline-nya jatuh di periode ini.
// Mengembalikan jumlah SO yang berhasil dimasukkan.
const sinkronSoKePeriode = async (
  pjwNomor,
  userKode = "SYSTEM",
  hanyaNomor = null,
) => {
  try {
    const [[hdr]] = await db.query(
      `SELECT pjw_cab, pjw_close,
              DATE_FORMAT(pjw_tgl1, '%Y-%m-%d') AS tgl1,
              DATE_FORMAT(pjw_tgl2, '%Y-%m-%d') AS tgl2
       FROM tpenjadwalan_ppic_hdr WHERE pjw_nomor = ?`,
      [pjwNomor],
    );
    if (!hdr || hdr.pjw_close === "Y") return 0;
    if (!KOMITMEN_KIRIM_CABANG.includes(hdr.pjw_cab)) return 0;

    // Dateline lampau tidak diotomatiskan: mulai Senin minggu berjalan
    const { tgl1: senin } = getWeekRange(toLocalDate(new Date()));
    const awal = hdr.tgl1 > senin ? hdr.tgl1 : senin;
    if (awal > hdr.tgl2) return 0;

    const kandidat = await cariKandidatSoPeriode(
      hdr.pjw_cab,
      awal,
      hdr.tgl2,
      hanyaNomor,
    );

    let masuk = 0;
    for (const k of kandidat) {
      try {
        await db.query(
          `INSERT INTO tpenjadwalan_ppic_dtl
             (pjwd_pjw_nomor, pjwd_tipe, pjwd_so_nomor, pjwd_rencana,
              pjwd_tgl_permintaan_kirim, pjwd_status_permintaan, pjwd_user_create)
           VALUES (?, 'SO', ?, ?, ?, 'CLOSE', ?)`,
          [pjwNomor, k.Nomor, Number(k.Kurang) || 0, k.Dateline, userKode],
        );
        await db.query(
          `INSERT IGNORE INTO tpenjadwalan_ppic_so_log
             (pso_so_nomor, pso_pjw_nomor, pso_sumber) VALUES (?, ?, 'AUTO')`,
          [k.Nomor, pjwNomor],
        );
        masuk++;
      } catch (e) {
        console.error(`Auto-push SO ${k.Nomor} gagal:`, e.message);
      }
    }
    return masuk;
  } catch (e) {
    console.error(`Sinkron SO ke periode ${pjwNomor} gagal:`, e);
    return 0;
  }
};

// Dipanggil dari save SO (event). Cari periode Open yang cocok dengan
// cabang + dateline SO; kalau tidak ada, tidak melakukan apa-apa.
const pushSoToKomitmenKirim = async (soNomor, userKode = "SYSTEM") => {
  try {
    const [[so]] = await db.query(
      `SELECT so_cab, DATE_FORMAT(so_dateline, '%Y-%m-%d') AS dateline
       FROM tsalesorder
       WHERE so_nomor = ? AND so_aktif = 'Y' AND so_close = 0`,
      [soNomor],
    );
    if (!so || !so.dateline) return;
    if (!KOMITMEN_KIRIM_CABANG.includes(so.so_cab)) return;

    const [[periode]] = await db.query(
      `SELECT pjw_nomor FROM tpenjadwalan_ppic_hdr
       WHERE pjw_cab = ? AND pjw_close = 'N' AND ? BETWEEN pjw_tgl1 AND pjw_tgl2
       ORDER BY pjw_tgl1 DESC LIMIT 1`,
      [so.so_cab, so.dateline],
    );
    if (!periode) return;

    await sinkronSoKePeriode(periode.pjw_nomor, userKode, soNomor);
  } catch (e) {
    console.error(`Gagal auto-push SO ${soNomor} ke Komitmen Kirim:`, e);
  }
};

// Simpan jadwal sepakat. items: [{ Tanggal: 'YYYY-MM-DD', Qty: number }]
// 0 baris  = kosongkan kesepakatan
// 1 baris  = hanya tanggal (tanpa breakdown)
// >=2 baris = breakdown, total Qty wajib sama dengan Rencana
const simpanKesepakatan = async (pjwdId, items, userKode, userBagian) => {
  assertFieldOwnership(
    "pjwd_tgl_kesepakatan",
    FIELD_OWNERSHIP,
    userKode,
    userBagian,
  );
  const daftar = Array.isArray(items) ? items : [];
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[row]] = await conn.query(
      `SELECT d.pjwd_rencana, h.pjw_close,
          DATE_FORMAT(h.pjw_tgl1, '%Y-%m-%d') AS tgl1,
          DATE_FORMAT(h.pjw_tgl2, '%Y-%m-%d') AS tgl2
       FROM tpenjadwalan_ppic_dtl d
       INNER JOIN tpenjadwalan_ppic_hdr h ON h.pjw_nomor = d.pjwd_pjw_nomor
       WHERE d.pjwd_id = ? FOR UPDATE`,
      [pjwdId],
    );
    if (!row) throw new Error("Baris komitmen tidak ditemukan.");
    if (row.pjw_close === "Y") throw new Error("Periode sudah ditutup.");

    for (const it of daftar) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(it.Tanggal || "")))
        throw new Error("Tanggal kesepakatan tidak valid.");
      if (!(Number(it.Qty) > 0) && daftar.length > 1)
        throw new Error("Qty setiap baris breakdown harus lebih dari 0.");
    }

    // Tanggal paling awal harus di dalam periode ini. Memundurkan SELURUH
    // kiriman ke periode lain tetap lewat ubah tanggal Kesepakatan biasa
    // (alur pindah periode). Pecahan berikutnya boleh melewati akhir periode.
    if (daftar.length) {
      const awal = daftar.map((it) => it.Tanggal).sort()[0];
      if (awal < row.tgl1 || awal > row.tgl2)
        throw new Error(
          "Tanggal paling awal harus di dalam periode ini. Untuk memindahkan seluruh kiriman ke periode lain, ubah tanggal Kesepakatan langsung.",
        );
    }

    if (daftar.length > 1) {
      const total = daftar.reduce((a, it) => a + Number(it.Qty), 0);
      const rencana = Number(row.pjwd_rencana) || 0;
      if (Math.abs(total - rencana) > 0.0001)
        throw new Error(
          `Total breakdown (${total}) harus sama dengan Rencana (${rencana}).`,
        );
    }

    await conn.query(
      `DELETE FROM tpenjadwalan_ppic_kesepakatan WHERE pjwk_pjwd_id = ?`,
      [pjwdId],
    );
    if (daftar.length > 1) {
      await conn.query(
        `INSERT INTO tpenjadwalan_ppic_kesepakatan
           (pjwk_pjwd_id, pjwk_tgl, pjwk_qty, pjwk_user) VALUES ?`,
        [
          daftar.map((it) => [
            pjwdId,
            it.Tanggal,
            Number(it.Qty),
            userKode || null,
          ]),
        ],
      );
    }

    // Tanggal kesepakatan utama = tanggal paling awal
    const tglUtama = daftar.length
      ? daftar.map((it) => it.Tanggal).sort()[0]
      : null;
    const totalQty =
      daftar.length > 1
        ? daftar.reduce((a, it) => a + Number(it.Qty), 0)
        : null;
    await conn.query(
      `UPDATE tpenjadwalan_ppic_dtl
       SET pjwd_tgl_kesepakatan = ?,
           pjwd_qty_kesepakatan = COALESCE(?, pjwd_qty_kesepakatan)
       WHERE pjwd_id = ?`,
      [tglUtama, totalQty, pjwdId],
    );

    await conn.commit();
    return {
      pjwdId: Number(pjwdId),
      tglKesepakatan: tglUtama,
      items: daftar.length > 1 ? daftar : [],
      qtyKesepakatan: totalQty,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

module.exports = {
  generateNomor,
  getCabangOptions,
  getDivisiOptions,
  searchSoKandidat,
  searchPraOrderKandidat,
  searchMapKandidat,
  getSoInfo,
  getPraOrderInfo,
  getMapInfo,
  getMhInfo,
  getPenawaranDetailList,
  getPenawaranItemInfo,
  getFormDetail,
  saveData,
  updateHeaderField,
  createHeader,
  addDetailRow,
  updateDetailField,
  deleteDetailRow,
  checkTargetPeriod,
  moveDetailRowToPeriod,
  pushMapToKomitmenKirim,
  removeMapFromKomitmenKirim,
  rapikanRevisiMapKomitmen,
  simpanKesepakatan,
  pushSoToKomitmenKirim,
  sinkronSoKePeriode,
};
