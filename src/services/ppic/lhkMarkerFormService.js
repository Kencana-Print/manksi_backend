const db = require("../../config/database");
// Lookup SPK/MAP generik dipakai bareng dengan LHK Pola — reuse
// supaya tidak duplikasi logic query yang sama persis.
const {
  searchSpk,
  getSpkByNomor,
  getDivisiNama,
} = require("../garmen/lhkPolaFormService");

// --- GENERATE NOMOR (format: LHKM/0001/2026) ---
const generateNomor = async (tanggal) => {
  const tahun = new Date(tanggal).getFullYear();
  const [rows] = await db.query(
    `SELECT IFNULL(MAX(CAST(SUBSTR(lhkp_nomor, 6, 4) AS UNSIGNED)), 0) AS jumlah
     FROM tlhkpola_hdr
     WHERE lhkp_nomor LIKE 'LHKM/%' AND RIGHT(lhkp_nomor, 4) = ?`,
    [String(tahun)],
  );
  const nextVal = Number(rows[0].jumlah) + 1;
  return `LHKM/${String(nextVal).padStart(4, "0")}/${tahun}`;
};

const galat = (pesan, statusCode = 400) =>
  Object.assign(new Error(pesan), { statusCode });

// ============================================================
// SIZE & RASIO
// ============================================================
const MAKS_RASIO = 7;
// Urutan tampil size; size di luar daftar menyusul menurut abjad
const URUTAN_SIZE = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];

const bulat5 = (n) => Math.round(n * 1e5) / 1e5;

const urutkanSize = (list) =>
  [...list].sort((a, b) => {
    const ia = URUTAN_SIZE.indexOf(a.size.toUpperCase());
    const ib = URUTAN_SIZE.indexOf(b.size.toUpperCase());
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.size.localeCompare(b.size);
  });

// Qty order per size dari SPK (tspk_size), bila kosong dari MAP (tmemospk_size)
const getSizeSpk = async (spkNomor, executor = db) => {
  let [rows] = await executor.query(
    `SELECT TRIM(spks_size) AS size, SUM(spks_qty) AS qty
       FROM tspk_size WHERE spks_nomor = ?
      GROUP BY TRIM(spks_size)`,
    [spkNomor],
  );
  if (rows.length === 0) {
    [rows] = await executor.query(
      `SELECT TRIM(mspks_size) AS size, SUM(mspks_qty) AS qty
         FROM tmemospk_size WHERE mspks_nomor = ?
        GROUP BY TRIM(mspks_size)`,
      [spkNomor],
    );
  }
  const list = urutkanSize(
    rows
      .filter((r) => r.size)
      .map((r) => ({ size: r.size, qtyOrder: Number(r.qty) })),
  );
  return list.map((r, i) => ({ ...r, urut: i + 1 }));
};

// Validasi dan hitung rasio. Sisa per size = qty order dikurangi
// jumlah (spreading x qty rasio) semua rasio dari atas sampai rasio ini.
const hitungRasio = (noBlok, sizeList, rasioInput) => {
  const label = `Blok ${noBlok}`;
  const terisi = (Array.isArray(rasioInput) ? rasioInput : []).filter(
    (r) =>
      r &&
      (Number(r.spreading) > 0 ||
        Number(r.pMarkerCm) > 0 ||
        Object.values(r.qty || {}).some((v) => Number(v ?? 0) !== 0)),
  );
  if (terisi.length === 0) {
    throw new Error(`${label}: minimal 1 rasio harus diisi.`);
  }

  const sisaBerjalan = {};
  for (const s of sizeList) sisaBerjalan[s.size] = s.qtyOrder;

  const dipakai = new Set();
  const hasil = [];
  const urut = [...terisi].sort((a, b) => Number(a.rasio) - Number(b.rasio));

  for (const r of urut) {
    const no = Number(r.rasio);
    if (!Number.isInteger(no) || no < 1 || no > MAKS_RASIO) {
      throw new Error(`${label}: nomor rasio harus 1 sampai ${MAKS_RASIO}.`);
    }
    if (dipakai.has(no)) throw new Error(`${label}: rasio ${no} dobel.`);
    dipakai.add(no);

    const spreading = Number(r.spreading ?? 0);
    if (!Number.isInteger(spreading) || spreading < 0) {
      throw new Error(
        `${label} rasio ${no}: spreading harus bilangan bulat >= 0 (isi 0 bila tinggi gelar belum diketahui).`,
      );
    }
    const cm = Number(r.pMarkerCm);
    if (!(cm > 0)) {
      throw new Error(`${label} rasio ${no}: p.marker (cm) harus > 0.`);
    }

    const qtyIn = r.qty && typeof r.qty === "object" ? r.qty : {};
    for (const k of Object.keys(qtyIn)) {
      if (!sizeList.some((s) => s.size === k)) {
        throw new Error(`${label} rasio ${no}: size ${k} tidak ada di SPK.`);
      }
    }

    const qty = {};
    let adaQty = false;
    for (const s of sizeList) {
      const q = Number(qtyIn[s.size] ?? 0);
      if (!Number.isInteger(q)) {
        throw new Error(
          `${label} rasio ${no}: qty size ${s.size} harus bilangan bulat.`,
        );
      }
      qty[s.size] = q;
      if (q !== 0) adaQty = true;
      sisaBerjalan[s.size] = bulat5(sisaBerjalan[s.size] - spreading * q);
    }
    if (!adaQty) {
      throw new Error(
        `${label} rasio ${no}: isi qty (selain 0) minimal di satu size.`,
      );
    }

    const cmBulat = Math.round(cm * 1000) / 1000;
    const m = bulat5(cmBulat / 100);
    hasil.push({
      no,
      spreading,
      cm: cmBulat,
      m,
      total: bulat5(m * spreading),
      qty,
      sisa: { ...sisaBerjalan },
    });
  }
  return hasil;
};

// Nomor tanda terima: TTM.yyyymm.nnnn
const generateNomorTt = async (conn) => {
  const d = new Date();
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `TTM.${ym}.`;
  const [[r]] = await conn.query(
    `SELECT IFNULL(MAX(CAST(SUBSTR(tt_nomor, 12, 4) AS UNSIGNED)), 0) AS maks
       FROM tpermintaan_marker_tt WHERE tt_nomor LIKE ?`,
    [`${prefix}%`],
  );
  return `${prefix}${String(Number(r.maks) + 1).padStart(4, "0")}`;
};

// Satu tanda terima per pasangan (LHK, permintaan). Dipanggil di akhir
// transaksi saveData, idempoten: pasangan yang sudah punya tidak dibuat ulang.
const sinkronTandaTerima = async (conn, lhkNomor, pmList, userKode) => {
  const [lama] = await conn.query(
    `SELECT tt_nomor, tt_pm_nomor FROM tpermintaan_marker_tt WHERE tt_lhk_nomor = ?`,
    [lhkNomor],
  );
  const sudahAda = new Set(lama.map((r) => r.tt_pm_nomor));

  // Permintaan yang tidak lagi ada di LHK: tanda terimanya dihapus.
  // (Yang sudah divalidasi tidak sampai sini, LHK-nya sudah terkunci.)
  for (const r of lama) {
    if (!pmList.includes(r.tt_pm_nomor)) {
      await conn.query(`DELETE FROM tpermintaan_marker_tt WHERE tt_nomor = ?`, [
        r.tt_nomor,
      ]);
    }
  }

  // Isi dokumen berubah: Mutasi dikosongkan, dokumen harus dicetak ulang
  await conn.query(
    `UPDATE tpermintaan_marker_tt
        SET tt_date_mutasi = NULL, tt_user_mutasi = NULL
      WHERE tt_lhk_nomor = ?`,
    [lhkNomor],
  );

  for (const pm of pmList) {
    if (sudahAda.has(pm)) continue;
    const nomorTt = await generateNomorTt(conn);
    await conn.query(
      `INSERT INTO tpermintaan_marker_tt
         (tt_nomor, tt_lhk_nomor, tt_pm_nomor, tt_user_create, tt_date_create)
       VALUES (?, ?, ?, ?, NOW())`,
      [nomorTt, lhkNomor, pm, userKode],
    );
  }
};

// Data dokumen tanda terima satu LHK. Isi dibaca dari baris LHK, tidak disalin.
const bacaTandaTerima = async (executor, lhkNomor) => {
  const [[hdr]] = await executor.query(
    `SELECT lhkp_nomor AS nomor,
            DATE_FORMAT(lhkp_tanggal, '%Y-%m-%d') AS tanggal,
            lhkp_keterangan AS keterangan, lhkp_pembuat_marker AS pembuatMarker,
            user_create AS userCreate,
            DATE_FORMAT(date_create, '%Y-%m-%d %H:%i') AS dateCreate
       FROM tlhkpola_hdr WHERE lhkp_nomor = ?`,
    [lhkNomor],
  );
  if (!hdr) throw galat("Data LHK Marker tidak ditemukan.", 404);

  const [tandaTerima] = await executor.query(
    `SELECT t.tt_nomor AS nomor, t.tt_pm_nomor AS pmNomor,
            p.pm_user_create AS peminta,
            DATE_FORMAT(p.pm_deadline, '%Y-%m-%d') AS deadline,
            DATE_FORMAT(t.tt_date_mutasi, '%Y-%m-%d %H:%i') AS tglMutasi,
            t.tt_user_mutasi AS userMutasi,
            DATE_FORMAT(t.tt_date_terima, '%Y-%m-%d %H:%i') AS tglTerima,
            t.tt_user_terima AS userTerima
       FROM tpermintaan_marker_tt t
       INNER JOIN tpermintaan_marker p ON p.pm_nomor = t.tt_pm_nomor
      WHERE t.tt_lhk_nomor = ?
      ORDER BY t.tt_nomor`,
    [lhkNomor],
  );

  for (const t of tandaTerima) {
    const [baris] = await executor.query(
      `SELECT d.ldm_urut AS urut, d.ldm_spk_nomor AS spkNomor,
              IFNULL(s.spk_nama, m.mspk_nama) AS namaSpk,
              d.ldm_bhn_kode AS kodeBahan, bh.Bhn_Name AS namaBahan,
              d.ldm_setting AS setting,
              d.ldm_lebar_kain AS lebarMarker,
              d.ldm_tujuan_proses AS untuk,
              d.ldm_keterangan AS keterangan,
              d.ldm_size AS sizeLama,
              (SELECT SUM(r.lmr_total_m) FROM tlhkpola_marker_rasio r
                WHERE r.lmr_ldm_id = d.ldm_id) AS totalKebutuhan
         FROM tlhkpola_marker_dtl d
         LEFT JOIN tspk s ON s.spk_nomor = d.ldm_spk_nomor
         LEFT JOIN tmemospk m ON m.mspk_nomor = d.ldm_spk_nomor
         LEFT JOIN tbahan bh ON bh.Bhn_kode = d.ldm_bhn_kode
        WHERE d.ldm_nomor = ? AND d.ldm_pm_nomor = ?
        ORDER BY d.ldm_urut`,
      [lhkNomor, t.pmNomor],
    );
    t.baris = baris.map((b) => ({
      ...b,
      totalKebutuhan:
        b.totalKebutuhan === null ? null : Number(b.totalKebutuhan),
    }));
  }
  return { lhk: hdr, tandaTerima };
};

// ============================================================
// GET DETAIL — untuk mode Ubah (hanya sisi Marker)
// ============================================================
const getDetail = async (nomor) => {
  const [headerRows] = await db.query(
    `SELECT lhkp_nomor, DATE_FORMAT(lhkp_tanggal, '%Y-%m-%d') AS lhkp_tanggal,
            lhkp_keterangan, lhkp_pembuat_pola, lhkp_pembuat_marker,
            user_create, date_create, user_modified, date_modified
       FROM tlhkpola_hdr WHERE lhkp_nomor = ?`,
    [nomor],
  );
  if (headerRows.length === 0)
    throw new Error("Data LHK Marker tidak ditemukan.");

  const [marker] = await db.query(
    `SELECT d.ldm_id AS id, d.ldm_urut AS urut, d.ldm_spk_nomor AS spkNomor,
            IFNULL(s.spk_nama, m.mspk_nama) AS namaSpk,
            d.ldm_pm_nomor AS pmNomor, d.ldm_bhn_kode AS kode,
            bh.Bhn_Name AS namaBahan, bh.Bhn_satuan AS satuan,
            d.ldm_setting AS setting, d.ldm_lebar_kain AS lebarMarker,
            d.ldm_tujuan_proses AS untuk, d.ldm_keterangan AS keterangan,
            d.ldm_size AS sizeLama
       FROM tlhkpola_marker_dtl d
       LEFT JOIN tspk s ON s.spk_nomor = d.ldm_spk_nomor
       LEFT JOIN tmemospk m ON m.mspk_nomor = d.ldm_spk_nomor
       LEFT JOIN tbahan bh ON bh.Bhn_kode = d.ldm_bhn_kode
      WHERE d.ldm_nomor = ?
      ORDER BY d.ldm_urut`,
    [nomor],
  );

  const ids = marker.map((r) => r.id);
  let sizeRows = [];
  let rasioRows = [];
  let rasioSizeRows = [];
  if (ids.length > 0) {
    [sizeRows] = await db.query(
      `SELECT lms_ldm_id AS ldmId, lms_size AS size, lms_qty_order AS qtyOrder
         FROM tlhkpola_marker_size WHERE lms_ldm_id IN (?)
        ORDER BY lms_urut`,
      [ids],
    );
    [rasioRows] = await db.query(
      `SELECT lmr_ldm_id AS ldmId, lmr_rasio AS rasio, lmr_spreading AS spreading,
              lmr_p_marker_cm AS pMarkerCm, lmr_p_marker_m AS pMarkerM,
              lmr_total_m AS totalM
         FROM tlhkpola_marker_rasio WHERE lmr_ldm_id IN (?)
        ORDER BY lmr_rasio`,
      [ids],
    );
    [rasioSizeRows] = await db.query(
      `SELECT lmz_ldm_id AS ldmId, lmz_rasio AS rasio, lmz_size AS size,
              lmz_qty AS qty, lmz_sisa AS sisa
         FROM tlhkpola_marker_rasio_size WHERE lmz_ldm_id IN (?)`,
      [ids],
    );
  }

  const blok = marker.map((b) => ({
    ...b,
    formatLama: !b.kode,
    size: sizeRows
      .filter((x) => x.ldmId === b.id)
      .map((x) => ({ size: x.size, qtyOrder: Number(x.qtyOrder) })),
    rasio: rasioRows
      .filter((x) => x.ldmId === b.id)
      .map((x) => {
        const qty = {};
        const sisa = {};
        for (const z of rasioSizeRows) {
          if (z.ldmId === b.id && z.rasio === x.rasio) {
            qty[z.size] = Number(z.qty);
            sisa[z.size] = Number(z.sisa);
          }
        }
        return {
          rasio: x.rasio,
          spreading: Number(x.spreading),
          pMarkerCm: Number(x.pMarkerCm),
          pMarkerM: Number(x.pMarkerM),
          totalM: Number(x.totalM),
          qty,
          sisa,
        };
      }),
  }));

  return {
    header: {
      ...headerRows[0],
      pembuatMarker: headerRows[0].lhkp_pembuat_marker || "",
    },
    marker: blok,
  };
};

// ============================================================
// SAVE DATA — create & edit (Marker saja)
// Satu blok = satu pasangan (permintaan, bahan, setting).
// Sisa, p.marker (m) dan total dihitung di sini; angka dari FE diabaikan.
// ============================================================
const saveData = async (payload, user, isEdit) => {
  const { nomor: existingNomor, tanggal, keterangan, marker } = payload;

  if (!tanggal) throw new Error("Tanggal wajib diisi.");

  const blokInput = (marker || []).filter(
    (r) => r && (String(r.pmNomor || "").trim() || String(r.kode || "").trim()),
  );
  if (blokInput.length === 0) {
    throw new Error("Minimal harus ada 1 blok bahan di LHK Marker.");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    if (isEdit && existingNomor) {
      const [terkunci] = await conn.query(
        `SELECT p.pm_nomor
           FROM tlhkpola_marker_dtl d
           INNER JOIN tpermintaan_marker p ON p.pm_nomor = d.ldm_pm_nomor
          WHERE d.ldm_nomor = ? AND p.pm_date_close IS NOT NULL
          LIMIT 1`,
        [existingNomor],
      );
      if (terkunci.length > 0) {
        throw new Error(
          `LHK ini terkait Permintaan Marker ${terkunci[0].pm_nomor} yang sudah CLOSE, tidak bisa diubah.`,
        );
      }
      const [sudahTerima] = await conn.query(
        `SELECT tt_nomor, tt_pm_nomor FROM tpermintaan_marker_tt
          WHERE tt_lhk_nomor = ? AND tt_date_terima IS NOT NULL LIMIT 1`,
        [existingNomor],
      );
      if (sudahTerima.length > 0) {
        throw new Error(
          `LHK ini sudah divalidasi pada tanda terima ${sudahTerima[0].tt_nomor} (Permintaan Marker ${sudahTerima[0].tt_pm_nomor}), tidak bisa diubah.`,
        );
      }
      const [[lama]] = await conn.query(
        `SELECT COUNT(*) AS n FROM tlhkpola_marker_dtl
          WHERE ldm_nomor = ? AND ldm_bhn_kode IS NULL`,
        [existingNomor],
      );
      if (Number(lama.n) > 0) {
        throw new Error(
          "LHK ini memakai format lama (tanpa bahan dan rasio), tidak bisa diubah. Hanya bisa dilihat atau dihapus.",
        );
      }
    }

    // Validasi tiap blok terhadap Permintaan Marker, lalu hitung rasio
    const sizeCache = new Map();
    const kunciDipakai = new Map(); // kunci -> nomor blok pertama
    const rencana = [];

    for (let i = 0; i < blokInput.length; i++) {
      const r = blokInput[i];
      const noBlok = i + 1;
      const pm = String(r.pmNomor || "").trim();
      const spk = String(r.spkNomor || "").trim();
      const kode = String(r.kode || "").trim();
      const setting = String(r.setting || "").trim();
      if (!pm || !spk || !kode || !setting) {
        throw new Error(
          `Blok ${noBlok}: permintaan, SPK, bahan dan setting wajib terisi.`,
        );
      }

      const kunci = `${pm}|${spk}|${kode}|${setting}`;
      if (kunciDipakai.has(kunci)) {
        throw new Error(
          `Blok ${noBlok}: bahan ${kode} (${setting}) untuk SPK ${spk} di ${pm} sama dengan Blok ${kunciDipakai.get(kunci)}.`,
        );
      }
      kunciDipakai.set(kunci, noBlok);

      const [[p]] = await conn.query(
        `SELECT pm_status_manual AS manual, pm_date_close AS closed,
                pm_user_create AS peminta, pm_pic AS pic
           FROM tpermintaan_marker WHERE pm_nomor = ?`,
        [pm],
      );
      if (!p) throw new Error(`Permintaan Marker ${pm} tidak ditemukan.`);
      if (p.manual) {
        throw new Error(`Permintaan Marker ${pm} berstatus ${p.manual}.`);
      }
      if (p.closed) throw new Error(`Permintaan Marker ${pm} sudah CLOSE.`);
      if (!p.pic) {
        throw new Error(
          `Permintaan Marker ${pm} belum diambil. Ambil dulu dari Antrean Saya.`,
        );
      }
      if (String(p.pic).toUpperCase() !== String(user.kode).toUpperCase()) {
        throw new Error(
          `Permintaan Marker ${pm} dipegang ${p.pic}, hanya PIC yang bisa menyimpan LHK.`,
        );
      }

      const [[det]] = await conn.query(
        `SELECT pm2_spk_nomor AS spk FROM tpermintaan_marker_detail
          WHERE pm2_pm_nomor = ? AND pm2_spk_nomor = ?
            AND pm2_bhn_kode = ? AND pm2_setting = ?
          LIMIT 1`,
        [pm, spk, kode, setting],
      );
      if (!det) {
        throw new Error(
          `Blok ${noBlok}: bahan ${kode} (${setting}) untuk SPK ${spk} tidak ada di Permintaan Marker ${pm}.`,
        );
      }

      const [dup] = await conn.query(
        `SELECT ldm_nomor FROM tlhkpola_marker_dtl
          WHERE ldm_pm_nomor = ? AND ldm_spk_nomor = ?
            AND ldm_bhn_kode = ? AND ldm_setting = ?
            AND ldm_nomor <> ?
          LIMIT 1`,
        [pm, det.spk, kode, setting, existingNomor || ""],
      );
      if (dup.length > 0) {
        throw new Error(
          `Bahan ${kode} (${setting}) untuk SPK ${det.spk} di Permintaan Marker ${pm} sudah punya LHK ${dup[0].ldm_nomor}.`,
        );
      }

      if (!sizeCache.has(det.spk)) {
        sizeCache.set(det.spk, await getSizeSpk(det.spk, conn));
      }
      const sizeList = sizeCache.get(det.spk);
      if (sizeList.length === 0) {
        throw new Error(`SPK ${det.spk} belum punya data size.`);
      }

      const lebar = String(r.lebarMarker || "").trim();
      if (lebar.length > 50) {
        throw new Error(`Blok ${noBlok}: lebar marker maksimal 50 karakter.`);
      }
      const ket = String(r.keterangan || "").trim();
      if (ket.length > 200) {
        throw new Error(`Blok ${noBlok}: keterangan maksimal 200 karakter.`);
      }

      rencana.push({
        pm,
        kode,
        setting,
        spk: det.spk,
        untuk: p.peminta,
        pic: p.pic,
        lebar,
        ket,
        sizeList,
        rasio: hitungRasio(noBlok, sizeList, r.rasio),
      });
    }

    let nomor;
    if (isEdit) {
      if (!existingNomor) throw new Error("Nomor LHK Marker wajib diisi.");
      const [exist] = await conn.query(
        `SELECT lhkp_nomor FROM tlhkpola_hdr WHERE lhkp_nomor = ?`,
        [existingNomor],
      );
      if (exist.length === 0)
        throw new Error("Data LHK Marker tidak ditemukan.");
      nomor = existingNomor;
      // Pembuat tidak diubah saat edit (tetap pembuat asli)
      await conn.query(
        `UPDATE tlhkpola_hdr
         SET lhkp_tanggal = ?, lhkp_keterangan = ?,
             user_modified = ?, date_modified = NOW()
         WHERE lhkp_nomor = ?`,
        [tanggal, keterangan || "", user.kode, nomor],
      );
    } else {
      // Pembuat = nama PIC permintaan (PIC sudah dipastikan sama dengan user)
      const [[u]] = await conn.query(
        `SELECT user_nama FROM tuser WHERE user_kode = ?`,
        [rencana[0].pic],
      );
      const namaPembuat = (u && u.user_nama) || rencana[0].pic;

      nomor = await generateNomor(tanggal);
      await conn.query(
        `INSERT INTO tlhkpola_hdr
           (lhkp_nomor, lhkp_tanggal, lhkp_keterangan, lhkp_pembuat_marker, user_create, date_create)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [nomor, tanggal, keterangan || "", namaPembuat, user.kode],
      );
    }

    // Anak (size, rasio, rasio_size) ikut terhapus lewat ON DELETE CASCADE
    await conn.query(`DELETE FROM tlhkpola_marker_dtl WHERE ldm_nomor = ?`, [
      nomor,
    ]);

    for (let i = 0; i < rencana.length; i++) {
      const b = rencana[i];
      const [ins] = await conn.query(
        `INSERT INTO tlhkpola_marker_dtl
           (ldm_nomor, ldm_urut, ldm_spk_nomor, ldm_pm_nomor, ldm_bhn_kode,
            ldm_setting, ldm_lebar_kain, ldm_tujuan_proses, ldm_keterangan)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [nomor, i + 1, b.spk, b.pm, b.kode, b.setting, b.lebar, b.untuk, b.ket],
      );
      const ldmId = ins.insertId;

      await conn.query(
        `INSERT INTO tlhkpola_marker_size
           (lms_ldm_id, lms_size, lms_urut, lms_qty_order) VALUES ?`,
        [b.sizeList.map((s) => [ldmId, s.size, s.urut, s.qtyOrder])],
      );
      await conn.query(
        `INSERT INTO tlhkpola_marker_rasio
           (lmr_ldm_id, lmr_rasio, lmr_spreading, lmr_p_marker_cm,
            lmr_p_marker_m, lmr_total_m) VALUES ?`,
        [b.rasio.map((r) => [ldmId, r.no, r.spreading, r.cm, r.m, r.total])],
      );
      await conn.query(
        `INSERT INTO tlhkpola_marker_rasio_size
           (lmz_ldm_id, lmz_rasio, lmz_size, lmz_qty, lmz_sisa) VALUES ?`,
        [
          b.rasio.flatMap((r) =>
            b.sizeList.map((s) => [
              ldmId,
              r.no,
              s.size,
              r.qty[s.size],
              r.sisa[s.size],
            ]),
          ),
        ],
      );
    }

    // Tanda terima per LHK dan permintaan, ikut transaksi ini (idempoten)
    const pmDipakai = [...new Set(rencana.map((b) => b.pm))];
    await sinkronTandaTerima(conn, nomor, pmDipakai, user.kode);

    await conn.commit();
    return { nomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// ============================================================
// DELETE — hanya hapus marker + header. Grading (record lama
// gabungan) SENGAJA TIDAK disentuh.
// ============================================================
const deleteData = async (nomor) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [terkunci] = await conn.query(
      `SELECT p.pm_nomor
         FROM tlhkpola_marker_dtl d
         INNER JOIN tpermintaan_marker p ON p.pm_nomor = d.ldm_pm_nomor
        WHERE d.ldm_nomor = ? AND p.pm_date_close IS NOT NULL
        LIMIT 1`,
      [nomor],
    );
    if (terkunci.length > 0) {
      throw new Error(
        `LHK ini terkait Permintaan Marker ${terkunci[0].pm_nomor} yang sudah CLOSE, tidak bisa dihapus.`,
      );
    }

    const [sudahTerima] = await conn.query(
      `SELECT tt_nomor, tt_pm_nomor FROM tpermintaan_marker_tt
        WHERE tt_lhk_nomor = ? AND tt_date_terima IS NOT NULL LIMIT 1`,
      [nomor],
    );
    if (sudahTerima.length > 0) {
      throw new Error(
        `LHK ini sudah divalidasi pada tanda terima ${sudahTerima[0].tt_nomor} (Permintaan Marker ${sudahTerima[0].tt_pm_nomor}), tidak bisa dihapus.`,
      );
    }
    await conn.query(
      `DELETE FROM tpermintaan_marker_tt WHERE tt_lhk_nomor = ?`,
      [nomor],
    );

    await conn.query(`DELETE FROM tlhkpola_marker_dtl WHERE ldm_nomor = ?`, [
      nomor,
    ]);
    const [result] = await conn.query(
      `DELETE FROM tlhkpola_hdr WHERE lhkp_nomor = ?`,
      [nomor],
    );
    if (result.affectedRows === 0)
      throw new Error("Data LHK Marker tidak ditemukan.");
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// Pratinjau dokumen: tanpa efek samping (tidak mengisi Mutasi)
const getTandaTerima = (lhkNomor) => bacaTandaTerima(db, lhkNomor);

// Cetak: Mutasi diisi pada cetak pertama, cetak ulang tidak mengubahnya
const cetakTandaTerima = async (lhkNomor, user) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[ada]] = await conn.query(
      `SELECT COUNT(*) AS n FROM tpermintaan_marker_tt WHERE tt_lhk_nomor = ?`,
      [lhkNomor],
    );
    if (!Number(ada.n)) {
      throw galat(
        "LHK ini belum terkait Permintaan Marker, tidak ada tanda terima untuk dicetak.",
      );
    }
    await conn.query(
      `UPDATE tpermintaan_marker_tt
          SET tt_date_mutasi = NOW(), tt_user_mutasi = ?
        WHERE tt_lhk_nomor = ? AND tt_date_mutasi IS NULL`,
      [user.kode, lhkNomor],
    );
    const data = await bacaTandaTerima(conn, lhkNomor);
    await conn.commit();
    return data;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// Daftar tanda terima satu permintaan (dialog di browse Permintaan Marker)
const listTandaTerimaByPermintaan = async (pmNomor) => {
  const [rows] = await db.query(
    `SELECT t.tt_nomor AS nomor, t.tt_lhk_nomor AS lhkNomor,
            p.pm_user_create AS peminta,
            DATE_FORMAT(h.date_create, '%Y-%m-%d %H:%i') AS tglLhk,
            (SELECT GROUP_CONCAT(d.ldm_spk_nomor ORDER BY d.ldm_urut SEPARATOR ', ')
               FROM tlhkpola_marker_dtl d
              WHERE d.ldm_nomor = t.tt_lhk_nomor AND d.ldm_pm_nomor = t.tt_pm_nomor) AS spk,
            DATE_FORMAT(t.tt_date_mutasi, '%Y-%m-%d %H:%i') AS tglMutasi,
            t.tt_user_mutasi AS userMutasi,
            DATE_FORMAT(t.tt_date_terima, '%Y-%m-%d %H:%i') AS tglTerima,
            t.tt_user_terima AS userTerima
       FROM tpermintaan_marker_tt t
       INNER JOIN tpermintaan_marker p ON p.pm_nomor = t.tt_pm_nomor
       LEFT JOIN tlhkpola_hdr h ON h.lhkp_nomor = t.tt_lhk_nomor
      WHERE t.tt_pm_nomor = ?
      ORDER BY t.tt_nomor`,
    [pmNomor],
  );
  return rows;
};

// Validasi digital: hanya pembuat permintaan, setelah Mutasi terisi
const validasiTandaTerima = async (ttNomor, user) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[t]] = await conn.query(
      `SELECT t.tt_nomor, t.tt_pm_nomor, t.tt_date_mutasi, t.tt_date_terima,
              p.pm_user_create
         FROM tpermintaan_marker_tt t
         INNER JOIN tpermintaan_marker p ON p.pm_nomor = t.tt_pm_nomor
        WHERE t.tt_nomor = ?
        FOR UPDATE`,
      [ttNomor],
    );
    if (!t) throw galat("Tanda terima tidak ditemukan.", 404);
    if (
      String(t.pm_user_create).toUpperCase() !== String(user.kode).toUpperCase()
    ) {
      throw galat(
        `Hanya pembuat permintaan (${t.pm_user_create}) yang dapat memvalidasi tanda terima ini.`,
        403,
      );
    }
    if (t.tt_date_terima) throw galat("Tanda terima ini sudah divalidasi.");
    if (!t.tt_date_mutasi) {
      throw galat(
        "Tanda terima belum dicetak dan diserahkan oleh pembuat marker, belum bisa divalidasi.",
      );
    }
    await conn.query(
      `UPDATE tpermintaan_marker_tt
          SET tt_date_terima = NOW(), tt_user_terima = ?
        WHERE tt_nomor = ?`,
      [user.kode, ttNomor],
    );
    await conn.commit();
    return { nomor: ttNomor, pmNomor: t.tt_pm_nomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = {
  getDetail,
  saveData,
  deleteData,
  searchSpk,
  getSpkByNomor,
  getDivisiNama,
  getSizeSpk,
  getTandaTerima,
  cetakTandaTerima,
  listTandaTerimaByPermintaan,
  validasiTandaTerima,
};
