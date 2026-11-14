const db = require("../../../config/database");
const {
  galat,
  teks,
  norm,
  round2,
  parseTanggal,
  adalahSuperadmin,
  cabangUser,
} = require("./lhkCommon");
const {
  T,
  KAIN,
  APV,
  TOLERANSI_KAIN,
  hitungKelebihanKain,
  ambilPlangkanMap,
  cekTutupBuku,
  pastikanLhkDiCabang,
  pastikanBelumDipakai,
  ambilInfoSpk,
  periksaSumber,
  pastikanPabrik,
} = require("./lhkCetakShared");
const { pastikanRantaiLhk } = require("./lhkGerbangRantai");

const PREFIX_NOMOR = "LHK-C";
const NOMOR_LOCK = "lhk_cetak_nomor";
const MAKS_INT = 2147483647; // int(11)

// --- util angka ---
const bilangan = (v, label) => {
  const s = teks(v);
  if (s === "") {
    return 0;
  }
  if (!/^\d+$/.test(s)) {
    throw galat(`${label} harus bilangan bulat tidak negatif`);
  }
  const n = Number(s);
  if (n > MAKS_INT) {
    throw galat(`${label} terlalu besar`);
  }
  return n;
};

// Qty meter: > 0, maksimal 2 desimal
const meter = (v, label) => {
  const s = teks(v);
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    throw galat(`${label} harus angka positif, maksimal 2 desimal`);
  }
  const n = Number(s);
  if (n <= 0) {
    throw galat(`${label} harus lebih dari 0`);
  }
  if (n > 999999999999) {
    throw galat(`${label} terlalu besar`);
  }
  return n;
};

// Lokasi dikunci ke cabang user (kecuali superadmin)
const pastikanLokasiUser = (pabrik, user) => {
  if (adalahSuperadmin(user)) {
    return;
  }
  const cab = cabangUser(user);
  if (norm(pabrik) !== cab) {
    throw galat(`Lokasi harus sesuai cabang Anda (${cab})`, "forbidden");
  }
};

const SESI_VALID = ["PAGI", "SIANG"];
const BATAS_SIANG = 13 * 3600; // 13:00
// Sementara sebelum rilis: boleh input mundur. Set false saat rilis.
const BOLEH_MUNDUR = true;

const cekTanggalInput = (tgl, hariIni) => {
  if (tgl > hariIni) {
    throw galat("Tanggal tidak boleh lebih dari hari ini");
  }
  if (tgl < hariIni && !BOLEH_MUNDUR) {
    throw galat("LHK Cetak hanya boleh diinput pada tanggal hari ini");
  }
};

// TIME dari fingerprint: NULL atau 00:00:00 = belum scan
const detik = (t) => {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(t ?? ""));
  if (!m) {
    return null;
  }
  const s = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0);
  return s === 0 ? null : s;
};

const selisihMenit = (dari, sampai) =>
  Math.max(0, Math.floor((sampai - dari) / 60));

const fmtJam = (menit) => {
  const m = Math.max(0, Number(menit) || 0);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

// Hitung jam kerja satu karyawan dari baris absensi. null = tidak memenuhi syarat sesi.
// PAGI: scan1 sampai batas akhir (jam input, maksimal cutoff 13:00), dipotong jam pulang bila sudah scan pulang.
// SIANG: max(13:00, scan1) sampai scan pulang; wajib scan pulang setelah 13:00.
const hitungJam = (sesi, row, detikAkhirPagi) => {
  const s1 = detik(row.scan1);
  const s2 = detik(row.scan2);
  const keluar = detik(row.keluar);
  if (s1 === null) {
    return null;
  }
  if (sesi === "PAGI") {
    const akhir = s2 === null ? detikAkhirPagi : Math.min(detikAkhirPagi, s2);
    return akhir > s1 ? { kerja: selisihMenit(s1, akhir), lembur: 0 } : null;
  }
  if (s2 === null || s2 <= BATAS_SIANG) {
    return null;
  }
  const mulai = Math.max(BATAS_SIANG, s1);
  return {
    kerja: selisihMenit(mulai, s2),
    lembur: keluar === null ? 0 : selisihMenit(keluar, s2),
  };
};

// Waktu server (jam yang sama dengan CURDATE() yang dipakai kode lain)
const sekarangServer = async (q) => {
  const [r] = await q.query(
    `SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS tgl,
            TIME_FORMAT(CURTIME(), '%H:%i:%s') AS jam`,
  );
  return { tgl: r[0].tgl, jam: r[0].jam };
};

// Karyawan cetak aktif di lokasi yang punya absensi pada tanggal tsb
const ambilAbsensi = async (q, tanggal, pabrik, niks = null) => {
  const params = [tanggal, pabrik];
  let filterNik = "";
  if (niks) {
    filterNik = "AND k.kar_nik IN (?)";
    params.push(niks);
  }
  const [rows] = await q.query(
    `SELECT k.kar_nik AS nik, k.kar_nama AS nama,
            a.scan1, a.scan2, a.keluar
     FROM ${T.karyawan} k
     JOIN hrd2.tabsensi a
       ON a.nik = k.kar_kode_absensi AND a.tanggal = ?
     WHERE k.kar_bagian LIKE '%CETAK%'
       AND k.kar_status_aktif = 1
       AND k.kar_pab_kode = ?
       AND k.kar_kode_absensi <> ''
       ${filterNik}`,
    params,
  );
  return rows;
};

// NIK yang sama tidak boleh ada di dua LHK pada tanggal + sesi yang sama
const cekDobelSesi = async (q, tanggal, sesi, niks, nomorSendiri) => {
  if (niks.length === 0) {
    return;
  }
  const [rows] = await q.query(
    `SELECT d.lcd2_kar_nik AS nik, h.lch_nomor AS nomor
     FROM ${T.dtl2} d
     JOIN ${T.hdr} h ON h.lch_nomor = d.lcd2_lch_nomor
     WHERE h.lch_tanggal = ? AND h.lch_sesi = ?
       AND d.lcd2_kar_nik IN (?) AND h.lch_nomor <> ?
     LIMIT 1`,
    [tanggal, sesi, niks, nomorSendiri],
  );
  if (rows.length > 0) {
    throw galat(
      `Karyawan ${rows[0].nik} sudah tercatat di LHK ${rows[0].nomor} (sesi ${sesi.toLowerCase()} tanggal yang sama)`,
    );
  }
};

// --- validasi payload ---
// Body: { Tanggal, Kode_Pabrik, Sesi, Kar_Borongan, Kar_Harian,
//         Detail: [{ Nomor_SPK, Qty_Cetak, Jml_Plangkan }],
//         Karyawan: [{ Nik }] },
//         Kain: [{ Kode_Bahan, Qty_Meter }]
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

  const karBorongan = bilangan(body.Kar_Borongan, "Karyawan borongan");
  const karHarian = bilangan(body.Kar_Harian, "Karyawan harian");

  const detail = Array.isArray(body.Detail) ? body.Detail : [];
  if (detail.length === 0) {
    throw galat("Minimal satu baris SPK/MAP harus diisi");
  }
  const sudahSpk = new Set();
  const baris = detail.map((d, i) => {
    const n = i + 1;
    const spk = teks(d?.Nomor_SPK);
    if (!spk) {
      throw galat(`Baris ${n}: nomor SPK/MAP wajib diisi`);
    }
    if (spk.length > 20) {
      throw galat(`Baris ${n}: nomor SPK/MAP maksimal 20 karakter`);
    }
    if (sudahSpk.has(spk)) {
      throw galat(`Baris ${n}: SPK/MAP ${spk} sudah ada di baris lain`);
    }
    sudahSpk.add(spk);

    const qtyCetak = bilangan(d.Qty_Cetak, `Baris ${n}: Jumlah cetak`);
    if (qtyCetak <= 0) {
      throw galat(`Baris ${n}: jumlah cetak harus lebih dari 0`);
    }
    return {
      spk,
      qtyCetak,
      plangkan: bilangan(d.Jml_Plangkan, `Baris ${n}: Jumlah plangkan`),
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

  const daftarKain = Array.isArray(body.Kain) ? body.Kain : [];
  const sudahKain = new Set();
  const kain = daftarKain.map((k, i) => {
    const n = i + 1;
    const kode = teks(k?.Kode_Bahan).toUpperCase();
    if (!kode.startsWith("SB")) {
      throw galat(`Kain ${n}: kode bahan tidak valid`);
    }
    if (sudahKain.has(kode)) {
      throw galat(`Kain ${n}: bahan ${kode} muncul lebih dari sekali`);
    }
    sudahKain.add(kode);
    return { kode, qty: meter(k.Qty_Meter, `Kain ${n}: qty`) };
  });

  return {
    tanggal,
    pabrik,
    sesi,
    karBorongan,
    karHarian,
    baris,
    karyawan,
    kain,
  };
};

const validasiSumberBaris = async (q, baris, user) => {
  const peta = await ambilInfoSpk(
    q,
    baris.map((b) => b.spk),
  );
  for (const b of baris) {
    periksaSumber(peta.get(b.spk), b.spk, user);
  }
  return peta;
};

// Plangkan otomatis dari HP. Baris yang sudah tersimpan di LHK ini mempertahankan
// nilainya (snapshot); baris baru memakai sisa. Tanpa MAP/HP, nilai manual dari client.
const terapkanPlangkan = async (q, data, nomorLhk) => {
  const peta = await ambilPlangkanMap(
    q,
    data.baris.map((b) => b.spk),
    nomorLhk,
    true,
  );
  let tersimpan = new Map();
  if (nomorLhk) {
    const [rows] = await q.query(
      `SELECT lcd_spk_nomor AS spk, lcd_qty_plangkan AS plg
       FROM ${T.dtl} WHERE lcd_lch_nomor = ?`,
      [nomorLhk],
    );
    tersimpan = new Map(rows.map((r) => [String(r.spk), Number(r.plg) || 0]));
  }
  for (const b of data.baris) {
    if (!peta.get(b.spk)?.otomatis) {
      continue;
    }
    b.plangkan = tersimpan.has(b.spk)
      ? tersimpan.get(b.spk)
      : peta.get(b.spk).sisa;
  }
};

// Kain harus bahan Spanduk (kode SB) yang aktif di tbahan (bhn_aktif 0); kain yang
// sudah tersimpan di LHK ini tetap lolos walau kemudian dinonaktifkan
const validasiKain = async (q, kain, nomorLhk) => {
  if (kain.length === 0) {
    return;
  }
  const [rows] = await q.query(
    `SELECT b.Bhn_kode AS kode
     FROM ${T.bahan} b
     WHERE b.Bhn_kode IN (?)
       AND LEFT(b.Bhn_kode, 2) = ?
       AND (b.bhn_aktif = 0
            OR b.Bhn_kode IN (SELECT lck_brg_kode FROM ${T.kain}
                              WHERE lck_lch_nomor = ?))`,
    [kain.map((k) => k.kode), KAIN.prefix, nomorLhk],
  );
  const ada = new Set(rows.map((r) => String(r.kode)));
  const salah = kain.find((k) => !ada.has(k.kode));
  if (salah) {
    throw galat(`Bahan ${salah.kode} bukan bahan Spanduk yang aktif`);
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
    cekTanggalInput(data.tanggal, hariIni);
  }

  const peta = new Map();
  if (baru.length > 0) {
    const rows = await ambilAbsensi(
      q,
      data.tanggal,
      data.pabrik,
      baru.map((k) => k.nik),
    );
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
          `Karyawan ${k.nik} tidak memenuhi syarat: bukan karyawan cetak aktif lokasi ${data.pabrik}, tidak punya kode absensi, atau tidak ada absensi hari ini`,
        );
      }
      // Tanggal lampau: semua karyawan sudah punya scan pulang, jadi abaikan untuk Pagi
      const jam = hitungJam(data.sesi, r, jamAkhir);
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
// tulisKain=false: LHK lama yang tidak mengirim kain, kain tidak disentuh.
const simpanDetail = async (
  conn,
  nomor,
  data,
  tulisKaryawan = true,
  tulisKain = true,
) => {
  if (tulisKaryawan) {
    await conn.query(`DELETE FROM ${T.dtl2} WHERE lcd2_lch_nomor = ?`, [nomor]);
  }
  await conn.query(`DELETE FROM ${T.dtl} WHERE lcd_lch_nomor = ?`, [nomor]);

  await conn.query(
    `INSERT INTO ${T.dtl}
       (lcd_lch_nomor, lcd_spk_nomor, lcd_qty_cetak, lcd_qty_plangkan)
     VALUES ?`,
    [data.baris.map((b) => [nomor, b.spk, b.qtyCetak, b.plangkan])],
  );

  if (tulisKaryawan && data.karyawan.length > 0) {
    await conn.query(
      `INSERT INTO ${T.dtl2}
         (lcd2_lch_nomor, lcd2_spk_nomor, lcd2_kar_nik, lcd2_kar_nama,
          lcd2_absensi, lcd2_lembur, lcd2_qty_cetak,
          lcd2_menit_kerja, lcd2_menit_lembur)
       VALUES ?`,
      [
        data.karyawan.map((k) => [
          nomor,
          "",
          k.nik,
          k.nama,
          0,
          0,
          0,
          k.kerja,
          k.lembur,
        ]),
      ],
    );
  }

  if (tulisKain) {
    await conn.query(`DELETE FROM ${T.kain} WHERE lck_lch_nomor = ?`, [nomor]);
    if (data.kain.length > 0) {
      await conn.query(
        `INSERT INTO ${T.kain} (lck_lch_nomor, lck_brg_kode, lck_qty_meter)
         VALUES ?`,
        [data.kain.map((k) => [nomor, k.kode, k.qty])],
      );
    }
  }
};

// LHK-C.yymm.NNNN, dipanggil di dalam lock + transaksi
const buatNomor = async (conn, tanggalStr) => {
  const yymm = tanggalStr.slice(2, 4) + tanggalStr.slice(5, 7);
  const prefix = `${PREFIX_NOMOR}.${yymm}.`;
  const [rows] = await conn.query(
    `SELECT MAX(CAST(RIGHT(lch_nomor, 4) AS UNSIGNED)) AS mx
     FROM ${T.hdr} WHERE lch_nomor LIKE ?`,
    [`${prefix}%`],
  );
  const next = (Number(rows[0]?.mx) || 0) + 1;
  if (next > 9999) {
    throw galat("Nomor LHK bulan ini sudah mencapai batas (9999)");
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
};

// --- LOAD ---
const getLhkCetakById = async (nomor, user) => {
  const no = teks(nomor);
  const [hdr] = await db.query(
    `SELECT h.lch_nomor AS Nomor,
            DATE_FORMAT(h.lch_tanggal, '%Y-%m-%d') AS Tanggal,
            h.lch_pab_kode AS Kode_Pabrik,
            p.pab_nama AS Nama_Pabrik,
            IFNULL(h.lch_jkar_borongan, 0) AS Kar_Borongan,
            IFNULL(h.lch_jkar_harian, 0) AS Kar_Harian,
            h.lch_sesi AS Sesi,
            TIME_FORMAT(h.lch_jam_input, '%H:%i') AS Jam_Input,
            h.lch_apv_status AS Apv_Status,
            h.lch_apv_user AS Apv_User,
            DATE_FORMAT(h.lch_apv_tgl, '%Y-%m-%d %H:%i') AS Apv_Tgl,
            h.lch_apv_alasan AS Apv_Alasan
     FROM ${T.hdr} h
     LEFT JOIN ${T.pabrik} p ON p.pab_kode = h.lch_pab_kode
     WHERE h.lch_nomor = ?`,
    [no],
  );
  if (hdr.length === 0) {
    throw galat("Data LHK Cetak tidak ditemukan", "notFound");
  }
  await pastikanLhkDiCabang(db, no, user);

  const [detail] = await db.query(
    `SELECT d.lcd_spk_nomor AS Nomor_SPK,
            x.spk_nama AS Nama_SPK,
            x.spk_jumlah AS Jumlah_Order,
            x.spk_panjang AS Panjang,
            x.spk_lebar AS Lebar,
            IFNULL(d.lcd_qty_cetak, 0) AS Qty_Cetak,
            IFNULL(d.lcd_qty_plangkan, 0) AS Jml_Plangkan
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
     ) x ON x.spk_nomor = d.lcd_spk_nomor
     WHERE d.lcd_lch_nomor = ?
     ORDER BY d.lcd_spk_nomor`,
    [no],
  );

  const plg = await ambilPlangkanMap(
    db,
    detail.map((d) => d.Nomor_SPK),
    no,
  );

  // Digabung per NIK (format lama menyimpan karyawan berulang per SPK;
  // nilai yang sama berulang, jadi diambil MAX, bukan dijumlah)
  const [karyawan] = await db.query(
    `SELECT lcd2_kar_nik AS Nik,
            MAX(lcd2_kar_nama) AS Nama,
            MAX(IFNULL(lcd2_absensi, 0)) AS Absensi,
            MAX(IFNULL(lcd2_lembur, 0)) AS Lembur,
            MAX(IFNULL(lcd2_menit_kerja, 0)) AS MenitKerja,
            MAX(IFNULL(lcd2_menit_lembur, 0)) AS MenitLembur
     FROM ${T.dtl2}
     WHERE lcd2_lch_nomor = ?
     GROUP BY lcd2_kar_nik
     ORDER BY MAX(lcd2_kar_nama)`,
    [no],
  );

  const [kain] = await db.query(
    `SELECT k.lck_brg_kode AS Kode_Bahan,
            b.Bhn_Name AS Nama_Bahan,
            b.bhn_lebar AS Lebar,
            k.lck_qty_meter AS Qty_Meter
     FROM ${T.kain} k
     LEFT JOIN ${T.bahan} b ON b.Bhn_kode = k.lck_brg_kode
     WHERE k.lck_lch_nomor = ?
     ORDER BY b.Bhn_Name, k.lck_brg_kode`,
    [no],
  );

  return {
    ...hdr[0],
    Kain_Kebutuhan: round2(
      detail.reduce(
        (t, d) => t + Number(d.Qty_Cetak) * (Number(d.Panjang) || 0),
        0,
      ),
    ),
    Kain_Toleransi: TOLERANSI_KAIN,
    Detail: detail.map((d) => ({
      ...d,
      Plangkan_Otomatis: plg.get(d.Nomor_SPK)?.otomatis === true,
    })),
    Kain: kain.map((k) => ({
      Kode_Bahan: String(k.Kode_Bahan),
      Nama_Bahan: k.Nama_Bahan,
      Lebar: k.Lebar,
      Qty_Meter: Number(k.Qty_Meter),
    })),
    Karyawan: karyawan.map((k) => ({
      Nik: String(k.Nik),
      Nama: k.Nama,
      Absensi: Number(k.Absensi), // legacy (LHK lama)
      Lembur: Number(k.Lembur), // legacy (LHK lama)
      Menit_Kerja: Number(k.MenitKerja),
      Menit_Lembur: Number(k.MenitLembur),
      Jam_Kerja: fmtJam(k.MenitKerja),
      Jam_Lembur: fmtJam(k.MenitLembur),
    })),
  };
};

// --- Info SPK/MAP untuk mengisi baris ---
const getInfoSpk = async (nomor, user) => {
  const no = teks(nomor);
  const peta = await ambilInfoSpk(db, [no]);
  const info = peta.get(no);
  periksaSumber(info, no, user);
  // Cek rantai dini (saat Enter / pilih modal), supaya penolakan muncul sebelum Simpan.
  // Cek saat simpan di create/update tetap jalan sebagai pengaman utama.
  await pastikanRantaiLhk(db, {
    kodeLini: "CETAK",
    daftarSpk: [no],
  });
  const plg = (await ambilPlangkanMap(db, [info.nomor])).get(info.nomor);
  return {
    Nomor_SPK: info.nomor,
    Nama_SPK: info.nama,
    Jumlah_Order: info.jumlah,
    Panjang: info.panjang,
    Lebar: info.lebar,
    Kode_Bahan: info.bahan || "",
    Plangkan_Otomatis: plg?.otomatis === true,
    Plangkan: plg?.sisa ?? 0,
    Plangkan_Total: plg?.total ?? 0,
    Plangkan_Terpakai: plg?.terpakai ?? 0,
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

// --- Lookup kain: bahan Spanduk (kode SB) yang aktif ---
const getLookupKain = async (search) => {
  const kata = teks(search);
  const params = [KAIN.prefix];
  let filter = "";
  if (kata) {
    filter = "AND (b.Bhn_kode LIKE ? OR b.Bhn_Name LIKE ?)";
    params.push(`%${kata}%`, `%${kata}%`);
  }
  const [rows] = await db.query(
    `SELECT b.Bhn_kode AS Kode, b.Bhn_Name AS Nama,
            IFNULL(b.bhn_konstruksi, '') AS Konstruksi, b.bhn_lebar AS Lebar
     FROM ${T.bahan} b
     WHERE LEFT(b.Bhn_kode, 2) = ? AND b.bhn_aktif = 0
       ${filter}
     ORDER BY b.Bhn_Name, b.bhn_lebar, b.Bhn_kode`,
    params,
  );
  return rows;
};

// --- Karyawan cetak yang hadir hari ini sesuai sesi (dasar daftar grid) ---
// PAGI : sudah scan masuk, belum scan pulang; jam kerja = scan1 s/d sekarang.
// SIANG: sudah scan masuk dan scan pulang; jam kerja = max(13:00, scan1) s/d scan2.
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
  cekTanggalInput(tanggal, sekarang.tgl);
  const mundur = tanggal < sekarang.tgl;

  // Sesi pagi dibatasi cutoff 13:00 supaya input siang hari tidak membengkakkan jam kerja
  const jamAkhir = mundur
    ? BATAS_SIANG
    : Math.min(detik(sekarang.jam) ?? 0, BATAS_SIANG);
  const rows = await ambilAbsensi(db, tanggal, kode);
  const hasil = [];
  for (const r of rows) {
    const jam = hitungJam(sesi, r, jamAkhir);
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
const createLhkCetak = async (body, user) => {
  const data = siapkanData(body);
  if (data.kain.length === 0) {
    throw galat("Minimal satu baris kain harus diisi");
  }
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
    const peta = await validasiSumberBaris(conn, data.baris, user);
    await terapkanPlangkan(conn, data, "");
    await validasiKain(conn, data.kain, "");
    await pastikanRantaiLhk(conn, {
      kodeLini: "CETAK",
      daftarSpk: data.baris.map((b) => b.spk),
    });
    const sekarang = await sekarangServer(conn);
    cekTanggalInput(data.tanggal, sekarang.tgl);
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

    const kelebihan = hitungKelebihanKain(data.baris, data.kain, peta);
    const statusApv = kelebihan.perluApproval ? APV.MENUNGGU : APV.TIDAK_PERLU;
    const nomor = await buatNomor(conn, data.tanggal);
    try {
      await conn.query(
        `INSERT INTO ${T.hdr}
           (lch_nomor, lch_tanggal, lch_pab_kode, lch_jkar_borongan,
            lch_jkar_harian, lch_sesi, lch_jam_input,
            lch_date_create, lch_user_create, lch_apv_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURDATE(), ?, ?)`,
        [
          nomor,
          data.tanggal,
          data.pabrik,
          data.karBorongan,
          data.karHarian,
          data.sesi,
          jamInput,
          user?.kode ?? null,
          statusApv,
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
    return { nomor, menungguApproval: statusApv === APV.MENUNGGU };
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
const updateLhkCetak = async (nomor, body, user) => {
  const no = teks(nomor);
  const data = siapkanData(body);
  pastikanLokasiUser(data.pabrik, user);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [lama] = await conn.query(
      `SELECT DATE_FORMAT(lch_tanggal, '%Y-%m-%d') AS tgl,
              lch_pab_kode AS pabrik,
              lch_sesi AS sesi,
              TIME_FORMAT(lch_jam_input, '%H:%i:%s') AS jam
       FROM ${T.hdr} WHERE lch_nomor = ? FOR UPDATE`,
      [no],
    );
    if (lama.length === 0) {
      throw galat("Data LHK Cetak tidak ditemukan", "notFound");
    }
    // tutup buku: tanggal lama dan tanggal baru sama-sama dicek
    if (lama[0].tgl) {
      await cekTutupBuku(lama[0].tgl);
    }
    await cekTutupBuku(data.tanggal);

    await pastikanLhkDiCabang(conn, no, user);
    await pastikanBelumDipakai(conn, no, user);
    await pastikanPabrik(conn, data.pabrik);
    const peta = await validasiSumberBaris(conn, data.baris, user);
    await terapkanPlangkan(conn, data, no);
    await validasiKain(conn, data.kain, no);
    await pastikanRantaiLhk(conn, {
      kodeLini: "CETAK",
      daftarSpk: data.baris.map((b) => b.spk),
      nomorLhk: no,
    });
    const legacy = lama[0].sesi === "";
    if (!legacy && data.kain.length === 0) {
      throw galat("Minimal satu baris kain harus diisi");
    }
    let jamInput = lama[0].jam;
    if (!legacy) {
      if (data.sesi !== lama[0].sesi) {
        throw galat("Sesi LHK tidak bisa diubah");
      }
      const sekarang = await sekarangServer(conn);
      const jamSkrg = detik(sekarang.jam) ?? 0;
      const tglBerubah = data.tanggal !== lama[0].tgl;
      cekTanggalInput(data.tanggal, sekarang.tgl);
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
          `SELECT lcd2_kar_nik AS nik, MAX(lcd2_kar_nama) AS nama,
                  MAX(IFNULL(lcd2_menit_kerja, 0)) AS kerja,
                  MAX(IFNULL(lcd2_menit_lembur, 0)) AS lembur
           FROM ${T.dtl2} WHERE lcd2_lch_nomor = ? GROUP BY lcd2_kar_nik`,
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
    const kelebihan = hitungKelebihanKain(data.baris, data.kain, peta);
    const statusApv = kelebihan.perluApproval ? APV.MENUNGGU : APV.TIDAK_PERLU;

    await conn.query(
      `UPDATE ${T.hdr}
       SET lch_tanggal = ?, lch_pab_kode = ?, lch_jkar_borongan = ?,
           lch_jkar_harian = ?, lch_jam_input = ?,
           lch_apv_status = ?, lch_apv_user = NULL, lch_apv_tgl = NULL,
           lch_apv_alasan = NULL,
           lch_date_modified = CURDATE(), lch_user_modified = ?
       WHERE lch_nomor = ?`,
      [
        data.tanggal,
        data.pabrik,
        data.karBorongan,
        data.karHarian,
        jamInput,
        statusApv,
        user?.kode ?? null,
        no,
      ],
    );
    await simpanDetail(
      conn,
      no,
      data,
      !legacy,
      !legacy || data.kain.length > 0,
    );

    await conn.commit();
    return { nomor: no, menungguApproval: statusApv === APV.MENUNGGU };
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
};

module.exports = {
  getLhkCetakById,
  getInfoSpk,
  getLookupPabrik,
  getLookupKain,
  getLookupKaryawan,
  createLhkCetak,
  updateLhkCetak,
};
