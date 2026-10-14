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
} = require("./lhkAfdrukShared");
const { pastikanMutasiMasuk } = require("./lhkGerbangMutasi");

const PREFIX_NOMOR = "LHK-A";
const NOMOR_LOCK = "lhk_afdruk_nomor";
const MAKS_ANGKA = 99999999.99; // double(10,2)
const MAKS_INT = 2147483647; // int(11)

// --- util angka ---
const angka = (v, label) => {
  if (v === null || v === undefined || teks(v) === "") {
    return 0;
  }
  const s = teks(v);
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw galat(`${label} harus angka tidak negatif (desimal pakai titik)`);
  }
  const n = Number(s);
  if (n > MAKS_ANGKA) {
    throw galat(`${label} terlalu besar (maksimum 99.999.999,99)`);
  }
  return round2(n);
};

const bilangan = (v, label) => {
  if (v === null || v === undefined || teks(v) === "") {
    return 0;
  }
  const s = teks(v);
  if (!/^\d+$/.test(s)) {
    throw galat(`${label} harus bilangan bulat tidak negatif`);
  }
  const n = Number(s);
  if (n > MAKS_INT) {
    throw galat(`${label} terlalu besar`);
  }
  return n;
};

// Kunci pembanding ukuran (double 2 desimal) tanpa risiko selisih float
const kunciUkuran = (u) => Math.round(Number(u) * 100);

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
// Body: { Tanggal, Kode_Pabrik, Detail: [{ Nomor_SPK, Ulano, Screen, Lem,
//         Katalis, Plangkan: [{ Ukuran, Qty }] }] }
// J Plangkan tidak diterima dari client: dihitung = jumlah Qty semua ukuran.
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
    throw galat("Minimal satu baris SPK/MAP harus diisi");
  }

  const sudah = new Set();
  const baris = detail.map((d, i) => {
    const n = i + 1;
    const spk = teks(d?.Nomor_SPK);
    if (!spk) {
      throw galat(`Baris ${n}: nomor SPK/MAP wajib diisi`);
    }
    if (spk.length > 20) {
      throw galat(`Baris ${n}: nomor SPK/MAP maksimal 20 karakter`);
    }
    if (sudah.has(spk)) {
      throw galat(`Baris ${n}: SPK/MAP ${spk} sudah ada di baris lain`);
    }
    sudah.add(spk);

    const daftar = Array.isArray(d.Plangkan) ? d.Plangkan : [];
    const ukuranSudah = new Set();
    const plangkan = [];
    let jPlangkan = 0;
    for (const p of daftar) {
      const u = teks(p?.Ukuran);
      if (!/^\d+(\.\d+)?$/.test(u)) {
        throw galat(`Baris ${n}: ukuran plangkan tidak valid`);
      }
      const key = kunciUkuran(u);
      if (ukuranSudah.has(key)) {
        throw galat(`Baris ${n}: ukuran ${u} muncul lebih dari sekali`);
      }
      ukuranSudah.add(key);

      const qty = bilangan(p.Qty, `Baris ${n}: Qty ukuran ${u}`);
      if (qty > 0) {
        plangkan.push({ key, ukuran: u, qty });
        jPlangkan += qty;
      }
    }
    if (jPlangkan > MAKS_INT) {
      throw galat(`Baris ${n}: jumlah plangkan terlalu besar`);
    }

    return {
      spk,
      plangkan,
      jPlangkan,
      ulano: angka(d.Ulano, `Baris ${n}: Ulano`),
      screen: angka(d.Screen, `Baris ${n}: Screen`),
      lem: angka(d.Lem, `Baris ${n}: Lem`),
      // Delphi membulatkan ke integer; web menyimpan apa adanya (2 desimal)
      katalis: angka(d.Katalis, `Baris ${n}: Katalis`),
    };
  });

  return { tanggal, pabrik, baris };
};

// Ukuran harus ada di master; nilai yang disimpan = nilai master
const validasiUkuran = async (q, baris) => {
  const [master] = await q.query(`SELECT up_uraian AS ukuran FROM ${T.ukuran}`);
  const peta = new Map(
    master.map((m) => [kunciUkuran(m.ukuran), Number(m.ukuran)]),
  );
  baris.forEach((b, i) => {
    for (const p of b.plangkan) {
      if (!peta.has(p.key)) {
        throw galat(`Baris ${i + 1}: ukuran ${p.ukuran} tidak ada di master`);
      }
      p.nilai = peta.get(p.key);
    }
  });
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

// Hapus semua detail + Detail Plangkan LHK, lalu isi ulang.
// Menghapus dtl2 per nomor (bukan per SPK) supaya SPK yang dibuang ikut bersih
// dan nomor yang dipakai ulang tidak mewarisi baris sisa.
const simpanDetail = async (conn, nomor, baris) => {
  await conn.query(`DELETE FROM ${T.dtl2} WHERE lad2_lah_nomor = ?`, [nomor]);
  await conn.query(`DELETE FROM ${T.dtl} WHERE lad_lah_nomor = ?`, [nomor]);

  const valuesDtl = baris.map((b) => [
    nomor,
    b.spk,
    b.jPlangkan,
    b.ulano,
    b.screen,
    b.lem,
    b.katalis,
  ]);
  await conn.query(
    `INSERT INTO ${T.dtl}
       (lad_lah_nomor, lad_spk_nomor, lad_j_plangkan, lad_ulano,
        lad_screen, lad_lem, lad_katalis)
     VALUES ?`,
    [valuesDtl],
  );

  const valuesDtl2 = [];
  for (const b of baris) {
    for (const p of b.plangkan) {
      valuesDtl2.push([nomor, b.spk, p.nilai, p.qty]);
    }
  }
  if (valuesDtl2.length > 0) {
    await conn.query(
      `INSERT INTO ${T.dtl2}
         (lad2_lah_nomor, lad2_spk_nomor, lad2_up_kode, lad2_qty)
       VALUES ?`,
      [valuesDtl2],
    );
  }
};

// LHK-A.yymm.NNNN, dipanggil di dalam lock + transaksi
const buatNomor = async (conn, tanggalStr) => {
  const yymm = tanggalStr.slice(2, 4) + tanggalStr.slice(5, 7);
  const prefix = `${PREFIX_NOMOR}.${yymm}.`;
  const [rows] = await conn.query(
    `SELECT MAX(CAST(RIGHT(lah_nomor, 4) AS UNSIGNED)) AS mx
     FROM ${T.hdr} WHERE lah_nomor LIKE ?`,
    [`${prefix}%`],
  );
  const next = (Number(rows[0]?.mx) || 0) + 1;
  if (next > 9999) {
    throw galat("Nomor LHK bulan ini sudah mencapai batas (9999)");
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
};

// --- Lookup ukuran plangkan (master 15 ukuran) ---
const getLookupUkuran = async () => {
  const [rows] = await db.query(
    `SELECT up_kode AS Kode, up_uraian AS Ukuran
     FROM ${T.ukuran} ORDER BY up_kode`,
  );
  return rows.map((r) => ({ Kode: r.Kode, Ukuran: Number(r.Ukuran) }));
};

// --- LOAD ---
const getLhkAfdrukById = async (nomor, user) => {
  const no = teks(nomor);
  const [hdr] = await db.query(
    `SELECT h.lah_nomor AS Nomor,
            DATE_FORMAT(h.lah_tanggal, '%Y-%m-%d') AS Tanggal,
            h.lah_pab_kode AS Kode_Pabrik,
            p.pab_nama AS Nama_Pabrik
     FROM ${T.hdr} h
     LEFT JOIN ${T.pabrik} p ON p.pab_kode = h.lah_pab_kode
     WHERE h.lah_nomor = ?`,
    [no],
  );
  if (hdr.length === 0) {
    throw galat("Data LHK Afdruk tidak ditemukan", "notFound");
  }
  await pastikanLhkDiCabang(db, no, user);

  const [detail] = await db.query(
    `SELECT d.lad_spk_nomor AS Nomor_SPK,
            x.spk_nama AS Nama_SPK,
            x.spk_jumlah AS Jumlah_Order,
            x.spk_panjang AS Panjang,
            x.spk_lebar AS Lebar,
            d.lad_ulano AS Ulano,
            d.lad_screen AS Screen,
            d.lad_lem AS Lem,
            d.lad_katalis AS Katalis
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
     ) x ON x.spk_nomor = d.lad_spk_nomor
     WHERE d.lad_lah_nomor = ?
     ORDER BY d.lad_spk_nomor`,
    [no],
  );

  const [qtyRows] = await db.query(
    `SELECT lad2_spk_nomor AS spk, lad2_up_kode AS ukuran, lad2_qty AS qty
     FROM ${T.dtl2} WHERE lad2_lah_nomor = ?`,
    [no],
  );
  const peta = new Map(
    qtyRows.map((r) => [
      `${norm(r.spk)}|${kunciUkuran(r.ukuran)}`,
      Number(r.qty),
    ]),
  );
  const ukuran = await getLookupUkuran();

  const Detail = detail.map((d) => {
    const Plangkan = ukuran.map((u) => ({
      Ukuran: u.Ukuran,
      Qty: peta.get(`${norm(d.Nomor_SPK)}|${kunciUkuran(u.Ukuran)}`) ?? 0,
    }));
    return {
      ...d,
      J_Plangkan: Plangkan.reduce((a, p) => a + p.Qty, 0),
      Plangkan,
    };
  });

  return { ...hdr[0], Detail };
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

// --- CREATE ---
const createLhkAfdruk = async (body, user) => {
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
      kodeLini: "AFDRUK",
      tanggal: data.tanggal,
      daftarSpk: data.baris.map((b) => b.spk),
    });
    await validasiUkuran(conn, data.baris);

    const nomor = await buatNomor(conn, data.tanggal);
    try {
      await conn.query(
        `INSERT INTO ${T.hdr}
           (lah_nomor, lah_tanggal, lah_pab_kode, lah_date_create, lah_user_create)
         VALUES (?, ?, ?, CURDATE(), ?)`,
        [nomor, data.tanggal, data.pabrik, user?.kode ?? null],
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
const updateLhkAfdruk = async (nomor, body, user) => {
  const no = teks(nomor);
  const data = siapkanData(body);
  pastikanLokasiUser(data.pabrik, user);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [lama] = await conn.query(
      `SELECT DATE_FORMAT(lah_tanggal, '%Y-%m-%d') AS tgl
       FROM ${T.hdr} WHERE lah_nomor = ? FOR UPDATE`,
      [no],
    );
    if (lama.length === 0) {
      throw galat("Data LHK Afdruk tidak ditemukan", "notFound");
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
      kodeLini: "AFDRUK",
      tanggal: data.tanggal,
      daftarSpk: data.baris.map((b) => b.spk),
      nomorLhk: no,
    });
    await validasiUkuran(conn, data.baris);

    await conn.query(
      `UPDATE ${T.hdr}
       SET lah_tanggal = ?, lah_pab_kode = ?,
           lah_date_modified = CURDATE(), lah_user_modified = ?
       WHERE lah_nomor = ?`,
      [data.tanggal, data.pabrik, user?.kode ?? null, no],
    );
    await simpanDetail(conn, no, data.baris);

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
  getLhkAfdrukById,
  getInfoSpk,
  getLookupPabrik,
  getLookupUkuran,
  createLhkAfdruk,
  updateLhkAfdruk,
};
