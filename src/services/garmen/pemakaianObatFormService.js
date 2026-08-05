const db = require("../../config/database");

/**
 * Opsi Cabang yang BOLEH dipilih saat create — replikasi persis
 * FormCreate: P01-only / P04-only / [P01,P04] tergantung cabang user.
 * ⚠️ BEDA dari Browse (yang punya opsi ALL) — form ini tidak ada ALL.
 */
const getCabangOptions = (user) => {
  const cab = user.cabang || "";
  if (cab === "P01") return ["P01"];
  if (cab === "P04") return ["P04"];
  return ["P01", "P04"];
};

/**
 * Dropdown Lini — replikasi FormCreate: filter tliniobat berdasarkan
 * divisi user (flag=0 = lini umum, flag=1/4 = spesifik divisi).
 */
const getLiniOptions = async (divisi) => {
  let query;
  if (Number(divisi) === 1) {
    query = `SELECT lini FROM tliniobat WHERE flag = 0 OR flag = 1 ORDER BY lini`;
  } else if (Number(divisi) === 4) {
    query = `SELECT lini FROM tliniobat WHERE flag = 0 OR flag = 4 ORDER BY lini`;
  } else {
    query = `SELECT lini FROM tliniobat ORDER BY lini`;
  }
  const [rows] = await db.query(query);
  return rows.map((r) => r.lini);
};

/**
 * Dropdown Jenis Obat — replikasi FormCreate: tgarmen_brg brg_jenis="OBAT".
 * ⚠️ Return kode+satuan sekalian (bukan cuma nama) supaya resolve
 * kode/satuan saat user pilih jenis bisa instant di client tanpa
 * round-trip API (deviasi UX, bukan replikasi 1:1 arsitektur Delphi,
 * tapi behavior akhirnya sama — cljenisPropertiesEditValueChanged).
 */
const getJenisObatOptions = async () => {
  const [rows] = await db.query(
    `SELECT brg_kode AS kode, brg_nama AS nama, brg_satuan AS satuan
     FROM tgarmen_brg WHERE brg_jenis = "OBAT" ORDER BY brg_nama`,
  );
  return rows;
};

/**
 * Resolve SPK (edtNomorSPKExit) — ⚠️ Query BEDA dari F1-search-modal:
 * cabang tspk cuma filter spk_aktif='Y' (TANPA cek divisi/cmo), cabang
 * tmemospk TANPA FILTER SAMA SEKALI. Direplikasi literal persis source,
 * termasuk join aneh `inner join tbarang on spk_nomor=brg_kode`.
 */
const resolveSpk = async (nomorSpk) => {
  const q = `
    SELECT * FROM (
        SELECT spk_nomor, spk_nama AS brg_name, jo_nama, spk_jumlah, spk_cmo
        FROM tspk
        LEFT JOIN tjenisorder ON spk_jo_kode = jo_kode
        WHERE spk_aktif = "Y"
        UNION ALL
        SELECT mspk_nomor AS spk_nomor, mspk_nama AS brg_name, jo_nama,
        mspk_jumlah AS spk_jumlah, mspk_cmo AS spk_cmo
        FROM tmemospk
        LEFT JOIN tjenisorder ON mspk_jo_kode = jo_kode
    ) final
    WHERE spk_nomor = ?
    `;
  const [rows] = await db.query(q, [nomorSpk]);
  if (rows.length === 0) {
    return { found: false }; // "Nomor SPK tersebut tidak ada."
  }
  if (!rows[0].spk_cmo) {
    return { found: true, approved: false }; // "MAP/SPK tsb belum diapproval Chief Marketing."
  }
  return {
    found: true,
    approved: true,
    data: {
      namaBarang: rows[0].brg_name,
      jenisBarang: rows[0].jo_nama,
      jumlah: rows[0].spk_jumlah,
    },
  };
};

/**
 * Resolve Komponen manual-type (loadkomponen) — ⚠️ LIKE partial match
 * LIMIT 1, direplikasi persis (berpotensi ambigu kalau ada kode
 * overlap).
 */
const resolveKomponen = async (kode) => {
  const [rows] = await db.query(
    `SELECT bhn_kode AS kode, bhn_name AS nama, bhn_satuan AS satuan, bhn_stok AS stok
     FROM tbahan WHERE bhn_jb_kode = "LL" AND bhn_aktif = 0 AND bhn_kode LIKE ?
     LIMIT 1`,
    [`%${kode}%`],
  );
  if (rows.length === 0) return null; // "Komponen ini belum ada."
  return rows[0];
};

/**
 * loaddataall — ambil header + komponen + detail utk edit/print.
 */
const getFormData = async (nomor) => {
  const qHeader = `
    SELECT h.ob_nomor, h.ob_cab, h.ob_tanggal, h.ob_spk_nomor,
      IFNULL(s.spk_nama, m.Mspk_nama) AS namaSpk,
      o.jo_nama AS jenisOrder,
      IFNULL(s.spk_jumlah, m.mspk_jumlah) AS spkJumlah,
      h.ob_lini, h.ob_keterangan
    FROM tpakaiobat_hdr h
    LEFT JOIN tspk s ON s.spk_nomor = h.ob_spk_nomor
    LEFT JOIN tmemospk m ON m.Mspk_nomor = h.ob_spk_nomor
    LEFT JOIN tjenisorder o ON o.jo_kode = LEFT(RIGHT(h.ob_spk_nomor, 9), 2)
    WHERE h.ob_nomor = ?
  `;
  const [headerRows] = await db.query(qHeader, [nomor]);
  if (headerRows.length === 0) return null;

  const qKomponen = `
    SELECT k.obk_kode AS kode, b.Bhn_Name AS nama, k.obk_hasil AS hasil
    FROM tpakaiobat_komponen k
    LEFT JOIN tbahan b ON b.Bhn_kode = k.obk_kode
    WHERE k.obk_nomor = ?
  `;
  const [komponenRows] = await db.query(qKomponen, [nomor]);

  const qDetail = `
    SELECT j.brg_nama AS jenis, d.obd_jumlah AS jumlah, j.brg_satuan AS satuan,
      d.obd_okode AS okode
    FROM tpakaiobat_dtl d
    LEFT JOIN tgarmen_brg j ON j.brg_kode = d.obd_okode
    WHERE d.obd_nomor = ?
  `;
  const [detailRows] = await db.query(qDetail, [nomor]);
  // ⚠️ qty (gram) cuma dihitung utk satuan KG, replikasi persis
  const details = detailRows.map((d) => ({
    ...d,
    qty: d.satuan === "KG" ? Number(d.jumlah) * 1000 : 0,
  }));

  return { ...headerRows[0], komponen: komponenRows, details };
};

const getMaxNomor = async (conn, tanggal) => {
  const year = new Date(tanggal).getFullYear();
  const [rows] = await conn.query(
    `SELECT IFNULL(MAX(RIGHT(ob_nomor, 5)), 0) AS mx FROM tpakaiobat_hdr
     WHERE MID(ob_nomor, 4, 4) = ? FOR UPDATE`,
    [String(year)],
  );
  const next = Number(rows[0].mx) + 1;
  return `OB.${year}.${String(next).padStart(5, "0")}`;
};

/**
 * simpandata — replikasi F10 SIMPAN: validasi SPK terisi, minimal 1
 * komponen (hasil != 0), minimal 1 detail obat (jumlah != 0, okode
 * wajib resolve). Delete-then-reinsert komponen & detail dalam 1
 * transaction (3 tabel: hdr, komponen, dtl).
 */
const saveData = async (payload, user, isEdit) => {
  const {
    nomor,
    tanggal,
    spkNomor,
    namaBarang,
    lini,
    keterangan,
    cabang,
    komponen,
    details,
  } = payload;

  // Validasi 1: SPK wajib terisi
  if (!namaBarang) {
    throw new Error("Spk belum di isi.");
  }

  const validKomponen = (komponen || []).filter((k) => k.kode && k.kode.trim());
  // Validasi 2: minimal 1 komponen
  if (validKomponen.length === 0) {
    throw new Error("Komponen harus diisi.");
  }
  // Validasi 3: tiap komponen wajib hasil != 0
  for (const k of validKomponen) {
    if (!k.hasil || Number(k.hasil) === 0) {
      throw new Error("Hasil produksi harus diisi.");
    }
  }
  // Duplikat komponen (defense-in-depth, replikasi cek client Delphi)
  const kodeKomponenSet = new Set();
  for (const k of validKomponen) {
    if (kodeKomponenSet.has(k.kode)) {
      throw new Error(`Komponen ${k.kode} terduplikasi.`);
    }
    kodeKomponenSet.add(k.kode);
  }

  const validDetails = (details || []).filter((d) => d.jenis && d.jenis.trim());
  // Validasi 4: minimal 1 detail
  if (validDetails.length === 0) {
    throw new Error("Detail harus diisi.");
  }
  for (const d of validDetails) {
    // Validasi 5: okode wajib ke-resolve
    if (!d.okode) {
      throw new Error("Jenis obat tidak terdaftar.");
    }
    // Validasi 6: jumlah wajib != 0 (⚠️ beda dari Koreksi Stok yg boleh 0)
    if (!d.jumlah || Number(d.jumlah) === 0) {
      throw new Error("Jumlah harus diisi.");
    }
  }
  const okodeSet = new Set();
  for (const d of validDetails) {
    if (okodeSet.has(d.okode)) {
      throw new Error(`Jenis obat ${d.jenis} terduplikasi.`);
    }
    okodeSet.add(d.okode);
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let finalNomor = nomor;
    let finalCabang = cabang;

    if (isEdit) {
      const [rows] = await conn.query(
        `SELECT ob_nomor, ob_cab FROM tpakaiobat_hdr WHERE ob_nomor = ? FOR UPDATE`,
        [nomor],
      );
      if (rows.length === 0) throw new Error("Data tidak ditemukan.");

      // ⚠️ Cabang immutable saat edit — abaikan dari payload
      finalCabang = rows[0].ob_cab;

      await conn.query(
        `UPDATE tpakaiobat_hdr SET ob_tanggal = ?, ob_spk_nomor = ?, ob_lini = ?,
           ob_keterangan = ?, ob_cab = ?, user_modified = ?, date_modified = NOW()
         WHERE ob_nomor = ?`,
        [tanggal, spkNomor, lini, keterangan, finalCabang, user.kode, nomor],
      );
    } else {
      // Validasi cabang allowed sesuai FormCreate
      const allowedCabang = getCabangOptions(user);
      if (!allowedCabang.includes(cabang)) {
        throw new Error("Cabang tidak valid.");
      }

      finalNomor = await getMaxNomor(conn, tanggal);

      await conn.query(
        `INSERT INTO tpakaiobat_hdr
           (ob_nomor, ob_tanggal, ob_spk_nomor, ob_lini, ob_keterangan, ob_cab, user_create, date_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [finalNomor, tanggal, spkNomor, lini, keterangan, cabang, user.kode],
      );
    }

    // Delete-then-reinsert komponen
    await conn.query(`DELETE FROM tpakaiobat_komponen WHERE obk_nomor = ?`, [
      finalNomor,
    ]);
    for (const k of validKomponen) {
      await conn.query(
        `INSERT INTO tpakaiobat_komponen (obk_nomor, obk_kode, obk_hasil) VALUES (?, ?, ?)`,
        [finalNomor, k.kode, k.hasil],
      );
    }

    // Delete-then-reinsert detail obat
    await conn.query(`DELETE FROM tpakaiobat_dtl WHERE obd_nomor = ?`, [
      finalNomor,
    ]);
    for (const d of validDetails) {
      await conn.query(
        `INSERT INTO tpakaiobat_dtl (obd_nomor, obd_okode, obd_jumlah) VALUES (?, ?, ?)`,
        [finalNomor, d.okode, d.jumlah],
      );
    }

    await conn.commit();
    return { nomor: finalNomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = {
  getCabangOptions,
  getLiniOptions,
  getJenisObatOptions,
  resolveSpk,
  resolveKomponen,
  getFormData,
  saveData,
};
