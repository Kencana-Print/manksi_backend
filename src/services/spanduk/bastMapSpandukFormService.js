const db = require("../../config/database");
const {
  galat,
  teks,
  norm,
  adalahSuperadmin,
  cabangUser,
} = require("./lhk/lhkCommon");
const { pastikanMapPunyaLhk } = require("./lhk/lhkGerbangRantai");

const T = {
  memo: "kencanaprint.tmemospk",
  bast: "kencanaprint.tkesesuaianmap",
  master: "kencanaprint.tkesesuaian",
  bahan: "kencanaprint.tkesesuaianmap_komponen",
  lock: "kencanaprint.tkesesuaianmap_lock",
  barang: "kencanaprint.tbarang_new",
  putus: "kencanaprint.tkesesuaianmap_keputusan",
};

const DIVISI_SPANDUK = 1;
const KTG_BAHAN_UTAMA = "1";
// Kode tjenisbarang untuk "jenis bahan baku". Diisi setelah dikonfirmasi;
// selama kosong, filter jenis tidak dipakai.
const JENIS_BAHAN_BAKU = [];
// Urutan tampil: Bahan, Warna, Gambar, Desain Font, Desain Gambar, Finishing, Ukuran
const KESESUAIAN_SPANDUK = [11, 12, 5, 13, 14, 7, 10];
const KODE_SESUAI_BAHAN = 11; // keterangannya = daftar bahan terpilih
const HARI_BATAS_ON_PROGRESS = 6;
const MAKS_KETERANGAN = 200;
const MAKS_JUMLAH = 99999999.99;
const KEPUTUSAN_VALID = ["LANJUT", "ULANG"];
// BAST "N" = semua baris kesesuaian berstatus N
const SQL_SEMUA_N = `(SELECT COUNT(*) FROM ${T.bast} a WHERE a.mspk_nomor = ? AND a.kode_sesuai IN (${KESESUAIAN_SPANDUK.join(",")})) > 0
  AND (SELECT COUNT(*) FROM ${T.bast} a WHERE a.mspk_nomor = ? AND a.kode_sesuai IN (${KESESUAIAN_SPANDUK.join(",")}) AND a.status <> 'N') = 0`;

// ── util ──
const angkaTidakNegatif = (v, label) => {
  if (v === null || v === undefined || teks(v) === "") return 0;
  const s = teks(v);
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw galat(`${label} harus angka tidak negatif (desimal pakai titik)`);
  }
  const n = Number(s);
  if (n > MAKS_JUMLAH) throw galat(`${label} terlalu besar`);
  return n;
};

const filterJenis = () =>
  JENIS_BAHAN_BAKU.length ? ` AND b.brg_jenis IN (?)` : "";
const paramJenis = () => (JENIS_BAHAN_BAKU.length ? [JENIS_BAHAN_BAKU] : []);

// Ambil MAP + semua guard: ada, divisi 1, sudah CMO, cabang sama (non-superadmin)
const ambilMap = async (conn, nomor, user, kunci = false) => {
  const [[m]] = await conn.query(
    `SELECT m.mspk_nomor, m.mspk_divisi, m.mspk_cab, m.mspk_cmo, m.mspk_nama,
            m.mspk_nama2, m.mspk_ukuran, m.mspk_kain, m.mspk_finishing,
            m.mspk_keterangan, m.mspk_kendala, m.mspk_jumlah_jadi, m.mspk_tipe,
            DATE_FORMAT(m.mspk_tanggal, '%Y-%m-%d') AS mspk_tanggal,
            (SELECT j.jo_nama FROM kencanaprint.tjenisorder j
              WHERE j.jo_kode = m.MSpk_jo_kode AND j.jo_divisi = m.mspk_divisi
              LIMIT 1) AS jenis_order,
            (SELECT GROUP_CONCAT(DISTINCT d.lprd_lpr_nomor
                      ORDER BY d.lprd_lpr_nomor SEPARATOR ', ')
               FROM kencanaprint.tlhk_proof_dtl d
              WHERE d.lprd_spk_nomor = m.mspk_nomor) AS nomor_lhk_proof
       FROM ${T.memo} m WHERE m.mspk_nomor = ? ${kunci ? "FOR UPDATE" : ""}`,
    [nomor],
  );
  if (!m) throw galat(`MAP ${nomor} tidak ditemukan`, "notFound");
  if (Number(m.mspk_divisi) !== DIVISI_SPANDUK) {
    throw galat(`MAP ${nomor} bukan divisi Spanduk`, "forbidden");
  }
  if (teks(m.mspk_cmo) === "") {
    throw galat(`MAP ${nomor} belum disetujui CMO`);
  }
  if (!adalahSuperadmin(user) && norm(m.mspk_cab) !== cabangUser(user)) {
    throw galat(`MAP ${nomor} milik cabang lain`, "forbidden");
  }
  return m;
};

// Ada BAST On Progress di cabang ini yang sudah lewat 6 hari (hanya MAP Spanduk)
const cekBatasOnProgress = async (conn, cab) => {
  const [rows] = await conn.query(
    `SELECT l.map FROM ${T.lock} l
       INNER JOIN ${T.memo} m ON m.mspk_nomor = l.map
      WHERE l.apv = "N" AND l.cab = ? AND m.mspk_divisi = ?
        AND l.tgl <= DATE_SUB(CURDATE(), INTERVAL ${HARI_BATAS_ON_PROGRESS} DAY)
      ORDER BY l.tgl LIMIT 1`,
    [cab, DIVISI_SPANDUK],
  );
  return rows.length
    ? `BAST MAP ${rows[0].map} masih On Progress lebih dari ${HARI_BATAS_ON_PROGRESS} hari. ` +
        `Selesaikan dulu supaya bisa membuat BAST MAP yang baru.`
    : "";
};

// ── LOOKUP ──
const getLookupMap = async (search, user) => {
  const params = [DIVISI_SPANDUK];
  let where = `m.mspk_divisi = ? AND m.mspk_cmo <> ""
    AND NOT EXISTS (SELECT 1 FROM ${T.bast} s WHERE s.mspk_nomor = m.mspk_nomor)`;
  if (!adalahSuperadmin(user)) {
    where += ` AND m.mspk_cab = ?`;
    params.push(cabangUser(user));
  }
  const kata = teks(search);
  if (kata) {
    where += ` AND (m.mspk_nomor LIKE ? OR m.mspk_nama LIKE ? OR m.mspk_nama2 LIKE ?)`;
    const like = `%${kata}%`;
    params.push(like, like, like);
  }
  const [rows] = await db.query(
    `SELECT m.mspk_nomor AS Nomor,
            DATE_FORMAT(m.mspk_tanggal, '%Y-%m-%d') AS Tanggal,
            m.mspk_nama AS NamaPekerjaan, m.mspk_nama2 AS NamaExt,
            m.mspk_ukuran AS Ukuran
       FROM ${T.memo} m
      WHERE ${where}
    ORDER BY m.mspk_tanggal DESC, m.mspk_nomor DESC`,
    params,
  );
  return rows;
};

const getLookupBahan = async (search) => {
  const params = [DIVISI_SPANDUK, KTG_BAHAN_UTAMA, ...paramJenis()];
  let where = `b.brg_divisi = ? AND b.brg_ktg_kode = ? AND b.brg_isaktif = 1${filterJenis()}`;
  const kata = teks(search);
  if (kata) {
    where += ` AND (b.brg_nama LIKE ? OR b.brg_kode LIKE ?)`;
    const like = `%${kata}%`;
    params.push(like, like);
  }
  const [rows] = await db.query(
    `SELECT b.brg_kode AS Kode, b.brg_nama AS Nama, b.brg_satuan AS Satuan
       FROM ${T.barang} b
      WHERE ${where}
      ORDER BY b.brg_nama`,
    params,
  );
  return rows;
};

// ── DETAIL / DATA FORM ── (BAST baru: sudahAda=false, checklist default)
const getFormData = async (nomor, user) => {
  const map = await ambilMap(db, nomor, user);

  const [[ada]] = await db.query(
    `SELECT COUNT(*) AS n FROM ${T.bast} WHERE mspk_nomor = ?`,
    [nomor],
  );
  const sudahAda = Number(ada.n) > 0;
  if (!sudahAda) {
    await pastikanMapPunyaLhk(db, {
      kodeLini: "PROOF",
      nomor: map.mspk_nomor,
    });
  }

  const [checklist] = await db.query(
    `SELECT s.kode_sesuai AS no, s.nama_sesuai AS kesesuaian,
            IFNULL(a.status, "N") AS status, IFNULL(a.keterangan, "-") AS keterangan,
            a.user_create, a.date_create, a.user_modify, a.date_modify
       FROM ${T.master} s
       LEFT JOIN ${T.bast} a ON a.kode_sesuai = s.kode_sesuai AND a.mspk_nomor = ?
      WHERE s.kode_sesuai IN (?)
      ORDER BY FIELD(s.kode_sesuai, ${KESESUAIAN_SPANDUK.join(",")})`,
    [nomor, KESESUAIAN_SPANDUK],
  );
  if (checklist.length !== KESESUAIAN_SPANDUK.length) {
    throw new Error("Master kesesuaian (tkesesuaian) tidak lengkap.");
  }

  const [bahan] = await db.query(
    `SELECT k.kode AS Kode, b.brg_nama AS Nama, b.brg_satuan AS Satuan
       FROM ${T.bahan} k
       LEFT JOIN ${T.barang} b ON b.brg_kode = k.kode
      WHERE k.nomor = ? ORDER BY k.no_urut`,
    [nomor],
  );

  const [[lock]] = await db.query(
    `SELECT map, DATE_FORMAT(tgl, '%Y-%m-%d') AS tgl, cab, apv, approved, alasan
       FROM ${T.lock} WHERE map = ?`,
    [nomor],
  );

  const peringatan = sudahAda
    ? ""
    : await cekBatasOnProgress(db, norm(map.mspk_cab));

  return {
    header: map,
    sudahAda,
    checklist,
    bahan,
    lock: lock || null,
    peringatan,
  };
};

// ── VALIDASI PAYLOAD ──
const siapkanData = (p) => {
  const jumlah = angkaTidakNegatif(p?.jumlahJadi, "Jumlah");
  const kendala = teks(p?.kendala);
  const tipe = teks(p?.tipe);

  if (!Array.isArray(p?.checklist)) throw galat("Data kesesuaian tidak valid");
  const peta = new Map();
  for (const c of p.checklist) {
    const no = Number(c?.no);
    if (!KESESUAIAN_SPANDUK.includes(no)) {
      throw galat(`Kesesuaian ${c?.no} tidak termasuk kesesuaian Spanduk`);
    }
    if (peta.has(no)) throw galat(`Kesesuaian ${no} terkirim ganda`);
    const status = norm(c.status);
    if (!["Y", "N"].includes(status)) {
      throw galat(`Status kesesuaian ${no} harus Y atau N`);
    }
    const ket = teks(c.keterangan) || "-";
    if (ket.length > MAKS_KETERANGAN) {
      throw galat(
        `Keterangan kesesuaian ${no} maksimal ${MAKS_KETERANGAN} karakter`,
      );
    }
    peta.set(no, { no, status, keterangan: ket });
  }
  if (peta.size !== KESESUAIAN_SPANDUK.length) {
    throw galat("Seluruh kesesuaian wajib dikirim");
  }
  const checklist = KESESUAIAN_SPANDUK.map((no) => peta.get(no));

  const bahanIn = Array.isArray(p?.bahan) ? p.bahan : [];
  const kodeBahan = [];
  for (const b of bahanIn) {
    const kode = teks(b?.kode);
    if (!kode) continue;
    if (kodeBahan.includes(kode)) throw galat(`Bahan ${kode} terpilih ganda`);
    kodeBahan.push(kode);
  }

  // Tanpa properti lock di payload: lock tidak disentuh sama sekali
  const lock =
    p?.lock === undefined || p?.lock === null
      ? null
      : {
          aktif: p.lock.aktif === true,
          approved: p.lock.approved === true,
          alasan: teks(p.lock.alasan).slice(0, 100),
        };

  return { jumlah, kendala, tipe, checklist, kodeBahan, lock };
};

const periksaBahan = async (conn, kodeBahan) => {
  if (!kodeBahan.length) return;
  const [rows] = await conn.query(
    `SELECT b.brg_kode FROM ${T.barang} b
      WHERE b.brg_kode IN (?) AND b.brg_divisi = ? AND b.brg_ktg_kode = ?${filterJenis()}`,
    [kodeBahan, DIVISI_SPANDUK, KTG_BAHAN_UTAMA, ...paramJenis()],
  );
  const ada = new Set(rows.map((r) => String(r.brg_kode)));
  const hilang = kodeBahan.filter((k) => !ada.has(k));
  if (hilang.length) {
    throw galat(
      `Bahan tidak valid (bukan bahan baku utama Spanduk): ${hilang.join(", ")}`,
    );
  }
};

// ── SIMPAN (create / update) ──
const simpan = async (mode, nomorUrl, payload, user) => {
  const nomor = teks(mode === "create" ? payload?.nomor : nomorUrl);
  if (!nomor) throw galat("Nomor MAP wajib diisi");
  const d = siapkanData(payload);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const map = await ambilMap(conn, nomor, user, true);
    if (mode === "update") {
      const [serah] = await conn.query(
        `SELECT mmkd_nomor FROM kencanaprint.tmutasi_marketing_spanduk_dtl
         WHERE mmkd_mspk_nomor = ? LIMIT 1`,
        [nomor],
      );
      if (serah.length > 0) {
        throw galat(
          `BAST tidak bisa diubah: MAP sudah diserahkan ke marketing (${serah[0].mmkd_nomor})`,
        );
      }
    }
    const [[ada]] = await conn.query(
      `SELECT COUNT(*) AS n FROM ${T.bast} WHERE mspk_nomor = ?`,
      [nomor],
    );
    const sudahAda = Number(ada.n) > 0;

    if (mode === "create") {
      if (sudahAda)
        throw galat(`MAP ${nomor} sudah memiliki BAST. Gunakan ubah.`);
      const pesan = await cekBatasOnProgress(conn, norm(map.mspk_cab));
      if (pesan) throw galat(pesan);
      await pastikanMapPunyaLhk(conn, {
        kodeLini: "PROOF",
        nomor: map.mspk_nomor,
      });
    } else if (!sudahAda) {
      throw galat(`BAST untuk MAP ${nomor} tidak ditemukan`, "notFound");
    }

    await periksaBahan(conn, d.kodeBahan);

    // Keterangan baris Bahan = nama bahan terpilih (dibuat server)
    const baris = d.checklist.find((c) => c.no === KODE_SESUAI_BAHAN);
    if (baris) {
      if (d.kodeBahan.length > 0) {
        const [nm] = await conn.query(
          `SELECT brg_kode, brg_nama FROM ${T.barang} WHERE brg_kode IN (?)`,
          [d.kodeBahan],
        );
        const peta = new Map(
          nm.map((r) => [String(r.brg_kode), String(r.brg_nama ?? "").trim()]),
        );
        baris.keterangan = d.kodeBahan
          .map((k) => peta.get(k) ?? k)
          .join(", ")
          .slice(0, MAKS_KETERANGAN);
      } else {
        baris.keterangan = "-";
      }
    }

    // 1. Header MAP
    await conn.query(
      `UPDATE ${T.memo}
          SET mspk_jumlah_jadi = ?, mspk_kendala = ?, mspk_bastnew = 1
        WHERE mspk_nomor = ?`,
      [d.jumlah, d.kendala, nomor],
    );

    // 2. Kesesuaian (upsert; user_create/date_create tidak ditimpa)
    for (const c of d.checklist) {
      await conn.query(
        `INSERT INTO ${T.bast}
           (mspk_nomor, kode_sesuai, status, keterangan, user_create, date_create)
         VALUES (?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           status = VALUES(status), keterangan = VALUES(keterangan),
           user_modify = ?, date_modify = NOW()`,
        [nomor, c.no, c.status, c.keterangan, user.kode, user.kode],
      );
    }

    // Status bisa berubah, jadi keputusan lama tidak berlaku lagi
    if (mode === "update") {
      await conn.query(`DELETE FROM ${T.putus} WHERE map = ?`, [nomor]);
    }

    // 3. Bahan (hapus lalu isi ulang; komponen/warna/babaran tidak dipakai Spanduk)
    await conn.query(`DELETE FROM ${T.bahan} WHERE nomor = ?`, [nomor]);
    for (let i = 0; i < d.kodeBahan.length; i++) {
      await conn.query(
        `INSERT INTO ${T.bahan}
           (nomor, kode, komponen, warna, babaran, babarank, no_urut, date_create)
         VALUES (?, ?, "", "", 0, 0, ?, NOW())`,
        [nomor, d.kodeBahan[i], i + 1],
      );
    }

    // 4. Lock / On Progress (hanya jika dikirim; aturannya belum diputuskan)
    if (d.lock) {
      const cabLock = norm(map.mspk_cab);
      if (d.lock.aktif && !d.lock.approved) {
        await conn.query(
          `INSERT INTO ${T.lock} (map, tgl, cab) VALUES (?, CURDATE(), ?)
           ON DUPLICATE KEY UPDATE apv = "N"`,
          [nomor, cabLock],
        );
      } else if (d.lock.approved) {
        const [r] = await conn.query(
          `UPDATE ${T.lock} SET apv = "Y", alasan = ?, approved = ? WHERE map = ?`,
          [d.lock.alasan, user.kode, nomor],
        );
        if (!r.affectedRows) {
          throw galat("BAST belum On Progress, tidak ada yang bisa di-approve");
        }
      } else {
        await conn.query(
          `UPDATE ${T.lock} SET apv = "Y", alasan = "", approved = "" WHERE map = ?`,
          [nomor],
        );
      }
    }

    await conn.commit();
    return nomor;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

const create = (payload, user) => simpan("create", null, payload, user);
const update = (nomor, payload, user) => simpan("update", nomor, payload, user);

// ── DATA CETAK ──
const getPrintData = async (nomor, user) => {
  const map = await ambilMap(db, nomor, user);

  const [details] = await db.query(
    `SELECT a.kode_sesuai AS no, s.nama_sesuai AS kesesuaian,
            a.status, a.keterangan
       FROM ${T.bast} a
       INNER JOIN ${T.master} s ON s.kode_sesuai = a.kode_sesuai
      WHERE a.mspk_nomor = ? AND a.kode_sesuai IN (?)
      ORDER BY FIELD(a.kode_sesuai, ${KESESUAIAN_SPANDUK.join(",")})`,
    [nomor, KESESUAIAN_SPANDUK],
  );
  if (details.length === 0) {
    throw galat(`MAP ${nomor} belum memiliki BAST`, "notFound");
  }

  return { header: map, details };
};

// ── KEPUTUSAN BAST N (lanjut / produksi ulang) ──
const setKeputusan = async (nomorUrl, payload, user) => {
  const nomor = teks(nomorUrl);
  const keputusan = norm(payload?.keputusan);
  const alasan = teks(payload?.alasan);
  if (!KEPUTUSAN_VALID.includes(keputusan)) {
    throw galat("Keputusan harus LANJUT atau ULANG");
  }
  if (!alasan) throw galat("Alasan wajib diisi");
  if (alasan.length > 200) throw galat("Alasan maksimal 200 karakter");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await ambilMap(conn, nomor, user, true);

    const [[sn]] = await conn.query(`SELECT ${SQL_SEMUA_N} AS ok`, [
      nomor,
      nomor,
    ]);
    if (!Number(sn.ok)) {
      throw galat("Keputusan hanya untuk BAST yang seluruh kesesuaiannya N");
    }
    const [serah] = await conn.query(
      `SELECT mmkd_nomor FROM kencanaprint.tmutasi_marketing_spanduk_dtl
       WHERE mmkd_mspk_nomor = ? LIMIT 1`,
      [nomor],
    );
    if (serah.length > 0) {
      throw galat(`MAP sudah diserahkan ke marketing (${serah[0].mmkd_nomor})`);
    }

    await conn.query(
      `INSERT INTO ${T.putus} (map, keputusan, alasan, user_putus, tgl_putus)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE keputusan = VALUES(keputusan),
         alasan = VALUES(alasan), user_putus = VALUES(user_putus),
         tgl_putus = VALUES(tgl_putus)`,
      [nomor, keputusan, alasan, user.kode],
    );
    await conn.commit();
    return nomor;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = {
  getLookupMap,
  getLookupBahan,
  getFormData,
  getPrintData,
  create,
  update,
  setKeputusan,
  KESESUAIAN_SPANDUK,
};
