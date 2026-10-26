const db = require("../../../config/database");
const { teks, parseTanggal, angka, bilangan } = require("./lhkCommon");
const {
  T,
  galat,
  cekTutupBuku,
  pastikanLhkDiCabang,
  pastikanBelumDipakai,
  ambilInfoSpk,
  periksaSumber,
  pastikanPabrik,
} = require("./lhkJahitShared");
const { pastikanRantaiLhk } = require("./lhkGerbangRantai");
const {
  SESI_VALID,
  BATAS_SIANG,
  detik,
  fmtJam,
  hitungJam,
  sekarangServer,
  ambilAbsensi,
} = require("./lhkAbsensi");

const PREFIX_NOMOR = "LHK-J";
const NOMOR_LOCK = "lhk_jahit_nomor";
const LOKASI_QTY_MANUAL = "MT1"; // mitra luar: tanpa fingerprint, Qty Jahit manual

// BS wajib diisi (0 bila tidak ada)
const bsWajib = (v, label) => {
  if (v === undefined || v === null || teks(v) === "") {
    throw galat(`${label} wajib diisi (isi 0 bila tidak ada BS)`);
  }
  return bilangan(v, label);
};

// Body: { Tanggal, Kode_Pabrik, Sesi, Detail: [{ Nomor_SPK, Qty_Jahit, Tambah_Jahit,
//   Tambah_Tali, BS_Jahit, Karyawan: [{ NIK, Qty }] }] }
// Jam kerja tidak diterima dari client; dihitung server dari absensi.
const siapkanData = (body = {}) => {
  const tanggal = parseTanggal(body.Tanggal);

  const pabrik = teks(body.Kode_Pabrik);
  if (!pabrik) {
    throw galat("Lokasi wajib diisi");
  }
  if (pabrik.length > 10) {
    throw galat("Kode lokasi maksimal 10 karakter");
  }

  const sesi = teks(body.Sesi).toUpperCase();
  if (sesi !== "" && !SESI_VALID.includes(sesi)) {
    throw galat("Sesi harus PAGI atau SIANG");
  }

  const detail = Array.isArray(body.Detail) ? body.Detail : [];
  if (detail.length === 0) {
    throw galat("Minimal satu baris SPK harus diisi");
  }

  const sudahSpk = new Set();
  const baris = detail.map((d, i) => {
    const n = i + 1;
    const spk = teks(d?.Nomor_SPK);
    if (!spk) {
      throw galat(`Baris ${n}: nomor SPK wajib diisi`);
    }
    if (spk.length > 20) {
      throw galat(`Baris ${n}: nomor SPK maksimal 20 karakter`);
    }
    if (sudahSpk.has(spk.toUpperCase())) {
      throw galat(`Baris ${n}: SPK ${spk} sudah ada di baris lain`);
    }
    sudahSpk.add(spk.toUpperCase());

    const tambahJahit = angka(d.Tambah_Jahit, `Baris ${n}: Tambah jahit`);
    const tambahTali = bilangan(d.Tambah_Tali, `Baris ${n}: Tambah tali`);
    const bsJahit = bsWajib(d.BS_Jahit, `Baris ${n}: BS Jahit`);

    // Karyawan: qty 0 dibuang
    const daftar = Array.isArray(d.Karyawan) ? d.Karyawan : [];
    const sudahNik = new Set();
    const karyawan = [];
    daftar.forEach((k, j) => {
      const m = `Baris ${n}, karyawan ${j + 1}`;
      const nik = teks(k?.NIK);
      if (!nik) {
        throw galat(`${m}: NIK wajib diisi`);
      }
      if (nik.length > 20) {
        throw galat(`${m}: NIK maksimal 20 karakter`);
      }
      if (sudahNik.has(nik.toUpperCase())) {
        throw galat(`Baris ${n}: karyawan ${nik} sudah ada di SPK ${spk}`);
      }
      sudahNik.add(nik.toUpperCase());
      const qty = bilangan(k.Qty, `${m}: Qty jahit`);
      if (qty > 0) {
        karyawan.push({ nik, qty });
      }
    });

    return {
      spk,
      tambahJahit,
      tambahTali,
      bsJahit,
      karyawan,
      qtyManual: d.Qty_Jahit,
    };
  });

  return { tanggal, pabrik, sesi, baris };
};

// Sumber harus ada, divisi 1/5, dan cabang user (SPK atau MAP)
const validasiSumberBaris = async (q, baris, user) => {
  const peta = await ambilInfoSpk(
    q,
    baris.map((b) => b.spk),
  );
  for (const b of baris) {
    periksaSumber(peta.get(b.spk), b.spk, user);
  }
};

// Dipakai untuk lokasi MT1 saja (tanpa absensi): nama dari master karyawan
const lengkapiKaryawan = async (q, baris) => {
  const semua = [
    ...new Set(baris.flatMap((b) => b.karyawan.map((k) => k.nik))),
  ];
  if (semua.length === 0) {
    return;
  }
  const [rows] = await q.query(
    `SELECT kar_nik AS nik, kar_nama AS nama
     FROM ${T.karyawan} WHERE kar_nik IN (?)`,
    [semua],
  );
  const peta = new Map(rows.map((r) => [String(r.nik).toUpperCase(), r]));
  for (const b of baris) {
    for (const k of b.karyawan) {
      const r = peta.get(k.nik.toUpperCase());
      if (!r) {
        throw galat(`Karyawan dengan NIK ${k.nik} tidak ditemukan`);
      }
      k.nik = r.nik;
      k.nama = r.nama;
      k.kerja = 0;
    }
  }
};

// Isi nama + menit kerja tiap karyawan. nikLama: Map nik -> {nama, kerja}
// (snapshot tersimpan; tidak dihitung ulang). NIK baru wajib ada di absensi hari ini.
const hitungKaryawan = async (
  q,
  data,
  { hariIni, jamAkhir, nikLama = new Map() },
) => {
  if (data.pabrik === LOKASI_QTY_MANUAL) {
    await lengkapiKaryawan(q, data.baris);
    return;
  }
  const semua = [
    ...new Set(data.baris.flatMap((b) => b.karyawan.map((k) => k.nik))),
  ];
  const baru = semua.filter((n) => !nikLama.has(n));
  if (baru.length > 0 && data.tanggal !== hariIni) {
    throw galat(
      "Karyawan hanya bisa ditambahkan pada tanggal hari ini (absensi diambil dari hari yang sama)",
    );
  }
  const peta = new Map();
  if (baru.length > 0) {
    const rows = await ambilAbsensi(q, {
      tabelKaryawan: T.karyawan,
      bagian: "JAHIT",
      tanggal: data.tanggal,
      pabrik: data.pabrik,
      niks: baru,
    });
    for (const r of rows) {
      peta.set(String(r.nik), r);
    }
  }
  const hasil = new Map();
  for (const nik of semua) {
    const lama = nikLama.get(nik);
    if (lama) {
      hasil.set(nik, lama);
      continue;
    }
    const r = peta.get(nik);
    if (!r) {
      throw galat(
        `Karyawan ${nik} tidak memenuhi syarat: bukan karyawan jahit aktif lokasi ${data.pabrik}, tidak punya kode absensi, atau tidak ada absensi hari ini`,
      );
    }
    const jam = hitungJam(data.sesi, r, jamAkhir);
    if (!jam) {
      throw galat(
        data.sesi === "PAGI"
          ? `Karyawan ${nik} (${r.nama}) belum scan masuk atau sudah scan pulang`
          : `Karyawan ${nik} (${r.nama}) belum scan masuk atau belum scan pulang`,
      );
    }
    hasil.set(nik, { nama: String(r.nama ?? "").trim(), kerja: jam.kerja });
  }
  for (const b of data.baris) {
    for (const k of b.karyawan) {
      const h = hasil.get(k.nik);
      k.nama = h.nama.slice(0, 100);
      k.kerja = h.kerja;
    }
  }
};

// Tiap SPK wajib punya karyawan ber-qty (kecuali MT1); qty SPK = jumlah qty karyawan
const finalisasiBaris = (data) => {
  const manual = data.pabrik === LOKASI_QTY_MANUAL;
  data.baris.forEach((b, i) => {
    if (manual) {
      b.qtyJahit = bilangan(b.qtyManual, `Baris ${i + 1}: Qty jahit`);
      return;
    }
    if (b.karyawan.length === 0) {
      throw galat(
        `Baris ${i + 1}: SPK ${b.spk} wajib punya minimal satu karyawan dengan qty lebih dari 0`,
      );
    }
    b.qtyJahit = b.karyawan.reduce((a, k) => a + k.qty, 0);
  });
};

// NIK yang sama tidak boleh ada di dua LHK Jahit pada tanggal + sesi yang sama
const cekDobelSesi = async (q, tanggal, sesi, niks, nomorSendiri) => {
  if (niks.length === 0) {
    return;
  }
  const [rows] = await q.query(
    `SELECT d.ljd2_kar_nik AS nik, h.ljh_nomor AS nomor
     FROM ${T.dtl2} d
     JOIN ${T.hdr} h ON h.ljh_nomor = d.ljd2_ljh_nomor
     WHERE h.ljh_tanggal = ? AND h.ljh_sesi = ?
       AND d.ljd2_kar_nik IN (?) AND h.ljh_nomor <> ?
     LIMIT 1`,
    [tanggal, sesi, niks, nomorSendiri],
  );
  if (rows.length > 0) {
    throw galat(
      `Karyawan ${rows[0].nik} sudah tercatat di LHK ${rows[0].nomor} (sesi ${sesi.toLowerCase()} tanggal yang sama)`,
    );
  }
};

// tulisKaryawan=false: LHK lama (tanpa sesi), dtl_2 tidak disentuh
const simpanDetail = async (conn, nomor, baris, tulisKaryawan = true) => {
  if (tulisKaryawan) {
    await conn.query(`DELETE FROM ${T.dtl2} WHERE ljd2_ljh_nomor = ?`, [nomor]);
  }
  await conn.query(`DELETE FROM ${T.dtl} WHERE ljd_ljh_nomor = ?`, [nomor]);

  await conn.query(
    `INSERT INTO ${T.dtl}
       (ljd_ljh_nomor, ljd_spk_nomor, ljd_qty_jahit,
        ljd_tambah_jahit, ljd_tambah_tali, ljd_bs_jahit)
     VALUES ?`,
    [
      baris.map((b) => [
        nomor,
        b.spk,
        b.qtyJahit,
        b.tambahJahit,
        b.tambahTali,
        b.bsJahit,
      ]),
    ],
  );

  if (!tulisKaryawan) {
    return;
  }
  const values = baris.flatMap((b) =>
    b.karyawan.map((k) => [nomor, b.spk, k.nik, k.nama, 0, k.qty, k.kerja]),
  );
  if (values.length > 0) {
    await conn.query(
      `INSERT INTO ${T.dtl2}
         (ljd2_ljh_nomor, ljd2_spk_nomor, ljd2_kar_nik, ljd2_kar_nama,
          ljd2_absensi, ljd2_qty_jahit, ljd2_menit_kerja)
       VALUES ?`,
      [values],
    );
  }
};

// LHK-J.yymm.NNNN, dipanggil di dalam lock + transaksi
const buatNomor = async (conn, tanggalStr) => {
  const yymm = tanggalStr.slice(2, 4) + tanggalStr.slice(5, 7);
  const prefix = `${PREFIX_NOMOR}.${yymm}.`;
  const [rows] = await conn.query(
    `SELECT MAX(CAST(RIGHT(ljh_nomor, 4) AS UNSIGNED)) AS mx
     FROM ${T.hdr} WHERE ljh_nomor LIKE ?`,
    [`${prefix}%`],
  );
  const next = (Number(rows[0]?.mx) || 0) + 1;
  if (next > 9999) {
    throw galat("Nomor LHK bulan ini sudah mencapai batas (9999)");
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
};

// --- LOAD ---
const getLhkJahitById = async (nomor, user) => {
  const no = teks(nomor);
  const [hdr] = await db.query(
    `SELECT h.ljh_nomor AS Nomor,
            DATE_FORMAT(h.ljh_tanggal, '%Y-%m-%d') AS Tanggal,
            h.ljh_pab_kode AS Kode_Pabrik,
            p.pab_nama AS Nama_Pabrik,
            h.ljh_sesi AS Sesi,
            TIME_FORMAT(h.ljh_jam_input, '%H:%i') AS Jam_Input
     FROM ${T.hdr} h
     LEFT JOIN ${T.pabrik} p ON p.pab_kode = h.ljh_pab_kode
     WHERE h.ljh_nomor = ?`,
    [no],
  );
  if (hdr.length === 0) {
    throw galat("Data LHK Jahit tidak ditemukan", "notFound");
  }
  await pastikanLhkDiCabang(db, no, user);

  const [detail] = await db.query(
    `SELECT d.ljd_spk_nomor AS Nomor_SPK,
            x.spk_nama AS Nama_SPK,
            x.spk_jumlah AS Jumlah_Order,
            x.spk_panjang AS Panjang,
            x.spk_lebar AS Lebar,
            d.ljd_qty_jahit AS Qty_Jahit,
            d.ljd_tambah_jahit AS Tambah_Jahit,
            d.ljd_tambah_tali AS Tambah_Tali,
            d.ljd_bs_jahit AS BS_Jahit
     FROM ${T.dtl} d
     LEFT JOIN (
       SELECT spk_nomor, spk_nama, spk_jumlah,
              IFNULL(spk_panjang, 0) AS spk_panjang,
              IFNULL(spk_lebar, 0) AS spk_lebar
       FROM ${T.spk}
       UNION ALL
       SELECT mspk_nomor, mspk_nama, mspk_jumlah,
              IFNULL(mspk_panjang, 0), IFNULL(mspk_lebar, 0)
       FROM ${T.memoSpk}
     ) x ON x.spk_nomor = d.ljd_spk_nomor
     WHERE d.ljd_ljh_nomor = ?
     ORDER BY d.ljd_spk_nomor`,
    [no],
  );

  const [kar] = await db.query(
    `SELECT ljd2_spk_nomor AS Nomor_SPK,
            ljd2_kar_nik AS NIK,
            ljd2_kar_nama AS Nama,
            ljd2_absensi AS Absensi,
            ljd2_qty_jahit AS Qty,
            ljd2_menit_kerja AS Menit_Kerja
     FROM ${T.dtl2}
     WHERE ljd2_ljh_nomor = ?
     ORDER BY ljd2_kar_nama`,
    [no],
  );
  const perSpk = new Map();
  for (const k of kar) {
    const { Nomor_SPK, ...sisa } = k;
    if (!perSpk.has(Nomor_SPK)) {
      perSpk.set(Nomor_SPK, []);
    }
    perSpk.get(Nomor_SPK).push({
      ...sisa,
      Jam_Kerja: fmtJam(sisa.Menit_Kerja),
    });
  }

  return {
    ...hdr[0],
    Detail: detail.map((d) => ({
      ...d,
      Karyawan: perSpk.get(d.Nomor_SPK) ?? [],
    })),
  };
};

// --- Info SPK/MAP untuk mengisi baris ---
const getInfoSpk = async (nomor, user) => {
  const no = teks(nomor);
  const peta = await ambilInfoSpk(db, [no]);
  const info = peta.get(no);
  periksaSumber(info, no, user);
  // Cek rantai dini: SPK wajib sudah punya LHK Quiring
  await pastikanRantaiLhk(db, { kodeLini: "JAHIT", daftarSpk: [no] });
  return {
    Nomor_SPK: info.nomor,
    Nama_SPK: info.nama,
    Jumlah_Order: info.jumlah,
    Panjang: info.panjang,
    Lebar: info.lebar,
  };
};

// --- Lookup pabrik ---
const getLookupPabrik = async (search) => {
  const kata = teks(search);
  const params = [];
  let where = "";
  if (kata) {
    where = "WHERE pab_kode LIKE ? OR pab_nama LIKE ?";
    params.push(`%${kata}%`, `%${kata}%`);
  }
  const [rows] = await db.query(
    `SELECT pab_kode AS Kode, pab_nama AS Nama
     FROM ${T.pabrik} ${where}
     ORDER BY pab_kode`,
    params,
  );
  return rows;
};

// Karyawan jahit untuk baris SPK baru.
// MT1: dari master (tanpa absensi). Selain MT1: hanya yang hadir hari ini sesuai sesi
// (PAGI: sudah scan masuk, belum pulang; SIANG: sudah scan masuk dan pulang).
const getLookupKaryawan = async (pabrik, sesiParam, tanggalParam) => {
  const kode = teks(pabrik);
  if (!kode) {
    throw galat("Lokasi wajib diisi");
  }
  if (kode === LOKASI_QTY_MANUAL) {
    const [rows] = await db.query(
      `SELECT kar_nik AS NIK, kar_nama AS Nama
       FROM ${T.karyawan}
       WHERE kar_bagian LIKE '%JAHIT%' AND kar_status_aktif = 1
         AND kar_pab_kode = ?
       ORDER BY kar_nama`,
      [kode],
    );
    return rows.map((r) => ({ ...r, Jam_Kerja: "00:00" }));
  }

  const sesi = teks(sesiParam).toUpperCase();
  if (!SESI_VALID.includes(sesi)) {
    throw galat("Sesi wajib dipilih (PAGI atau SIANG)");
  }
  const tanggal = parseTanggal(tanggalParam);
  const sekarang = await sekarangServer(db);
  if (tanggal !== sekarang.tgl) {
    throw galat("Daftar karyawan hanya tersedia untuk tanggal hari ini");
  }
  const jamAkhir = detik(sekarang.jam) ?? 0;
  if (sesi === "PAGI" && jamAkhir >= BATAS_SIANG) {
    throw galat(
      "Sesi pagi sudah berakhir (setelah jam 13.00). Pilih sesi Siang.",
    );
  }
  const rows = await ambilAbsensi(db, {
    tabelKaryawan: T.karyawan,
    bagian: "JAHIT",
    tanggal,
    pabrik: kode,
  });
  const hasil = [];
  for (const r of rows) {
    const jam = hitungJam(sesi, r, jamAkhir);
    if (!jam) {
      continue;
    }
    hasil.push({
      NIK: String(r.nik),
      Nama: r.nama,
      Jam_Kerja: fmtJam(jam.kerja),
    });
  }
  return hasil.sort((a, b) => a.Nama.localeCompare(b.Nama));
};

// --- CREATE ---
const createLhkJahit = async (body, user) => {
  const data = siapkanData(body);
  if (!SESI_VALID.includes(data.sesi)) {
    throw galat("Sesi wajib dipilih (PAGI atau SIANG)");
  }
  await cekTutupBuku(data.tanggal);

  const conn = await db.getConnection();
  let lockDiambil = false;
  try {
    const [lock] = await conn.query("SELECT GET_LOCK(?, 10) AS ok", [
      NOMOR_LOCK,
    ]);
    if (Number(lock[0].ok) !== 1) {
      throw galat("Sistem sedang membuat nomor LHK lain, coba lagi sebentar");
    }
    lockDiambil = true;

    await conn.beginTransaction();
    await pastikanPabrik(conn, data.pabrik);
    await validasiSumberBaris(conn, data.baris, user);
    await pastikanRantaiLhk(conn, {
      kodeLini: "JAHIT",
      daftarSpk: data.baris.map((b) => b.spk),
    });
    const sekarang = await sekarangServer(conn);
    if (data.tanggal !== sekarang.tgl) {
      throw galat("LHK Jahit hanya boleh diinput pada tanggal hari ini");
    }
    const jamSkrg = detik(sekarang.jam) ?? 0;
    if (data.sesi === "PAGI" && jamSkrg >= BATAS_SIANG) {
      throw galat(
        "LHK sesi pagi tidak bisa diinput setelah jam 13.00. Gunakan sesi Siang.",
      );
    }
    await hitungKaryawan(conn, data, {
      hariIni: sekarang.tgl,
      jamAkhir: jamSkrg,
    });
    finalisasiBaris(data);
    await cekDobelSesi(
      conn,
      data.tanggal,
      data.sesi,
      data.baris.flatMap((b) => b.karyawan.map((k) => k.nik)),
      "",
    );

    const nomor = await buatNomor(conn, data.tanggal);
    try {
      await conn.query(
        `INSERT INTO ${T.hdr}
           (ljh_nomor, ljh_tanggal, ljh_pab_kode, ljh_sesi, ljh_jam_input,
            ljh_date_create, ljh_user_create)
         VALUES (?, ?, ?, ?, ?, CURDATE(), ?)`,
        [
          nomor,
          data.tanggal,
          data.pabrik,
          data.sesi,
          sekarang.jam,
          user?.kode ?? null,
        ],
      );
    } catch (e) {
      // Aplikasi desktop tidak memakai lock penomoran ini
      if (e.code === "ER_DUP_ENTRY") {
        throw galat(
          `Nomor ${nomor} sudah dipakai input lain (mungkin dari aplikasi desktop). Silakan simpan ulang.`,
        );
      }
      throw e;
    }
    await simpanDetail(conn, nomor, data.baris);

    await conn.commit();
    return nomor;
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    if (lockDiambil) {
      await conn.query("SELECT RELEASE_LOCK(?)", [NOMOR_LOCK]).catch(() => {});
    }
    conn.release();
  }
};

// --- UPDATE ---
const updateLhkJahit = async (nomor, body, user) => {
  const no = teks(nomor);
  const data = siapkanData(body);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [lama] = await conn.query(
      `SELECT DATE_FORMAT(ljh_tanggal, '%Y-%m-%d') AS tgl,
              ljh_pab_kode AS pabrik,
              ljh_sesi AS sesi,
              TIME_FORMAT(ljh_jam_input, '%H:%i:%s') AS jam
       FROM ${T.hdr} WHERE ljh_nomor = ? FOR UPDATE`,
      [no],
    );
    if (lama.length === 0) {
      throw galat("Data LHK Jahit tidak ditemukan", "notFound");
    }

    // tutup buku: tanggal lama dan tanggal baru sama-sama dicek
    if (lama[0].tgl) {
      await cekTutupBuku(lama[0].tgl);
    }
    await cekTutupBuku(data.tanggal);

    await pastikanLhkDiCabang(conn, no, user);
    await pastikanBelumDipakai(conn, no, user);
    await pastikanPabrik(conn, data.pabrik);
    await validasiSumberBaris(conn, data.baris, user);
    await pastikanRantaiLhk(conn, {
      kodeLini: "JAHIT",
      daftarSpk: data.baris.map((b) => b.spk),
      nomorLhk: no,
    });
    const legacy = lama[0].sesi === "";
    if (!legacy) {
      if (data.sesi !== lama[0].sesi) {
        throw galat("Sesi LHK tidak bisa diubah");
      }
      if (data.tanggal !== lama[0].tgl) {
        throw galat(
          "Tanggal LHK tidak bisa diubah (jam kerja terikat absensi hari itu)",
        );
      }
      const sekarang = await sekarangServer(conn);
      const jamSkrg = detik(sekarang.jam) ?? 0;
      let nikLama = new Map();
      if (data.pabrik === String(lama[0].pabrik).trim()) {
        const [ada] = await conn.query(
          `SELECT ljd2_kar_nik AS nik, MAX(ljd2_kar_nama) AS nama,
                  MAX(IFNULL(ljd2_menit_kerja, 0)) AS kerja
           FROM ${T.dtl2} WHERE ljd2_ljh_nomor = ? GROUP BY ljd2_kar_nik`,
          [no],
        );
        nikLama = new Map(
          ada.map((r) => [
            String(r.nik),
            { nama: teks(r.nama), kerja: Number(r.kerja) },
          ]),
        );
      }
      const adaBaru = data.baris.some((b) =>
        b.karyawan.some((k) => !nikLama.has(k.nik)),
      );
      if (
        data.sesi === "PAGI" &&
        adaBaru &&
        data.pabrik !== LOKASI_QTY_MANUAL &&
        jamSkrg >= BATAS_SIANG
      ) {
        throw galat(
          "Karyawan baru tidak bisa ditambahkan ke LHK pagi setelah jam 13.00.",
        );
      }
      await hitungKaryawan(conn, data, {
        hariIni: sekarang.tgl,
        // pagi: jam akhir tetap jam input LHK saat pertama disimpan
        jamAkhir: detik(lama[0].jam) ?? jamSkrg,
        nikLama,
      });
      finalisasiBaris(data);
      await cekDobelSesi(
        conn,
        data.tanggal,
        data.sesi,
        data.baris.flatMap((b) => b.karyawan.map((k) => k.nik)),
        no,
      );
    } else {
      // LHK lama: SPK dan karyawan tidak berubah, hanya Tambah Jahit/Tali dan BS
      const [dtlLama] = await conn.query(
        `SELECT ljd_spk_nomor AS spk, ljd_qty_jahit AS qty
         FROM ${T.dtl} WHERE ljd_ljh_nomor = ?`,
        [no],
      );
      const petaQty = new Map(
        dtlLama.map((r) => [String(r.spk).toUpperCase(), Number(r.qty)]),
      );
      for (const b of data.baris) {
        if (!petaQty.has(b.spk.toUpperCase())) {
          throw galat(
            `LHK lama tidak bisa menambah SPK ${b.spk}. Buat LHK Jahit baru.`,
          );
        }
        b.qtyJahit = petaQty.get(b.spk.toUpperCase());
      }
    }

    await conn.query(
      `UPDATE ${T.hdr}
       SET ljh_tanggal = ?, ljh_pab_kode = ?,
           ljh_date_modified = CURDATE(), ljh_user_modified = ?
       WHERE ljh_nomor = ?`,
      [data.tanggal, data.pabrik, user?.kode ?? null, no],
    );
    await simpanDetail(conn, no, data.baris, !legacy);

    await conn.commit();
    return no;
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
};

module.exports = {
  getLhkJahitById,
  getInfoSpk,
  getLookupPabrik,
  getLookupKaryawan,
  createLhkJahit,
  updateLhkJahit,
};
