const db = require("../../../config/database");

// ─────────────────────────────────────────────────────────
// Filter dasar (dipakai getReport & getSummaryByDesainer)
// ─────────────────────────────────────────────────────────
const buildWhere = ({
  startDate,
  endDate,
  desainer = "",
  customer = "",
  jenisPekerjaan = "",
  status = "",
}) => {
  if (!startDate || !endDate) {
    throw new Error("Rentang tanggal wajib diisi.");
  }
  let where = `WHERE h.pd_tanggal BETWEEN ? AND ?`;
  const params = [startDate, endDate];

  if (desainer) {
    where += ` AND h.pd_desainer = ?`;
    params.push(desainer);
  }
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

// ─────────────────────────────────────────────────────────
// Laporan detail — 1 baris per PD, dengan breakdown status
// ─────────────────────────────────────────────────────────
const getReport = async (filters) => {
  const { where, params } = buildWhere(filters);

  const [rows] = await db.query(
    `SELECT
       h.pd_nomor AS Nomor,
       DATE_FORMAT(h.pd_tanggal, '%Y-%m-%d') AS Tanggal,
       h.pd_nama_project AS NamaProject,
       IFNULL(c.cus_nama, '') AS Customer,
       h.pd_jenis_pekerjaan AS JenisPekerjaan,
       h.pd_desainer AS DesainerKode,
       IFNULL(ud.user_nama, h.pd_desainer) AS Desainer,
       h.pd_nama_marketing AS MarketingKode,
       IFNULL(um.user_nama, h.pd_nama_marketing) AS Marketing,
       h.pd_jml AS Jml,
       h.pd_status AS Status,
       h.pd_keterangan AS Keterangan,
       CASE WHEN h.pd_status IN ('OPEN','PROGRESS','CLOSE')
            THEN h.pd_jmljadi ELSE 0 END AS Acc,
       CASE WHEN h.pd_status IN ('OPEN','PROGRESS')
            THEN h.pd_jml - h.pd_jmljadi ELSE 0 END AS Revisi,
       CASE WHEN h.pd_status = 'PENDING' THEN h.pd_jml ELSE 0 END AS Pending,
       CASE WHEN h.pd_status = 'CANCEL' THEN h.pd_jml ELSE 0 END AS Cancel,
       CASE WHEN h.pd_status = 'CANCEL_ALT' THEN h.pd_jml ELSE 0 END AS CancelAlt,
       l.lhk_nomor AS LhkNomor,
       DATE_FORMAT(l.lhk_tgl_selesai, '%Y-%m-%d %H:%i') AS TglSelesai
     FROM tpermintaan_desain h
     LEFT JOIN tcustomer c ON c.cus_kode = h.pd_customer
     LEFT JOIN tuser ud ON ud.user_kode = h.pd_desainer
     LEFT JOIN tuser um ON um.user_kode = h.pd_nama_marketing
     LEFT JOIN tlhk_desain l ON l.lhk_pd_nomor = h.pd_nomor
     ${where}
     ORDER BY h.pd_tanggal, h.pd_nomor`,
    params,
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// Rekap pivot — Desainer x Marketing, breakdown status + total
// (dasar sheet "Total Semua" & panel rekap di web)
// ─────────────────────────────────────────────────────────
const getSummaryByDesainer = async (filters) => {
  const { where, params } = buildWhere(filters);

  const [rows] = await db.query(
    `SELECT
       h.pd_desainer AS DesainerKode,
       IFNULL(ud.user_nama, h.pd_desainer) AS Desainer,
       h.pd_nama_marketing AS MarketingKode,
       IFNULL(um.user_nama, h.pd_nama_marketing) AS Marketing,
       SUM(h.pd_jml) AS JumlahTot,
       SUM(CASE WHEN h.pd_status IN ('OPEN','PROGRESS','CLOSE')
                THEN h.pd_jmljadi ELSE 0 END) AS Acc,
       SUM(CASE WHEN h.pd_status IN ('OPEN','PROGRESS')
                THEN h.pd_jml - h.pd_jmljadi ELSE 0 END) AS Revisi,
       SUM(CASE WHEN h.pd_status = 'PENDING' THEN h.pd_jml ELSE 0 END) AS Pending,
       SUM(CASE WHEN h.pd_status = 'CANCEL' THEN h.pd_jml ELSE 0 END) AS Cancel,
       SUM(CASE WHEN h.pd_status = 'CANCEL_ALT' THEN h.pd_jml ELSE 0 END) AS CancelAlt
     FROM tpermintaan_desain h
     LEFT JOIN tuser ud ON ud.user_kode = h.pd_desainer
     LEFT JOIN tuser um ON um.user_kode = h.pd_nama_marketing
     ${where}
     GROUP BY h.pd_desainer, h.pd_nama_marketing
     ORDER BY Desainer, Marketing`,
    params,
  );
  return rows;
};

module.exports = { getReport, getSummaryByDesainer };
