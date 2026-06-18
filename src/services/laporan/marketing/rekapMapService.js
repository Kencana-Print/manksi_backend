const db = require("../../../config/database");

// ── 1. Rekap summary per sales + divisi ──
const getRekap = async (query) => {
  const { bulan, tahun } = query;
  const bln = bulan || new Date().getMonth() + 1;
  const thn = tahun || new Date().getFullYear();

  const sql = `
    SELECT
      mspk_perush_kode              AS Perush,
      divisi                        AS Divisi,
      sal_nama                      AS Sales,
      COUNT(mspk_nomor)             AS JmlMAP,
      SUM(jml)                      AS Qty,
      SUM(nominal)                  AS Nominal,
      IFNULL(SUM(realisasi), 0)     AS Realisasi,
      CASE
        WHEN SUM(nominal) > 0
        THEN ROUND(SUM(realisasi) / SUM(nominal) * 100, 2)
        ELSE 0
      END                           AS Presentase
    FROM (
      SELECT
        m.mspk_perush_kode,
        d.Divisi,
        m.mspk_nomor,
        m.mspk_tanggal,
        m.mspk_nama,
        m.mspk_rencana_order,
        m.mspk_harga,
        (m.mspk_rencana_order * m.mspk_harga) AS nominal,
        m.mspk_panjang,
        m.mspk_lebar,
        s.sal_nama,
        IF(d.Divisi = 'MMT',
          m.mspk_rencana_order * m.mspk_panjang * m.mspk_lebar,
          IF(d.Divisi = 'SPANDUK',
            m.mspk_panjang * m.mspk_rencana_order,
            m.mspk_rencana_order)
        ) AS jml,
        (
          SELECT SUM(IFNULL(spk_harga * spk_jumlah, 0))
          FROM tspk
          WHERE spk_aktif = 'Y' AND spk_memo = m.mspk_nomor
          GROUP BY m.mspk_nomor
        ) AS realisasi
      FROM tmemospk m
      INNER JOIN tsales   s ON s.sal_kode   = m.mspk_sal_kode
      INNER JOIN tdivisi  d ON d.kode       = m.mspk_divisi
      WHERE MONTH(m.mspk_tanggal) = ?
        AND YEAR(m.mspk_tanggal)  = ?
        AND m.mspk_aktif = 'Y'
    ) final
    GROUP BY mspk_perush_kode, divisi, sales
    ORDER BY mspk_perush_kode ASC, divisi ASC, sales ASC
  `;

  const [rows] = await db.query(sql, [bln, thn]);
  return rows;
};

// ── 2. Detail per divisi (Spanduk / Garmen / MMT) ──
const getDetail = async (query) => {
  const { bulan, tahun, divisi } = query;
  const bln = bulan || new Date().getMonth() + 1;
  const thn = tahun || new Date().getFullYear();
  const div = (divisi || "SPANDUK").toUpperCase();

  const sql = `
    SELECT
      m.mspk_perush_kode            AS Perusahaan,
      d.Divisi                       AS Divisi,
      m.mspk_nomor                   AS Nomor,
      DATE_FORMAT(m.mspk_tanggal, '%d-%m-%Y') AS Tanggal,
      c.cus_nama                     AS Customer,
      m.mspk_tipe                    AS Tipe,
      m.mspk_nama                    AS Nama,
      m.mspk_rencana_order           AS Qty,
      m.mspk_harga                   AS Harga,
      (m.mspk_rencana_order * m.mspk_harga) AS Nilai,
      m.mspk_panjang                 AS Panjang,
      m.mspk_lebar                   AS Lebar,
      s.sal_nama                     AS Sales,
      IF(d.Divisi = 'MMT',
        m.mspk_rencana_order * m.mspk_panjang * m.mspk_lebar,
        IF(d.Divisi = 'SPANDUK',
          m.mspk_panjang * m.mspk_rencana_order,
          m.mspk_rencana_order)
      )                              AS Jml,
      (
        SELECT SUM(IFNULL(spk_harga * spk_jumlah, 0))
        FROM tspk
        WHERE spk_aktif = 'Y' AND spk_memo = m.mspk_nomor
        GROUP BY m.mspk_nomor
      )                              AS Realisasi,
      m.mspk_confirm                 AS Note
    FROM tmemospk m
    INNER JOIN tsales    s ON s.sal_kode   = m.mspk_sal_kode
    INNER JOIN tdivisi   d ON d.kode       = m.mspk_divisi
    INNER JOIN tcustomer c ON c.cus_kode   = m.mspk_cus_kode
    WHERE MONTH(m.mspk_tanggal) = ?
      AND YEAR(m.mspk_tanggal)  = ?
      AND m.mspk_aktif = 'Y'
      AND d.Divisi = ?
    ORDER BY m.mspk_tanggal ASC, m.mspk_nomor ASC
  `;

  const [rows] = await db.query(sql, [bln, thn, div]);
  return rows;
};

// ── 3. Update note / confirm ──
const updateNote = async (body) => {
  const { nomor, note } = body;
  if (!nomor) throw new Error("Nomor MAP wajib diisi.");

  const sql = `
    UPDATE tmemospk
    SET mspk_confirm = ?
    WHERE mspk_nomor = ?
  `;
  const [result] = await db.query(sql, [note || "", nomor]);
  return result.affectedRows;
};

module.exports = { getRekap, getDetail, updateNote };
