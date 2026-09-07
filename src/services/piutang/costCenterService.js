const db = require("../../config/database");

const getAll = async () => {
  const [headers] = await db.query(
    `SELECT cc_kode, cc_nama, cc_cabang FROM financenew.tcostcenter ORDER BY cc_nama`,
  );
  const [details] = await db.query(
    `SELECT dc_kode, dc_nama FROM financenew.tcostcenteritem ORDER BY dc_kode, dc_nama`,
  );
  return headers.map((h) => ({
    ...h,
    detail: details.filter((d) => d.dc_kode === h.cc_kode),
  }));
};

const search = async (query) => {
  let sql = `
    SELECT cc.cc_kode, cc.cc_nama, cc.cc_cabang, dc.dc_nama
    FROM financenew.tcostcenteritem dc
    INNER JOIN financenew.tcostcenter cc ON cc.cc_kode = dc.dc_kode
    WHERE CAST(cc.cc_kode AS UNSIGNED) >= 10
  `;
  const params = [];
  if (query) {
    sql += ` AND (dc.dc_nama LIKE ? OR cc.cc_nama LIKE ?)`;
    params.push(`%${query}%`, `%${query}%`);
  }
  sql += ` ORDER BY cc.cc_nama, dc.dc_nama LIMIT 100`;
  const [rows] = await db.query(sql, params);
  return rows;
};

module.exports = { getAll, search };
