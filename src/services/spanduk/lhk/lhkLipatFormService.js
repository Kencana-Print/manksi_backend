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
} = require("./lhkLipatShared");
const { pastikanRantaiLhk } = require("./lhkGerbangRantai");
const {
  BOLEH_MUNDUR,
  detik,
  fmtJam,
  hitungJamHarian,
  sekarangServer,
  ambilAbsensi,
} = require("./lhkAbsensi");

const PREFIX_NOMOR = "LHK-L";
const NOMOR_LOCK = "lhk_lipat_nomor";
const LOKASI_QTY_MANUAL = "MT1"; // mitra luar: tanpa fingerprint, Qty Lipat manual

// Masa depan ditolak; tanggal lampau hanya selama saklar BOLEH_MUNDUR true
const cekTanggalInput = (tgl, hariIni) => {
  if (tgl > hariIni) {
    throw galat("Tanggal tidak boleh lebih dari hari ini");
  }
  if (tgl < hariIni && !BOLEH_MUNDUR) {
    throw galat("LHK Lipat hanya boleh diinput pada tanggal hari ini");
  }
};

// BS wajib diisi (0 bila tidak ada)
const bsWajib = (v, label) => {
  if (v === undefined || v === null || teks(v) === "") {
    throw galat(`${label} wajib diisi (isi 0 bila tidak ada BS)`);
  }
  return bilangan(v, label);
};

// Body: { Tanggal, Kode_Pabrik, Sesi, Detail: [{ Nomor_SPK, Qty_Lipat, Tambah_Lipat,
//   Mata_Ayam, BS_Lipat, Karyawan: [{ NIK, Qty }] }] }
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

    const tambahLipat = angka(d.Tambah_Lipat, `Baris ${n}: Tambah lipat`);
    const mataAyam = bilangan(d.Mata_Ayam, `Baris ${n}: Mata ayam`);
    const bsLipat = bsWajib(d.BS_Lipat, `Baris ${n}: BS Lipat`);

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
      const qty = bilangan(k.Qty, `${m}: Qty lipat`);
      if (qty > 0) {
        karyawan.push({ nik, qty });
      }
    });

    return {
      spk,
      tambahLipat,
      mataAyam,
      bsLipat,
      karyawan,
      qtyManual: d.Qty_Lipat,
    };
  });

  return { tanggal, pabrik, baris };
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

// MT1 saja (tanpa absensi): nama dari master karyawan
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

// Isi nama + menit kerja. nikLama: Map nik -> {nama, kerja} (snapshot, tidak dihitung ulang).
// jamAkhir: batas bila belum scan pulang (hari ini); null = tanggal lampau, scan pulang wajib.
const hitungKaryawan = async (q, data, { jamAkhir, nikLama = new Map() }) => {
  if (data.pabrik === LOKASI_QTY_MANUAL) {
    await lengkapiKaryawan(q, data.baris);
    return;
  }
  const semua = [
    ...new Set(data.baris.flatMap((b) => b.karyawan.map((k) => k.nik))),
  ];
  const baru = semua.filter((n) => !nikLama.has(n));
  const peta = new Map();
  if (baru.length > 0) {
    const rows = await ambilAbsensi(q, {
      tabelKaryawan: T.karyawan,
      bagian: "LIPAT",
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
        `Karyawan ${nik} tidak memenuhi syarat: bukan karyawan lipat aktif lokasi ${data.pabrik}, tidak punya kode absensi, atau tidak ada absensi pada tanggal ${data.tanggal}`,
      );
    }
    const jam = hitungJamHarian(r, jamAkhir);
    if (!jam) {
      throw galat(
        jamAkhir === null
          ? `Karyawan ${nik} (${r.nama}) belum scan masuk atau belum scan pulang pada tanggal ${data.tanggal}`
          : `Karyawan ${nik} (${r.nama}) belum scan masuk`,
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

// Qty SPK = jumlah qty karyawan; tiap SPK wajib punya karyawan ber-qty (kecuali MT1)
const finalisasiBaris = (data) => {
  const manual = data.pabrik === LOKASI_QTY_MANUAL;
  data.baris.forEach((b, i) => {
    if (manual) {
      b.qtyLipat = bilangan(b.qtyManual, `Baris ${i + 1}: Qty lipat`);
      return;
    }
    if (b.karyawan.length === 0) {
      throw galat(
        `Baris ${i + 1}: SPK ${b.spk} wajib punya minimal satu karyawan dengan qty lebih dari 0`,
      );
    }
    b.qtyLipat = b.karyawan.reduce((a, k) => a + k.qty, 0);
  });
};

// tulisKaryawan=false: LHK lama (tanpa jam input), dtl_2 tidak disentuh
const simpanDetail = async (conn, nomor, baris, tulisKaryawan = true) => {
  if (tulisKaryawan) {
    await conn.query(`DELETE FROM ${T.dtl2} WHERE lld2_llh_nomor = ?`, [nomor]);
  }
  await conn.query(`DELETE FROM ${T.dtl} WHERE lld_llh_nomor = ?`, [nomor]);

  await conn.query(
    `INSERT INTO ${T.dtl}
       (lld_llh_nomor, lld_spk_nomor, lld_qty_lipat,
        lld_tambah_lipat, lld_mata_ayam, lld_bs_lipat)
     VALUES ?`,
    [
      baris.map((b) => [
        nomor,
        b.spk,
        b.qtyLipat,
        b.tambahLipat,
        b.mataAyam,
        b.bsLipat,
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
         (lld2_llh_nomor, lld2_spk_nomor, lld2_kar_nik, lld2_kar_nama,
          lld2_absensi, lld2_qty_lipat, lld2_menit_kerja)
       VALUES ?`,
      [values],
    );
  }
};

// LHK-L.yymm.NNNN, dipanggil di dalam lock + transaksi
const buatNomor = async (conn, tanggalStr) => {
  const yymm = tanggalStr.slice(2, 4) + tanggalStr.slice(5, 7);
  const prefix = `${PREFIX_NOMOR}.${yymm}.`;
  const [rows] = await conn.query(
    `SELECT MAX(CAST(RIGHT(llh_nomor, 4) AS UNSIGNED)) AS mx
     FROM ${T.hdr} WHERE llh_nomor LIKE ?`,
    [`${prefix}%`],
  );
  const next = (Number(rows[0]?.mx) || 0) + 1;
  if (next > 9999) {
    throw galat("Nomor LHK bulan ini sudah mencapai batas (9999)");
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
};

// --- LOAD ---
const getLhkLipatById = async (nomor, user) => {
  const no = teks(nomor);
  const [hdr] = await db.query(
    `SELECT h.llh_nomor AS Nomor,
            DATE_FORMAT(h.llh_tanggal, '%Y-%m-%d') AS Tanggal,
            h.llh_pab_kode AS Kode_Pabrik,
            p.pab_nama AS Nama_Pabrik,
            TIME_FORMAT(h.llh_jam_input, '%H:%i') AS Jam_Input,
            (h.llh_jam_input IS NULL) AS Legacy
     FROM ${T.hdr} h
     LEFT JOIN ${T.pabrik} p ON p.pab_kode = h.llh_pab_kode
     WHERE h.llh_nomor = ?`,
    [no],
  );
  if (hdr.length === 0) {
    throw galat("Data LHK Lipat tidak ditemukan", "notFound");
  }
  await pastikanLhkDiCabang(db, no, user);

  const [detail] = await db.query(
    `SELECT d.lld_spk_nomor AS Nomor_SPK,
            x.spk_nama AS Nama_SPK,
            x.spk_jumlah AS Jumlah_Order,
            x.spk_panjang AS Panjang,
            x.spk_lebar AS Lebar,
            d.lld_qty_lipat AS Qty_Lipat,
            d.lld_tambah_lipat AS Tambah_Lipat,
            d.lld_mata_ayam AS Mata_Ayam,
            d.lld_bs_lipat AS BS_Lipat
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
     ) x ON x.spk_nomor = d.lld_spk_nomor
     WHERE d.lld_llh_nomor = ?
     ORDER BY d.lld_spk_nomor`,
    [no],
  );

  const [kar] = await db.query(
    `SELECT lld2_spk_nomor AS Nomor_SPK,
            lld2_kar_nik AS NIK,
            lld2_kar_nama AS Nama,
            lld2_absensi AS Absensi,
            lld2_qty_lipat AS Qty,
            lld2_menit_kerja AS Menit_Kerja
     FROM ${T.dtl2}
     WHERE lld2_llh_nomor = ?
     ORDER BY lld2_kar_nama`,
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
    Legacy: Number(hdr[0].Legacy) === 1,
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
  // Cek rantai dini: SPK wajib sudah punya LHK Jahit
  await pastikanRantaiLhk(db, { kodeLini: "LIPAT", daftarSpk: [no] });
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

// MT1: dari master (tanpa absensi). Selain MT1: yang sudah scan masuk pada tanggal LHK.
// Hari ini: belum pulang boleh. Tanggal lampau: wajib sudah scan pulang.
const getLookupKaryawan = async (pabrik, tanggalParam) => {
  const kode = teks(pabrik);
  if (!kode) {
    throw galat("Lokasi wajib diisi");
  }
  if (kode === LOKASI_QTY_MANUAL) {
    const [rows] = await db.query(
      `SELECT kar_nik AS NIK, kar_nama AS Nama
       FROM ${T.karyawan}
       WHERE kar_bagian LIKE '%LIPAT%' AND kar_status_aktif = 1
         AND kar_pab_kode = ?
       ORDER BY kar_nama`,
      [kode],
    );
    return rows.map((r) => ({ ...r, Jam_Kerja: "00:00" }));
  }

  const tanggal = parseTanggal(tanggalParam);
  const sekarang = await sekarangServer(db);
  cekTanggalInput(tanggal, sekarang.tgl);
  const jamAkhir = tanggal < sekarang.tgl ? null : (detik(sekarang.jam) ?? 0);
  const rows = await ambilAbsensi(db, {
    tabelKaryawan: T.karyawan,
    bagian: "LIPAT",
    tanggal,
    pabrik: kode,
  });
  const hasil = [];
  for (const r of rows) {
    const jam = hitungJamHarian(r, jamAkhir);
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
const createLhkLipat = async (body, user) => {
  const data = siapkanData(body);
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
      kodeLini: "LIPAT",
      daftarSpk: data.baris.map((b) => b.spk),
    });
    const sekarang = await sekarangServer(conn);
    cekTanggalInput(data.tanggal, sekarang.tgl);
    const mundur = data.tanggal < sekarang.tgl;
    const jamSkrg = detik(sekarang.jam) ?? 0;
    await hitungKaryawan(conn, data, { jamAkhir: mundur ? null : jamSkrg });
    finalisasiBaris(data);

    const nomor = await buatNomor(conn, data.tanggal);
    try {
      await conn.query(
        `INSERT INTO ${T.hdr}
           (llh_nomor, llh_tanggal, llh_pab_kode, llh_jam_input,
            llh_date_create, llh_user_create)
         VALUES (?, ?, ?, ?, CURDATE(), ?)`,
        [nomor, data.tanggal, data.pabrik, sekarang.jam, user?.kode ?? null],
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
const updateLhkLipat = async (nomor, body, user) => {
  const no = teks(nomor);
  const data = siapkanData(body);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [lama] = await conn.query(
      `SELECT DATE_FORMAT(llh_tanggal, '%Y-%m-%d') AS tgl,
              llh_pab_kode AS pabrik,
              llh_sesi AS sesi,
              TIME_FORMAT(llh_jam_input, '%H:%i:%s') AS jam
       FROM ${T.hdr} WHERE llh_nomor = ? FOR UPDATE`,
      [no],
    );
    if (lama.length === 0) {
      throw galat("Data LHK Lipat tidak ditemukan", "notFound");
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
      kodeLini: "LIPAT",
      daftarSpk: data.baris.map((b) => b.spk),
      nomorLhk: no,
    });
    const legacy = lama[0].sesi === "";
    if (!legacy) {
      const sekarang = await sekarangServer(conn);
      const jamSkrg = detik(sekarang.jam) ?? 0;
      const tglBerubah = data.tanggal !== lama[0].tgl;
      if (tglBerubah) {
        cekTanggalInput(data.tanggal, sekarang.tgl);
        if (!BOLEH_MUNDUR) {
          throw galat(
            "Tanggal LHK tidak bisa diubah (jam kerja terikat absensi hari itu)",
          );
        }
      }
      const mundur = data.tanggal < sekarang.tgl;

      // Snapshot karyawan dipertahankan hanya bila lokasi dan tanggal tidak berubah
      let nikLama = new Map();
      if (!tglBerubah && data.pabrik === String(lama[0].pabrik).trim()) {
        const [ada] = await conn.query(
          `SELECT lld2_kar_nik AS nik, MAX(lld2_kar_nama) AS nama,
                  MAX(IFNULL(lld2_menit_kerja, 0)) AS kerja
           FROM ${T.dtl2} WHERE lld2_llh_nomor = ? GROUP BY lld2_kar_nik`,
          [no],
        );
        nikLama = new Map(
          ada.map((r) => [
            String(r.nik),
            { nama: teks(r.nama), kerja: Number(r.kerja) },
          ]),
        );
      }
      await hitungKaryawan(conn, data, {
        jamAkhir: mundur ? null : jamSkrg,
        nikLama,
      });
      finalisasiBaris(data);
    } else {
      // LHK lama: SPK dan karyawan tidak berubah, hanya Tambah Lipat, Mata Ayam, BS
      const [dtlLama] = await conn.query(
        `SELECT lld_spk_nomor AS spk, lld_qty_lipat AS qty
         FROM ${T.dtl} WHERE lld_llh_nomor = ?`,
        [no],
      );
      const petaQty = new Map(
        dtlLama.map((r) => [String(r.spk).toUpperCase(), Number(r.qty)]),
      );
      for (const b of data.baris) {
        if (!petaQty.has(b.spk.toUpperCase())) {
          throw galat(
            `LHK lama tidak bisa menambah SPK ${b.spk}. Buat LHK Lipat baru.`,
          );
        }
        b.qtyLipat = petaQty.get(b.spk.toUpperCase());
      }
    }

    await conn.query(
      `UPDATE ${T.hdr}
       SET llh_tanggal = ?, llh_pab_kode = ?,
           llh_date_modified = CURDATE(), llh_user_modified = ?
       WHERE llh_nomor = ?`,
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
  getLhkLipatById,
  getInfoSpk,
  getLookupPabrik,
  getLookupKaryawan,
  createLhkLipat,
  updateLhkLipat,
};
