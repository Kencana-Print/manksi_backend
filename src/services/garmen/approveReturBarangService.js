const db = require("../../config/database");

// ⚠️ Jenis SPAREPART/ATK-RTK secara STRUKTURAL tidak pernah punya data di
// modul approval ini — mereka tidak pernah masuk tgarmenreturlog_hdr
// (cuma ACCESORIES/OBAT yang lewat alur draft+approval). Source Delphi
// punya filter tambahan pakai kolom `min_bagian` yang sebenarnya TIDAK
// ADA di tabel ini (bug copy-paste dari modul Realisasi) — tapi karena
// data untuk jenis itu memang selalu kosong, bug-nya tidak berdampak.
// Kita tidak replikasi kolom yang tidak ada (akan error di MySQL).
const VALID_JENIS = ["ACCESORIES", "OBAT", "SPAREPART", "ATK/RTK"];

// ── Master browse: draft (log) LEFT JOIN status approval-nya ──
const getBrowseData = async (startDate, endDate, jenis) => {
  if (!VALID_JENIS.includes(jenis)) throw new Error("Jenis tidak valid.");

  const dariExpr =
    jenis === "ACCESORIES" || jenis === "OBAT"
      ? `IF(h.ret_cab <> 'P03', SUBSTRING(p.gdgp_nama, 4), q.pab_nama)`
      : `q.pab_nama`;

  const qMaster = `
    SELECT h.ret_nomor AS Nomor, h.ret_jenis AS Jenis, h.ret_tanggal AS Tanggal,
      h.ret_cab AS Cab, ${dariExpr} AS Dari, h.ret_keterangan AS Keterangan,
      h.user_create AS Usr,
      IFNULL(r.ret_nomor, "") AS NoApprov, r.ret_tanggal AS TglApprov,
      IFNULL(r.user_create, "") AS Approved
    FROM tgarmenreturlog_hdr h
    LEFT JOIN tgudangproduksi p ON p.gdgp_kode = h.ret_gp
    LEFT JOIN tgarmenretur_hdr r ON r.ret_log = h.ret_nomor
    LEFT JOIN tpabrik q ON q.pab_kode = h.ret_cab
    WHERE h.ret_tanggal >= ? AND h.ret_tanggal <= ? AND h.ret_jenis = ?
    ORDER BY h.ret_nomor
  `;
  const [masterRows] = await db.query(qMaster, [startDate, endDate, jenis]);

  // Detail: UNION dua sumber — draft yang BELUM di-approve (branch A) dan
  // detail dari record FINAL yang SUDAH di-approve (branch B), keduanya
  // di-key ke nomor LOG (draft) supaya nyambung ke master row yang sama.
  const qDetail = `
    SELECT * FROM (
      SELECT d.retd_nomor AS Nomor, d.retd_brg_kode AS Kode,
        IF(b.brg_note = "", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
        b.brg_satuan AS Satuan, d.retd_Jumlah AS Jumlah, d.retd_keterangan AS Keterangan,
        d.retd_nominta AS NoMinta, IFNULL(m.re_spk_nomor, "") AS SPK
      FROM tgarmenreturlog_hdr h
      INNER JOIN tgarmenreturlog_dtl d ON d.retd_nomor = h.ret_nomor
      LEFT JOIN tgarmen_brg b ON b.brg_kode = d.retd_brg_kode
      LEFT JOIN tgarmenrealisasi_hdr m ON m.re_nomor = d.retd_nominta
      WHERE h.ret_tanggal >= ? AND h.ret_tanggal <= ? AND h.ret_jenis = ?
        AND h.ret_nomor NOT IN (SELECT ret_log FROM tgarmenretur_hdr WHERE ret_log <> "")

      UNION ALL

      SELECT h.ret_log AS Nomor, d.retd_brg_kode AS Kode,
        IF(b.brg_note = "", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
        b.brg_satuan AS Satuan, d.retd_Jumlah AS Jumlah, d.retd_keterangan AS Keterangan,
        d.retd_nominta AS NoMinta, IFNULL(m.re_spk_nomor, "") AS SPK
      FROM tgarmenretur_hdr h
      INNER JOIN tgarmenretur_dtl d ON d.retd_nomor = h.ret_nomor
      LEFT JOIN tgarmen_brg b ON b.brg_kode = d.retd_brg_kode
      LEFT JOIN tgarmenrealisasi_hdr m ON m.re_nomor = d.retd_nominta
      WHERE h.ret_log IN (
        SELECT l.ret_nomor FROM tgarmenreturlog_hdr l
        WHERE l.ret_tanggal >= ? AND l.ret_tanggal <= ?
      ) AND h.ret_jenis = ?
    ) x
    ORDER BY x.Nomor
  `;
  const [detailRows] = await db.query(qDetail, [
    startDate,
    endDate,
    jenis,
    startDate,
    endDate,
    jenis,
  ]);

  return masterRows.map((master) => ({
    ...master,
    details: detailRows.filter((d) => d.Nomor === master.Nomor),
  }));
};

// ── Detail utk dialog approve: cabang sesuai NoApprov ada/tidak ──
const getApprovalDetail = async (logNomor, noApprov) => {
  if (noApprov) {
    // loadApprove: sudah pernah di-approve, load dari tabel final (edit mode)
    const q = `
      SELECT h.ret_nomor, h.ret_jenis, h.ret_tanggal, h.ret_cab, h.ret_keterangan,
        r.ret_gp AS gp, r.ret_tanggal AS tglret, p.gdgp_nama,
        d.retd_urut, d.retd_nominta, d.retd_brg_kode,
        IF(b.brg_note = "", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
        b.brg_satuan, d.retd_Jumlah, d.retd_keterangan, d.retd_spk
      FROM tgarmenretur_hdr h
      INNER JOIN tgarmenretur_dtl d ON d.retd_nomor = h.ret_nomor
      LEFT JOIN tgarmen_brg b ON b.brg_kode = d.retd_brg_kode
      LEFT JOIN tgarmenreturlog_hdr r ON r.ret_nomor = h.ret_log
      LEFT JOIN tgudangproduksi p ON p.gdgp_kode = r.ret_gp
      WHERE h.ret_nomor = ?
      ORDER BY d.retd_urut
    `;
    const [rows] = await db.query(q, [noApprov]);
    if (rows.length === 0) throw new Error("Nomor tersebut belum ada.");
    const h = rows[0];

    const details = [];
    for (const r of rows) {
      const retur = await getReturLog(r.retd_nominta, r.retd_brg_kode);
      const sudah = await getSudah(r.retd_nominta, r.retd_brg_kode, noApprov);
      details.push({
        nominta: r.retd_nominta,
        kode: r.retd_brg_kode,
        nama: r.Nama,
        satuan: r.brg_satuan,
        retur,
        jumlah: Number(r.retd_Jumlah),
        sudah,
        keterangan: r.retd_keterangan,
        spk: r.retd_spk,
      });
    }

    return {
      isEdit: true,
      noApprov: h.ret_nomor,
      jenis: h.ret_jenis,
      tanggalApprove: h.ret_tanggal,
      logNomor: logNomor,
      tanggalRetur: h.tglret,
      keterangan: h.ret_keterangan,
      gudangProduksi: { kode: h.gp, nama: h.gdgp_nama },
      details,
    };
  }

  // loaddataall: masih draft, belum pernah di-approve (create mode)
  const q = `
    SELECT h.ret_nomor, h.ret_jenis, h.ret_tanggal, h.ret_cab, h.ret_keterangan,
      IF(h.ret_jenis IN ("ACCESORIES","OBAT") AND h.ret_cab <> "P03", h.ret_gp, h.user_create) AS gp,
      IF(h.ret_jenis IN ("ACCESORIES","OBAT") AND h.ret_cab <> "P03", p.gdgp_nama, q.pab_nama) AS gpnm,
      d.retd_nominta, d.retd_brg_kode,
      IF(b.brg_note = "", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
      b.brg_satuan, d.retd_Jumlah, d.retd_keterangan, d.retd_spk
    FROM tgarmenreturlog_hdr h
    INNER JOIN tgarmenreturlog_dtl d ON d.retd_nomor = h.ret_nomor
    LEFT JOIN tgarmen_brg b ON b.brg_kode = d.retd_brg_kode
    LEFT JOIN tgudangproduksi p ON p.gdgp_kode = h.ret_gp
    LEFT JOIN tpabrik q ON q.pab_kode = h.ret_cab
    WHERE h.ret_nomor = ?
    ORDER BY d.retd_brg_kode, d.retd_urut
  `;
  const [rows] = await db.query(q, [logNomor]);
  if (rows.length === 0) throw new Error("Nomor tersebut belum ada.");
  const h = rows[0];

  const details = [];
  for (const r of rows) {
    const retur = await getReturLog(r.retd_nominta, r.retd_brg_kode);
    const sudah = await getSudah(r.retd_nominta, r.retd_brg_kode, "");
    details.push({
      nominta: r.retd_nominta,
      kode: r.retd_brg_kode,
      nama: r.Nama,
      satuan: r.brg_satuan,
      retur,
      jumlah: Number(r.retd_Jumlah), // default = sama persis dgn draft, approver bisa koreksi
      sudah,
      keterangan: r.retd_keterangan,
      spk: r.retd_spk,
    });
  }

  return {
    isEdit: false,
    noApprov: "",
    jenis: h.ret_jenis,
    tanggalApprove: new Date(), // default hari ini, sesuai dttanggal.DateTime:=Date
    logNomor: h.ret_nomor,
    tanggalRetur: h.ret_tanggal,
    keterangan: h.ret_keterangan,
    gudangProduksi: { kode: h.gp, nama: h.gpnm },
    details,
  };
};

// getreturlog: total qty yang diminta di draft (log), utk kolom "Retur" (referensi)
const getReturLog = async (nominta, kode) => {
  if (!nominta) return 0;
  const [rows] = await db.query(
    `SELECT IFNULL(SUM(retd_jumlah), 0) AS total FROM tgarmenreturlog_dtl
     WHERE retd_nominta = ? AND retd_brg_kode = ?`,
    [nominta, kode],
  );
  return Number(rows[0]?.total || 0);
};

// getsudah: total qty yang SUDAH di-approve di tabel final, excl. record ini sendiri
const getSudah = async (nominta, kode, excludeNoApprov) => {
  if (!nominta) return 0;
  const [rows] = await db.query(
    `SELECT IFNULL(SUM(retd_Jumlah), 0) AS total FROM tgarmenretur_dtl
     WHERE retd_nomor <> ? AND retd_nominta = ? AND retd_brg_kode = ?`,
    [excludeNoApprov || "", nominta, kode],
  );
  return Number(rows[0]?.total || 0);
};

// getmaxnomor: generate nomor approval (RTA/RTO), sama pola dgn Retur Barang
const generateNomor = async (conn, jenis, tahun) => {
  const prefixMap = {
    ACCESORIES: "RTA",
    OBAT: "RTO",
    SPAREPART: "RTS",
    "ATK/RTK": "RTK",
  };
  const prefix = prefixMap[jenis] || "RTX";
  const [rows] = await conn.query(
    `SELECT IFNULL(MAX(RIGHT(ret_nomor, 5)), 0) AS jumlah FROM tgarmenretur_hdr
     WHERE LEFT(ret_nomor, 7) = ? FOR UPDATE`,
    [prefix + tahun],
  );
  const next = 100001 + Number(rows[0].jumlah);
  return `${prefix}${tahun}.${String(next).slice(-5)}`;
};

/**
 * Simpan approval: INSERT baru (kalau draft belum pernah di-approve) atau
 * UPDATE (kalau mengedit record yang sudah ada approval-nya).
 * Replikasi simpandata() — flagedit ditentukan otomatis dari ada/tidaknya
 * noApprov yang dikirim payload.
 */
const saveApproval = async (payload, user) => {
  const {
    logNomor,
    noApprov,
    jenis,
    tanggalApprove,
    keterangan,
    gudangProduksi,
    details,
  } = payload;

  if (!logNomor) throw new Error("Referensi nomor retur (log) wajib ada.");

  const filled = (details || []).filter((d) => d.kode && d.kode.trim() !== "");
  if (filled.length === 0) throw new Error("Detail harus diisi.");
  for (const d of filled) {
    if (!d.jumlah || Number(d.jumlah) === 0) {
      throw new Error("Jumlah harus di isi!");
    }
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomor = noApprov;
    const isEdit = !!noApprov;

    if (isEdit) {
      await conn.query(
        `UPDATE tgarmenretur_hdr SET
           ret_tanggal = ?, ret_keterangan = ?,
           date_modified = NOW(), user_modified = ?
         WHERE ret_nomor = ?`,
        [tanggalApprove, keterangan || "", user.kode, nomor],
      );
    } else {
      const tahun = new Date(tanggalApprove).getFullYear().toString();
      nomor = await generateNomor(conn, jenis, tahun);

      await conn.query(
        `INSERT INTO tgarmenretur_hdr
           (ret_jenis, ret_nomor, ret_log, ret_tanggal, ret_cab, ret_bagian, ret_gp, ret_keterangan, date_create, user_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
        [
          jenis,
          nomor,
          logNomor,
          tanggalApprove,
          user.cabang,
          user.bagian,
          gudangProduksi?.kode || "",
          keterangan || "",
          user.kode,
        ],
      );
    }

    await conn.query(`DELETE FROM tgarmenretur_dtl WHERE retd_nomor = ?`, [
      nomor,
    ]);

    let urut = 0;
    for (const d of filled) {
      urut += 1;
      await conn.query(
        `INSERT INTO tgarmenretur_dtl
           (retd_nomor, retd_brg_kode, retd_jumlah, retd_keterangan, retd_nominta, retd_spk, retd_urut)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          nomor,
          d.kode,
          Number(d.jumlah),
          d.keterangan || "",
          d.nominta || "",
          d.spk || "",
          urut,
        ],
      );
    }

    await conn.commit();
    return nomor;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

/**
 * Batalkan approve (cxButton4). ⚠️ Source Delphi cuma DELETE header
 * (tgarmenretur_hdr), TIDAK hapus detail — jadi row tgarmenretur_dtl jadi
 * orphan (bug, bukan business rule). Di sini saya hapus header+detail
 * sekaligus supaya tidak ninggalin sampah data. Kalau mau replikasi
 * persis (biarkan orphan), tinggal hapus baris DELETE detail di bawah.
 */
const cancelApproval = async (noApprov, user) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT ret_nomor FROM tgarmenretur_hdr WHERE ret_nomor = ? FOR UPDATE`,
      [noApprov],
    );
    if (rows.length === 0) throw new Error("No.Retur tsb belum di approve.");

    await conn.query(`DELETE FROM tgarmenretur_hdr WHERE ret_nomor = ?`, [
      noApprov,
    ]);
    await conn.query(`DELETE FROM tgarmenretur_dtl WHERE retd_nomor = ?`, [
      noApprov,
    ]);

    await conn.commit();
    return true;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = {
  getBrowseData,
  getApprovalDetail,
  saveApproval,
  cancelApproval,
};
