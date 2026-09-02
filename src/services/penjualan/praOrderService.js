const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

const getDivisiFilter = async (cabKaos, userCab) => {
  let query = "";
  if (cabKaos && cabKaos !== "KDC") {
    query = `SELECT kode AS Kode, Divisi AS Nama FROM tdivisi WHERE kode = 3 ORDER BY kode`;
  } else if (userCab && cabKaos === "KDC") {
    query = `SELECT kode AS Kode, Divisi AS Nama FROM tdivisi WHERE kode IN (3,6) ORDER BY kode`;
  } else if (userCab === "P03") {
    query = `SELECT kode AS Kode, Divisi AS Nama FROM tdivisi ORDER BY kode`;
  } else {
    query = `SELECT kode AS Kode, Divisi AS Nama FROM tdivisi WHERE kode <> 3 ORDER BY kode`;
  }
  const [rows] = await db.query(query);
  return rows;
};

const getBrowseData = async (startDate, endDate, divisiKode, userInfo) => {
  let query = `
    SELECT
      h.pro_nomor AS Nomor,
      v.Divisi AS Divisi,
      DATE_FORMAT(h.pro_tanggal, '%Y-%m-%d') AS Tanggal,
      h.pro_cus_nama AS Customer,
      s.sal_nama AS Sales,
      h.pro_nama_pekerjaan AS NamaPekerjaan,
      h.pro_qty_rencana AS QtyRencana,
      DATE_FORMAT(h.pro_tgl_kirim, '%Y-%m-%d') AS TglKirim,
      h.pro_status_bahan AS StatusBahan,
      h.pro_status_ppic AS StatusPpic,
      h.pro_mh_nomor AS NomorMH,
      h.pro_status AS Status,
      h.user_create AS usr,
      DATE_FORMAT(h.date_create, '%Y-%m-%d %H:%i:%s') AS Created,
      IFNULL((
        SELECT IFNULL(
          IF(pin_acc = "" AND pin_dipakai = "", "WAIT",
            IF(pin_acc = "Y" AND pin_dipakai = "", "ACC",
              IF(pin_acc = "Y" AND pin_dipakai = "Y", "",
                IF(pin_acc = "N", "TOLAK", "")
              )
            )
          ), ""
        )
        FROM tspk_pin5
        WHERE pin_trs = "PRA ORDER" AND pin_nomor = h.pro_nomor
        ORDER BY pin_urut DESC LIMIT 1
      ), "") AS Ngedit
    FROM tpraorder_hdr h
    LEFT JOIN tdivisi v ON v.kode = h.pro_divisi
    LEFT JOIN tsales s ON s.sal_kode = h.pro_sal_kode
    WHERE h.pro_tanggal >= ? AND h.pro_tanggal <= ?
  `;
  const params = [startDate, endDate];

  if (divisiKode && divisiKode !== "0") {
    query += ` AND h.pro_divisi = ?`;
    params.push(divisiKode);
  }

  const isManagerOrAdmin =
    userInfo.jabatan.includes("MANAGER-CMO-MO") ||
    userInfo.kode === "ADMIN" ||
    userInfo.bagian?.toUpperCase() === "AUDIT" ||
    userInfo.bagian?.toUpperCase() === "FINANCE" ||
    userInfo.bagian?.toUpperCase() === "MARKETING" ||
    userInfo.jabatan?.toUpperCase() === "MARKETING" ||
    userInfo.jabatan?.toUpperCase() === "MO" ||
    userInfo.flags?.cmo === 1 ||
    userInfo.flags?.cmo === "1" ||
    userInfo.flags?.cmo === "Y";

  if (!isManagerOrAdmin) {
    if (userInfo.jabatan === "CRM") {
      query += ` AND (h.pro_sal_kode = "019" OR h.user_create = ?)`;
      params.push(userInfo.kode);
    } else if (userInfo.cabKaos && userInfo.cabKaos !== "KDC") {
      query += ` AND h.pro_cabkaos = ?`;
      params.push(userInfo.cabKaos);
    } else {
      query += ` AND h.user_create = ?`;
      params.push(userInfo.kode);
    }
  }

  query += ` ORDER BY h.pro_nomor DESC`;
  const [rows] = await db.query(query, params);
  return rows;
};

const deleteData = async (nomor) => {
  const conn = await db.getConnection();
  try {
    const [rows] = await conn.query(
      "SELECT pro_tanggal, pro_status FROM tpraorder_hdr WHERE pro_nomor = ?",
      [nomor],
    );
    if (rows.length === 0) throw new Error("Data tidak ditemukan.");
    const data = rows[0];

    if (data.pro_status === "CLOSE") {
      throw new Error(
        "Sudah dikonversi ke Permintaan Harga. Tidak bisa dihapus.",
      );
    }

    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    const tglTransaksi = new Date(data.pro_tanggal);
    if (zdtClose && tglTransaksi < zdtClose) {
      throw new Error("Transaksi tersebut sudah close. Tidak bisa dihapus.");
    }

    await conn.query("DELETE FROM tpraorder_hdr WHERE pro_nomor = ?", [nomor]);
    return true;
  } finally {
    conn.release();
  }
};

const checkPengajuanEdit = async (nomor) => {
  const [rows] = await db.query(
    `SELECT pin_urut, pin_alasan, pin_dipakai FROM tspk_pin5
     WHERE pin_trs = "PRA ORDER" AND pin_nomor = ? ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );
  if (rows.length === 0) return { urut: 1, alasan: "" };
  const pin = rows[0];
  return pin.pin_dipakai === ""
    ? { urut: pin.pin_urut, alasan: pin.pin_alasan }
    : { urut: pin.pin_urut + 1, alasan: "" };
};

const submitPengajuanEdit = async (nomor, urut, alasan, userKode) => {
  const [rows] = await db.query(
    "SELECT pro_tanggal, pro_nama_pekerjaan FROM tpraorder_hdr WHERE pro_nomor = ?",
    [nomor],
  );
  if (rows.length === 0) throw new Error("Data Pra Order tidak ditemukan.");
  const { pro_tanggal, pro_nama_pekerjaan } = rows[0];

  await db.query(
    `INSERT INTO tspk_pin5
      (pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan)
     VALUES ("PRA ORDER", ?, ?, ?, ?, NOW(), ?, ?)
     ON DUPLICATE KEY UPDATE
       pin_tgl_trs = VALUES(pin_tgl_trs), pin_ket = VALUES(pin_ket), pin_acc = "",
       pin_tgl_minta = NOW(), pin_user_minta = VALUES(pin_user_minta), pin_alasan = VALUES(pin_alasan)`,
    [nomor, urut, pro_tanggal, pro_nama_pekerjaan, userKode, alasan],
  );
  return true;
};

module.exports = {
  getDivisiFilter,
  getBrowseData,
  deleteData,
  checkPengajuanEdit,
  submitPengajuanEdit,
};
