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
  cekTutupBuku,
  pastikanLhkDiCabang,
  pastikanBelumDipakai,
  ambilInfoSpk,
  periksaSumber,
  pastikanPabrik,
} = require("./lhkCetakShared");
const { pastikanMutasiMasuk } = require("./lhkGerbangMutasi");

const PREFIX_NOMOR = "LHK-C";
const NOMOR_LOCK = "lhk_cetak_nomor";
const MAKS_INT = 2147483647; // int(11)
const MAKS_DOUBLE_5_2 = 999.99; // double(5,2): absensi, lembur

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

const angka2 = (v, label) => {
  const s = teks(v);
  if (s === "") {
    return 0;
  }
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw galat(`${label} harus angka tidak negatif (desimal pakai titik)`);
  }
  const n = round2(Number(s));
  if (n > MAKS_DOUBLE_5_2) {
    throw galat(`${label} terlalu besar (maksimum 999,99)`);
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

// --- validasi payload ---
// Body: { Tanggal, Kode_Pabrik, Kar_Borongan, Kar_Harian,
//         Detail: [{ Nomor_SPK, Qty_Cetak, Jml_Plangkan }],
//         Karyawan: [{ Nik, Absensi, Lembur }] }
// Qty per karyawan tidak ada di web (selalu 0 di data lama dan tidak bisa
// diedit di Delphi). Nama karyawan diambil dari master, bukan dari client.
const siapkanData = (body = {}) => {
  const tanggal = parseTanggal(body.Tanggal);

  const pabrik = teks(body.Kode_Pabrik);
  if (!pabrik) {
    throw galat("Lokasi wajib diisi");
  }
  if (pabrik.length > 10) {
    throw galat("Kode lokasi maksimal 10 karakter");
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
    return {
      nik,
      absensi: angka2(k.Absensi, `Karyawan ${nik}: Absensi`),
      lembur: angka2(k.Lembur, `Karyawan ${nik}: Lembur`),
    };
  });

  return { tanggal, pabrik, karBorongan, karHarian, baris, karyawan };
};

const validasiSumberBaris = async (q, baris, user) => {
  const peta = await ambilInfoSpk(
    q,
    baris.map((b) => b.spk),
  );
  for (const b of baris) {
    periksaSumber(peta.get(b.spk), b.spk, user);
  }
};

// NIK baru harus aktif, bagian mengandung CETAK, dan di pabrik yang sama
// (aturan daftar karyawan Delphi). NIK yang sudah tercatat di LHK ini
// (nikLama: Map nik -> nama tersimpan) tetap boleh walau kini nonaktif.
const validasiKaryawan = async (q, karyawan, pabrik, nikLama = new Map()) => {
  if (karyawan.length === 0) {
    return;
  }
  const [master] = await q.query(
    `SELECT kar_nik, kar_nama, kar_bagian, kar_pab_kode, kar_status_aktif
     FROM ${T.karyawan} WHERE kar_nik IN (?)`,
    [karyawan.map((k) => k.nik)],
  );
  const peta = new Map(master.map((m) => [String(m.kar_nik), m]));

  for (const k of karyawan) {
    const m = peta.get(k.nik);
    if (nikLama.has(k.nik)) {
      k.nama = teks(m?.kar_nama) || nikLama.get(k.nik);
    } else {
      if (!m) {
        throw galat(`Karyawan ${k.nik} tidak ada di master karyawan`);
      }
      if (Number(m.kar_status_aktif) !== 1) {
        throw galat(`Karyawan ${k.nik} (${m.kar_nama}) sudah tidak aktif`);
      }
      if (!/CETAK/i.test(String(m.kar_bagian ?? ""))) {
        throw galat(`Karyawan ${k.nik} (${m.kar_nama}) bukan bagian cetak`);
      }
      if (norm(m.kar_pab_kode) !== norm(pabrik)) {
        throw galat(
          `Karyawan ${k.nik} (${m.kar_nama}) bukan karyawan lokasi ${pabrik}`,
        );
      }
      k.nama = teks(m.kar_nama);
    }
    k.nama = k.nama.slice(0, 100);
  }
};

// Hapus semua detail LHK lalu isi ulang. dtl_2 dihapus per nomor (semua SPK,
// termasuk baris format lama), supaya nomor yang dipakai ulang tidak mewarisi
// baris sisa. dtl_2 ditulis per LHK per karyawan (SPK dikosongkan, seperti
// perilaku Delphi) dan Qty karyawan selalu 0.
const simpanDetail = async (conn, nomor, data) => {
  await conn.query(`DELETE FROM ${T.dtl2} WHERE lcd2_lch_nomor = ?`, [nomor]);
  await conn.query(`DELETE FROM ${T.dtl} WHERE lcd_lch_nomor = ?`, [nomor]);

  await conn.query(
    `INSERT INTO ${T.dtl}
       (lcd_lch_nomor, lcd_spk_nomor, lcd_qty_cetak, lcd_qty_plangkan)
     VALUES ?`,
    [data.baris.map((b) => [nomor, b.spk, b.qtyCetak, b.plangkan])],
  );

  if (data.karyawan.length > 0) {
    await conn.query(
      `INSERT INTO ${T.dtl2}
         (lcd2_lch_nomor, lcd2_spk_nomor, lcd2_kar_nik, lcd2_kar_nama,
          lcd2_absensi, lcd2_lembur, lcd2_qty_cetak)
       VALUES ?`,
      [
        data.karyawan.map((k) => [
          nomor,
          "",
          k.nik,
          k.nama,
          k.absensi,
          k.lembur,
          0,
        ]),
      ],
    );
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
            IFNULL(h.lch_jkar_harian, 0) AS Kar_Harian
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

  // Digabung per NIK (format lama menyimpan karyawan berulang per SPK;
  // nilai yang sama berulang, jadi diambil MAX, bukan dijumlah)
  const [karyawan] = await db.query(
    `SELECT lcd2_kar_nik AS Nik,
            MAX(lcd2_kar_nama) AS Nama,
            MAX(IFNULL(lcd2_absensi, 0)) AS Absensi,
            MAX(IFNULL(lcd2_lembur, 0)) AS Lembur
     FROM ${T.dtl2}
     WHERE lcd2_lch_nomor = ?
     GROUP BY lcd2_kar_nik
     ORDER BY MAX(lcd2_kar_nama)`,
    [no],
  );

  return {
    ...hdr[0],
    Detail: detail,
    Karyawan: karyawan.map((k) => ({
      Nik: String(k.Nik),
      Nama: k.Nama,
      Absensi: Number(k.Absensi),
      Lembur: Number(k.Lembur),
    })),
  };
};

// --- Info SPK/MAP untuk mengisi baris ---
const getInfoSpk = async (nomor, user) => {
  const no = teks(nomor);
  const peta = await ambilInfoSpk(db, [no]);
  const info = peta.get(no);
  periksaSumber(info, no, user);
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

// --- Daftar karyawan cetak aktif untuk satu lokasi (daftar awal grid) ---
// Aturan Delphi: bagian mengandung CETAK, aktif, pabrik = lokasi.
const getLookupKaryawan = async (pabrik, user) => {
  const kode = teks(pabrik);
  if (!kode) {
    throw galat("Lokasi wajib dipilih");
  }
  pastikanLokasiUser(kode, user);
  const [rows] = await db.query(
    `SELECT kar_nik AS Nik, kar_nama AS Nama
     FROM ${T.karyawan}
     WHERE kar_bagian LIKE '%CETAK%'
       AND kar_status_aktif = 1
       AND kar_pab_kode = ?
     ORDER BY kar_nama`,
    [kode],
  );
  return rows.map((r) => ({ Nik: String(r.Nik), Nama: r.Nama }));
};

// --- CREATE ---
const createLhkCetak = async (body, user) => {
  const data = siapkanData(body);
  pastikanLokasiUser(data.pabrik, user);
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
    await pastikanMutasiMasuk(conn, {
      kodeLini: "CETAK",
      tanggal: data.tanggal,
      daftarSpk: data.baris.map((b) => b.spk),
    });
    await validasiKaryawan(conn, data.karyawan, data.pabrik);

    const nomor = await buatNomor(conn, data.tanggal);
    try {
      await conn.query(
        `INSERT INTO ${T.hdr}
           (lch_nomor, lch_tanggal, lch_pab_kode, lch_jkar_borongan,
            lch_jkar_harian, lch_date_create, lch_user_create)
         VALUES (?, ?, ?, ?, ?, CURDATE(), ?)`,
        [
          nomor,
          data.tanggal,
          data.pabrik,
          data.karBorongan,
          data.karHarian,
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
const updateLhkCetak = async (nomor, body, user) => {
  const no = teks(nomor);
  const data = siapkanData(body);
  pastikanLokasiUser(data.pabrik, user);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [lama] = await conn.query(
      `SELECT DATE_FORMAT(lch_tanggal, '%Y-%m-%d') AS tgl,
              lch_pab_kode AS pabrik
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
    await pastikanBelumDipakai(conn, no);
    await pastikanPabrik(conn, data.pabrik);
    await validasiSumberBaris(conn, data.baris, user);
    await pastikanMutasiMasuk(conn, {
      kodeLini: "CETAK",
      tanggal: data.tanggal,
      daftarSpk: data.baris.map((b) => b.spk),
      nomorLhk: no,
    });

    // Karyawan lama hanya dikecualikan kalau lokasi tidak berubah
    let nikLama = new Map();
    if (norm(lama[0].pabrik) === norm(data.pabrik)) {
      const [ada] = await conn.query(
        `SELECT lcd2_kar_nik AS nik, MAX(lcd2_kar_nama) AS nama
         FROM ${T.dtl2} WHERE lcd2_lch_nomor = ? GROUP BY lcd2_kar_nik`,
        [no],
      );
      nikLama = new Map(ada.map((r) => [String(r.nik), teks(r.nama)]));
    }
    await validasiKaryawan(conn, data.karyawan, data.pabrik, nikLama);

    await conn.query(
      `UPDATE ${T.hdr}
       SET lch_tanggal = ?, lch_pab_kode = ?, lch_jkar_borongan = ?,
           lch_jkar_harian = ?, lch_date_modified = CURDATE(),
           lch_user_modified = ?
       WHERE lch_nomor = ?`,
      [
        data.tanggal,
        data.pabrik,
        data.karBorongan,
        data.karHarian,
        user?.kode ?? null,
        no,
      ],
    );
    await simpanDetail(conn, no, data);

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
  getLhkCetakById,
  getInfoSpk,
  getLookupPabrik,
  getLookupKaryawan,
  createLhkCetak,
  updateLhkCetak,
};
