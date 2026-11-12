const db = require("../../config/database");
const {
  validasiPeriode,
  adalahSuperadmin,
  cabangUser,
  galat,
  cekTutupBuku,
} = require("../spanduk/lhk/lhkCommon");

const T = {
  hdr: "tterima_mutasi_marketing",
  dtl: "tterima_mutasi_marketing_dtl",
  mut: "tmutasi_marketing_spanduk",
  mutDtl: "tmutasi_marketing_spanduk_dtl",
  memo: "tmemospk",
  user: "tuser",
};

const PREFIX_NOMOR = "TMT";
const MAKS_KETERANGAN = 200;
const MAKS_JUMLAH = 99999999.99;
// false = semua user bermenu 191 melihat semua dokumen mutasi (marketing biasanya
// beda cabang dari produksi). true = hanya dokumen bercabang sama dengan user.
const BATASI_CABANG = false;

const str = (v) => String(v ?? "").trim();
const MO_SQL = `IFNULL(NULLIF(u.user_nama, ''), IFNULL(m.user_create, ''))`;

// Dokumen mutasi yang tampil: semua yang belum diterima (tanpa lihat periode),
// ditambah yang sudah diterima dengan tanggal terima dalam periode.
// Mutasi lama yang sudah berisi tanggal diterima tanpa dokumen terima disembunyikan.
const SQL_TAMPIL = `(
  (t.tmm_nomor IS NULL AND NOT EXISTS (
     SELECT 1 FROM ${T.mutDtl} z
      WHERE z.mmkd_nomor = h.mmk_nomor AND z.mmkd_diterima_tgl IS NOT NULL))
  OR t.tmm_tanggal BETWEEN ? AND ?
)`;

const sqlCabang = (user, params) => {
  if (!BATASI_CABANG || adalahSuperadmin(user)) return "";
  params.push(cabangUser(user));
  return "AND h.mmk_cab = ?";
};

// --- BROWSE: satu baris per dokumen mutasi ---
const getBrowse = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const params = [tglAwal, tglAkhir];
  const cab = sqlCabang(user, params);

  const [rows] = await db.query(
    `SELECT h.mmk_nomor AS Nomor_Mutasi,
            DATE_FORMAT(h.mmk_tanggal, '%Y-%m-%d') AS Tanggal_Mutasi,
            h.mmk_cab AS Lokasi,
            IFNULL(h.mmk_keterangan, '') AS Keterangan,
            IFNULL(x.jml_map, 0) AS Jumlah_MAP,
            IFNULL(x.total_kirim, 0) AS Total_Kirim,
            IFNULL(x.mo, '') AS MO,
            IFNULL(t.tmm_nomor, '') AS Nomor_Terima,
            DATE_FORMAT(t.tmm_tanggal, '%Y-%m-%d') AS Tanggal_Terima,
            (SELECT SUM(td.tmmd_qty_terima) FROM ${T.dtl} td
              WHERE td.tmmd_nomor = t.tmm_nomor) AS Total_Terima,
            IF(t.tmm_nomor IS NULL, 'BELUM', 'SUDAH') AS Status
     FROM ${T.mut} h
     LEFT JOIN ${T.hdr} t ON t.tmm_mmk_nomor = h.mmk_nomor
     LEFT JOIN (
       SELECT d.mmkd_nomor AS xnomor,
              COUNT(*) AS jml_map,
              SUM(d.mmkd_qty_kirim) AS total_kirim,
              GROUP_CONCAT(DISTINCT ${MO_SQL} SEPARATOR ', ') AS mo
       FROM ${T.mutDtl} d
       LEFT JOIN ${T.memo} m ON m.mspk_nomor = d.mmkd_mspk_nomor
       LEFT JOIN ${T.user} u ON u.user_kode = m.user_create
       GROUP BY d.mmkd_nomor
     ) x ON x.xnomor = h.mmk_nomor
     WHERE ${SQL_TAMPIL}
     ${cab}
     ORDER BY (t.tmm_nomor IS NULL) DESC, h.mmk_tanggal DESC, h.mmk_nomor DESC`,
    params,
  );
  return rows;
};

// --- DETAIL: satu baris per MAP (dipakai expand dan dialog terima) ---
const getDetail = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);
  const params = [tglAwal, tglAkhir];
  const cab = sqlCabang(user, params);

  const [rows] = await db.query(
    `SELECT h.mmk_nomor AS Nomor_Mutasi,
            d.mmkd_mspk_nomor AS Nomor_MAP,
            IFNULL(m.mspk_nama, '') AS Nama_MAP,
            IFNULL(m.mspk_ukuran, '') AS Ukuran,
            d.mmkd_qty_kirim AS Qty_Kirim,
            td.tmmd_qty_terima AS Qty_Terima,
            ${MO_SQL} AS MO
     FROM ${T.mut} h
     JOIN ${T.mutDtl} d ON d.mmkd_nomor = h.mmk_nomor
     LEFT JOIN ${T.hdr} t ON t.tmm_mmk_nomor = h.mmk_nomor
     LEFT JOIN ${T.dtl} td ON td.tmmd_nomor = t.tmm_nomor
                          AND td.tmmd_mspk_nomor = d.mmkd_mspk_nomor
     LEFT JOIN ${T.memo} m ON m.mspk_nomor = d.mmkd_mspk_nomor
     LEFT JOIN ${T.user} u ON u.user_kode = m.user_create
     WHERE ${SQL_TAMPIL}
     ${cab}
     ORDER BY h.mmk_nomor, d.mmkd_no_urut, d.mmkd_mspk_nomor`,
    params,
  );
  return rows;
};

// --- Validasi payload ---
const periksaTanggal = (v) => {
  const s = str(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw galat("Tanggal tidak valid");
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw galat("Tanggal tidak valid");
  }
  return s;
};

const parseTerima = (v, nomor) => {
  const s = str(v);
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    throw galat(
      `Jumlah terima MAP ${nomor} harus angka (maks 2 desimal, desimal pakai titik)`,
    );
  }
  const n = Number(s);
  if (n > MAKS_JUMLAH) throw galat(`Jumlah terima MAP ${nomor} terlalu besar`);
  return n;
};

const siapkanPayload = (p) => {
  const mutasi = str(p?.mutasi);
  if (!mutasi) throw galat("Nomor mutasi harus diisi");
  const keterangan = str(p?.keterangan);
  if (keterangan.length > MAKS_KETERANGAN) {
    throw galat(`Keterangan maksimal ${MAKS_KETERANGAN} karakter`);
  }
  const daftar = Array.isArray(p?.maps) ? p.maps : [];
  const maps = daftar
    .map((m) => ({ nomor: str(m?.nomor), qtyTerima: m?.qtyTerima }))
    .filter((m) => m.nomor !== "")
    .map((m) => ({
      nomor: m.nomor,
      qtyTerima: parseTerima(m.qtyTerima, m.nomor),
    }));
  if (maps.length === 0) throw galat("Isi jumlah terima");
  if (new Set(maps.map((m) => m.nomor.toUpperCase())).size !== maps.length) {
    throw galat("Ada MAP yang terisi ganda");
  }
  return {
    mutasi,
    tanggal: p?.tanggal ? periksaTanggal(p.tanggal) : "",
    keterangan,
    maps,
  };
};

// --- Penomoran: TMT.{YYYY}{MM}.{NNNN}, reset tiap bulan (dipanggil di bawah GET_LOCK) ---
const buatNomor = async (conn, tanggal) => {
  const prefix = `${PREFIX_NOMOR}.${tanggal.slice(0, 4)}${tanggal.slice(5, 7)}.`;
  const [rows] = await conn.query(
    `SELECT MAX(CAST(RIGHT(tmm_nomor, 4) AS UNSIGNED)) AS mx
     FROM ${T.hdr} WHERE tmm_nomor LIKE ?`,
    [`${prefix}%`],
  );
  const next = (Number(rows[0]?.mx) || 0) + 1;
  if (next > 9999)
    throw galat("Nomor Terima Mutasi bulan ini sudah mencapai batas (9999)");
  return `${prefix}${String(next).padStart(4, "0")}`;
};

// --- TERIMA: validasi marketing atas satu dokumen mutasi (semua MAP sekaligus) ---
const terima = async (payload, user) => {
  const d = siapkanPayload(payload);
  const conn = await db.getConnection();
  let kunci = "";
  let dapatKunci = false;
  try {
    const [[hr]] = await conn.query(
      "SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hari",
    );
    const tanggal = d.tanggal || hr.hari;
    if (tanggal > hr.hari) {
      throw galat("Tanggal terima tidak boleh melebihi hari ini");
    }
    await cekTutupBuku(tanggal);

    kunci = `TMT-${tanggal.slice(0, 4)}${tanggal.slice(5, 7)}`;
    const [[lk]] = await conn.query("SELECT GET_LOCK(?, 10) AS ok", [kunci]);
    if (Number(lk.ok) !== 1)
      throw galat("Sistem sedang membuat nomor, coba lagi");
    dapatKunci = true;

    await conn.beginTransaction();

    const [hdr] = await conn.query(
      `SELECT mmk_nomor, mmk_cab, DATE_FORMAT(mmk_tanggal, '%Y-%m-%d') AS tgl
       FROM ${T.mut} WHERE mmk_nomor = ? FOR UPDATE`,
      [d.mutasi],
    );
    if (hdr.length === 0)
      throw galat("Dokumen Mutasi Marketing tidak ditemukan", "notFound");
    if (
      BATASI_CABANG &&
      !adalahSuperadmin(user) &&
      str(hdr[0].mmk_cab) !== cabangUser(user)
    ) {
      throw galat("Dokumen ini bukan milik cabang Anda", "forbidden");
    }
    if (tanggal < hdr[0].tgl) {
      throw galat("Tanggal terima tidak boleh lebih awal dari tanggal mutasi");
    }

    const [sudah] = await conn.query(
      `SELECT tmm_nomor FROM ${T.hdr} WHERE tmm_mmk_nomor = ? LIMIT 1`,
      [d.mutasi],
    );
    if (sudah.length > 0) {
      throw galat(
        `Mutasi ${d.mutasi} sudah diterima pada ${sudah[0].tmm_nomor}`,
      );
    }

    const [dtl] = await conn.query(
      `SELECT mmkd_mspk_nomor, mmkd_qty_kirim, mmkd_diterima_tgl
       FROM ${T.mutDtl} WHERE mmkd_nomor = ?
       ORDER BY mmkd_no_urut, mmkd_mspk_nomor FOR UPDATE`,
      [d.mutasi],
    );
    if (dtl.some((r) => r.mmkd_diterima_tgl)) {
      throw galat(`Mutasi ${d.mutasi} sudah tercatat diterima`);
    }

    // Daftar MAP di payload harus persis sama dengan isi dokumen mutasi
    const terimaPer = new Map(
      d.maps.map((m) => [m.nomor.toUpperCase(), m.qtyTerima]),
    );
    const adaDi = new Set(
      dtl.map((r) => String(r.mmkd_mspk_nomor).toUpperCase()),
    );
    if (
      terimaPer.size !== adaDi.size ||
      [...terimaPer.keys()].some((k) => !adaDi.has(k))
    ) {
      throw galat("Daftar MAP tidak sesuai dokumen mutasi. Muat ulang browse.");
    }
    if (![...terimaPer.values()].some((v) => v > 0)) {
      throw galat("Minimal satu MAP harus memiliki jumlah terima lebih dari 0");
    }

    const nomor = await buatNomor(conn, tanggal);
    await conn.query(
      `INSERT INTO ${T.hdr}
         (tmm_nomor, tmm_tanggal, tmm_mmk_nomor, tmm_cab, tmm_keterangan, date_create, user_create)
       VALUES (?, ?, ?, ?, ?, NOW(), ?)`,
      [nomor, tanggal, d.mutasi, str(hdr[0].mmk_cab), d.keterangan, user.kode],
    );

    let urut = 1;
    for (const r of dtl) {
      await conn.query(
        `INSERT INTO ${T.dtl}
           (tmmd_nomor, tmmd_mspk_nomor, tmmd_qty_kirim, tmmd_qty_terima, tmmd_no_urut, date_create)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [
          nomor,
          r.mmkd_mspk_nomor,
          Number(r.mmkd_qty_kirim),
          terimaPer.get(String(r.mmkd_mspk_nomor).toUpperCase()),
          urut++,
        ],
      );
    }

    // Menandai mutasi sudah diterima (juga mengunci ubah/hapus Mutasi Marketing)
    await conn.query(
      `UPDATE ${T.mutDtl}
       SET mmkd_diterima_tgl = ?, mmkd_diterima_oleh = ?
       WHERE mmkd_nomor = ?`,
      [tanggal, user.kode, d.mutasi],
    );

    await conn.commit();
    return { nomor };
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e && e.code === "ER_DUP_ENTRY"
      ? galat("Mutasi ini sudah diterima di dokumen lain. Muat ulang browse.")
      : e;
  } finally {
    if (dapatKunci)
      await conn.query("SELECT RELEASE_LOCK(?)", [kunci]).catch(() => {});
    conn.release();
  }
};

// --- BATAL TERIMA: hanya superadmin; mutasi kembali "belum diterima" ---
const remove = async (nomorUrl, user) => {
  if (!adalahSuperadmin(user)) {
    throw galat(
      "Hanya superadmin yang boleh membatalkan Terima Mutasi",
      "forbidden",
    );
  }
  const nomor = str(nomorUrl);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [hdr] = await conn.query(
      `SELECT tmm_nomor, tmm_mmk_nomor, DATE_FORMAT(tmm_tanggal, '%Y-%m-%d') AS tgl
       FROM ${T.hdr} WHERE tmm_nomor = ? FOR UPDATE`,
      [nomor],
    );
    if (hdr.length === 0)
      throw galat("Dokumen Terima Mutasi tidak ditemukan", "notFound");

    await cekTutupBuku(hdr[0].tgl);

    await conn.query(`DELETE FROM ${T.dtl} WHERE tmmd_nomor = ?`, [nomor]);
    await conn.query(`DELETE FROM ${T.hdr} WHERE tmm_nomor = ?`, [nomor]);
    await conn.query(
      `UPDATE ${T.mutDtl}
       SET mmkd_diterima_tgl = NULL, mmkd_diterima_oleh = NULL
       WHERE mmkd_nomor = ?`,
      [hdr[0].tmm_mmk_nomor],
    );

    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
};

module.exports = { getBrowse, getDetail, terima, remove };
