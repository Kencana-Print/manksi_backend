const db = require("../../config/database");

const generateNomor = async (tanggal, conn) => {
  const d = new Date(tanggal);
  const yyyymm = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `PDM.${yyyymm}.`;
  const [[row]] = await (conn || db).query(
    `SELECT IFNULL(MAX(CAST(RIGHT(pd_nomor,4) AS UNSIGNED)),0) AS maxVal
     FROM tpermintaan_desain WHERE pd_nomor LIKE ?`,
    [`${prefix}%`],
  );
  const next = Number(row.maxVal) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
};

const createPD = async (
  {
    tanggal,
    namaProject,
    customer,
    jenisPekerjaan,
    dateline,
    keterangan,
    prioritas,
    desainer,
    referensi,
    items,
  },
  user,
) => {
  if (!namaProject || !namaProject.trim()) {
    throw new Error("Nama project wajib diisi");
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Minimal 1 item desain harus diisi");
  }

  const desainerDefault = desainer ? String(desainer).trim() : null;
  const rows = items.map((it) => ({
    desain: String(it.desain ?? "").trim(),
    jml: Number(it.jml),
    desainer: it.desainer ? String(it.desainer).trim() : desainerDefault,
  }));
  for (const r of rows) {
    if (!r.desain) throw new Error("Nama desain pada detail wajib diisi");
    if (!Number.isInteger(r.jml) || r.jml <= 0)
      throw new Error("Jumlah detail harus bilangan bulat > 0");
  }
  const jmlTotal = rows.reduce((sum, r) => sum + r.jml, 0);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const nomor = await generateNomor(tanggal, conn);

    await conn.query(
      `INSERT INTO tpermintaan_desain
        (pd_nomor, pd_tanggal, pd_nama_project, pd_nama_marketing, pd_customer,
         pd_jenis_pekerjaan, pd_dateline, pd_keterangan, pd_jml, pd_jmljadi,
         pd_status, pd_prioritas, pd_referensi, pd_user_create, pd_date_create)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'OPEN', ?, ?, ?, NOW())`,
      [
        nomor,
        tanggal,
        namaProject.trim(),
        user.kode,
        customer || null,
        jenisPekerjaan || "BARU",
        dateline || null,
        keterangan || "",
        jmlTotal,
        prioritas || "NORMAL",
        referensi || null,
        user.kode,
      ],
    );

    await conn.query(
      `INSERT INTO tpermintaan_desain_detail
         (pd2_pd_nomor, pd2_pd_desain, pd2_pd_jml, pd2_desainer) VALUES ?`,
      [rows.map((r) => [nomor, r.desain, r.jml, r.desainer])],
    );

    await conn.commit();
    return { nomor };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

module.exports = { createPD };
