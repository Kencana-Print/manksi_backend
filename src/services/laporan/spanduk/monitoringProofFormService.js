const db = require("../../../config/database");
const {
  galat,
  teks,
  norm,
  adalahSuperadmin,
  cabangUser,
} = require("../../spanduk/lhk/lhkCommon");

const DIVISI_SPANDUK = 1;
const STATUS_VALID = ["OK", "NOK"];
const MAKS_ARSIP = 20;
const MAKS_QTY = 99999999;
const FMT_TGL = "%Y-%m-%d";

const tanggalValid = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

// Guard MAP: divisi Spanduk dan cabang user (non-superadmin)
const periksaAkses = (m, nomor, user) => {
  if (!m) throw galat(`MAP ${nomor} tidak ditemukan`, "notFound");
  if (Number(m.mspk_divisi) !== DIVISI_SPANDUK) {
    throw galat(`MAP ${nomor} bukan divisi Spanduk`, "forbidden");
  }
  if (!adalahSuperadmin(user) && norm(m.mspk_cab) !== cabangUser(user)) {
    throw galat(`MAP ${nomor} milik cabang lain`, "forbidden");
  }
};

// ── LOAD (Delphi: loaddata) ──
const getForm = async (nomor, user) => {
  const kode = teks(nomor);
  if (!kode) throw galat("Nomor MAP wajib diisi");

  const [[m]] = await db.query(
    `SELECT m.mspk_nomor AS Nomor,
            m.mspk_divisi, m.mspk_cab,
            DATE_FORMAT(m.mspk_tanggal, '${FMT_TGL}') AS Tanggal,
            DATE_FORMAT(m.mspk_dateline, '${FMT_TGL}') AS Deadline,
            m.mspk_perush_kode AS Perush_Kode,
            pr.perush_nama AS Perush_Nama,
            m.mspk_nama AS Nama,
            m.mspk_jumlah AS Jumlah,
            m.mspk_panjang AS Panjang,
            m.mspk_lebar AS Lebar,
            m.mspk_gramasi AS Gramasi,
            m.mspk_kain AS Kain,
            m.mspk_rencana_order AS Rencana_Order,
            m.mspk_workshop AS Workshop,
            m.mspk_keterangan AS Keterangan,
            p.tph_nomor IS NOT NULL AS Ada_Proof,
            DATE_FORMAT(p.tph_tanggal_proof, '${FMT_TGL}') AS Tgl_Proof,
            IFNULL(p.tph_qty, 0) AS Jml_Proof,
            IFNULL(p.tph_gdg_kode, '') AS Gudang_Kode,
            IFNULL(g.gdg_nama, '') AS Gudang_Nama,
            IFNULL(p.tph_status, '') AS Status,
            DATE_FORMAT(p.tph_tanggal_status, '${FMT_TGL}') AS Tg_Status,
            IFNULL(p.tph_arsip, '') AS Arsip
     FROM kencanaprint.tmemospk m
     LEFT JOIN kencanaprint.tperusahaan pr ON pr.perush_kode = m.mspk_perush_kode
     LEFT JOIN kencanaprint.tproof_hdr p ON p.tph_mspk_nomor = m.mspk_nomor
     LEFT JOIN kencanaprint.tgudang g ON g.gdg_kode = p.tph_gdg_kode
     WHERE m.mspk_nomor = ?
     LIMIT 1`,
    [kode],
  );

  periksaAkses(m, kode, user);

  const { mspk_divisi, mspk_cab, ...data } = m;
  return { ...data, Ada_Proof: Boolean(data.Ada_Proof) };
};

// ── SIMPAN (Delphi: simpandata, insert atau update) ──
const simpan = async (nomor, payload, user) => {
  const kode = teks(nomor);
  if (!kode) throw galat("Nomor MAP wajib diisi");

  const qty = Number(payload?.jumlahProof);
  if (!Number.isInteger(qty) || qty < 1 || qty > MAKS_QTY) {
    throw galat("Jumlah Proof belum diisi (bilangan bulat, minimal 1)");
  }

  const gudang = teks(payload?.gudang);
  if (!gudang) throw galat("Lokasi Proof belum diisi");

  const tglProof = teks(payload?.tglProof);
  if (!tanggalValid(tglProof)) throw galat("Tanggal Proof tidak valid");

  const tglStatusTeks = teks(payload?.tglStatus);
  if (tglStatusTeks && !tanggalValid(tglStatusTeks)) {
    throw galat("Tanggal Status tidak valid");
  }
  const tglStatus = tglStatusTeks || null;

  const status = teks(payload?.status).toUpperCase();
  if (status && !STATUS_VALID.includes(status)) {
    throw galat("Status harus OK, NOK, atau kosong");
  }

  const arsip = teks(payload?.arsip);
  if (arsip.length > MAKS_ARSIP) {
    throw galat(`Arsip maksimal ${MAKS_ARSIP} karakter`);
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Kunci baris MAP: dua simpan bersamaan untuk MAP yang sama diserialkan
    const [[m]] = await conn.query(
      `SELECT mspk_nomor, mspk_divisi, mspk_cab,
              DATE_FORMAT(mspk_tanggal, '${FMT_TGL}') AS mspk_tanggal
         FROM kencanaprint.tmemospk WHERE mspk_nomor = ? FOR UPDATE`,
      [kode],
    );
    periksaAkses(m, kode, user);

    const [[g]] = await conn.query(
      `SELECT gdg_kode FROM kencanaprint.tgudang
        WHERE gdg_kode = ? AND gdg_kode LIKE '%WH-%'`,
      [gudang],
    );
    if (!g) throw galat(`Lokasi Proof ${gudang} tidak valid`);

    const [[ada]] = await conn.query(
      `SELECT tph_nomor FROM kencanaprint.tproof_hdr
        WHERE tph_mspk_nomor = ? LIMIT 1`,
      [kode],
    );

    if (ada) {
      await conn.query(
        `UPDATE kencanaprint.tproof_hdr
            SET tph_tanggal = ?, tph_gdg_kode = ?, tph_tanggal_proof = ?,
                tph_qty = ?, tph_status = ?, tph_tanggal_status = ?,
                tph_arsip = ?, date_modified = CURDATE(), user_modified = ?
          WHERE tph_nomor = ?`,
        [
          m.mspk_tanggal,
          gudang,
          tglProof,
          qty,
          status || null,
          tglStatus,
          arsip,
          user.kode,
          ada.tph_nomor,
        ],
      );
    } else {
      try {
        await conn.query(
          `INSERT INTO kencanaprint.tproof_hdr
             (tph_nomor, tph_tanggal, tph_gdg_kode, tph_mspk_nomor,
              tph_tanggal_proof, tph_qty, tph_status, tph_tanggal_status,
              tph_arsip, date_create, user_create)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?)`,
          [
            kode,
            m.mspk_tanggal,
            gudang,
            kode,
            tglProof,
            qty,
            status || null,
            tglStatus,
            arsip,
            user.kode,
          ],
        );
      } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
          throw galat(
            `Nomor proof ${kode} sudah dipakai baris proof lain (data lama tidak konsisten)`,
          );
        }
        throw err;
      }
    }

    await conn.commit();
    return { nomor: kode, baru: !ada };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// ── LOOKUP gudang proof (Delphi F1: tgudang LIKE '%WH-%') ──
const getGudangProof = async () => {
  const [rows] = await db.query(
    `SELECT gdg_kode AS Kode, gdg_nama AS Nama
       FROM kencanaprint.tgudang
      WHERE gdg_kode LIKE '%WH-%'
      ORDER BY gdg_kode`,
  );
  return rows;
};

// ── LOOKUP MAP untuk tombol Baru (Delphi F1 di Nomor Pra SPK) ──
const getDaftarMap = async (cari, user) => {
  const kata = `%${teks(cari)}%`;
  const params = [DIVISI_SPANDUK, kata, kata];
  let sqlCab = "";
  if (!adalahSuperadmin(user)) {
    sqlCab = "AND m.mspk_cab = ?";
    params.push(cabangUser(user));
  }
  const [rows] = await db.query(
    `SELECT m.mspk_nomor AS Nomor,
            DATE_FORMAT(m.mspk_tanggal, '${FMT_TGL}') AS Tanggal,
            m.mspk_jo_kode AS Jenis,
            m.mspk_nama AS Nama
       FROM kencanaprint.tmemospk m
      WHERE m.mspk_divisi = ?
        AND (m.mspk_nomor LIKE ? OR m.mspk_nama LIKE ?)
        ${sqlCab}
      ORDER BY m.mspk_tanggal DESC, m.mspk_nomor DESC
      LIMIT 50`,
    params,
  );
  return rows;
};

module.exports = { getForm, simpan, getGudangProof, getDaftarMap };
