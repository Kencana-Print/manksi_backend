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
  userDesign: "tuserdesign",
  mesin: "tmesin_mmt",
  pabrik: "tpabrik",
  sesi: "tlhkdesign_sesi",
  sesiPause: "tlhkdesign_sesi_pause",
  sesiMap: "tlhkdesign_sesi_map",
};

const MAKS_BARIS_LOOKUP = 50;
const MAKS_KETERANGAN = 200; // ldk_keterangan char(200)
const MAKS_CATATAN = 100; // lds_note varchar(100)
const MAKS_KODE_STATUS = 10; // lds_user, lds_cabang varchar(10)
const MAKS_TOTAL = 10; // ldk_output char(10)
const PREFIX_NOMOR = "LHK-D";
const NOMOR_LOCK = "lhk_design_nomor";
const SESI_AKTIF = ["BERJALAN", "PAUSE"];
const BATAS_PAUSE_MENIT = 30;
const MAKS_MAP_SESI = 20; // batas wajar tab per timer; ubah di sini bila perlu
const MAKS_ALASAN = 100; // sp_alasan varchar(100)
const FMT = "'%Y-%m-%d %H:%i:%s'";

const SQL_HDR_KUNCI = `SELECT DATE_FORMAT(ld_tanggal, '%Y-%m-%d') AS tgl,
         ld_nomor AS nomor
  FROM ${T.hdr} WHERE ld_spk = ? AND ld_tipe = ? FOR UPDATE`;

const STATUS_SESI = { SELESAI: "SELESAI" };

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
            user_create AS User_Create, ld_nomor AS Nomor_LHK
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
    Nomor_LHK: hdr[0]?.Nomor_LHK ?? null,
    Tanggal_LHK: hdr[0]?.Tanggal ?? null,
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
const simpanSatu = async (conn, no, tanggal, komponen, user) => {
  await ambilSumber(conn, no, user);

  const [lama] = await conn.query(SQL_HDR_KUNCI, [no, TIPE]);
  if (lama.length === 0) {
    throw galat(`LHK Design ${no} belum dimulai. Tekan Mulai terlebih dahulu.`);
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
};

const dalamTransaksi = async (fn) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const hasil = await fn(conn);
    await conn.commit();
    return hasil;
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
};

// Satu MAP (dipakai bila LHK dibuka tersendiri dari browse)
const simpanLhkDesign = async (nomor, body = {}, user) => {
  const no = teks(nomor);
  const tanggal = parseTanggal(body.Tanggal);
  const komponen = siapkanKomponen(body.Komponen);
  await dalamTransaksi((conn) => simpanSatu(conn, no, tanggal, komponen, user));
  return getLhkDesignById(no, user);
};

// Beberapa tab sekaligus: tanggal sama, semua atau tidak sama sekali
// Body: { Tanggal, Daftar: [{ Nomor_SPK, Komponen: [...] }] }
const simpanLhkDesignBatch = async (body = {}, user) => {
  const tanggal = parseTanggal(body.Tanggal);
  const daftar = Array.isArray(body.Daftar) ? body.Daftar : [];
  if (daftar.length === 0) {
    throw galat("Minimal satu SPK/MAP harus disimpan");
  }
  const sudah = new Set();
  const item = daftar.map((d, i) => {
    const no = teks(d?.Nomor_SPK);
    if (!no) {
      throw galat(`Tab ${i + 1}: nomor SPK/MAP wajib diisi`);
    }
    if (sudah.has(norm(no))) {
      throw galat(`Tab ${i + 1}: SPK/MAP ${no} muncul lebih dari sekali`);
    }
    sudah.add(norm(no));
    return { no, komponen: siapkanKomponen(d.Komponen) };
  });

  await dalamTransaksi(async (conn) => {
    for (const x of item) {
      await simpanSatu(conn, x.no, tanggal, x.komponen, user);
    }
  });
  return item.map((x) => x.no);
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

// --- SESI TIMER ---
const siapkanAlasan = (v) => {
  const s = teks(v);
  if (!s) {
    throw galat("Alasan pause wajib diisi");
  }
  if (s.length > MAKS_ALASAN) {
    throw galat(`Alasan pause maksimal ${MAKS_ALASAN} karakter`);
  }
  return s;
};

const siapkanDaftarSpk = (daftar) => {
  const list = Array.isArray(daftar)
    ? daftar.map((v) => teks(v)).filter(Boolean)
    : [];
  if (list.length === 0) {
    throw galat("Minimal satu SPK/MAP harus dipilih");
  }
  if (list.length > MAKS_MAP_SESI) {
    throw galat(`Maksimal ${MAKS_MAP_SESI} SPK/MAP dalam satu timer`);
  }
  const sudah = new Set();
  for (const no of list) {
    if (no.length > 20) {
      throw galat(`Nomor SPK/MAP ${no} maksimal 20 karakter`);
    }
    if (sudah.has(norm(no))) {
      throw galat(`SPK/MAP ${no} dipilih lebih dari sekali`);
    }
    sudah.add(norm(no));
  }
  return list;
};

const formatDurasi = (detik) => {
  const d = Math.max(0, Math.floor(Number(detik) || 0));
  const jam = String(Math.floor(d / 3600)).padStart(2, "0");
  const menit = String(Math.floor((d % 3600) / 60)).padStart(2, "0");
  const dtk = String(d % 60).padStart(2, "0");
  return `${jam}:${menit}:${dtk}`;
};

// LHK-D.yymm.NNNN, dipanggil di dalam GET_LOCK + transaksi
const buatNomor = async (conn, tanggalStr) => {
  const yymm = tanggalStr.slice(2, 4) + tanggalStr.slice(5, 7);
  const prefix = `${PREFIX_NOMOR}.${yymm}.`;
  const [rows] = await conn.query(
    `SELECT MAX(CAST(RIGHT(ld_nomor, 4) AS UNSIGNED)) AS mx
     FROM ${T.hdr} WHERE ld_nomor LIKE ?`,
    [`${prefix}%`],
  );
  const next = (Number(rows[0]?.mx) || 0) + 1;
  if (next > 9999) {
    throw galat("Nomor LHK Design bulan ini sudah mencapai batas (9999)");
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
};

// Sesi milik user yang membuatnya (superadmin bebas)
const ambilSesi = async (q, id, user) => {
  const s = teks(id);
  if (!/^\d+$/.test(s)) {
    throw galat("ID sesi timer tidak valid");
  }
  const [rows] = await q.query(
    `SELECT sesi_id, sesi_cabang, sesi_user, sesi_login, sesi_status,
            DATE_FORMAT(sesi_mulai, ${FMT}) AS mulai
     FROM ${TABEL.sesi} WHERE sesi_id = ? FOR UPDATE`,
    [Number(s)],
  );
  if (rows.length === 0) {
    throw galat("Sesi timer tidak ditemukan", "notFound");
  }
  if (
    !adalahSuperadmin(user) &&
    norm(rows[0].sesi_login) !== norm(user?.kode)
  ) {
    throw galat("Sesi timer ini milik user lain", "forbidden");
  }
  return rows[0];
};

const pastikanAktif = (sesi) => {
  if (!SESI_AKTIF.includes(sesi.sesi_status)) {
    throw galat(`Sesi timer sudah ${sesi.sesi_status}`);
  }
};

// Pause yang masih terbuka ditutup (waktu pause tidak dihitung ke durasi)
const tutupPauseTerbuka = async (conn, sesiId) => {
  const [rows] = await conn.query(
    `SELECT sp_id, TIMESTAMPDIFF(SECOND, sp_mulai, NOW()) AS detik
     FROM ${TABEL.sesiPause}
     WHERE sp_sesi = ? AND sp_selesai IS NULL FOR UPDATE`,
    [sesiId],
  );
  for (const r of rows) {
    await conn.query(
      `UPDATE ${TABEL.sesiPause} SET sp_selesai = NOW() WHERE sp_id = ?`,
      [r.sp_id],
    );
    await conn.query(
      `UPDATE ${TABEL.sesi}
       SET sesi_pause_detik = sesi_pause_detik + ? WHERE sesi_id = ?`,
      [Number(r.detik), sesiId],
    );
  }
};

// Status sesi untuk UI. Durasi bersih dihitung server; UI hanya menghitung
// mundur dari Server_Sekarang.
const bacaSesi = async (q, id) => {
  const [rows] = await q.query(
    `SELECT sesi_id, sesi_cabang, sesi_user, sesi_status, sesi_note,
            DATE_FORMAT(sesi_mulai, ${FMT}) AS mulai,
            DATE_FORMAT(sesi_selesai, ${FMT}) AS selesai,
            sesi_pause_detik AS jeda, sesi_durasi_detik AS durasi,
            TIMESTAMPDIFF(SECOND, sesi_mulai, NOW()) AS total,
            DATE_FORMAT(NOW(), ${FMT}) AS sekarang
     FROM ${TABEL.sesi} WHERE sesi_id = ?`,
    [id],
  );
  if (rows.length === 0) {
    throw galat("Sesi timer tidak ditemukan", "notFound");
  }
  const s = rows[0];

  const [pauseRows] = await q.query(
    `SELECT sp_alasan AS alasan, DATE_FORMAT(sp_mulai, ${FMT}) AS mulai,
            TIMESTAMPDIFF(SECOND, sp_mulai, NOW()) AS detik
     FROM ${TABEL.sesiPause}
     WHERE sp_sesi = ? AND sp_selesai IS NULL
     ORDER BY sp_id DESC LIMIT 1`,
    [id],
  );
  const pauseAktif = pauseRows[0]
    ? {
        Mulai: pauseRows[0].mulai,
        Alasan: pauseRows[0].alasan,
        Berjalan_Detik: Number(pauseRows[0].detik),
        Sisa_Detik: Math.max(
          0,
          BATAS_PAUSE_MENIT * 60 - Number(pauseRows[0].detik),
        ),
      }
    : null;

  const [maps] = await q.query(
    `SELECT m.sm_spk AS Nomor_SPK, h.ld_nomor AS Nomor_LHK,
            m.sm_porsi AS Porsi_Persen, m.sm_durasi AS Durasi_Detik
     FROM ${TABEL.sesiMap} m
     LEFT JOIN ${T.hdr} h ON h.ld_spk = m.sm_spk AND h.ld_tipe = ?
     WHERE m.sm_sesi = ?
     ORDER BY m.sm_urut`,
    [TIPE, id],
  );
  const [nama] = maps.length
    ? await q.query(
        `SELECT x.nomor, x.nama FROM (${SQL_SUMBER}) x WHERE x.nomor IN (?)`,
        [maps.map((m) => m.Nomor_SPK)],
      )
    : [[]];
  const petaNama = new Map(nama.map((n) => [norm(n.nomor), n.nama]));

  let bersih = null;
  if (s.sesi_status === STATUS_SESI.SELESAI) {
    bersih = Number(s.durasi);
  } else if (SESI_AKTIF.includes(s.sesi_status)) {
    bersih = Math.max(
      0,
      Number(s.total) - Number(s.jeda) - (pauseAktif?.Berjalan_Detik ?? 0),
    );
  }

  return {
    Sesi_Id: s.sesi_id,
    Status: s.sesi_status,
    Kode_Cabang: s.sesi_cabang,
    Designer: s.sesi_user,
    Catatan: s.sesi_note,
    Mulai: s.mulai,
    Selesai: s.selesai,
    Server_Sekarang: s.sekarang,
    Pause_Detik: Number(s.jeda),
    Pause_Aktif: pauseAktif,
    Batas_Pause_Menit: BATAS_PAUSE_MENIT,
    Durasi_Bersih_Detik: bersih,
    Daftar: maps.map((m) => ({
      Nomor_SPK: m.Nomor_SPK,
      Nomor_LHK: m.Nomor_LHK,
      Nama_SPK: petaNama.get(norm(m.Nomor_SPK)) ?? "",
      Porsi_Persen: m.Porsi_Persen === null ? null : Number(m.Porsi_Persen),
      Durasi_Detik: m.Durasi_Detik === null ? null : Number(m.Durasi_Detik),
    })),
  };
};

const getSesi = async (id, user) => {
  await dalamTransaksi((conn) => ambilSesi(conn, id, user));
  return bacaSesi(db, Number(teks(id)));
};

// Sesi aktif milik user yang login (untuk memulihkan timer setelah reload)
const getSesiAktif = async (user) => {
  const [rows] = await db.query(
    `SELECT sesi_id FROM ${TABEL.sesi}
     WHERE sesi_login = ? AND sesi_status IN (?)
     ORDER BY sesi_id DESC LIMIT 1`,
    [teks(user?.kode), SESI_AKTIF],
  );
  return rows.length ? bacaSesi(db, rows[0].sesi_id) : null;
};

// Mulai: satu timer untuk beberapa SPK/MAP. Tiap MAP dibuatkan header dan
// nomor LHK-D sendiri (bila belum punya). Body: { Kode_Cabang, Designer,
// Catatan, Daftar_Spk: [nomor] }. Daftar dikunci setelah Mulai.
const mulaiSesi = async (body = {}, user) => {
  const catatan = siapkanCatatan(body.Catatan);
  const daftar = siapkanDaftarSpk(body.Daftar_Spk);
  const login = teks(user?.kode);
  if (!login) {
    throw galat("User tidak terdeteksi", "forbidden");
  }

  const conn = await db.getConnection();
  let lockDiambil = false;
  let sesiId;
  try {
    const [lock] = await conn.query("SELECT GET_LOCK(?, 10) AS ok", [
      NOMOR_LOCK,
    ]);
    if (Number(lock[0].ok) !== 1) {
      throw galat("Sistem sedang memproses timer lain, coba lagi sebentar");
    }
    lockDiambil = true;

    await conn.beginTransaction();
    const pelaku = await siapkanPelaku(conn, body);

    const [aktif] = await conn.query(
      `SELECT sesi_id FROM ${TABEL.sesi}
       WHERE sesi_cabang = ? AND sesi_user = ? AND sesi_status IN (?) LIMIT 1`,
      [pelaku.cabang, pelaku.designer, SESI_AKTIF],
    );
    if (aktif.length > 0) {
      throw galat(
        `Designer ${pelaku.designer} masih punya timer yang berjalan atau di-pause. Selesaikan atau batalkan dulu.`,
      );
    }

    const [dipakai] = await conn.query(
      `SELECT m.sm_spk AS spk FROM ${TABEL.sesiMap} m
       JOIN ${TABEL.sesi} s ON s.sesi_id = m.sm_sesi
       WHERE m.sm_spk IN (?) AND s.sesi_status IN (?) LIMIT 1`,
      [daftar, SESI_AKTIF],
    );
    if (dipakai.length > 0) {
      throw galat(
        `SPK/MAP ${dipakai[0].spk} sedang dipakai timer lain. Selesaikan atau batalkan dulu.`,
      );
    }

    // Sebelum header dibuat, supaya Mulai pertama tidak ikut terkunci rantai
    for (const no of daftar) {
      await ambilSumber(conn, no, user);
      await pastikanBelumDipakai(conn, no, user);
    }

    const [[waktu]] = await conn.query(
      `SELECT DATE_FORMAT(NOW(), ${FMT}) AS sekarang,
              DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hari`,
    );
    const [res] = await conn.query(
      `INSERT INTO ${TABEL.sesi}
         (sesi_cabang, sesi_user, sesi_login, sesi_status, sesi_mulai,
          sesi_pause_detik, sesi_note)
       VALUES (?, ?, ?, 'BERJALAN', ?, 0, ?)`,
      [pelaku.cabang, pelaku.designer, login, waktu.sekarang, catatan],
    );
    sesiId = res.insertId;

    let urut = 0;
    for (const no of daftar) {
      urut += 1;
      const [hdr] = await conn.query(SQL_HDR_KUNCI, [no, TIPE]);
      let buatHeader = 0;
      let nomorBaru = 0;
      if (hdr.length === 0) {
        await cekTutupBuku(waktu.hari);
        const nomorLhk = await buatNomor(conn, waktu.hari);
        await conn.query(
          `INSERT INTO ${T.hdr}
             (ld_spk, ld_nomor, ld_tanggal, user_create, date_create, ld_tipe)
           VALUES (?, ?, CURDATE(), ?, NOW(), ?)`,
          [no, nomorLhk, login, TIPE],
        );
        buatHeader = 1;
        nomorBaru = 1;
      } else {
        if (hdr[0].tgl) {
          await cekTutupBuku(hdr[0].tgl);
        }
        if (!teks(hdr[0].nomor)) {
          const nomorLhk = await buatNomor(conn, waktu.hari);
          await conn.query(
            `UPDATE ${T.hdr} SET ld_nomor = ? WHERE ld_spk = ? AND ld_tipe = ?`,
            [nomorLhk, no, TIPE],
          );
          nomorBaru = 1;
        }
      }

      await conn.query(
        `INSERT INTO ${TABEL.sesiMap}
           (sm_sesi, sm_spk, sm_urut, sm_buat_header, sm_nomor_baru)
         VALUES (?, ?, ?, ?, ?)`,
        [sesiId, no, urut, buatHeader, nomorBaru],
      );
      await conn.query(
        `INSERT INTO ${T.status}
           (lds_spk, lds_cabang, lds_user, lds_status, lds_tgl,
            lds_durasi, lds_note, lds_tipe)
         VALUES (?, ?, ?, ?, ?, '', ?, ?)`,
        [
          no,
          pelaku.cabang,
          pelaku.designer,
          STATUS_MULAI,
          waktu.sekarang,
          catatan,
          TIPE,
        ],
      );
    }

    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    if (lockDiambil) {
      await conn.query("SELECT RELEASE_LOCK(?)", [NOMOR_LOCK]).catch(() => {});
    }
    conn.release();
  }
  return bacaSesi(db, sesiId);
};

// Pause: alasan wajib
const pauseSesi = async (id, body = {}, user) => {
  const alasan = siapkanAlasan(body.Alasan);
  const sesiId = await dalamTransaksi(async (conn) => {
    const s = await ambilSesi(conn, id, user);
    if (s.sesi_status !== "BERJALAN") {
      throw galat(`Timer tidak sedang berjalan (status ${s.sesi_status})`);
    }
    await conn.query(
      `INSERT INTO ${TABEL.sesiPause} (sp_sesi, sp_mulai, sp_alasan)
       VALUES (?, NOW(), ?)`,
      [s.sesi_id, alasan],
    );
    await conn.query(
      `UPDATE ${TABEL.sesi} SET sesi_status = 'PAUSE' WHERE sesi_id = ?`,
      [s.sesi_id],
    );
    return s.sesi_id;
  });
  return bacaSesi(db, sesiId);
};

// Lanjut: ditolak bila pause melebihi batas; user harus Selesai atau Batal
const resumeSesi = async (id, user) => {
  const sesiId = await dalamTransaksi(async (conn) => {
    const s = await ambilSesi(conn, id, user);
    if (s.sesi_status !== "PAUSE") {
      throw galat(`Timer tidak sedang di-pause (status ${s.sesi_status})`);
    }
    const [rows] = await conn.query(
      `SELECT sp_id, TIMESTAMPDIFF(SECOND, sp_mulai, NOW()) AS detik
       FROM ${TABEL.sesiPause}
       WHERE sp_sesi = ? AND sp_selesai IS NULL
       ORDER BY sp_id DESC LIMIT 1 FOR UPDATE`,
      [s.sesi_id],
    );
    if (rows.length === 0) {
      throw galat("Data pause tidak ditemukan");
    }
    const detik = Number(rows[0].detik);
    if (detik > BATAS_PAUSE_MENIT * 60) {
      throw galat(
        `Pause melebihi ${BATAS_PAUSE_MENIT} menit, timer tidak bisa dilanjutkan. Pilih Selesai atau Batal.`,
      );
    }
    await conn.query(
      `UPDATE ${TABEL.sesiPause} SET sp_selesai = NOW() WHERE sp_id = ?`,
      [rows[0].sp_id],
    );
    await conn.query(
      `UPDATE ${TABEL.sesi}
       SET sesi_status = 'BERJALAN', sesi_pause_detik = sesi_pause_detik + ?
       WHERE sesi_id = ?`,
      [detik, s.sesi_id],
    );
    return s.sesi_id;
  });
  return bacaSesi(db, sesiId);
};

// Porsi per tab dalam persen (total 100); satu MAP otomatis 100
const siapkanPorsi = (daftar, maps) => {
  if (maps.length === 1 && (!Array.isArray(daftar) || daftar.length === 0)) {
    return [100];
  }
  const list = Array.isArray(daftar) ? daftar : [];
  const peta = new Map();
  for (const p of list) {
    const no = norm(p?.Nomor_SPK);
    if (peta.has(no)) {
      throw galat(`Porsi SPK/MAP ${p.Nomor_SPK} dikirim lebih dari sekali`);
    }
    peta.set(no, angka(p?.Persen, `Porsi ${p?.Nomor_SPK ?? ""}`, 100));
  }
  const hasil = maps.map((m) => {
    const v = peta.get(norm(m.sm_spk));
    if (v === undefined) {
      throw galat(`Porsi untuk SPK/MAP ${m.sm_spk} belum diisi`);
    }
    return v;
  });
  if (peta.size !== maps.length) {
    throw galat("Porsi memuat SPK/MAP yang tidak ada di timer ini");
  }
  const total = round2(hasil.reduce((a, b) => a + b, 0));
  if (Math.abs(total - 100) > 0.01) {
    throw galat(`Total porsi harus 100% (sekarang ${total}%)`);
  }
  return hasil;
};

// Sisa detik dibagikan ke pecahan terbesar supaya jumlahnya persis = total
const bagiDurasi = (total, persen) => {
  const jumlahPersen = persen.reduce((a, b) => a + b, 0);
  const mentah = persen.map((p) => (total * p) / jumlahPersen);
  const dasar = mentah.map((v) => Math.floor(v));
  let sisa = total - dasar.reduce((a, b) => a + b, 0);
  const urut = mentah
    .map((v, i) => ({ i, f: v - dasar[i] }))
    .sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; k < urut.length && sisa > 0; k += 1) {
    dasar[urut[k].i] += 1;
    sisa -= 1;
  }
  return dasar;
};

// Selesai: tiap MAP dapat status DONE dengan durasi sesuai porsinya.
// Body: { Catatan, Porsi: [{ Nomor_SPK, Persen }] }
const selesaiSesi = async (id, body = {}, user) => {
  const catatan = siapkanCatatan(body.Catatan);
  const sesiId = await dalamTransaksi(async (conn) => {
    const s = await ambilSesi(conn, id, user);
    pastikanAktif(s);
    await tutupPauseTerbuka(conn, s.sesi_id);

    const [maps] = await conn.query(
      `SELECT sm_spk FROM ${TABEL.sesiMap} WHERE sm_sesi = ? ORDER BY sm_urut`,
      [s.sesi_id],
    );
    const persen = siapkanPorsi(body.Porsi, maps);

    const [[w]] = await conn.query(
      `SELECT TIMESTAMPDIFF(SECOND, sesi_mulai, NOW()) AS total,
              sesi_pause_detik AS jeda, DATE_FORMAT(NOW(), ${FMT}) AS sekarang
       FROM ${TABEL.sesi} WHERE sesi_id = ?`,
      [s.sesi_id],
    );
    const bersih = Math.max(0, Number(w.total) - Number(w.jeda));
    const alokasi = bagiDurasi(bersih, persen);

    for (let i = 0; i < maps.length; i += 1) {
      const no = maps[i].sm_spk;
      const [hdr] = await conn.query(SQL_HDR_KUNCI, [no, TIPE]);
      if (hdr.length === 0) {
        throw galat(`LHK Design ${no} tidak ditemukan`, "notFound");
      }
      if (hdr[0].tgl) {
        await cekTutupBuku(hdr[0].tgl);
      }
      await conn.query(
        `INSERT INTO ${T.status}
           (lds_spk, lds_cabang, lds_user, lds_status, lds_tgl,
            lds_durasi, lds_note, lds_tipe)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          no,
          s.sesi_cabang,
          s.sesi_user,
          STATUS_SELESAI,
          w.sekarang,
          formatDurasi(alokasi[i]),
          catatan,
          TIPE,
        ],
      );
      await conn.query(
        `UPDATE ${TABEL.sesiMap} SET sm_porsi = ?, sm_durasi = ?
         WHERE sm_sesi = ? AND sm_spk = ?`,
        [persen[i], alokasi[i], s.sesi_id, no],
      );
    }

    await conn.query(
      `UPDATE ${TABEL.sesi}
       SET sesi_status = 'SELESAI', sesi_selesai = NOW(),
           sesi_durasi_detik = ?
       WHERE sesi_id = ?`,
      [bersih, s.sesi_id],
    );
    return s.sesi_id;
  });
  return bacaSesi(db, sesiId);
};

// Batal = cancel, bukan DONE. Baris ON PROGRESS sesi ini dihapus; header yang
// dibuat sesi ini ikut dihapus bila belum punya komponen. Header yang sudah
// berisi komponen dipertahankan (data tidak dibuang).
const batalSesi = async (id, user) => {
  const hasil = await dalamTransaksi(async (conn) => {
    const s = await ambilSesi(conn, id, user);
    pastikanAktif(s);
    await tutupPauseTerbuka(conn, s.sesi_id);

    const [maps] = await conn.query(
      `SELECT sm_spk, sm_buat_header, sm_nomor_baru
       FROM ${TABEL.sesiMap} WHERE sm_sesi = ? ORDER BY sm_urut`,
      [s.sesi_id],
    );

    const dipertahankan = [];
    for (const m of maps) {
      const no = m.sm_spk;
      await conn.query(
        `DELETE FROM ${T.status}
         WHERE lds_spk = ? AND lds_tipe = ? AND lds_status = ?
           AND lds_user = ? AND lds_tgl = ?`,
        [no, TIPE, STATUS_MULAI, s.sesi_user, s.mulai],
      );

      if (Number(m.sm_buat_header) === 1) {
        // Kunci rantai: bila lini berikutnya sudah ada, header tidak boleh dibuang
        await pastikanBelumDipakai(conn, no, user);
        const [[k]] = await conn.query(
          `SELECT COUNT(*) AS jml FROM ${T.komponen}
           WHERE ldk_spk = ? AND ldk_tipe = ?`,
          [no, TIPE],
        );
        if (Number(k.jml) === 0) {
          await conn.query(
            `DELETE FROM ${T.hdr} WHERE ld_spk = ? AND ld_tipe = ?`,
            [no, TIPE],
          );
        } else {
          dipertahankan.push(no);
        }
      } else if (Number(m.sm_nomor_baru) === 1) {
        await conn.query(
          `UPDATE ${T.hdr} SET ld_nomor = NULL WHERE ld_spk = ? AND ld_tipe = ?`,
          [no, TIPE],
        );
      }
    }

    await conn.query(
      `UPDATE ${TABEL.sesi}
       SET sesi_status = 'BATAL', sesi_selesai = NOW(), sesi_durasi_detik = NULL
       WHERE sesi_id = ?`,
      [s.sesi_id],
    );
    return { sesiId: s.sesi_id, dipertahankan };
  });
  return {
    ...(await bacaSesi(db, hasil.sesiId)),
    Header_Dipertahankan: hasil.dipertahankan,
  };
};

module.exports = {
  getLookupSpk,
  getLookupDesigner,
  getLookupMesin,
  getLookupBahan,
  getLhkDesignById,
  simpanLhkDesign,
  simpanLhkDesignBatch,
  getSesi,
  getSesiAktif,
  mulaiSesi,
  pauseSesi,
  resumeSesi,
  selesaiSesi,
  batalSesi,
};
