const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");
const browseService = require("./permintaanPembelianBahanService");

const PREFIX = "MBB";
const LOCK_NAME = "mbb_nomor";
const BAGIAN_INPUT = "GUDANG";
const BAGIAN_SUPER = ["EDP", "DIR", "DIREKSI", "AUDIT"];
// Cabang spanduk hanya boleh bahan SB…, cabang lain hanya bahan non-SB
const CAB_SPANDUK = ["P02", "P05"];
const MAX_JUMLAH = 999999.99; // double(8,2)

const bagianUser = (user) => String(user?.bagian || "").toUpperCase();
const cabangUser = (user) => String(user?.cabang || "HO-");
const isSuper = (user) => BAGIAN_SUPER.includes(bagianUser(user));

const assertBolehInput = (user) => {
  if (!isSuper(user) && bagianUser(user) !== BAGIAN_INPUT) {
    throw new Error(
      "Hanya bagian Gudang yang boleh membuat/mengubah permintaan.",
    );
  }
};

const assertCabang = (user, cabDokumen) => {
  if (!isSuper(user) && cabangUser(user) !== cabDokumen) {
    throw new Error("Dokumen cabang lain tidak bisa diubah.");
  }
};

const normalTanggal = (v) => {
  const s = String(v || "").substring(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(s).getTime())) {
    throw new Error("Tanggal tidak valid.");
  }
  return s;
};

const normalTeks = (v, maks, label) => {
  const s = String(v ?? "").trim();
  if (s.length > maks) throw new Error(`${label} maksimal ${maks} karakter.`);
  return s;
};

const cekTutupBuku = async (tanggal) => {
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();
  if (zdtClose && new Date(tanggal) < zdtClose) {
    throw new Error("Transaksi tsb sudah close.\nTidak bisa disimpan.");
  }
};

// Validasi dan lengkapi detail dari master bahan (satuan dari master, bukan dari klien)
const siapkanDetail = async (conn, cab, items) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Detail bahan wajib diisi minimal 1 baris.");
  }

  const kodeList = items.map((it) => String(it?.kode ?? "").trim());
  if (kodeList.some((k) => !k)) throw new Error("Kode bahan wajib diisi.");

  const unik = new Set(kodeList.map((k) => k.toUpperCase()));
  if (unik.size !== kodeList.length) {
    throw new Error("Ada bahan yang dobel dalam satu dokumen.");
  }

  const [master] = await conn.query(
    `SELECT Bhn_kode, Bhn_satuan FROM tbahan
      WHERE Bhn_kode IN (?) AND bhn_aktif = 0`,
    [kodeList],
  );
  const peta = new Map(
    master.map((m) => [String(m.Bhn_kode).toUpperCase(), m]),
  );
  const spandukCab = CAB_SPANDUK.includes(cab);

  return items.map((it, i) => {
    const m = peta.get(kodeList[i].toUpperCase());
    if (!m)
      throw new Error(`Bahan ${kodeList[i]} tidak ditemukan atau tidak aktif.`);

    const isSB = String(m.Bhn_kode).startsWith("SB");
    if (isSB !== spandukCab) {
      throw new Error(
        `Bahan ${m.Bhn_kode} tidak sesuai jenis bahan cabang ${cab}.`,
      );
    }

    const jumlah = Number(it.jumlah);
    if (!Number.isFinite(jumlah) || jumlah <= 0) {
      throw new Error(`Jumlah bahan ${m.Bhn_kode} harus lebih dari 0.`);
    }
    if (jumlah > MAX_JUMLAH) {
      throw new Error(`Jumlah bahan ${m.Bhn_kode} melebihi batas.`);
    }

    return {
      kode: m.Bhn_kode,
      nourut: i + 1,
      satuan: m.Bhn_satuan || "",
      jumlah,
      ket: normalTeks(it.keterangan, 150, `Keterangan bahan ${m.Bhn_kode}`),
    };
  });
};

const insertDetail = async (conn, nomor, rows) => {
  const values = rows.map((r) => [
    nomor,
    r.kode,
    r.nourut,
    r.satuan,
    r.jumlah,
    r.ket,
  ]);
  await conn.query(
    `INSERT INTO tmintabelibahan_dtl
       (mbbd_nomor, mbbd_bhn_kode, mbbd_nourut, mbbd_satuan, mbbd_jumlah, mbbd_ket)
     VALUES ?`,
    [values],
  );
};

// Format: MBB + tahun + "." + 5 digit. Dipanggil saat GET_LOCK dipegang.
const buatNomor = async (conn, tanggal) => {
  const awal = `${PREFIX}${tanggal.substring(0, 4)}.`;
  const [[row]] = await conn.query(
    `SELECT MAX(mbb_nomor) AS maks FROM tmintabelibahan_hdr WHERE mbb_nomor LIKE ?`,
    [`${awal}%`],
  );
  const urut = row.maks
    ? parseInt(String(row.maks).substring(awal.length), 10) + 1
    : 1;
  return awal + String(urut).padStart(5, "0");
};

const getForEdit = async (nomor, user) => {
  const [hdr] = await db.query(
    `SELECT mbb_nomor AS Nomor, DATE_FORMAT(mbb_tanggal, "%Y-%m-%d") AS Tanggal,
            mbb_ket AS Keterangan, mbb_cab AS Cab, mbb_bagian AS Bagian,
            mbb_status AS Status
       FROM tmintabelibahan_hdr WHERE mbb_nomor = ?`,
    [nomor],
  );
  if (hdr.length === 0) throw new Error("Data tidak ditemukan.");
  assertCabang(user, hdr[0].Cab);

  const detail = await browseService.getBrowseDetail(nomor);
  return { header: hdr[0], detail };
};

const create = async (payload, user) => {
  assertBolehInput(user);
  const tanggal = normalTanggal(payload?.tanggal);
  const ket = normalTeks(payload?.keterangan, 200, "Keterangan");
  const cab = cabangUser(user);

  const conn = await db.getConnection();
  let lockDipegang = false;
  try {
    await cekTutupBuku(tanggal);

    // Lock sebelum transaksi, supaya MAX nomor dibaca setelah dokumen lain commit
    const [[lock]] = await conn.query(`SELECT GET_LOCK(?, 10) AS ok`, [
      LOCK_NAME,
    ]);
    if (Number(lock.ok) !== 1)
      throw new Error("Penomoran sedang sibuk, coba lagi.");
    lockDipegang = true;

    await conn.beginTransaction();

    const rows = await siapkanDetail(conn, cab, payload?.items);
    const nomor = await buatNomor(conn, tanggal);

    await conn.query(
      `INSERT INTO tmintabelibahan_hdr
         (mbb_nomor, mbb_tanggal, mbb_ket, mbb_cab, mbb_bagian, mbb_status,
          date_create, user_create)
       VALUES (?, ?, ?, ?, ?, '', NOW(), ?)`,
      [nomor, tanggal, ket, cab, bagianUser(user).substring(0, 15), user.kode],
    );
    await insertDetail(conn, nomor, rows);

    await conn.commit();
    return { nomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    if (lockDipegang) {
      try {
        await conn.query(`DO RELEASE_LOCK(?)`, [LOCK_NAME]);
      } catch (e) {
        /* lock dilepas otomatis saat koneksi ditutup */
      }
    }
    conn.release();
  }
};

const update = async (nomor, payload, user) => {
  assertBolehInput(user);
  const tanggal = normalTanggal(payload?.tanggal);
  const ket = normalTeks(payload?.keterangan, 200, "Keterangan");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [hdr] = await conn.query(
      `SELECT DATE_FORMAT(mbb_tanggal, "%Y-%m-%d") AS tanggal, mbb_cab, mbb_status
         FROM tmintabelibahan_hdr WHERE mbb_nomor = ? FOR UPDATE`,
      [nomor],
    );
    if (hdr.length === 0) throw new Error("Data tidak ditemukan.");

    assertCabang(user, hdr[0].mbb_cab);
    if (hdr[0].mbb_status !== "") {
      throw new Error(`Sudah ${hdr[0].mbb_status}\nTidak bisa diubah.`);
    }

    // Tanggal lama dan baru sama-sama tidak boleh di periode yang sudah ditutup
    await cekTutupBuku(hdr[0].tanggal);
    await cekTutupBuku(tanggal);

    const [dipakai] = await conn.query(
      `SELECT po_nomor FROM tpo_hdr WHERE po_mbb_nomor = ? LIMIT 1`,
      [nomor],
    );
    if (dipakai.length > 0) {
      throw new Error(
        `Sudah dipakai di PO ${dipakai[0].po_nomor}. Tidak bisa diubah.`,
      );
    }

    const rows = await siapkanDetail(conn, hdr[0].mbb_cab, payload?.items);

    await conn.query(
      `UPDATE tmintabelibahan_hdr
          SET mbb_tanggal = ?, mbb_ket = ?, date_modified = NOW(), user_modified = ?
        WHERE mbb_nomor = ?`,
      [tanggal, ket, user.kode, nomor],
    );
    await conn.query(`DELETE FROM tmintabelibahan_dtl WHERE mbbd_nomor = ?`, [
      nomor,
    ]);
    await insertDetail(conn, nomor, rows);

    await conn.commit();
    return { nomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = {
  getForEdit,
  create,
  update,
};
