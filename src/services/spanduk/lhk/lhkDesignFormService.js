const db = require("../../../config/database");
const {
  galat,
  teks,
  norm,
  round2,
  angka,
  MAKS_ANGKA,
  parseTanggal,
  adalahSuperadmin,
  cabangUser,
  cekTutupBuku,
  DIVISI_BOLEH,
} = require("./lhkCommon");
const {
  T,
  TIPE,
  pastikanBelumDipakai,
  periksaSumber,
} = require("./lhkDesignShared");

const STATUS_MULAI = "ON PROGRESS";
const STATUS_SELESAI = "DONE";

// Pilihan tetap kolom Bahan (ldk_bahan). Tambah/ubah daftar di sini saja.
const DAFTAR_BAHAN = ["SETTING", "KERTAS ROLL", "PROVE ULANG"];

const TABEL = {
  userDesign: "kencanaprint.tuserdesign",
  mesin: "kencanaprint.tmesin_mmt",
  pabrik: "kencanaprint.tpabrik",
};

const MAKS_BARIS_LOOKUP = 50;
const MAKS_KETERANGAN = 200; // ldk_keterangan char(200)
const MAKS_CATATAN = 100; // lds_note varchar(100)
const MAKS_KODE_STATUS = 10; // lds_user, lds_cabang varchar(10)
const MAKS_TOTAL = 10; // ldk_output char(10)

// SPK/MAP yang boleh dipakai: aktif dan sudah CMO (mengikuti Delphi)
const SQL_SUMBER = `
  SELECT spk_nomor AS nomor, spk_nama AS nama, 'SPK' AS jenis,
         DATE_FORMAT(spk_tanggal, '%Y-%m-%d') AS tanggal,
         DATE_FORMAT(spk_dateline, '%Y-%m-%d') AS dateline,
         spk_finishing AS finishing, spk_divisi AS divisi, spk_cab AS cab
  FROM ${T.spk}
  WHERE spk_aktif = 'Y' AND spk_cmo <> ''
  UNION ALL
  SELECT mspk_nomor, mspk_nama, 'MAP',
         DATE_FORMAT(mspk_tanggal, '%Y-%m-%d'),
         DATE_FORMAT(mspk_dateline, '%Y-%m-%d'),
         mspk_finishing, mspk_divisi, mspk_cab
  FROM ${T.memoSpk}
  WHERE mspk_cmo <> ''`;

const ambilSumber = async (q, nomor, user) => {
  const [rows] = await q.query(
    `SELECT x.* FROM (${SQL_SUMBER}) x WHERE x.nomor = ? LIMIT 1`,
    [nomor],
  );
  if (rows.length === 0) {
    throw galat(
      `SPK/MAP ${nomor} tidak ditemukan, belum CMO, atau tidak aktif`,
      "notFound",
    );
  }
  periksaSumber(rows[0], nomor, user);
  return rows[0];
};

// --- LOOKUP ---
const getLookupSpk = async (search, user) => {
  const kata = teks(search);
  const kondisi = ["x.divisi IN (?)"];
  const params = [DIVISI_BOLEH];
  if (kata) {
    kondisi.push("(x.nomor LIKE ? OR x.nama LIKE ?)");
    params.push(`%${kata}%`, `%${kata}%`);
  }
  if (!adalahSuperadmin(user)) {
    kondisi.push("UPPER(TRIM(x.cab)) = ?");
    params.push(cabangUser(user));
  }
  const [rows] = await db.query(
    `SELECT x.nomor AS Nomor, x.nama AS Nama, x.jenis AS Jenis,
            x.tanggal AS Tanggal, x.dateline AS Dateline,
            x.finishing AS Finishing
     FROM (${SQL_SUMBER}) x
     WHERE ${kondisi.join(" AND ")}
     ORDER BY x.tanggal DESC, x.nomor DESC
     LIMIT ${MAKS_BARIS_LOOKUP}`,
    params,
  );
  return rows;
};

// Kode = cabang designer, Designer = nilai yang disimpan di lds_user
const getLookupDesigner = async () => {
  const [rows] = await db.query(
    `SELECT u.des_cabang AS Kode, p.pab_nama AS Nama, u.des_nama AS Designer
     FROM ${TABEL.userDesign} u
     LEFT JOIN ${TABEL.pabrik} p ON p.pab_kode = u.des_cabang
     ORDER BY u.des_cabang, u.des_nama`,
  );
  return rows;
};

const getLookupMesin = async () => {
  const [rows] = await db.query(
    `SELECT msn_kode AS Kode, msn_nama AS Nama, msn_note AS Keterangan
     FROM ${TABEL.mesin}
     WHERE msn_jenis = 'P'
     ORDER BY msn_kode`,
  );
  return rows;
};

const getLookupBahan = () => DAFTAR_BAHAN.map((b) => ({ Kode: b }));

// --- LOAD ---
const getLhkDesignById = async (nomor, user) => {
  const no = teks(nomor);
  const info = await ambilSumber(db, no, user);

  const [hdr] = await db.query(
    `SELECT DATE_FORMAT(ld_tanggal, '%Y-%m-%d') AS Tanggal,
            user_create AS User_Create
     FROM ${T.hdr} WHERE ld_spk = ? AND ld_tipe = ?`,
    [no, TIPE],
  );

  const [status] = await db.query(
    `SELECT lds_cabang AS Kode_Cabang, lds_user AS Designer,
            lds_status AS Status,
            DATE_FORMAT(lds_tgl, '%Y-%m-%d') AS Tanggal,
            DATE_FORMAT(lds_tgl, '%H:%i:%s') AS Jam,
            lds_durasi AS Durasi, lds_note AS Catatan
     FROM ${T.status}
     WHERE lds_spk = ? AND lds_tipe = ?
     ORDER BY lds_tgl, FIELD(lds_status, '${STATUS_MULAI}', '${STATUS_SELESAI}')`,
    [no, TIPE],
  );

  const [komponen] = await db.query(
    `SELECT ldk_bahan AS Bahan, ldk_panjang AS Panjang, ldk_jumlah AS Jumlah,
            ldk_output AS Total, ldk_c AS C, ldk_m AS M, ldk_y AS Y,
            ldk_k AS K, ldk_mesin AS Mesin, ldk_keterangan AS Keterangan
     FROM ${T.komponen}
     WHERE ldk_spk = ? AND ldk_tipe = ?`,
    [no, TIPE],
  );

  const [[waktu]] = await db.query(
    "SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS sekarang",
  );

  return {
    Nomor: info.nomor,
    Jenis: info.jenis,
    Nama_SPK: info.nama,
    Tanggal_SPK: info.tanggal,
    Dateline: info.dateline,
    Finishing: info.finishing,
    Ada: hdr.length > 0,
    Tanggal_LHK: hdr[0]?.Tanggal ?? null,
    User_Create: hdr[0]?.User_Create ?? null,
    Status_Terakhir: status.length ? status[status.length - 1].Status : null,
    Status: status,
    Komponen: komponen.map((k) => ({ ...k, Total: Number(k.Total) || 0 })),
    Server_Sekarang: waktu.sekarang,
  };
};

// --- VALIDASI KOMPONEN ---
const KOLOM_ANGKA = ["Panjang", "Jumlah", "C", "M", "Y", "K"];

const barisKosong = (d) =>
  !teks(d?.Bahan) &&
  !teks(d?.Mesin) &&
  !teks(d?.Keterangan) &&
  KOLOM_ANGKA.every((k) => !teks(d?.[k]) || Number(teks(d[k])) === 0);

// Total Output dihitung server: panjang x jumlah (kosong bila 0, seperti Delphi)
const siapkanKomponen = (daftar) => {
  const sumber = Array.isArray(daftar) ? daftar : [];
  const hasil = [];
  sumber.forEach((d, i) => {
    if (barisKosong(d)) {
      return;
    }
    const n = i + 1;
    const bahan = norm(d?.Bahan);
    if (!bahan) {
      throw galat(`Baris ${n}: Bahan wajib diisi`);
    }
    if (!DAFTAR_BAHAN.includes(bahan)) {
      throw galat(
        `Baris ${n}: Bahan harus salah satu dari ${DAFTAR_BAHAN.join(", ")}`,
      );
    }
    const keterangan = teks(d?.Keterangan);
    if (keterangan.length > MAKS_KETERANGAN) {
      throw galat(
        `Baris ${n}: Keterangan maksimal ${MAKS_KETERANGAN} karakter`,
      );
    }
    const panjang = angka(d?.Panjang, `Baris ${n}: Panjang Output`);
    const jumlah = angka(d?.Jumlah, `Baris ${n}: Jumlah Output`);
    const total = round2(panjang * jumlah);
    if (total > MAKS_ANGKA) {
      throw galat(`Baris ${n}: Total Output terlalu besar`);
    }
    const teksTotal = total > 0 ? String(total) : "";
    if (teksTotal.length > MAKS_TOTAL) {
      throw galat(`Baris ${n}: Total Output terlalu besar`);
    }
    hasil.push({
      baris: n,
      bahan,
      panjang,
      jumlah,
      total: teksTotal,
      c: angka(d?.C, `Baris ${n}: C`),
      m: angka(d?.M, `Baris ${n}: M`),
      y: angka(d?.Y, `Baris ${n}: Y`),
      k: angka(d?.K, `Baris ${n}: K`),
      mesin: teks(d?.Mesin),
      keterangan,
    });
  });
  return hasil;
};

// Mesin (bila diisi) harus ada di master mesin jenis Plotter; simpan nilai master
const validasiMesin = async (q, komponen) => {
  const kode = [...new Set(komponen.map((k) => k.mesin).filter(Boolean))];
  if (kode.length === 0) {
    return;
  }
  const [rows] = await q.query(
    `SELECT msn_kode FROM ${TABEL.mesin}
     WHERE msn_jenis = 'P' AND msn_kode IN (?)`,
    [kode],
  );
  const peta = new Map(rows.map((r) => [norm(r.msn_kode), teks(r.msn_kode)]));
  for (const k of komponen) {
    if (!k.mesin) {
      continue;
    }
    const nilai = peta.get(norm(k.mesin));
    if (!nilai) {
      throw galat(
        `Baris ${k.baris}: mesin ${k.mesin} tidak ada di master mesin`,
      );
    }
    k.mesin = nilai;
  }
};

// --- SIMPAN (tanggal LHK + komponen) ---
// Header dibuat oleh Mulai; Simpan hanya mengubah tanggal dan mengganti komponen.
const simpanLhkDesign = async (nomor, body = {}, user) => {
  const no = teks(nomor);
  const tanggal = parseTanggal(body.Tanggal);
  const komponen = siapkanKomponen(body.Komponen);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await ambilSumber(conn, no, user);

    const [lama] = await conn.query(
      `SELECT DATE_FORMAT(ld_tanggal, '%Y-%m-%d') AS tgl
       FROM ${T.hdr} WHERE ld_spk = ? AND ld_tipe = ? FOR UPDATE`,
      [no, TIPE],
    );
    if (lama.length === 0) {
      throw galat("LHK Design belum dimulai. Tekan Mulai terlebih dahulu.");
    }

    if (lama[0].tgl) {
      await cekTutupBuku(lama[0].tgl);
    }
    await cekTutupBuku(tanggal);
    await pastikanBelumDipakai(conn, no, user);
    await validasiMesin(conn, komponen);

    await conn.query(
      `UPDATE ${T.hdr}
       SET ld_tanggal = ?, user_modified = ?, date_modified = NOW()
       WHERE ld_spk = ? AND ld_tipe = ?`,
      [tanggal, user?.kode ?? "", no, TIPE],
    );

    await conn.query(
      `DELETE FROM ${T.komponen} WHERE ldk_spk = ? AND ldk_tipe = ?`,
      [no, TIPE],
    );
    if (komponen.length > 0) {
      await conn.query(
        `INSERT INTO ${T.komponen}
           (ldk_spk, ldk_output, ldk_panjang, ldk_jumlah, ldk_bahan,
            ldk_mesin, ldk_keterangan, ldk_tipe, ldk_c, ldk_m, ldk_y, ldk_k)
         VALUES ?`,
        [
          komponen.map((k) => [
            no,
            k.total,
            k.panjang,
            k.jumlah,
            k.bahan,
            k.mesin,
            k.keterangan,
            TIPE,
            k.c,
            k.m,
            k.y,
            k.k,
          ]),
        ],
      );
    }

    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
  return getLhkDesignById(no, user);
};

// --- STOPWATCH ---
// Cabang + designer harus pasangan yang ada di master user design
const siapkanPelaku = async (q, body) => {
  const cabang = teks(body?.Kode_Cabang);
  const designer = teks(body?.Designer);
  if (!cabang || !designer) {
    throw galat("Cabang dan designer wajib dipilih");
  }
  const [rows] = await q.query(
    `SELECT des_cabang, des_nama FROM ${TABEL.userDesign}
     WHERE des_cabang = ? AND des_nama = ? LIMIT 1`,
    [cabang, designer],
  );
  if (rows.length === 0) {
    throw galat("Designer tidak terdaftar di master user design");
  }
  const hasil = {
    cabang: teks(rows[0].des_cabang),
    designer: teks(rows[0].des_nama),
  };
  if (
    hasil.cabang.length > MAKS_KODE_STATUS ||
    hasil.designer.length > MAKS_KODE_STATUS
  ) {
    throw galat(
      `Kode cabang/nama designer melebihi ${MAKS_KODE_STATUS} karakter, tidak bisa disimpan`,
    );
  }
  return hasil;
};

const siapkanCatatan = (v) => {
  const s = teks(v);
  if (s.length > MAKS_CATATAN) {
    throw galat(`Catatan maksimal ${MAKS_CATATAN} karakter`);
  }
  return s;
};

// Status paling baru; bila satu detik sama, DONE dianggap lebih akhir
const statusTerakhir = async (q, no) => {
  const [rows] = await q.query(
    `SELECT lds_status AS status,
            DATE_FORMAT(lds_tgl, '%Y-%m-%d %H:%i:%s') AS tgl
     FROM ${T.status}
     WHERE lds_spk = ? AND lds_tipe = ?
     ORDER BY lds_tgl DESC, FIELD(lds_status, '${STATUS_SELESAI}', '${STATUS_MULAI}')
     LIMIT 1`,
    [no, TIPE],
  );
  return rows[0] ?? null;
};

const SQL_HDR_KUNCI = `SELECT DATE_FORMAT(ld_tanggal, '%Y-%m-%d') AS tgl
  FROM ${T.hdr} WHERE ld_spk = ? AND ld_tipe = ? FOR UPDATE`;

// Mulai: membuat header LHK (tanggal = hari ini) bila belum ada, lalu catat ON PROGRESS
const mulaiLhkDesign = async (nomor, body = {}, user) => {
  const no = teks(nomor);
  const catatan = siapkanCatatan(body.Catatan);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await ambilSumber(conn, no, user);
    const pelaku = await siapkanPelaku(conn, body);

    // Kunci rantai: Design yang sudah punya lini berikutnya tidak boleh dibuka
    // lagi. Sebelum header dibuat, supaya Mulai pertama tidak ikut terkunci.
    await pastikanBelumDipakai(conn, no, user);

    let [hdr] = await conn.query(SQL_HDR_KUNCI, [no, TIPE]);
    if (hdr.length === 0) {
      const [[hari]] = await conn.query(
        "SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS tgl",
      );
      await cekTutupBuku(hari.tgl);
      await conn.query(
        `INSERT INTO ${T.hdr}
           (ld_spk, ld_tanggal, user_create, date_create, ld_tipe)
         VALUES (?, CURDATE(), ?, NOW(), ?)
         ON DUPLICATE KEY UPDATE ld_spk = ld_spk`,
        [no, user?.kode ?? "", TIPE],
      );
      [hdr] = await conn.query(SQL_HDR_KUNCI, [no, TIPE]);
    } else if (hdr[0].tgl) {
      await cekTutupBuku(hdr[0].tgl);
    }

    const terakhir = await statusTerakhir(conn, no);
    if (terakhir?.status === STATUS_MULAI) {
      throw galat(
        `Pekerjaan sudah berjalan (${STATUS_MULAI}). Tekan Selesai bila sudah selesai.`,
      );
    }

    await conn.query(
      `INSERT INTO ${T.status}
         (lds_spk, lds_cabang, lds_user, lds_status, lds_tgl,
          lds_durasi, lds_note, lds_tipe)
       VALUES (?, ?, ?, ?, NOW(), '', ?, ?)`,
      [no, pelaku.cabang, pelaku.designer, STATUS_MULAI, catatan, TIPE],
    );

    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
  return getLhkDesignById(no, user);
};

// Selesai: catat DONE; durasi (HH:MM:SS) = selisih dari ON PROGRESS terakhir, jam server
const selesaiLhkDesign = async (nomor, body = {}, user) => {
  const no = teks(nomor);
  const catatan = siapkanCatatan(body.Catatan);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await ambilSumber(conn, no, user);
    const pelaku = await siapkanPelaku(conn, body);

    const [hdr] = await conn.query(SQL_HDR_KUNCI, [no, TIPE]);
    if (hdr.length === 0) {
      throw galat("LHK Design belum dimulai. Tekan Mulai terlebih dahulu.");
    }
    if (hdr[0].tgl) {
      await cekTutupBuku(hdr[0].tgl);
    }

    const terakhir = await statusTerakhir(conn, no);
    if (!terakhir || terakhir.status !== STATUS_MULAI) {
      throw galat(
        terakhir
          ? `Pekerjaan sudah ${STATUS_SELESAI}. Tekan Mulai bila dikerjakan ulang.`
          : `Belum ada status ${STATUS_MULAI}. Tekan Mulai terlebih dahulu.`,
      );
    }

    await conn.query(
      `INSERT INTO ${T.status}
         (lds_spk, lds_cabang, lds_user, lds_status, lds_tgl,
          lds_durasi, lds_note, lds_tipe)
       VALUES (?, ?, ?, ?, NOW(),
               TIME_FORMAT(SEC_TO_TIME(TIMESTAMPDIFF(SECOND, ?, NOW())), '%H:%i:%s'),
               ?, ?)`,
      [
        no,
        pelaku.cabang,
        pelaku.designer,
        STATUS_SELESAI,
        terakhir.tgl,
        catatan,
        TIPE,
      ],
    );

    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
  return getLhkDesignById(no, user);
};

module.exports = {
  getLookupSpk,
  getLookupDesigner,
  getLookupMesin,
  getLookupBahan,
  getLhkDesignById,
  simpanLhkDesign,
  mulaiLhkDesign,
  selesaiLhkDesign,
};
