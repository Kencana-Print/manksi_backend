const db = require("../../config/database");
const {
  getTanggalTutupBuku,
  getManualTutupBuku,
  getTanggalTutupBukuUntukTanggal,
} = require("../tutupBukuService");

const MODUL_NAMA = "KOREKSI BAHAN";
const DEFAULT_GUDANG_KODE = "GB001"; // ✅ sesuai instruksi, default gudang bahan

// ─────────────────────────────────────────────────────────
// GUDANG — replikasi edtgdgkodeExit
// ─────────────────────────────────────────────────────────
const getGudangByKode = async (kode) => {
  const [[row]] = await db.query(
    `SELECT gdg_kode AS kode, gdg_nama AS nama
     FROM tgudang WHERE gdg_bahan = 4 AND gdg_kode = ?`,
    [kode],
  );
  if (!row) throw new Error("Kode gudang tsb tidak ada.");
  return row;
};

// ─────────────────────────────────────────────────────────
// DEFAULT FORM (mode Baru) — replikasi refreshdata
// ─────────────────────────────────────────────────────────
const getDefaultForm = async () => {
  const gudang = await getGudangByKode(DEFAULT_GUDANG_KODE).catch(() => null);
  return {
    tanggal: new Date().toISOString().substring(0, 10),
    gdgKode: DEFAULT_GUDANG_KODE,
    gdgNama: gudang?.nama || "",
  };
};

// ─────────────────────────────────────────────────────────
// BARANG — replikasi clKodePropertiesEditValueChanged + loadbrg + cekkor
// ⚠️ Cek "barang sudah diinput di baris lain" itu state lokal di
// frontend (array baris CDS), TIDAK butuh backend — sengaja gak
// direplikasi di sini.
// ─────────────────────────────────────────────────────────
const getBarangDetail = async ({
  kode,
  gdgKode,
  tanggal,
  nomorSedangDiedit,
}) => {
  const [[bahan]] = await db.query(
    `SELECT b.Bhn_kode AS kode, b.bhn_name AS nama, b.bhn_satuan AS satuan,
            b.Bhn_hargabeli AS hpp,
       IFNULL((
         SELECT SUM(m.mst_stok_in - m.mst_stok_out)
         FROM tmasterstok_bahan m
         WHERE m.mst_aktif = "Y" AND m.mst_gdg_kode = ? AND m.mst_brg_kode = b.Bhn_kode
       ), 0) AS stok
     FROM tbahan b
     WHERE b.bhn_aktif = 0 AND LEFT(b.Bhn_kode, 2) <> "LL" AND b.Bhn_kode = ?`,
    [gdgKode, kode],
  );
  if (!bahan) throw new Error("Kode tsb tidak ada.");

  // ✅ Replikasi cekkor — cegah 2 koreksi aktif buat bahan+tanggal yg
  // sama, kecuali itu koreksi yg sedang diedit sendiri.
  const [[dup]] = await db.query(
    `SELECT mst_noreferensi AS noref FROM tmasterstok_bahan
     WHERE mst_aktif = "Y" AND LEFT(mst_noreferensi, 3) = "KOR"
       AND mst_tanggal = ? AND mst_brg_kode = ?
     LIMIT 1`,
    [tanggal, kode],
  );
  if (dup && dup.noref !== nomorSedangDiedit) {
    throw new Error(`Sudah ada koreksi pada tgl tsb dengan No: ${dup.noref}`);
  }

  return {
    kode: bahan.kode,
    nama: bahan.nama,
    satuan: bahan.satuan,
    hpp: Number(bahan.hpp) || 0,
    stok: Number(bahan.stok) || 0,
    jumlah: 0,
    selisih: 0 - (Number(bahan.stok) || 0),
    total: 0,
    ket: "",
  };
};

// ─────────────────────────────────────────────────────────
// STATUS APPROVAL — replikasi cekClose
// ─────────────────────────────────────────────────────────
const getApprovalStatus = async (nomor) => {
  const [rows] = await db.query(
    `SELECT pin_urut, pin_acc, pin_dipakai
     FROM tspk_pin5
     WHERE pin_trs = ? AND pin_nomor = ? AND pin_jenis = "UBAH"
     ORDER BY pin_urut DESC LIMIT 1`,
    [MODUL_NAMA, nomor],
  );
  if (rows.length === 0) return { status: "MINTA", urut: null };

  const r = rows[0];
  if (r.pin_acc === "" && r.pin_dipakai === "")
    return { status: "WAIT", urut: r.pin_urut };
  if (r.pin_acc === "Y" && r.pin_dipakai === "")
    return { status: "ACC", urut: r.pin_urut };
  if (r.pin_acc === "N") return { status: "TOLAK", urut: r.pin_urut };
  return { status: "MINTA", urut: null };
};

// ─────────────────────────────────────────────────────────
// Helper — replikasi blok "cek sudah close apa belum" (auto+manual,
// per bulan TRANSAKSI). Dipakai buat nentuin apa perlu ngecek status
// approval sama sekali atau enggak (kalau periode masih kebuka bebas,
// gak perlu approval).
// ─────────────────────────────────────────────────────────
const perluCekApproval = async (tanggalTrx) => {
  const manualClose = await getManualTutupBuku(MODUL_NAMA);
  if (manualClose === null) {
    const autoBoundary = await getTanggalTutupBukuUntukTanggal(tanggalTrx);
    return new Date() > autoBoundary;
  }
  return new Date(tanggalTrx) < manualClose;
};

// ─────────────────────────────────────────────────────────
// Helper — replikasi blok validasi di FormKeyDown (F10) SEBELUM
// simpandata: "Anda tidak boleh input di tanggal periode yg sudah
// diclose." Ini beda dari perluCekApproval — ini ngecek boleh SIMPAN
// atau enggak, berbasis PERIODE TERBUKA SAAT INI (bukan bulan
// transaksi), pakai boundary "hari ini" (zdtClose).
// ⚠️ Logic ini kompleks & pakai variable global Delphi (zdtClose)
// yang gak didefinisikan di file ini — diasumsikan setara boundary
// closing utk HARI INI (getTanggalTutupBuku()). Disarankan ditest
// dengan beberapa skenario tanggal nyata sebelum go-live.
// ─────────────────────────────────────────────────────────
const isTanggalEditable = async (tanggalTrx, approvalStatus) => {
  if (approvalStatus === "ACC") return true;

  const manualClose = await getManualTutupBuku(MODUL_NAMA);
  const zdtClose = await getTanggalTutupBuku(); // boundary closing "hari ini"
  const periodStart = new Date(zdtClose.getFullYear(), zdtClose.getMonth(), 1);
  const tgl = new Date(tanggalTrx);

  const withinOpenPeriod = tgl <= zdtClose && tgl >= periodStart;
  const afterBoundary = tgl >= zdtClose;
  const allowedByAuto = withinOpenPeriod || afterBoundary;

  if (manualClose === null) return allowedByAuto;
  if (tgl >= manualClose) return true;
  return allowedByAuto;
};

// ─────────────────────────────────────────────────────────
// GENERATE NOMOR — replikasi getmaxnomor (KOR.YYMM.NNNN)
// ─────────────────────────────────────────────────────────
const generateNomor = async (conn, tanggal) => {
  const d = new Date(tanggal);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const prefix = `KOR.${yy}${mm}`;

  const [[row]] = await conn.query(
    `SELECT IFNULL(MAX(RIGHT(KOR_NOMOR, 4)), 0) AS maxNum
     FROM tkor_hdr WHERE LEFT(KOR_NOMOR, 8) = ?`,
    [prefix],
  );
  // ✅ Number() coercion — mysql2 kadang return angregate sbg string
  const next = Number(row.maxNum) + 1;
  return `${prefix}.${String(next).padStart(4, "0")}`;
};

// ─────────────────────────────────────────────────────────
// GET FORM DATA (mode Ubah) — replikasi loaddataall
// ─────────────────────────────────────────────────────────
const getFormData = async (nomor) => {
  const [[header]] = await db.query(
    `SELECT KOR_NOMOR AS nomor, KOR_TANGGAL AS tanggal,
            KOR_GDG_KODE AS gdgKode, KOR_ket AS keterangan
     FROM tkor_hdr WHERE KOR_NOMOR = ?`,
    [nomor],
  );
  if (!header) throw new Error("Nomor tersebut belum ada.");

  const [[gudang]] = await db.query(
    `SELECT gdg_nama FROM tgudang WHERE gdg_kode = ?`,
    [header.gdgKode],
  );

  const [detail] = await db.query(
    `SELECT d.KORD_BRG_KODE AS kode, b.bhn_name AS nama, b.bhn_satuan AS satuan,
            d.KORD_STOK AS stok, d.KORD_QTY AS jumlah, d.KORD_SELISIH AS selisih,
            d.KORD_HPP AS hpp, (d.KORD_SELISIH * d.KORD_HPP) AS total,
            d.KORD_KET AS ket
     FROM tkor_dtl d
     LEFT JOIN tbahan b ON b.Bhn_kode = d.KORD_BRG_KODE
     WHERE d.KORD_KOR_NOMOR = ?
     ORDER BY d.KORD_BRG_KODE`,
    [nomor],
  );

  let approval = { status: "", urut: null };
  if (await perluCekApproval(header.tanggal)) {
    approval = await getApprovalStatus(nomor);
  }

  const totalNominal = detail.reduce((s, r) => s + (Number(r.total) || 0), 0);

  return {
    header: { ...header, gdgNama: gudang?.gdg_nama || "" },
    detail,
    approval,
    totalNominal,
  };
};

// ─────────────────────────────────────────────────────────
// VALIDASI HEADER+DETAIL — replikasi validasi di FormKeyDown (F10)
// ─────────────────────────────────────────────────────────
const validateHeaderAndDetail = (keterangan, detailRows) => {
  if (!keterangan || !keterangan.trim()) {
    throw new Error("Keterangan harus diisi.");
  }
  const filled = (detailRows || []).filter((r) => r.kode && r.kode.trim());
  if (filled.length === 0) {
    throw new Error("Detail barang harus diisi.");
  }
  for (const r of filled) {
    if (!r.ket || !r.ket.trim()) {
      throw new Error("Detail Keterangan harus diisi.");
    }
  }
};

// ─────────────────────────────────────────────────────────
// CREATE — replikasi simpandata (cabang INSERT)
// ─────────────────────────────────────────────────────────
const create = async (payload, userKode) => {
  const { tanggal, gdgKode, keterangan, detail } = payload;
  validateHeaderAndDetail(keterangan, detail);

  const editable = await isTanggalEditable(tanggal, "");
  if (!editable) {
    throw new Error(
      "Anda tidak boleh input di tanggal periode yg sudah diclose.",
    );
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const nomor = await generateNomor(conn, tanggal);

    await conn.query(
      `INSERT INTO tkor_hdr
        (KOR_NOMOR, KOR_TANGGAL, KOR_GDG_KODE, KOR_ket, user_create, date_create)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [nomor, tanggal, gdgKode, keterangan, userKode],
    );

    const filled = (detail || []).filter((r) => r.kode && r.kode.trim());
    for (const r of filled) {
      await conn.query(
        `INSERT INTO tkor_dtl
          (KORD_KOR_NOMOR, KORD_BRG_KODE, KORD_STOK, KORD_QTY, KORD_SELISIH, KORD_HPP, KORD_KET)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          nomor,
          r.kode,
          r.stok || 0,
          r.jumlah || 0,
          r.selisih || 0,
          r.hpp || 0,
          r.ket || "",
        ],
      );
    }

    await conn.commit();
    return { nomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────
// UPDATE — replikasi simpandata (cabang UPDATE) + tandain
// pin_dipakai='Y' kalau barusan disimpan pakai status ACC
// ─────────────────────────────────────────────────────────
const update = async (nomor, payload, userKode) => {
  const { tanggal, gdgKode, keterangan, detail } = payload;
  validateHeaderAndDetail(keterangan, detail);

  let xminta5 = "";
  let approvalUrut = null;
  if (await perluCekApproval(tanggal)) {
    const approval = await getApprovalStatus(nomor);
    xminta5 = approval.status;
    approvalUrut = approval.urut;
  }

  if (["MINTA", "WAIT", "TOLAK"].includes(xminta5)) {
    throw new Error(
      "Transaksi tsb sudah diclose. Silahkan minta approve untuk bisa menyimpan perubahan data.",
    );
  }

  const editable = await isTanggalEditable(tanggal, xminta5);
  if (!editable) {
    throw new Error(
      "Anda tidak boleh input di tanggal periode yg sudah diclose.",
    );
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      `UPDATE tkor_hdr
       SET KOR_TANGGAL = ?, KOR_GDG_KODE = ?, KOR_ket = ?,
           user_modified = ?, date_modified = NOW()
       WHERE KOR_NOMOR = ?`,
      [tanggal, gdgKode, keterangan, userKode, nomor],
    );

    await conn.query(`DELETE FROM tkor_dtl WHERE KORD_KOR_NOMOR = ?`, [nomor]);

    const filled = (detail || []).filter((r) => r.kode && r.kode.trim());
    for (const r of filled) {
      await conn.query(
        `INSERT INTO tkor_dtl
          (KORD_KOR_NOMOR, KORD_BRG_KODE, KORD_STOK, KORD_QTY, KORD_SELISIH, KORD_HPP, KORD_KET)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          nomor,
          r.kode,
          r.stok || 0,
          r.jumlah || 0,
          r.selisih || 0,
          r.hpp || 0,
          r.ket || "",
        ],
      );
    }

    if (xminta5 === "ACC" && approvalUrut) {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai = "Y"
         WHERE pin_trs = ? AND pin_nomor = ? AND pin_urut = ?`,
        [MODUL_NAMA, nomor, approvalUrut],
      );
    }

    await conn.commit();
    return { nomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = {
  getGudangByKode,
  getDefaultForm,
  getBarangDetail,
  getFormData,
  create,
  update,
};
