const db = require("../../../config/database");

const MANUAL = `'PENDING','CANCEL','CANCEL_ALT'`;

// Filter header (desainer difilter di level baris, bukan header)
const buildWhere = ({
  startDate,
  endDate,
  customer = "",
  jenisPekerjaan = "",
  status = "",
}) => {
  if (!startDate || !endDate) {
    throw new Error("Rentang tanggal wajib diisi.");
  }
  let where = `WHERE h.pd_tanggal BETWEEN ? AND ?`;
  const params = [startDate, endDate];
  if (customer) {
    where += ` AND h.pd_customer = ?`;
    params.push(customer);
  }
  if (jenisPekerjaan) {
    where += ` AND h.pd_jenis_pekerjaan = ?`;
    params.push(jenisPekerjaan);
  }
  if (status) {
    where += ` AND h.pd_status = ?`;
    params.push(status);
  }
  return { where, params };
};

// Baris dasar per (PD, desainer). Tiga sumber digabung:
//  A. pengerjaan desainer (kerja)      -> Acc / Progress
//  B. sisa detail yang belum diambil   -> Belum
//  C. PD berstatus manual              -> Pending / Cancel / Cancel Alt
const linesSql = (where) => `
  SELECT h.pd_nomor, k.kerja_desainer AS dk,
         SUM(k.kerja_jml) AS jml,
         SUM(IF(k.kerja_status = 'CLOSE', k.kerja_jml, 0)) AS acc,
         SUM(IF(k.kerja_status = 'PROGRESS', k.kerja_jml, 0)) AS progress,
         0 AS belum, 0 AS pending, 0 AS cancel, 0 AS cancel_alt,
         GROUP_CONCAT(DISTINCT k.kerja_lhk_nomor ORDER BY k.kerja_lhk_nomor SEPARATOR ', ') AS lhk,
         MAX(k.kerja_tgl_close) AS tgl_selesai
  FROM tpermintaan_desain h
  JOIN tpermintaan_desain_kerja k ON k.kerja_pd_nomor = h.pd_nomor
  ${where} AND h.pd_status NOT IN (${MANUAL})
  GROUP BY h.pd_nomor, k.kerja_desainer

  UNION ALL

  SELECT h.pd_nomor, IFNULL(d.pd2_desainer, '') AS dk,
         SUM(GREATEST(d.pd2_pd_jml - IFNULL(kk.tot, 0), 0)) AS jml,
         0, 0,
         SUM(GREATEST(d.pd2_pd_jml - IFNULL(kk.tot, 0), 0)) AS belum,
         0, 0, 0, NULL, NULL
  FROM tpermintaan_desain h
  JOIN tpermintaan_desain_detail d ON d.pd2_pd_nomor = h.pd_nomor
  LEFT JOIN (
    SELECT kerja_pd2_id, SUM(kerja_jml) AS tot
    FROM tpermintaan_desain_kerja GROUP BY kerja_pd2_id
  ) kk ON kk.kerja_pd2_id = d.pd2_id
  ${where} AND h.pd_status NOT IN (${MANUAL})
  GROUP BY h.pd_nomor, IFNULL(d.pd2_desainer, '')
  HAVING belum > 0

  UNION ALL

  SELECT h.pd_nomor, IFNULL(d.pd2_desainer, '') AS dk,
         SUM(d.pd2_pd_jml) AS jml, 0, 0, 0,
         SUM(IF(h.pd_status = 'PENDING', d.pd2_pd_jml, 0)),
         SUM(IF(h.pd_status = 'CANCEL', d.pd2_pd_jml, 0)),
         SUM(IF(h.pd_status = 'CANCEL_ALT', d.pd2_pd_jml, 0)),
         NULL, NULL
  FROM tpermintaan_desain h
  JOIN tpermintaan_desain_detail d ON d.pd2_pd_nomor = h.pd_nomor
  ${where} AND h.pd_status IN (${MANUAL})
  GROUP BY h.pd_nomor, IFNULL(d.pd2_desainer, '')
`;

const desainerName = `IF(x.dk = '', '(Belum Ditugaskan)', IFNULL(ud.user_nama, x.dk))`;

// ─────────────────────────────────────────────────────────
// Laporan detail — 1 baris per (PD, desainer)
// ─────────────────────────────────────────────────────────
const getReport = async (filters) => {
  const { where, params } = buildWhere(filters);
  const desainer = filters.desainer || "";
  const allParams = [...params, ...params, ...params];
  if (desainer) allParams.push(desainer);

  const [rows] = await db.query(
    `SELECT
       h.pd_nomor AS Nomor,
       DATE_FORMAT(h.pd_tanggal, '%Y-%m-%d') AS Tanggal,
       h.pd_nama_project AS NamaProject,
       IFNULL(c.cus_nama, '') AS Customer,
       h.pd_jenis_pekerjaan AS JenisPekerjaan,
       x.dk AS DesainerKode,
       ${desainerName} AS Desainer,
       h.pd_nama_marketing AS MarketingKode,
       IFNULL(um.user_nama, h.pd_nama_marketing) AS Marketing,
       SUM(x.jml) AS Jml,
       SUM(x.acc) AS Acc,
       SUM(x.progress) AS Progress,
       SUM(x.belum) AS Belum,
       SUM(x.pending) AS Pending,
       SUM(x.cancel) AS Cancel,
       SUM(x.cancel_alt) AS CancelAlt,
       h.pd_status AS Status,
       h.pd_keterangan AS Keterangan,
       IFNULL(h.pd_so_map_nomor, '') AS SoMap,
       IFNULL(h.pd_path_desain, '') AS PathDesain,
       GROUP_CONCAT(DISTINCT x.lhk SEPARATOR ', ') AS LhkNomor,
       DATE_FORMAT(MAX(x.tgl_selesai), '%Y-%m-%d %H:%i') AS TglSelesai
     FROM (${linesSql(where)}) x
     JOIN tpermintaan_desain h ON h.pd_nomor = x.pd_nomor
     LEFT JOIN tcustomer c ON c.cus_kode = h.pd_customer
     LEFT JOIN tuser ud ON ud.user_kode = x.dk
     LEFT JOIN tuser um ON um.user_kode = h.pd_nama_marketing
     ${desainer ? "WHERE x.dk = ?" : ""}
     GROUP BY h.pd_nomor, x.dk
     ORDER BY h.pd_tanggal, h.pd_nomor, Desainer`,
    allParams,
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// Rekap pivot — Desainer x Marketing
// ─────────────────────────────────────────────────────────
const getSummaryByDesainer = async (filters) => {
  const { where, params } = buildWhere(filters);
  const desainer = filters.desainer || "";
  const allParams = [...params, ...params, ...params];
  if (desainer) allParams.push(desainer);

  const [rows] = await db.query(
    `SELECT
       x.dk AS DesainerKode,
       ${desainerName} AS Desainer,
       h.pd_nama_marketing AS MarketingKode,
       IFNULL(um.user_nama, h.pd_nama_marketing) AS Marketing,
       SUM(x.jml) AS JumlahTot,
       SUM(x.acc) AS Acc,
       SUM(x.progress) AS Progress,
       SUM(x.belum) AS Belum,
       SUM(x.pending) AS Pending,
       SUM(x.cancel) AS Cancel,
       SUM(x.cancel_alt) AS CancelAlt
     FROM (${linesSql(where)}) x
     JOIN tpermintaan_desain h ON h.pd_nomor = x.pd_nomor
     LEFT JOIN tuser ud ON ud.user_kode = x.dk
     LEFT JOIN tuser um ON um.user_kode = h.pd_nama_marketing
     ${desainer ? "WHERE x.dk = ?" : ""}
     GROUP BY x.dk, h.pd_nama_marketing
     ORDER BY Desainer, Marketing`,
    allParams,
  );
  return rows;
};

module.exports = { getReport, getSummaryByDesainer };
