const db = require("../../config/database");
const { recomputeStatus } = require("./maklonStatusService");
const sjHasilMakloonService = require("./sjHasilMakloonService");
const { getProgress } = require("./maklonProgressService");

const generateLhkMaklonNomor = async (conn) => {
  const year = new Date().getFullYear();
  const [[last]] = await conn.query(
    `SELECT lhk_nomor FROM tdtf_maklon WHERE lhk_nomor LIKE ? ORDER BY lhk_nomor DESC LIMIT 1 FOR UPDATE`,
    [`LHK-DTF.${year}.%`],
  );
  const nextUrut = last?.lhk_nomor
    ? parseInt(last.lhk_nomor.split(".")[2], 10) + 1
    : 1;
  return `LHK-DTF.${year}.${String(nextUrut).padStart(5, "0")}`;
};

/**
 * Load semua baris tdtf untuk Cab + Tanggal tertentu — replikasi
 * loaddataall() di ufrmDtf.pas persis, termasuk kondisi JOIN
 * retail.tsodtf_hdr yang mencegah duplikasi SO DTF K01 yang sudah
 * direferensikan sebagai spk_nomor_po di tspk.
 *
 * ⚠️ Fallback nama BEDA dari browse (lhkSoDtfService.getBrowseData):
 * di sini urutannya spk_nama -> sd_nama -> mspk_nama (bukan
 * spk_nama -> mspk_nama -> sd_nama seperti di browse). Ini
 * inkonsistensi asli di source Delphi, direplikasi apa adanya.
 */
const getDetail = async (cab, tanggal) => {
  const q = `
    SELECT
      d.spk_nomor AS Kode,
      IFNULL(IFNULL(s.spk_nama, h.sd_nama), m.mspk_nama) AS Nama,
      d.Depan, d.Belakang, d.Lengan, d.Variasi, d.Saku, d.Panjang, d.Buangan,
      d.Keterangan AS Ket,
      'SPK' AS Tipe
    FROM tdtf d
    LEFT JOIN tspk s ON s.spk_nomor = d.spk_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = d.spk_nomor
    LEFT JOIN retail.tsodtf_hdr h
      ON h.sd_nomor = d.spk_nomor AND LEFT(h.sd_nomor, 3) = 'K01'
      AND h.sd_nomor NOT IN (SELECT spk_nomor_po FROM tspk WHERE LEFT(spk_nomor_po, 3) = 'K01')
    WHERE DATE(d.Tanggal) = ? AND d.Cab = ?
  `;
  const [rows] = await db.query(q, [tanggal, cab]);

  const qMaklon = `
    SELECT dm.id AS DtfMaklonId,
          dm.mkl_nomor AS Kode,
          IFNULL((
            SELECT GROUP_CONCAT(DISTINCT b.brg_nama SEPARATOR ', ')
            FROM tmaklon_dtl x
            INNER JOIN tmaklon_dtl_jadi j ON j.mkldj_mkld_id = x.mkld_id
            LEFT JOIN tgarmen_brg b ON b.brg_kode = j.mkldj_kode_jadi
            WHERE x.mkld_mkl_nomor = dm.mkl_nomor
          ), '') AS Nama,
          dm.kode_polos AS KodePolos,
          dm.qty_masuk AS QtyMasuk, dm.satuan AS Satuan,
          dm.keterangan AS Ket,
          'MAKLON' AS Tipe,
          dh.id AS HasilId,
          dh.dmh_kode_hasil AS KodeHasil,
          bh.brg_nama AS NamaHasil,
          dh.dmh_qty_hasil AS QtyHasil,
          dh.dmh_bs_afval AS BsAfval,
          EXISTS(
            SELECT 1 FROM tsj_maklon_dtl sd
            JOIN tmaklon_terima_dtl t ON t.mtd_sjmd_id = sd.sjmd_id
            WHERE sd.sjmd_dtf_maklon_hasil_id = dh.id
          ) AS SudahSj
    FROM tdtf_maklon dm
    LEFT JOIN tdtf_maklon_hasil dh ON dh.dmh_dtf_maklon_id = dm.id
    LEFT JOIN tgarmen_brg bh ON bh.brg_kode = dh.dmh_kode_hasil
    WHERE dm.tanggal = ? AND dm.cab = ?
    ORDER BY dm.id, dh.id
  `;
  const [maklonRows] = await db.query(qMaklon, [tanggal, cab]);

  const progMap = {};
  for (const mkl of [...new Set(maklonRows.map((r) => r.Kode))]) {
    progMap[mkl] = await getProgress(mkl, {
      excludeCab: cab,
      excludeTanggal: tanggal,
    });
  }

  const combined = [
    ...rows.map((r) => ({
      ...r,
      Depan: Number(r.Depan) || 0,
      Belakang: Number(r.Belakang) || 0,
      Lengan: Number(r.Lengan) || 0,
      Variasi: Number(r.Variasi) || 0,
      Saku: Number(r.Saku) || 0,
      Panjang: Number(r.Panjang) || 0,
      Buangan: Number(r.Buangan) || 0,
    })),
    ...maklonRows.map((r) => ({
      ...r,
      SudahDiterima: Number(r.SudahSj) === 1,
      QtyMasuk: Number(r.QtyMasuk) || 0,
      QtyHasil: Number(r.QtyHasil) || 0,
      BsAfval: Number(r.BsAfval) || 0,
      Rencana: progMap[r.Kode]?.rencana ?? 0,
      HasilLain: progMap[r.Kode]?.hasil ?? 0, // hasil dari LHK tanggal lain
    })),
  ];

  if (combined.length === 0) {
    return [
      {
        Kode: "",
        Nama: "",
        Depan: 0,
        Belakang: 0,
        Lengan: 0,
        Variasi: 0,
        Saku: 0,
        Panjang: 0,
        Buangan: 0,
        Ket: "",
        Tipe: "",
      },
    ];
  }
  return combined;
};

const getDefaultCab = (userCab, filterCab) => {
  if (userCab) return userCab; // user terkunci ke cabangnya sendiri
  if (!filterCab || filterCab === "ALL") return "P04";
  return filterCab;
};

/**
 * F1 — Help SPK/MAP. Union tspk (spk_divisi IN (3,4,6)) +
 * tmemospk (mspk_divisi IN (3,4,6)). Filter keyword ke Nomor & Nama
 * (replikasi sqlfilter:='Nomor,Nama' pada frmbantuan).
 */
const lookupSpkMap = async (keyword) => {
  const like = `%${keyword || ""}%`;
  const q = `
    SELECT * FROM (
      SELECT spk_nomor AS Nomor, spk_nama AS Nama, spk_jumlah AS Jumlah, spk_tanggal AS Tanggal, 'SPK' AS Tipe
      FROM tspk WHERE spk_divisi IN (3,4,6)
      UNION ALL
      SELECT mspk_nomor AS Nomor, mspk_nama AS Nama, mspk_jumlah AS Jumlah, mspk_tanggal AS Tanggal, 'SPK' AS Tipe
      FROM tmemospk WHERE mspk_divisi IN (3,4,6)
    ) x
    WHERE x.Nomor LIKE ? OR x.Nama LIKE ?
    ORDER BY x.Tanggal DESC
    LIMIT 100
  `;
  const [rows] = await db.query(q, [like, like]);
  return rows;
};

/**
 * F2 — Help SO DTF Kaosan. retail.tsodtf_hdr TANPA filter apapun
 * (beda dari F1 yang filter divisi). Dilengkapi pagination supaya
 * konsisten dengan pola SearchModal lain (bukan bagian dari source
 * Delphi asli — frmbantuan tidak berpaginasi — tapi diperlukan untuk
 * UX komponen reusable web).
 */
const lookupSoDtf = async (keyword, page = 1, limit = 50) => {
  const like = `%${keyword || ""}%`;
  const offset = (Number(page) - 1) * Number(limit);

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM retail.tsodtf_hdr h WHERE h.sd_nomor LIKE ? OR h.sd_nama LIKE ?`,
    [like, like],
  );

  const [rows] = await db.query(
    `SELECT h.sd_nomor AS Nomor, h.sd_nama AS Nama, h.sd_tanggal AS Tanggal, 'SODTF' AS Tipe
     FROM retail.tsodtf_hdr h
     WHERE h.sd_nomor LIKE ? OR h.sd_nama LIKE ?
     ORDER BY h.sd_tanggal DESC
     LIMIT ? OFFSET ?`,
    [like, like, Number(limit), offset],
  );

  return { items: rows, total: Number(total) };
};

/**
 * F3 — Help Nomor Maklon. Hanya Maklon yang statusnya sudah DIKIRIM
 * atau SEBAGIAN DIKIRIM (barang fisik sudah keluar gudang) yang
 * relevan untuk dikaitkan ke proses LHK — Maklon berstatus DRAFT
 * belum ada barang yang benar-benar diproses.
 */
const lookupMaklon = async (keyword, page = 1, limit = 50) => {
  const like = `%${keyword || ""}%`;
  const offset = (Number(page) - 1) * Number(limit);

  const base = `
    FROM tmaklon_hdr h
    LEFT JOIN (
      SELECT d.mkld_mkl_nomor AS nomor, SUM(j.mkldj_estimasi_qty) AS rencana
      FROM tmaklon_dtl d
      INNER JOIN tmaklon_dtl_jadi j ON j.mkldj_mkld_id = d.mkld_id
      GROUP BY d.mkld_mkl_nomor
    ) r ON r.nomor = h.mkl_nomor
    LEFT JOIN (
      SELECT dm.mkl_nomor AS nomor, SUM(dh.dmh_qty_hasil + dh.dmh_bs_afval) AS hasil
      FROM tdtf_maklon dm
      INNER JOIN tdtf_maklon_hasil dh ON dh.dmh_dtf_maklon_id = dm.id
      GROUP BY dm.mkl_nomor
    ) p ON p.nomor = h.mkl_nomor
    WHERE h.mkl_status IN ('DIKIRIM', 'SEBAGIAN DIKIRIM', 'OTW GUDANG', 'DITERIMA SEBAGIAN', 'SELESAI')
      AND (h.mkl_nomor LIKE ? OR h.mkl_keterangan LIKE ?)
      AND NOT (IFNULL(r.rencana, 0) > 0 AND IFNULL(p.hasil, 0) >= r.rencana)
  `;

  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total ${base}`, [
    like,
    like,
  ]);

  const [rows] = await db.query(
    `SELECT h.mkl_nomor AS Nomor,
            IFNULL((
              SELECT GROUP_CONCAT(DISTINCT b.brg_nama SEPARATOR ', ')
              FROM tmaklon_dtl d
              INNER JOIN tmaklon_dtl_jadi j ON j.mkldj_mkld_id = d.mkld_id
              LEFT JOIN tgarmen_brg b ON b.brg_kode = j.mkldj_kode_jadi
              WHERE d.mkld_mkl_nomor = h.mkl_nomor
            ), h.mkl_keterangan) AS Nama,
            h.mkl_tanggal AS Tanggal,
            IFNULL(r.rencana, 0) AS Rencana,
            IFNULL(p.hasil, 0) AS SudahHasil,
            'MAKLON' AS Tipe
     ${base}
     ORDER BY h.mkl_tanggal DESC
     LIMIT ? OFFSET ?`,
    [like, like, Number(limit), offset],
  );

  return { items: rows, total: Number(total) };
};

/**
 * Autofill saat baris Maklon dipilih (F3 atau blur manual) — ambil
 * kode_polos + total qty terkirim (SUM semua SJ Keluar untuk Maklon
 * ini) + kode_jadi_rencana sebagai default Item Hasil.
 * ⚠️ Asumsi single-item: kalau Maklon punya >1 baris detail, cuma
 * baris PERTAMA yang dipakai, dan qty adalah total gabungan (perlu
 * dikoreksi manual oleh user kalau multi-item).
 */
const getMaklonAutofill = async (mklNomor, cab = null, tanggal = null) => {
  const [[hdr]] = await db.query(
    `SELECT mkl_cab_tujuan FROM tmaklon_hdr WHERE mkl_nomor = ?`,
    [mklNomor],
  );
  const [rows] = await db.query(
    `SELECT d.mkld_id, d.mkld_kode_polos, d.mkld_satuan_kirim, d.mkld_qty_sudah_kirim
     FROM tmaklon_dtl d WHERE d.mkld_mkl_nomor = ? ORDER BY d.mkld_id`,
    [mklNomor],
  );
  if (!rows.length) throw new Error("Detail Maklon tidak ditemukan.");

  const first = rows[0];
  const prog = await getProgress(mklNomor, {
    excludeCab: cab,
    excludeTanggal: tanggal,
  });

  const [targetJadi] = await db.query(
    `SELECT j.mkldj_kode_jadi AS Kode, b.brg_nama AS Nama, j.mkldj_estimasi_qty AS EstimasiQty
     FROM tmaklon_dtl_jadi j
     INNER JOIN tmaklon_dtl d ON d.mkld_id = j.mkldj_mkld_id
     LEFT JOIN tgarmen_brg b ON b.brg_kode = j.mkldj_kode_jadi
     WHERE d.mkld_mkl_nomor = ?
     ORDER BY j.mkldj_id`,
    [mklNomor],
  );

  return {
    kodePolos: first.mkld_kode_polos,
    satuan: first.mkld_satuan_kirim,
    qtyMasuk: prog.sisaPolos, // default = sisa polos yang belum diproses LHK lain
    totalKirim: prog.totalKirim,
    rencana: prog.rencana,
    sudahHasil: prog.hasil,
    sisaHasil: prog.sisaHasil,
    selesai: prog.selesai,
    targetJadiOptions: targetJadi,
    cabTujuan: hdr?.mkl_cab_tujuan || "",
    multiItem: rows.length > 1,
  };
};

/**
 * Replikasi loadspk() — validasi kode yang diketik MANUAL (bukan via
 * F1/F2 popup). ⚠️ Scope BEDA dari F1: union tspk (spk_aktif='Y',
 * TANPA filter divisi) + retail.tsodtf_hdr. tmemospk TIDAK termasuk
 * di sini sama sekali — kalau kode cuma ada di tmemospk, validasi
 * manual ini akan gagal walau bisa dipilih via F1. Behavior asli,
 * dipertahankan.
 */
const validateKode = async (kode) => {
  const q = `
    SELECT * FROM (
      SELECT spk_nomor AS Nomor, spk_nama AS Nama, 'SPK' AS Tipe FROM tspk WHERE spk_aktif = 'Y'
      UNION ALL
      SELECT sd_nomor, sd_nama, 'SODTF' FROM retail.tsodtf_hdr
      UNION ALL
      SELECT h.mkl_nomor, IFNULL((
        SELECT GROUP_CONCAT(DISTINCT b.brg_nama SEPARATOR ', ')
        FROM tmaklon_dtl d
        INNER JOIN tmaklon_dtl_jadi j ON j.mkldj_mkld_id = d.mkld_id
        LEFT JOIN tgarmen_brg b ON b.brg_kode = j.mkldj_kode_jadi
        WHERE d.mkld_mkl_nomor = h.mkl_nomor
      ), h.mkl_keterangan), 'MAKLON'
      FROM tmaklon_hdr h
      WHERE h.mkl_status IN ('DIKIRIM', 'SEBAGIAN DIKIRIM', 'DITERIMA SEBAGIAN', 'SELESAI')
    ) x WHERE x.Nomor = ?
  `;
  const [[row]] = await db.query(q, [kode]);
  if (!row) {
    const err = new Error("Spk/SO DTF/Maklon tsb belum ada.");
    err.statusCode = 404;
    throw err;
  }
  return row;
};

/**
 * Replikasi assertCabAccess dari lhkSoDtfService (browse) — dipakai
 * juga di sini karena save() menghapus SELURUH baris cab+tanggal.
 */
const assertCabAccess = (cab, userCab) => {
  if (userCab && cab !== userCab) {
    const err = new Error("Data tersebut bukan cabang anda.");
    err.statusCode = 403;
    throw err;
  }
};

/**
 * Replikasi validasi F10 di FormKeyDown, urutan & pesan PERSIS:
 *  1. Semua baris kosong (tidak ada nama terisi) -> "Detail harus diisi."
 *  2. Per baris terisi: Ket kosong -> "Keterangan harus diisi."
 *  3. Per baris terisi: Depan+Belakang+Lengan+Variasi+Saku = 0
 *     (⚠️ Panjang & Buangan TIDAK ikut dijumlah) -> "Qty harus di isi"
 */
const validateRows = (rows) => {
  const filled = (rows || []).filter((r) => (r.Kode || "").trim() !== "");
  if (filled.length === 0) {
    const err = new Error("Detail harus diisi.");
    err.statusCode = 400;
    throw err;
  }
  for (const r of filled) {
    if (!r.Ket || !String(r.Ket).trim()) {
      const err = new Error("Keterangan harus diisi.");
      err.statusCode = 400;
      throw err;
    }
    if (r.Tipe !== "MAKLON") {
      const qtySum =
        (Number(r.Depan) || 0) +
        (Number(r.Belakang) || 0) +
        (Number(r.Lengan) || 0) +
        (Number(r.Variasi) || 0) +
        (Number(r.Saku) || 0);
      if (qtySum === 0) {
        const err = new Error("Qty harus di isi");
        err.statusCode = 400;
        throw err;
      }
    }
  }
  return filled;
};

/**
 * Replikasi simpandata() — FULL REPLACE. DELETE semua baris
 * cab+tanggal ini, lalu INSERT ulang baris-baris yang terisi.
 * Dibungkus transaction supaya atomik (bukan delete-lalu-gagal-insert
 * yang meninggalkan data kosong).
 */
const save = async (cab, tanggal, rows, userKode, userCab) => {
  assertCabAccess(cab, userCab);
  const filled = validateRows(rows);

  const maklonRows = filled.filter((r) => r.Tipe === "MAKLON");
  const spkRows = filled.filter((r) => r.Tipe !== "MAKLON");

  for (const r of maklonRows) {
    const filledHasil = (r.HasilRows || []).filter(
      (h) => h.KodeHasil && (Number(h.QtyHasil) > 0 || Number(h.BsAfval) > 0),
    );
    if (!filledHasil.length)
      throw new Error(`Item Hasil wajib diisi untuk baris Maklon ${r.Kode}.`);
    for (const h of filledHasil) {
      if (!Number(h.QtyHasil) && !Number(h.BsAfval))
        throw new Error(
          `Qty Hasil atau BS/Afval harus diisi untuk Item Hasil ${h.KodeHasil} (${r.Kode}).`,
        );
    }
  }

  const seenMkl = new Set();
  for (const r of maklonRows) {
    const key = `${r.Kode}|${r.KodePolos}`;
    if (seenMkl.has(key)) {
      const err = new Error(
        `Maklon ${r.Kode} muncul lebih dari sekali di tanggal yang sama. Gabungkan ke satu baris.`,
      );
      err.statusCode = 400;
      throw err;
    }
    seenMkl.add(key);
  }

  const conn = await db.getConnection();
  const sjHasilMaklonList = [];
  try {
    await conn.beginTransaction();

    await conn.query(`DELETE FROM tdtf WHERE Cab = ? AND Tanggal = ?`, [
      cab,
      tanggal,
    ]);

    for (const r of spkRows) {
      await conn.query(
        `INSERT INTO tdtf (tanggal, spk_nomor, depan, belakang, lengan, variasi, saku, panjang, buangan, keterangan, cab, user_create, date_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          tanggal,
          r.Kode,
          Number(r.Depan) || 0,
          Number(r.Belakang) || 0,
          Number(r.Lengan) || 0,
          Number(r.Variasi) || 0,
          Number(r.Saku) || 0,
          Number(r.Panjang) || 0,
          Number(r.Buangan) || 0,
          r.Ket || "",
          cab,
          userKode,
        ],
      );
    }

    const touchedHasilIdsByMkl = {};
    const masukBaruByMkl = {};

    for (const r of maklonRows) {
      const [[existing]] = await conn.query(
        `SELECT id, lhk_nomor FROM tdtf_maklon
         WHERE cab = ? AND tanggal = ? AND mkl_nomor = ? AND kode_polos = ?
         LIMIT 1`,
        [cab, tanggal, r.Kode, r.KodePolos],
      );

      const prog = await getProgress(r.Kode, {
        conn,
        excludeCab: cab,
        excludeTanggal: tanggal,
      });
      if (!existing && prog.selesai) {
        const err = new Error(
          `Maklon ${r.Kode} sudah terpenuhi sesuai rencana (${prog.hasil}/${prog.rencana}).`,
        );
        err.statusCode = 400;
        throw err;
      }
      masukBaruByMkl[r.Kode] =
        (masukBaruByMkl[r.Kode] || 0) + (Number(r.QtyMasuk) || 0);
      if (prog.masuk + masukBaruByMkl[r.Kode] > prog.totalKirim + 0.0001) {
        const err = new Error(
          `Qty masuk Maklon ${r.Kode} melebihi qty terkirim (${prog.masuk + masukBaruByMkl[r.Kode]} > ${prog.totalKirim}).`,
        );
        err.statusCode = 400;
        throw err;
      }

      let dtfMaklonId;
      if (existing) {
        dtfMaklonId = existing.id;
        await conn.query(
          `UPDATE tdtf_maklon
           SET qty_masuk=?, satuan=?, keterangan=?
           WHERE id=?`,
          [Number(r.QtyMasuk) || 0, r.Satuan || "", r.Ket || "", dtfMaklonId],
        );
      } else {
        const lhkNomor = await generateLhkMaklonNomor(conn);
        const [ins] = await conn.query(
          `INSERT INTO tdtf_maklon (lhk_nomor, tanggal, cab, mkl_nomor, kode_polos, qty_masuk, satuan, keterangan, user_create, date_create)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            lhkNomor,
            tanggal,
            cab,
            r.Kode,
            r.KodePolos,
            Number(r.QtyMasuk) || 0,
            r.Satuan || "",
            r.Ket || "",
            userKode,
          ],
        );
        dtfMaklonId = ins.insertId;
      }

      // ⬅ sinkronisasi item hasil (tdtf_maklon_hasil) — bisa banyak per baris
      const filledHasil = (r.HasilRows || []).filter((h) => h.KodeHasil);
      const [oldHasil] = await conn.query(
        `SELECT id FROM tdtf_maklon_hasil WHERE dmh_dtf_maklon_id = ?`,
        [dtfMaklonId],
      );
      const oldHasilIds = oldHasil.map((x) => x.id);
      const keepIds = [];

      for (const h of filledHasil) {
        if (h.Id && oldHasilIds.includes(h.Id)) {
          const [[cur]] = await conn.query(
            `SELECT dh.dmh_kode_hasil, dh.dmh_qty_hasil, dh.dmh_bs_afval,
              sd.sjmd_id,
              EXISTS(SELECT 1 FROM tmaklon_terima_dtl t WHERE t.mtd_sjmd_id = sd.sjmd_id) AS diterima
             FROM tdtf_maklon_hasil dh
             LEFT JOIN tsj_maklon_dtl sd ON sd.sjmd_dtf_maklon_hasil_id = dh.id
             WHERE dh.id = ? FOR UPDATE`,
            [h.Id],
          );

          const kode = h.KodeHasil;
          const qty = Number(h.QtyHasil) || 0;
          const bs = Number(h.BsAfval) || 0;

          if (cur.diterima) {
            const berubah =
              cur.dmh_kode_hasil !== kode ||
              Number(cur.dmh_qty_hasil) !== qty ||
              Number(cur.dmh_bs_afval) !== bs;
            if (berubah) {
              const err = new Error(
                `Item hasil ${cur.dmh_kode_hasil} (${r.Kode}) sudah diterima gudang, tidak bisa diubah.`,
              );
              err.statusCode = 400;
              throw err;
            }
          } else {
            await conn.query(
              `UPDATE tdtf_maklon_hasil SET dmh_kode_hasil=?, dmh_qty_hasil=?, dmh_bs_afval=? WHERE id=?`,
              [kode, qty, bs, h.Id],
            );
            if (cur.sjmd_id) {
              await conn.query(
                `UPDATE tsj_maklon_dtl SET sjmd_kode_jadi=?, sjmd_qty_terima=?, sjmd_qty_bs=? WHERE sjmd_id=?`,
                [kode, qty, bs, cur.sjmd_id],
              );
            }
          }
          keepIds.push(h.Id);
        } else {
          const qty = Number(h.QtyHasil) || 0;
          const bs = Number(h.BsAfval) || 0;
          if (qty <= 0 && bs <= 0) continue;
          const [insHasil] = await conn.query(
            `INSERT INTO tdtf_maklon_hasil (dmh_dtf_maklon_id, dmh_kode_hasil, dmh_qty_hasil, dmh_bs_afval)
             VALUES (?, ?, ?, ?)`,
            [dtfMaklonId, h.KodeHasil, qty, bs],
          );
          keepIds.push(insHasil.insertId);
        }
      }

      // hapus item hasil lama yg sudah dihapus user, kecuali sudah dipakai SJ
      for (const oldId of oldHasilIds) {
        if (keepIds.includes(oldId)) continue;
        const [[usedInSj]] = await conn.query(
          `SELECT 1 FROM tsj_maklon_dtl WHERE sjmd_dtf_maklon_hasil_id = ? LIMIT 1`,
          [oldId],
        );
        if (!usedInSj) {
          await conn.query(`DELETE FROM tdtf_maklon_hasil WHERE id = ?`, [
            oldId,
          ]);
        }
      }

      if (!touchedHasilIdsByMkl[r.Kode]) touchedHasilIdsByMkl[r.Kode] = [];
      touchedHasilIdsByMkl[r.Kode].push(...keepIds);
    }

    // Hapus baris Maklon LAMA yang sudah tidak ada lagi di form (dihapus
    // user) — tapi JANGAN hapus baris yang sudah dipakai SJ Hasil Maklon.
    const currentKeys = maklonRows.map((r) => `${r.Kode}|${r.KodePolos}`);
    const [oldRows] = await conn.query(
      `SELECT id, mkl_nomor, kode_polos FROM tdtf_maklon WHERE cab = ? AND tanggal = ?`,
      [cab, tanggal],
    );
    for (const old of oldRows) {
      const key = `${old.mkl_nomor}|${old.kode_polos}`;
      if (!currentKeys.includes(key)) {
        const [[usedInSj]] = await conn.query(
          `SELECT 1 FROM tsj_maklon_dtl sd
           INNER JOIN tdtf_maklon_hasil dh ON dh.id = sd.sjmd_dtf_maklon_hasil_id
           WHERE dh.dmh_dtf_maklon_id = ? LIMIT 1`,
          [old.id],
        );
        if (!usedInSj) {
          await conn.query(
            `DELETE FROM tdtf_maklon_hasil WHERE dmh_dtf_maklon_id = ?`,
            [old.id],
          );
          await conn.query(`DELETE FROM tdtf_maklon WHERE id = ?`, [old.id]);
        }
      }
    }

    // ⬅ Recompute status SEKALI per mkl_nomor yang tersentuh, setelah
    // semua perubahan (insert/update/delete) baris LHK selesai.
    const touchedMklNomor = [...new Set(maklonRows.map((r) => r.Kode))];
    for (const mkl of touchedMklNomor) {
      await recomputeStatus(conn, mkl);
    }

    // Kumpulkan id tdtf_maklon yang disentuh save ini per mkl_nomor —
    // dipakai untuk auto-generate SJ Hasil Maklon (hanya id yang belum
    // punya SJ sama sekali, dicek ulang di dalam generateSjForIds).
    for (const [mklNomor, hasilIds] of Object.entries(touchedHasilIdsByMkl)) {
      const result = await sjHasilMakloonService.generateSjForIds(
        conn,
        mklNomor,
        hasilIds,
        tanggal,
        userKode,
      );
      if (result) {
        sjHasilMaklonList.push({ mklNomor, sjmNomor: result.nomor });
        await recomputeStatus(conn, mklNomor);
      }
    }

    const progressList = [];
    for (const mkl of touchedMklNomor) {
      progressList.push({
        mklNomor: mkl,
        ...(await getProgress(mkl, { conn })),
      });
    }

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  return {
    cab,
    tanggal,
    count: filled.length,
    sjHasilMaklon: sjHasilMaklonList,
  };
};

module.exports = {
  getDetail,
  getDefaultCab,
  lookupSpkMap,
  lookupSoDtf,
  lookupMaklon,
  validateKode,
  getMaklonAutofill,
  save,
};
