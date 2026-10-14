const db = require("../../../config/database");
const { teks, round2, parseTanggal, angka, bilangan } = require("./lhkCommon");
const {
  T,
  galat,
  cekTutupBuku,
  filterCabang,
  pastikanLhkDiCabang,
  pastikanBelumDipakai,
  ambilInfoSpk,
  periksaSumber,
  pastikanPabrik,
} = require("./lhkHapusPlankanShared");
const { pastikanMutasiMasuk } = require("./lhkGerbangMutasi");

const PREFIX_NOMOR = "LHK-HP";
const NOMOR_LOCK = "lhk_hapusplangkan_nomor";
const MAKS_KETERANGAN = 200;

// --- validasi payload ---
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

    const ket = teks(d.Keterangan);
    if (ket.length > MAKS_KETERANGAN) {
      throw galat(
        `Baris ${n}: keterangan maksimal ${MAKS_KETERANGAN} karakter`,
      );
    }

    return {
      spk,
      plangkan: bilangan(d.J_Plangkan, `Baris ${n}: Jumlah plangkan`),
      ukuran: angka(d.Ukuran, `Baris ${n}: Ukuran`),
      rinso: round2(angka(d.Rinso, `Baris ${n}: Rinso`)),
      porstek: round2(angka(d.Porstek, `Baris ${n}: Porstek`)),
      m46: round2(angka(d.M46, `Baris ${n}: M46`)),
      kaporit: round2(angka(d.Kaporit, `Baris ${n}: Kaporit`)),
      caustik: round2(angka(d.Caustik, `Baris ${n}: Caustik`)),
      ket,
    };
  });

  return { tanggal, pabrik, baris };
};

// Mengembalikan peta info SPK/MAP (dipakai untuk panjang)
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

// J Meter = plangkan x panjang SPK/MAP. Baris lama yang plangkannya tidak
// berubah mempertahankan nilai tersimpan (Delphi hanya menghitung ulang
// saat jumlah plangkan diedit), supaya simpan ulang tidak mengubah riwayat.
const hitungJumlahMeter = (baris, peta, lamaPeta) =>
  baris.map((b) => {
    const lama = lamaPeta ? lamaPeta.get(b.spk) : null;
    const pakaiLama =
      lama && lama.jumlahmeter !== null && Number(lama.plangkan) === b.plangkan;
    const jumlahMeter = pakaiLama
      ? Number(lama.jumlahmeter)
      : round2(b.plangkan * Number(peta.get(b.spk)?.panjang ?? 0));
    return { ...b, jumlahMeter };
  });

const simpanDetail = async (conn, nomor, baris) => {
  await conn.query(`DELETE FROM ${T.dtl} WHERE lhpd_lhp_nomor = ?`, [nomor]);
  const values = baris.map((b, i) => [
    nomor,
    b.spk,
    b.plangkan,
    b.rinso,
    b.porstek,
    b.m46,
    b.kaporit,
    b.caustik,
    b.ket,
    b.ukuran,
    b.jumlahMeter,
    i + 1,
  ]);
  await conn.query(
    `INSERT INTO ${T.dtl}
       (lhpd_lhp_nomor, lhpd_spk_nomor, lhpd_jml_plangkan, lhpd_rinso,
        lhpd_porstek, lhpd_m46, lhpd_kaporit, lhpd_caustik, lhpd_keterangan,
        lhpd_ukuran, lhpd_jumlahmeter, lhpd_nourut)
     VALUES ?`,
    [values],
  );
};

// LHK-HP.yymm.NNNN, dipanggil di dalam lock + transaksi
const buatNomor = async (conn, tanggalStr) => {
  const yymm = tanggalStr.slice(2, 4) + tanggalStr.slice(5, 7);
  const prefix = `${PREFIX_NOMOR}.${yymm}.`;
  const [rows] = await conn.query(
    `SELECT MAX(CAST(RIGHT(lhp_nomor, 4) AS UNSIGNED)) AS mx
     FROM ${T.hdr} WHERE lhp_nomor LIKE ?`,
    [`${prefix}%`],
  );
  const next = (Number(rows[0]?.mx) || 0) + 1;
  if (next > 9999) {
    throw galat("Nomor LHK bulan ini sudah mencapai batas (9999)");
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
};

// --- LOAD ---
const getLhkHapusPlankanById = async (nomor, user) => {
  const no = teks(nomor);
  const [hdr] = await db.query(
    `SELECT h.lhp_nomor AS Nomor,
            DATE_FORMAT(h.lhp_tanggal, '%Y-%m-%d') AS Tanggal,
            h.lhp_pab_kode AS Kode_Pabrik,
            p.pab_nama AS Nama_Pabrik
     FROM ${T.hdr} h
     LEFT JOIN ${T.pabrik} p ON p.pab_kode = h.lhp_pab_kode
     WHERE h.lhp_nomor = ?`,
    [no],
  );
  if (hdr.length === 0) {
    throw galat("Data LHK Hapus Plankan tidak ditemukan", "notFound");
  }
  await pastikanLhkDiCabang(db, no, user);

  const [detail] = await db.query(
    `SELECT d.lhpd_spk_nomor AS Nomor_SPK,
            x.spk_nama AS Nama_SPK,
            x.spk_jumlah AS Jumlah_Order,
            x.spk_panjang AS Panjang,
            x.spk_lebar AS Lebar,
            d.lhpd_jml_plangkan AS J_Plangkan,
            d.lhpd_jumlahmeter AS J_Meter,
            d.lhpd_ukuran AS Ukuran,
            ROUND(IFNULL(d.lhpd_ukuran, 0) * IFNULL(d.lhpd_jml_plangkan, 0), 2) AS Jumlah_Meter,
            d.lhpd_rinso AS Rinso,
            d.lhpd_porstek AS Porstek,
            d.lhpd_m46 AS M46,
            d.lhpd_kaporit AS Kaporit,
            d.lhpd_caustik AS Caustik,
            d.lhpd_keterangan AS Keterangan
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
     ) x ON x.spk_nomor = d.lhpd_spk_nomor
     WHERE d.lhpd_lhp_nomor = ?
     ORDER BY d.lhpd_nourut, d.lhpd_spk_nomor`,
    [no],
  );

  return { ...hdr[0], Detail: detail };
};

// --- Info SPK/MAP untuk mengisi baris (nama, jumlah, panjang, lebar) ---
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

// --- CREATE ---
const createLhkHapusPlankan = async (body, user) => {
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
    const peta = await validasiSumberBaris(conn, data.baris, user);
    await pastikanMutasiMasuk(conn, {
      kodeLini: "HAPUS_PLANKAN",
      tanggal: data.tanggal,
      daftarSpk: data.baris.map((b) => b.spk),
    });
    const baris = hitungJumlahMeter(data.baris, peta, null);

    const nomor = await buatNomor(conn, data.tanggal);
    try {
      await conn.query(
        `INSERT INTO ${T.hdr}
           (lhp_nomor, lhp_tanggal, lhp_pab_kode, lhp_date_create, lhp_user_create)
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
    await simpanDetail(conn, nomor, baris);

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
const updateLhkHapusPlankan = async (nomor, body, user) => {
  const no = teks(nomor);
  const data = siapkanData(body);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [lama] = await conn.query(
      `SELECT DATE_FORMAT(lhp_tanggal, '%Y-%m-%d') AS tgl
       FROM ${T.hdr} WHERE lhp_nomor = ? FOR UPDATE`,
      [no],
    );
    if (lama.length === 0) {
      throw galat("Data LHK Hapus Plankan tidak ditemukan", "notFound");
    }

    // tutup buku: tanggal lama dan tanggal baru sama-sama dicek
    if (lama[0].tgl) {
      await cekTutupBuku(lama[0].tgl);
    }
    await cekTutupBuku(data.tanggal);

    await pastikanLhkDiCabang(conn, no, user);
    await pastikanBelumDipakai(conn, no);
    await pastikanPabrik(conn, data.pabrik);
    const peta = await validasiSumberBaris(conn, data.baris, user);
    await pastikanMutasiMasuk(conn, {
      kodeLini: "HAPUS_PLANKAN",
      tanggal: data.tanggal,
      daftarSpk: data.baris.map((b) => b.spk),
      nomorLhk: no,
    });

    const [lamaRows] = await conn.query(
      `SELECT lhpd_spk_nomor AS spk, lhpd_jml_plangkan AS plangkan,
              lhpd_jumlahmeter AS jumlahmeter
       FROM ${T.dtl} WHERE lhpd_lhp_nomor = ?`,
      [no],
    );
    const lamaPeta = new Map(lamaRows.map((r) => [r.spk, r]));
    const baris = hitungJumlahMeter(data.baris, peta, lamaPeta);

    await conn.query(
      `UPDATE ${T.hdr}
       SET lhp_tanggal = ?, lhp_pab_kode = ?,
           lhp_date_modified = CURDATE(), lhp_user_modified = ?
       WHERE lhp_nomor = ?`,
      [data.tanggal, data.pabrik, user?.kode ?? null, no],
    );
    await simpanDetail(conn, no, baris);

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
  getLhkHapusPlankanById,
  getInfoSpk,
  getLookupPabrik,
  createLhkHapusPlankan,
  updateLhkHapusPlankan,
};
