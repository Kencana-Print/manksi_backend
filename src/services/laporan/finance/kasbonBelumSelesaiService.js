const db = require("../../../config/database");

// ── Default account per cabang ────────────────────────────────────────
// Delphi FormShow: sama dengan Buku Besar
const getDefaultAccount = (cabang) => {
  if (cabang === "P01") return "A-111101";
  if (cabang === "P02") return "A-111102";
  if (cabang === "P04") return "A-111103";
  return "A-111101";
};

// ── Search account ────────────────────────────────────────────────────
// Delphi bantuanreka:
//   P01: LEFT(rek_kode,5)="A-111"  ← beda dari Buku Besar
//   Lainnya: rek_cabang = cabang
const searchAccount = async (cabang, search) => {
  let sql;
  const params = [];

  if (cabang === "P01") {
    sql = `SELECT rek_kode AS kode, rek_nama AS nama
           FROM finance.trekening
           WHERE LEFT(rek_kode, 5) = 'A-111'`;
  } else {
    sql = `SELECT rek_kode AS kode, rek_nama AS nama
           FROM finance.trekening
           WHERE rek_cabang = ?`;
    params.push(cabang);
  }

  if (search) {
    sql += ` AND (rek_kode LIKE ? OR rek_nama LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }

  sql += ` ORDER BY rek_kode LIMIT 100`;
  const [rows] = await db.query(sql, params);
  return rows;
};

// ── Validasi account ──────────────────────────────────────────────────
const getAccountByKode = async (kode) => {
  const [[row]] = await db.query(
    `SELECT rek_kode AS kode, rek_nama AS nama
     FROM finance.trekening WHERE rek_kode = ?`,
    [kode],
  );
  return row || null;
};

// ── Kasbon Belum Selesai — Master ─────────────────────────────────────
// Delphi btnRefreshClick — query master:
//   tkasbon WHERE bon_selesai=0 AND bon_rek_kode=rekkode
//   bon_jenis=0 → "KAS", else → "BANK"
const getMaster = async (rekkode) => {
  const [rows] = await db.query(
    `SELECT
       b.bon_nomor                                    AS Nomor,
       DATE_FORMAT(b.bon_tanggal, '%Y-%m-%d')         AS Tanggal,
       IF(b.bon_jenis = 0, 'KAS', 'BANK')             AS Jenis,
       IFNULL(b.bon_pjh_nomor, '')                    AS Pjh,
       IFNULL(b.bon_nota, '')                         AS Nota,
       IFNULL(b.bon_penerima, '')                     AS Penerima,
       IFNULL(b.bon_nominal, 0)                       AS Nominal,
       IFNULL(b.bon_Keterangan, '')                   AS Keterangan
     FROM finance.tkasbon b
     WHERE b.bon_selesai = 0
       AND b.bon_rek_kode = ?
     ORDER BY b.bon_nomor`,
    [rekkode],
  );
  return rows;
};

// ── Kasbon Belum Selesai — Detail ─────────────────────────────────────
// Delphi SQLDetail — UNION dua sumber, filter bon_selesai=0 AND bon_jenis=0:
//
// Sumber 1: ga2.tpermintaan_dtl JOIN tkasbon
//   Hanya untuk bon_jenis=0 (KAS)
//   Uraian: concat(pmd_nama, " ", pmd_spesifikasi)
//   Keterangan: "Pengajuan GA"
//
// Sumber 2: tkasbonitem JOIN tkasbon
//   Hanya untuk bon_jenis=0 (KAS)
//   Uraian: concat(bond_nama, " ", bond_spesifikasi)
//   Keterangan: "" (kosong)
//
// ORDER BY Nomor, keterangan DESC, uraian
// (DESC pada keterangan → "Pengajuan GA" muncul duluan karena P > "")
const getDetail = async (rekkode) => {
  const [rows] = await db.query(
    `SELECT x.Nomor, x.Uraian, x.Satuan, x.Qty,
            x.Nominal, x.Total, x.Kegunaan, x.Keterangan
     FROM (
       -- Sumber 1: Pengajuan GA (tpermintaan_dtl dari database ga2)
       SELECT
         d.pmd_bon                                          AS Nomor,
         CONCAT(IFNULL(d.pmd_nama,''), ' ',
                IFNULL(d.pmd_spesifikasi,''))               AS Uraian,
         IFNULL(d.pmd_satuan, '')                           AS Satuan,
         IFNULL(d.pmd_qty_riil, 0)                         AS Qty,
         IFNULL(d.pmd_nilai, 0)                            AS Nominal,
         (IFNULL(d.pmd_qty_riil,0) * IFNULL(d.pmd_nilai,0)) AS Total,
         IFNULL(d.pmd_kegunaan, '')                        AS Kegunaan,
         'Pengajuan GA'                                     AS Keterangan
       FROM ga2.tpermintaan_dtl d
       INNER JOIN finance.tkasbon b ON b.bon_nomor = d.pmd_bon
       WHERE b.bon_selesai = 0
         AND b.bon_jenis = 0
         AND b.bon_rek_kode = ?

       UNION ALL

       -- Sumber 2: Item kasbon langsung (tkasbonitem)
       SELECT
         i.bond_nomor                                       AS Nomor,
         CONCAT(IFNULL(i.bond_nama,''), ' ',
                IFNULL(i.bond_spesifikasi,''))              AS Uraian,
         IFNULL(i.bond_satuan, '')                         AS Satuan,
         IFNULL(i.bond_qty, 0)                             AS Qty,
         IFNULL(i.bond_nominal, 0)                         AS Nominal,
         (IFNULL(i.bond_qty,0) * IFNULL(i.bond_nominal,0)) AS Total,
         ''                                                 AS Kegunaan,
         ''                                                 AS Keterangan
       FROM finance.tkasbonitem i
       INNER JOIN finance.tkasbon k ON k.bon_nomor = i.bond_nomor
       WHERE k.bon_selesai = 0
         AND k.bon_jenis = 0
         AND k.bon_rek_kode = ?
     ) x
     ORDER BY x.Nomor, x.Keterangan DESC, x.Uraian`,
    [rekkode, rekkode],
  );
  return rows;
};

// ── Gabungkan master + detail untuk response ──────────────────────────
const getKasbonBelumSelesai = async (rekkode) => {
  const [master, detail] = await Promise.all([
    getMaster(rekkode),
    getDetail(rekkode),
  ]);
  return { master, detail };
};

module.exports = {
  getDefaultAccount,
  searchAccount,
  getAccountByKode,
  getMaster,
  getDetail,
  getKasbonBelumSelesai,
};
