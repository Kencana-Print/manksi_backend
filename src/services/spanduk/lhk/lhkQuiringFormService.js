const db = require("../../../config/database");
const {
  teks,
  norm,
  parseTanggal,
  bilangan,
  adalahSuperadmin,
  cabangUser,
  pastikanLokasiUser,
} = require("./lhkCommon");
const {
  T,
  BAGIAN_ABSENSI,
  galat,
  cekTutupBuku,
  pastikanLhkDiCabang,
  pastikanBelumDipakai,
  ambilInfoSpk,
  periksaSumber,
  pastikanPabrik,
  pastikanSpk,
} = require("./lhkQuiringShared");
const { pastikanRantaiLhk } = require("./lhkGerbangRantai");
const {
  SESI_VALID,
  BATAS_SIANG,
  BOLEH_MUNDUR,
  detik,
  fmtJam,
  hitungJamSesi,
  cekTanggalInput,
  sekarangServer,
  ambilAbsensi,
} = require("./lhkAbsensi");

const PREFIX_NOMOR = "LHK-Q";
const NOMOR_LOCK = "lhk_quiring_nomor";
const NAMA_LHK = "LHK Quiring";

// BS tidak lagi diinput di LHK Quiring (pindah ke LHK BS). Bila dikirim tetap
// divalidasi dan disimpan; bila tidak dikirim (null), nilai tersimpan dipertahankan.
const bsOpsional = (v, label) => (teks(v) === "" ? null : bilangan(v, label));

// --- validasi payload ---
// Body: { Tanggal, Kode_Pabrik, Sesi,
//         Detail: [{ Nomor_SPK, J_Oven, J_Jemuran, J_Potong, BS_* (opsional) }],
//         Karyawan: [{ Nik }] }
// Jam kerja dan lembur TIDAK diterima dari client; dihitung server dari absensi.
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

  const sudah = new Set();
  const baris = detail.map((d, i) => {
    const n = i + 1;
    const spk = teks(d?.Nomor_SPK);
    if (!spk) {
      throw galat(`Baris ${n}: nomor SPK wajib diisi`);
    }
    if (spk.length > 20) {
      throw galat(`Baris ${n}: nomor SPK maksimal 20 karakter`);
    }
    if (sudah.has(spk.toUpperCase())) {
      throw galat(`Baris ${n}: SPK ${spk} sudah ada di baris lain`);
    }
    sudah.add(spk.toUpperCase());

    // Satuan: Oven (m), Jemuran (m), Potong (pcs); kolom int, jadi bilangan bulat
    const oven = bilangan(d.J_Oven, `Baris ${n}: Jumlah oven`);
    const jemuran = bilangan(d.J_Jemuran, `Baris ${n}: Jumlah jemuran`);
    const potong = bilangan(d.J_Potong, `Baris ${n}: Jumlah potong`);
    if (oven + jemuran + potong <= 0) {
      throw galat(
        `Baris ${n}: minimal satu dari Oven, Jemuran, atau Potong harus lebih dari 0`,
      );
    }

    return {
      spk,
      oven,
      jemuran,
      potong,
      bsQuiring: bsOpsional(d.BS_Quiring, `Baris ${n}: BS Quiring`),
      bsCetak: bsOpsional(d.BS_Cetak, `Baris ${n}: BS Cetak`),
      bsBahan: bsOpsional(d.BS_Bahan, `Baris ${n}: BS Bahan`),
    };
  });

  const daftarKar = Array.isArray(body.Karyawan) ? body.Karyawan : [];
  const sudahNik = new Set();
  const karyawan = daftarKar.map((k, i) => {
    const n = i + 1;
    const nik = teks(k?.Nik);
    if (!nik) {
      throw galat(`Karyawan ${n}: NIK wajib diisi`);
    }
    if (nik.length > 20) {
      throw galat(`Karyawan ${n}: NIK maksimal 20 karakter`);
    }
    if (sudahNik.has(nik)) {
      throw galat(`Karyawan ${n}: NIK ${nik} muncul lebih dari sekali`);
    }
    sudahNik.add(nik);
    return { nik };
  });

  return { tanggal, pabrik, sesi, baris, karyawan };
};

// Sumber harus ada, divisi 1/5, cabang user, dan SPK (bukan MAP)
const validasiSumberBaris = async (q, baris, user) => {
  const daftar = baris.map((b) => b.spk);
  const peta = await ambilInfoSpk(q, daftar);
  for (const b of baris) {
    periksaSumber(peta.get(b.spk), b.spk, user);
  }
  await pastikanSpk(q, daftar);
};

// NIK yang sama tidak boleh ada di dua LHK Quiring pada tanggal + sesi yang sama
const cekDobelSesi = async (q, tanggal, sesi, niks, nomorSendiri) => {
  if (niks.length === 0) {
    return;
  }
  const [rows] = await q.query(
    `SELECT d.lqd2_kar_nik AS nik, h.lqh_nomor AS nomor
     FROM ${T.dtl2} d
     JOIN ${T.hdr} h ON h.lqh_nomor = d.lqd2_lqh_nomor
     WHERE h.lqh_tanggal = ? AND h.lqh_sesi = ?
       AND d.lqd2_kar_nik IN (?) AND h.lqh_nomor <> ?
     LIMIT 1`,
    [tanggal, sesi, niks, nomorSendiri],
  );
  if (rows.length > 0) {
    throw galat(
      `Karyawan ${rows[0].nik} sudah tercatat di LHK ${rows[0].nomor} (sesi ${sesi.toLowerCase()} tanggal yang sama)`,
    );
  }
};

// Isi nama + menit kerja + menit lembur tiap karyawan.
// nikLama: Map nik -> {nama, kerja, lembur} (snapshot tersimpan; tidak dihitung ulang).
// NIK baru: wajib ada di absensi tanggal LHK dan memenuhi syarat sesi.
const hitungKaryawan = async (
  q,
  data,
  { hariIni, jamAkhir, nikLama = new Map() },
) => {
  const baru = data.karyawan.filter((k) => !nikLama.has(k.nik));
  if (baru.length > 0) {
    cekTanggalInput(data.tanggal, hariIni, NAMA_LHK);
  }

  const peta = new Map();
  if (baru.length > 0) {
    const rows = await ambilAbsensi(q, {
      tabelKaryawan: T.karyawan,
      bagian: BAGIAN_ABSENSI,
      tanggal: data.tanggal,
      pabrik: data.pabrik,
      niks: baru.map((k) => k.nik),
    });
    for (const r of rows) {
      peta.set(String(r.nik), r);
    }
  }

  for (const k of data.karyawan) {
    const lama = nikLama.get(k.nik);
    if (lama) {
      k.nama = lama.nama;
      k.kerja = lama.kerja;
      k.lembur = lama.lembur;
    } else {
      const r = peta.get(k.nik);
      if (!r) {
        throw galat(
          `Karyawan ${k.nik} tidak memenuhi syarat: bukan karyawan quiring aktif lokasi ${data.pabrik}, tidak punya kode absensi, atau tidak ada absensi pada tanggal itu`,
        );
      }
      const jam = hitungJamSesi(data.sesi, r, jamAkhir);
      if (!jam) {
        throw galat(
          data.sesi === "PAGI"
            ? `Karyawan ${k.nik} (${r.nama}) belum scan masuk atau tidak punya jam kerja pagi`
            : `Karyawan ${k.nik} (${r.nama}) belum scan masuk, belum scan pulang, atau pulang sebelum 13.00`,
        );
      }
      k.nama = teks(r.nama);
      k.kerja = jam.kerja;
      k.lembur = jam.lembur;
    }
    k.nama = k.nama.slice(0, 100);
  }
};

// tulisKaryawan=false: LHK lama (tanpa sesi), karyawannya tidak disentuh.
// BS yang tidak dikirim (null) memakai nilai tersimpan per SPK, bukan di-nol-kan.
const simpanDetail = async (conn, nomor, data, tulisKaryawan = true) => {
  const [lama] = await conn.query(
    `SELECT lqd_spk_nomor AS spk, lqd_bs_quiring AS q,
            lqd_bs_cetak AS c, lqd_bs_bahan AS b
     FROM ${T.dtl} WHERE lqd_lqh_nomor = ?`,
    [nomor],
  );
  const bsLama = new Map(lama.map((r) => [String(r.spk).toUpperCase(), r]));

  await conn.query(`DELETE FROM ${T.dtl} WHERE lqd_lqh_nomor = ?`, [nomor]);
  await conn.query(
    `INSERT INTO ${T.dtl}
       (lqd_lqh_nomor, lqd_spk_nomor, lqd_j_oven,
        lqd_j_jemuran, lqd_j_potong,
        lqd_bs_quiring, lqd_bs_cetak, lqd_bs_bahan)
     VALUES ?`,
    [
      data.baris.map((b) => {
        const s = bsLama.get(b.spk.toUpperCase());
        return [
          nomor,
          b.spk,
          b.oven,
          b.jemuran,
          b.potong,
          b.bsQuiring ?? Number(s?.q ?? 0),
          b.bsCetak ?? Number(s?.c ?? 0),
          b.bsBahan ?? Number(s?.b ?? 0),
        ];
      }),
    ],
  );

  if (tulisKaryawan) {
    await conn.query(`DELETE FROM ${T.dtl2} WHERE lqd2_lqh_nomor = ?`, [nomor]);
    if (data.karyawan.length > 0) {
      await conn.query(
        `INSERT INTO ${T.dtl2}
           (lqd2_lqh_nomor, lqd2_kar_nik, lqd2_kar_nama,
            lqd2_menit_kerja, lqd2_menit_lembur)
         VALUES ?`,
        [data.karyawan.map((k) => [nomor, k.nik, k.nama, k.kerja, k.lembur])],
      );
    }
  }
};

// LHK-Q.yymm.NNNN, dipanggil di dalam lock + transaksi
const buatNomor = async (conn, tanggalStr) => {
  const yymm = tanggalStr.slice(2, 4) + tanggalStr.slice(5, 7);
  const prefix = `${PREFIX_NOMOR}.${yymm}.`;
  const [rows] = await conn.query(
    `SELECT MAX(CAST(RIGHT(lqh_nomor, 4) AS UNSIGNED)) AS mx
     FROM ${T.hdr} WHERE lqh_nomor LIKE ?`,
    [`${prefix}%`],
  );
  const next = (Number(rows[0]?.mx) || 0) + 1;
  if (next > 9999) {
    throw galat("Nomor LHK bulan ini sudah mencapai batas (9999)");
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
};

// --- LOAD ---
const getLhkQuiringById = async (nomor, user) => {
  const no = teks(nomor);
  const [hdr] = await db.query(
    `SELECT h.lqh_nomor AS Nomor,
            DATE_FORMAT(h.lqh_tanggal, '%Y-%m-%d') AS Tanggal,
            h.lqh_pab_kode AS Kode_Pabrik,
            p.pab_nama AS Nama_Pabrik,
            h.lqh_sesi AS Sesi,
            TIME_FORMAT(h.lqh_jam_input, '%H:%i') AS Jam_Input
     FROM ${T.hdr} h
     LEFT JOIN ${T.pabrik} p ON p.pab_kode = h.lqh_pab_kode
     WHERE h.lqh_nomor = ?`,
    [no],
  );
  if (hdr.length === 0) {
    throw galat("Data LHK Quiring tidak ditemukan", "notFound");
  }
  await pastikanLhkDiCabang(db, no, user);

  // BS_* tetap dikirim (data lama), form baru tidak menampilkannya
  const [detail] = await db.query(
    `SELECT d.lqd_spk_nomor AS Nomor_SPK,
            x.spk_nama AS Nama_SPK,
            x.spk_jumlah AS Jumlah_Order,
            x.spk_panjang AS Panjang,
            x.spk_lebar AS Lebar,
            d.lqd_j_oven AS J_Oven,
            d.lqd_j_jemuran AS J_Jemuran,
            d.lqd_j_potong AS J_Potong,
            d.lqd_bs_quiring AS BS_Quiring,
            d.lqd_bs_cetak AS BS_Cetak,
            d.lqd_bs_bahan AS BS_Bahan
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
     ) x ON x.spk_nomor = d.lqd_spk_nomor
     WHERE d.lqd_lqh_nomor = ?
     ORDER BY d.lqd_spk_nomor`,
    [no],
  );

  const [karyawan] = await db.query(
    `SELECT lqd2_kar_nik AS Nik, lqd2_kar_nama AS Nama,
            lqd2_menit_kerja AS MenitKerja, lqd2_menit_lembur AS MenitLembur
     FROM ${T.dtl2}
     WHERE lqd2_lqh_nomor = ?
     ORDER BY lqd2_kar_nama`,
    [no],
  );

  return {
    ...hdr[0],
    Detail: detail,
    Karyawan: karyawan.map((k) => ({
      Nik: String(k.Nik),
      Nama: k.Nama,
      Menit_Kerja: Number(k.MenitKerja),
      Menit_Lembur: Number(k.MenitLembur),
      Jam_Kerja: fmtJam(k.MenitKerja),
      Jam_Lembur: fmtJam(k.MenitLembur),
    })),
  };
};

// --- Info SPK untuk mengisi baris (nama, jumlah, panjang, lebar) ---
const getInfoSpk = async (nomor, user) => {
  const no = teks(nomor);
  const peta = await ambilInfoSpk(db, [no]);
  const info = peta.get(no);
  periksaSumber(info, no, user);
  await pastikanSpk(db, [no]);
  // Cek rantai dini (Enter / pilih modal): SPK wajib sudah punya LHK Cetak.
  // Cek saat simpan tetap jadi pengaman utama.
  await pastikanRantaiLhk(db, {
    kodeLini: "QUIRING",
    daftarSpk: [no],
  });
  return {
    Nomor_SPK: info.nomor,
    Nama_SPK: info.nama,
    Jumlah_Order: info.jumlah,
    Panjang: info.panjang,
    Lebar: info.lebar,
  };
};

// --- Lookup pabrik (non-superadmin hanya cabangnya sendiri) ---
const getLookupPabrik = async (search, user) => {
  const kata = teks(search);
  const kondisi = [];
  const params = [];
  if (kata) {
    kondisi.push("(pab_kode LIKE ? OR pab_nama LIKE ?)");
    params.push(`%${kata}%`, `%${kata}%`);
  }
  if (!adalahSuperadmin(user)) {
    kondisi.push("pab_kode = ?");
    params.push(cabangUser(user));
  }
  const where = kondisi.length ? `WHERE ${kondisi.join(" AND ")}` : "";
  const [rows] = await db.query(
    `SELECT pab_kode AS Kode, pab_nama AS Nama
     FROM ${T.pabrik} ${where}
     ORDER BY pab_kode`,
    params,
  );
  return rows;
};

// --- Karyawan quiring yang memenuhi syarat sesi pada tanggal tsb (dasar daftar grid) ---
// PAGI : sudah scan masuk; jam kerja = scan1 s/d sekarang (maks 13:00), dipotong
//        scan pulang bila sudah ada.
// SIANG: sudah scan masuk dan scan pulang (> 13:00); jam kerja = max(13:00, scan1) s/d scan2.
const getLookupKaryawan = async (pabrik, sesiParam, tanggalParam, user) => {
  const kode = teks(pabrik);
  if (!kode) {
    throw galat("Lokasi wajib dipilih");
  }
  pastikanLokasiUser(kode, user);

  const sesi = teks(sesiParam).toUpperCase();
  if (!SESI_VALID.includes(sesi)) {
    throw galat("Sesi wajib dipilih (PAGI atau SIANG)");
  }
  const tanggal = parseTanggal(tanggalParam);
  const sekarang = await sekarangServer(db);
  cekTanggalInput(tanggal, sekarang.tgl, NAMA_LHK);
  const mundur = tanggal < sekarang.tgl;

  // Sesi pagi dibatasi cutoff 13:00 supaya input siang hari tidak membengkakkan jam kerja
  const jamAkhir = mundur
    ? BATAS_SIANG
    : Math.min(detik(sekarang.jam) ?? 0, BATAS_SIANG);
  const rows = await ambilAbsensi(db, {
    tabelKaryawan: T.karyawan,
    bagian: BAGIAN_ABSENSI,
    tanggal,
    pabrik: kode,
  });
  const hasil = [];
  for (const r of rows) {
    const jam = hitungJamSesi(sesi, r, jamAkhir);
    if (!jam) {
      continue;
    }
    hasil.push({
      Nik: String(r.nik),
      Nama: r.nama,
      Jam_Masuk: String(r.scan1).slice(0, 5),
      Jam_Pulang: detik(r.scan2) === null ? "" : String(r.scan2).slice(0, 5),
      Menit_Kerja: jam.kerja,
      Menit_Lembur: jam.lembur,
      Jam_Kerja: fmtJam(jam.kerja),
      Jam_Lembur: fmtJam(jam.lembur),
    });
  }
  return hasil.sort((a, b) => a.Nama.localeCompare(b.Nama));
};

// --- CREATE ---
const createLhkQuiring = async (body, user) => {
  const data = siapkanData(body);
  pastikanLokasiUser(data.pabrik, user);
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
      kodeLini: "QUIRING",
      daftarSpk: data.baris.map((b) => b.spk),
    });

    const sekarang = await sekarangServer(conn);
    cekTanggalInput(data.tanggal, sekarang.tgl, NAMA_LHK);
    const mundur = data.tanggal < sekarang.tgl;
    // Tanggal lampau: jam input dipatok 13:00. Jam input > 13:00 menandai pagi diinput terlambat
    const jamInput = mundur ? "13:00:00" : sekarang.jam;
    await hitungKaryawan(conn, data, {
      hariIni: sekarang.tgl,
      jamAkhir: Math.min(detik(jamInput) ?? 0, BATAS_SIANG),
    });
    await cekDobelSesi(
      conn,
      data.tanggal,
      data.sesi,
      data.karyawan.map((k) => k.nik),
      "",
    );

    const nomor = await buatNomor(conn, data.tanggal);
    try {
      await conn.query(
        `INSERT INTO ${T.hdr}
           (lqh_nomor, lqh_tanggal, lqh_pab_kode, lqh_sesi, lqh_jam_input,
            lqh_date_create, lqh_user_create)
         VALUES (?, ?, ?, ?, ?, CURDATE(), ?)`,
        [
          nomor,
          data.tanggal,
          data.pabrik,
          data.sesi,
          jamInput,
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
    await simpanDetail(conn, nomor, data);

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
const updateLhkQuiring = async (nomor, body, user) => {
  const no = teks(nomor);
  const data = siapkanData(body);
  pastikanLokasiUser(data.pabrik, user);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [lama] = await conn.query(
      `SELECT DATE_FORMAT(lqh_tanggal, '%Y-%m-%d') AS tgl,
              lqh_pab_kode AS pabrik,
              lqh_sesi AS sesi,
              TIME_FORMAT(lqh_jam_input, '%H:%i:%s') AS jam
       FROM ${T.hdr} WHERE lqh_nomor = ? FOR UPDATE`,
      [no],
    );
    if (lama.length === 0) {
      throw galat("Data LHK Quiring tidak ditemukan", "notFound");
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
      kodeLini: "QUIRING",
      daftarSpk: data.baris.map((b) => b.spk),
      nomorLhk: no,
    });

    // LHK lama (sebelum ada sesi): karyawan dan jam input tidak disentuh
    const legacy = teks(lama[0].sesi) === "";
    let jamInput = lama[0].jam;
    if (!legacy) {
      if (data.sesi !== lama[0].sesi) {
        throw galat("Sesi LHK tidak bisa diubah");
      }
      const sekarang = await sekarangServer(conn);
      const jamSkrg = detik(sekarang.jam) ?? 0;
      const tglBerubah = data.tanggal !== lama[0].tgl;
      cekTanggalInput(data.tanggal, sekarang.tgl, NAMA_LHK);
      if (tglBerubah && !BOLEH_MUNDUR) {
        throw galat(
          "Tanggal LHK tidak bisa diubah (jam kerja terikat absensi hari itu)",
        );
      }
      const mundur = data.tanggal < sekarang.tgl;

      // Snapshot karyawan dipertahankan hanya bila lokasi dan tanggal tidak berubah
      let nikLama = new Map();
      if (!tglBerubah && norm(lama[0].pabrik) === norm(data.pabrik)) {
        const [ada] = await conn.query(
          `SELECT lqd2_kar_nik AS nik, lqd2_kar_nama AS nama,
                  lqd2_menit_kerja AS kerja, lqd2_menit_lembur AS lembur
           FROM ${T.dtl2} WHERE lqd2_lqh_nomor = ?`,
          [no],
        );
        nikLama = new Map(
          ada.map((r) => [
            String(r.nik),
            {
              nama: teks(r.nama),
              kerja: Number(r.kerja),
              lembur: Number(r.lembur),
            },
          ]),
        );
      }
      if (tglBerubah) {
        jamInput = mundur ? "13:00:00" : sekarang.jam;
      }
      await hitungKaryawan(conn, data, {
        hariIni: sekarang.tgl,
        jamAkhir: mundur ? BATAS_SIANG : Math.min(jamSkrg, BATAS_SIANG),
        nikLama,
      });
      await cekDobelSesi(
        conn,
        data.tanggal,
        data.sesi,
        data.karyawan.map((k) => k.nik),
        no,
      );
    }

    await conn.query(
      `UPDATE ${T.hdr}
       SET lqh_tanggal = ?, lqh_pab_kode = ?, lqh_jam_input = ?,
           lqh_date_modified = CURDATE(), lqh_user_modified = ?
       WHERE lqh_nomor = ?`,
      [data.tanggal, data.pabrik, jamInput, user?.kode ?? null, no],
    );
    await simpanDetail(conn, no, data, !legacy);

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
  getLhkQuiringById,
  getInfoSpk,
  getLookupPabrik,
  getLookupKaryawan,
  createLhkQuiring,
  updateLhkQuiring,
};
