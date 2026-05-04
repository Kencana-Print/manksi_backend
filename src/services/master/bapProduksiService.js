const db = require("../../config/database");

const getBrowse = async (startDate, endDate, userCabang, isAccKor) => {
  let params = [];
  let whereClause = `WHERE h.bap_tanggal >= ? AND h.bap_tanggal <= ?`;
  params.push(startDate, endDate);

  // Filter cabang jika user bukan Acc Kor (Pusat/Supervisor)
  if (userCabang && !isAccKor) {
    whereClause += ` AND h.bap_cab = ?`;
    params.push(userCabang);
  }

  const query = `
    SELECT 
      h.bap_nomor AS Nomor, 
      DATE_FORMAT(h.bap_tanggal, "%d-%m-%Y") AS Tanggal, 
      h.bap_cab AS Cab, 
      h.bap_tipe AS Tipe, 
      b.kb_nama AS Bagian,
      h.bap_masalah AS Masalah, 
      h.bap_sumber AS SumberMasalah, 
      h.bap_solusi AS Solusi, 
      h.bap_jawab AS Pertanggungjawaban, 
      h.bap_spk_nomor AS SPK,
      h.user_create AS Created, 
      h.bap_apv AS Approve,
      IFNULL((
        SELECT 
          IFNULL(
            IF(pin_acc="" AND pin_dipakai="", "WAIT",
              IF(pin_acc="Y" AND pin_dipakai="", "ACC",
                IF(pin_acc="Y" AND pin_dipakai="Y", "",
                  IF(pin_acc="N", "TOLAK", "")
                )
              )
            ), 
          "")
        FROM tspk_pin5 
        WHERE pin_trs = "BAP PRODUKSI" AND pin_nomor = h.bap_nomor 
        ORDER BY pin_urut DESC LIMIT 1
      ), "") AS Ngedit
    FROM tkpi_bapproduksi h
    LEFT JOIN kpi.tbagian b ON b.kb_kode = h.bap_bag
    ${whereClause}
    ORDER BY h.bap_nomor ASC
  `;

  const [rows] = await db.query(query, params);
  return rows;
};

const getById = async (nomor) => {
  const query = `SELECT * FROM tkpi_bapproduksi WHERE bap_nomor = ?`;
  const [rows] = await db.query(query, [nomor]);
  return rows.length > 0 ? rows[0] : null;
};

const remove = async (nomor) => {
  const query = `DELETE FROM tkpi_bapproduksi WHERE bap_nomor = ?`;
  await db.query(query, [nomor]);
};

const ajukanPerubahan = async (nomor, alasan, userKode) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [bapData] = await conn.query(
      "SELECT bap_tanggal, bap_spk_nomor FROM tkpi_bapproduksi WHERE bap_nomor = ?",
      [nomor],
    );
    if (bapData.length === 0) throw new Error("Data BAP tidak ditemukan");

    const tglBap = bapData[0].bap_tanggal;
    const spkNomor = bapData[0].bap_spk_nomor;

    const [pinData] = await conn.query(
      `
      SELECT pin_urut, pin_dipakai 
      FROM tspk_pin5 
      WHERE pin_trs = "BAP PRODUKSI" AND pin_nomor = ? 
      ORDER BY pin_urut DESC LIMIT 1
    `,
      [nomor],
    );

    let urut = 1;
    if (pinData.length > 0) {
      if (pinData[0].pin_dipakai === "") {
        urut = pinData[0].pin_urut;
      } else {
        urut = pinData[0].pin_urut + 1;
      }
    }

    const queryPin = `
      INSERT INTO tspk_pin5 (
        pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan
      ) VALUES ("BAP PRODUKSI", ?, ?, ?, ?, NOW(), ?, ?)
      ON DUPLICATE KEY UPDATE 
        pin_tgl_trs = ?, 
        pin_ket = ?, 
        pin_acc = "", 
        pin_tgl_minta = NOW(), 
        pin_user_minta = ?, 
        pin_alasan = ?
    `;

    await conn.query(queryPin, [
      nomor,
      urut,
      tglBap,
      spkNomor,
      userKode,
      alasan,
      tglBap,
      spkNomor,
      userKode,
      alasan,
    ]);

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = { getBrowse, getById, remove, ajukanPerubahan };
