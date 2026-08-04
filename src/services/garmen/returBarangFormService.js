const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

const MODUL_TUTUP_BUKU = "RETUR GARMEN";
// Jenis yang lewat tabel LOG (butuh approval gudang)
const JENIS_LOG = ["ACCESORIES", "OBAT"];

// ── Helper: resolusi tabel & prefix nomor sesuai jenis ──
const getTableConfig = (jenis) => {
  if (JENIS_LOG.includes(jenis)) {
    return {
      hdrTable: "tgarmenreturlog_hdr",
      dtlTable: "tgarmenreturlog_dtl",
      prefix: jenis === "ACCESORIES" ? "RETA" : "RETO",
      prefixLen: 8, // 4 huruf + 4 digit tahun
    };
  }
  return {
    hdrTable: "tgarmenretur_hdr",
    dtlTable: "tgarmenretur_dtl",
    prefix: jenis === "SPAREPART" ? "RTS" : "RTK",
    prefixLen: 7, // 3 huruf + 4 digit tahun
  };
};

// ── cekClose equivalent: status pengajuan tutup buku (PIN5) ──
const computeStatus = async (nomor) => {
  const [rows] = await db.query(
    `SELECT pin_urut, pin_acc, pin_dipakai FROM tspk_pin5
     WHERE pin_trs = "RETUR GARMEN" AND pin_nomor = ?
     ORDER BY pin_urut DESC LIMIT 1`,
    [nomor],
  );

  if (rows.length === 0) return { status: "MINTA", urut: 0 };

  const { pin_urut, pin_acc, pin_dipakai } = rows[0];
  if (pin_acc === "" && pin_dipakai === "")
    return { status: "WAIT", urut: pin_urut };
  if (pin_acc === "Y" && pin_dipakai === "")
    return { status: "ACC", urut: pin_urut };
  if (pin_acc === "N") return { status: "TOLAK", urut: pin_urut };
  return { status: "MINTA", urut: pin_urut };
};

// ── Replikasi gating loaddataall: kapan status pin5 perlu dicek ──
const resolveEditStatus = async (nomor, tanggal) => {
  const boundary =
    await tutupBukuService.getTanggalTutupBukuUntukTanggal(tanggal);
  const zClose = await tutupBukuService.getManualTutupBuku(MODUL_TUTUP_BUKU);
  const today = new Date();
  const tglTrs = new Date(tanggal);

  const perluCek = zClose === null ? boundary < today : tglTrs < zClose;

  if (!perluCek) return { status: "", urut: 0 };

  if (zClose === null) {
    return computeStatus(nomor);
  }
  if (tglTrs >= zClose) {
    return { status: "", urut: 0 };
  }
  return computeStatus(nomor);
};

// ── Replikasi VK_F10: validasi boleh simpan atau tidak ──
const checkCanSave = async (tanggal, statusPin5) => {
  if (["MINTA", "WAIT", "TOLAK"].includes(statusPin5)) {
    throw new Error(
      "Transaksi tsb sudah diclose. Silahkan minta approve untuk bisa menyimpan perubahan data.",
    );
  }

  const zdtClose = await tutupBukuService.getTanggalTutupBuku(); // boundary berbasis HARI INI
  const awalPeriode = new Date(zdtClose.getFullYear(), zdtClose.getMonth(), 1);
  const zClose = await tutupBukuService.getManualTutupBuku(MODUL_TUTUP_BUKU);
  const tglTrs = new Date(tanggal);

  const dalamPeriodeTerbuka = tglTrs <= zdtClose && tglTrs >= awalPeriode;
  const setelahBoundary = tglTrs >= zdtClose;

  const boleh =
    zClose === null
      ? dalamPeriodeTerbuka || setelahBoundary || statusPin5 === "ACC"
      : tglTrs >= zClose ||
        dalamPeriodeTerbuka ||
        setelahBoundary ||
        statusPin5 === "ACC";

  if (!boleh) {
    throw new Error(
      "Anda tidak boleh input di tanggal periode yg sudah diclose.",
    );
  }
};

// ── getminta:  ──
const getMinta = async (jenis, nominta, kode) => {
  if (!nominta) return 0;

  const [reRows] = await db.query(
    `SELECT re_minta FROM tgarmenrealisasi_hdr WHERE re_jenis = ? AND re_nomor = ?`,
    [jenis, nominta],
  );
  const reMinta = reRows[0]?.re_minta;
  if (!reMinta) return 0;

  const [rows] = await db.query(
    `SELECT IFNULL(SUM(mind_jumlah), 0) AS total FROM tgarmenminta_dtl
     WHERE mind_nomor = ? AND mind_brg_kode = ?`,
    [reMinta, kode],
  );
  return Number(rows[0]?.total || 0);
};

// ── getsudah: total sudah diretur (excl. dokumen ini sendiri) ──
// Selalu query tgarmenreturlog_dtl (tabel log) — konsisten, karena nominta
// hanya benar-benar dipakai untuk jenis ACCESORIES/OBAT yang memang
// tersimpan di tabel log ini.
const getSudah = async (jenis, currentNomor, nominta, kode) => {
  if (!nominta) return 0;
  const [rows] = await db.query(
    `SELECT IFNULL(SUM(d.retd_jumlah), 0) AS total
     FROM tgarmenreturlog_dtl d
     INNER JOIN tgarmenreturlog_hdr h ON h.ret_nomor = d.retd_nomor
     WHERE h.ret_jenis = ? AND d.retd_nomor <> ? AND d.retd_nominta = ? AND d.retd_brg_kode = ?`,
    [jenis, currentNomor || "", nominta, kode],
  );
  return Number(rows[0]?.total || 0);
};

// ── Load data untuk form edit (loaddataall) ──
const getFormData = async (nomor) => {
  const isLog = nomor.startsWith("RET"); // sesuai LeftStr(akode,3)='RET'
  const hdrTable = isLog ? "tgarmenreturlog_hdr" : "tgarmenretur_hdr";
  const dtlTable = isLog ? "tgarmenreturlog_dtl" : "tgarmenretur_dtl";

  const q = `
    SELECT h.*, d.*,
      IF(b.brg_note = "", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
      b.brg_satuan,
      IF(h.ret_jenis IN ("ACCESORIES","OBAT") AND h.ret_cab <> "P03", h.ret_gp, h.user_create) AS gp,
      IF(h.ret_jenis IN ("ACCESORIES","OBAT") AND h.ret_cab <> "P03", p.gdgp_nama, q.pab_nama) AS gpnm
    FROM ${hdrTable} h
    INNER JOIN ${dtlTable} d ON d.retd_nomor = h.ret_nomor
    LEFT JOIN tgarmen_brg b ON b.brg_kode = d.retd_brg_kode
    LEFT JOIN tgudangproduksi p ON p.gdgp_kode = h.ret_gp
    LEFT JOIN tpabrik q ON q.pab_kode = h.ret_cab
    WHERE h.ret_nomor = ?
    ORDER BY d.retd_urut
  `;
  const [rows] = await db.query(q, [nomor]);
  if (rows.length === 0) throw new Error("Nomor tersebut belum ada.");

  const header = rows[0];
  const jenis = header.ret_jenis;

  const details = [];
  for (const r of rows) {
    const minta = await getMinta(jenis, r.retd_nominta, r.retd_brg_kode);
    const sudah = await getSudah(jenis, nomor, r.retd_nominta, r.retd_brg_kode);
    details.push({
      nominta: r.retd_nominta,
      kode: r.retd_brg_kode,
      nama: r.Nama,
      satuan: r.brg_satuan,
      minta,
      jumlah: Number(r.retd_Jumlah),
      sudah,
      keterangan: r.retd_keterangan,
      spk: r.retd_spk,
    });
  }

  const { status } = await resolveEditStatus(nomor, header.ret_tanggal);

  return {
    nomor: header.ret_nomor,
    jenis,
    tanggal: header.ret_tanggal,
    cabang: header.ret_cab,
    keterangan: header.ret_keterangan,
    pic: header.user_create,
    gudangProduksi: { kode: header.gp, nama: header.gpnm },
    statusPin5: status,
    details,
  };
};

// ── getmaxnomor equivalent (dengan lock) ──
const generateNomor = async (conn, jenis, tahun) => {
  const { hdrTable, prefix, prefixLen } = getTableConfig(jenis);
  const [rows] = await conn.query(
    `SELECT IFNULL(MAX(RIGHT(ret_nomor, 5)), 0) AS jumlah FROM ${hdrTable}
     WHERE LEFT(ret_nomor, ${prefixLen}) = ? FOR UPDATE`,
    [prefix + tahun],
  );
  const next = 100001 + Number(rows[0].jumlah);
  const suffix = String(next).slice(-5);
  return `${prefix}${tahun}.${suffix}`;
};

// ── Validasi detail (replikasi VK_F10) ──
const validateDetails = (details) => {
  const filled = details.filter((d) => d.kode && d.kode.trim() !== "");
  if (filled.length === 0) {
    throw new Error("Detail harus diisi.");
  }
  for (const d of filled) {
    if (!d.jumlah || Number(d.jumlah) === 0) {
      throw new Error("Jumlah harus di isi!");
    }
  }
  return filled;
};

/**
 * Simpan data (create baru atau update existing)
 */
const saveData = async (payload, user, existingNomor = null) => {
  const { jenis, tanggal, cabang, gudangProduksi, keterangan, details } =
    payload;

  if (!["ACCESORIES", "OBAT", "SPAREPART", "ATK/RTK"].includes(jenis)) {
    throw new Error("Jenis tidak valid.");
  }

  const filledDetails = validateDetails(details);

  // Gudang Produksi wajib untuk ACCESORIES/OBAT & cabang <> P03
  const cabUser = user.cabang;
  const needsGp = JENIS_LOG.includes(jenis) && cabUser !== "P03";
  if (needsGp && (!gudangProduksi?.nama || gudangProduksi.nama.trim() === "")) {
    throw new Error("Gudang Produksi tidak boleh kosong");
  }

  const { hdrTable, dtlTable } = getTableConfig(jenis);
  const isEdit = !!existingNomor;

  // Kalau edit, ambil status pin5 terkini utk validasi periode & pin_urut
  let statusPin5 = "";
  let urutPin5 = 0;
  const tglCekStatus = tanggal;
  if (isEdit) {
    const resolved = await resolveEditStatus(existingNomor, tglCekStatus);
    statusPin5 = resolved.status;
    urutPin5 = resolved.urut;
  }

  await checkCanSave(tanggal, statusPin5);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomor = existingNomor;

    if (isEdit) {
      await conn.query(
        `UPDATE ${hdrTable} SET
           ret_tanggal = ?, ret_gp = ?, ret_keterangan = ?,
           date_modified = NOW(), user_modified = ?
         WHERE ret_nomor = ?`,
        [
          tanggal,
          gudangProduksi?.kode || "",
          keterangan || "",
          user.kode,
          nomor,
        ],
      );
    } else {
      const tahun = new Date(tanggal).getFullYear().toString();
      nomor = await generateNomor(conn, jenis, tahun);

      if (JENIS_LOG.includes(jenis)) {
        await conn.query(
          `INSERT INTO ${hdrTable}
             (ret_jenis, ret_nomor, ret_tanggal, ret_cab, ret_gp, ret_keterangan, date_create, user_create)
           VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)`,
          [
            jenis,
            nomor,
            tanggal,
            cabUser,
            gudangProduksi?.kode || "",
            keterangan || "",
            user.kode,
          ],
        );
      } else {
        await conn.query(
          `INSERT INTO ${hdrTable}
             (ret_jenis, ret_nomor, ret_tanggal, ret_cab, ret_bagian, ret_gp, ret_keterangan, date_create, user_create)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
          [
            jenis,
            nomor,
            tanggal,
            cabUser,
            user.bagian,
            gudangProduksi?.kode || "",
            keterangan || "",
            user.kode,
          ],
        );
      }
    }

    await conn.query(`DELETE FROM ${dtlTable} WHERE retd_nomor = ?`, [nomor]);

    let urut = 0;
    for (const d of filledDetails) {
      urut += 1;
      await conn.query(
        `INSERT INTO ${dtlTable}
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

    // Simpan pin5 dipakai=Y kalau status sedang ACC (dipakai skrg)
    if (isEdit && statusPin5 === "ACC") {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai = "Y"
         WHERE pin_trs = "RETUR GARMEN" AND pin_nomor = ? AND pin_urut = ?`,
        [nomor, urutPin5],
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

// ══════════════ SEARCH HELPERS ══════════════

// Tier 1: cari header Realisasi (dengan pagination, sesuai konvensi /lookups)
const searchRealisasiHeader = async (jenis, keyword, page = 1, limit = 50) => {
  const where = ["h.re_jenis = ?"];
  const params = [jenis];
  if (keyword) {
    where.push("(h.re_nomor LIKE ? OR h.re_spk_nomor LIKE ?)");
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const whereSql = where.join(" AND ");

  const [countRows] = await db.query(
    `SELECT COUNT(*) AS total FROM tgarmenrealisasi_hdr h WHERE ${whereSql}`,
    params,
  );
  const total = Number(countRows[0].total);

  const offset = (page - 1) * limit;
  const [rows] = await db.query(
    `SELECT h.re_nomor AS Nomor, h.re_tanggal AS Tanggal, h.re_spk_nomor AS SPK
     FROM tgarmenrealisasi_hdr h
     WHERE ${whereSql}
     ORDER BY h.re_tanggal DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return { items: rows, total };
};

// Tier 2: detail item dari Realisasi yang dipilih (dengan Minta/Sudah/SpkNama)
// SpkNama dipakai utk auto-fill Keterangan saat item dipilih (sesuai loadbrg() Delphi)
const searchRealisasiDetail = async (jenis, nomorRealisasi, currentNomor) => {
  const q = `
    SELECT h.re_nomor AS NoRealisasi, h.re_tanggal AS Tanggal, h.re_spk_nomor AS SPK,
      d.red_brg_kode AS Kode,
      IF(b.brg_note = "", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
      b.brg_satuan AS Satuan, d.red_jumlah AS Minta,
      IFNULL(s.spk_nama, m.mspk_nama) AS SpkNama
    FROM tgarmenrealisasi_hdr h
    INNER JOIN tgarmenrealisasi_dtl d ON d.red_nomor = h.re_nomor
    LEFT JOIN tgarmen_brg b ON b.brg_kode = d.red_brg_kode
    LEFT JOIN tspk s ON s.spk_nomor = h.re_spk_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = h.re_spk_nomor
    WHERE h.re_jenis = ? AND h.re_nomor = ?
  `;
  const [rows] = await db.query(q, [jenis, nomorRealisasi]);

  const result = [];
  for (const r of rows) {
    const sudah = await getSudah(jenis, currentNomor, r.NoRealisasi, r.Kode);
    result.push({ ...r, Sudah: sudah });
  }
  return result;
};

// F1/F2 pada Kode — pencarian barang langsung (OBAT/SPAREPART/ATK-RTK)
const searchBarang = async (
  jenis,
  cabang,
  bagian,
  keyword,
  page = 1,
  limit = 50,
) => {
  const stokTableMap = {
    OBAT: "tmasterstok_obat",
    SPAREPART: "tmasterstok_sparepart",
    "ATK/RTK": "tmasterstok_atk",
  };
  const stokTable = stokTableMap[jenis];
  if (!stokTable)
    throw new Error("Jenis ini tidak memakai pencarian barang langsung.");

  const where = ['b.brg_aktif = "Y"', "b.brg_jenis = ?"];
  const params = [jenis];
  if (bagian === "TEKNISI") where.push('b.brg_ktg <> "IT"');
  else if (bagian === "IT") where.push('b.brg_ktg = "IT"');
  if (keyword) {
    where.push("(b.brg_kode LIKE ? OR b.brg_nama LIKE ?)");
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const whereSql = where.join(" AND ");

  const [countRows] = await db.query(
    `SELECT COUNT(*) AS total FROM tgarmen_brg b WHERE ${whereSql}`,
    params,
  );
  const total = Number(countRows[0].total);

  const offset = (page - 1) * limit;
  const [rows] = await db.query(
    `SELECT b.brg_kode AS Kode,
       IF(b.brg_note = "", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
       b.brg_satuan AS Satuan,
       IFNULL((
         SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM ${stokTable} m
         WHERE m.mst_aktif = "Y" AND m.mst_brg_kode = b.brg_kode AND m.mst_cab = ?
       ), 0) AS Stok
     FROM tgarmen_brg b
     WHERE ${whereSql}
     ORDER BY b.brg_nama
     LIMIT ? OFFSET ?`,
    [cabang, ...params, limit, offset],
  );

  return { items: rows, total };
};

module.exports = {
  getFormData,
  saveData,
  searchRealisasiHeader,
  searchRealisasiDetail,
  searchBarang,
};
