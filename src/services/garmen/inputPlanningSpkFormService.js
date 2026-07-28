const db = require("../../config/database");

// ─────────────────────────────────────────────────────────
// HELPER — cek apakah SPK ini termasuk divisi "LL" (posisi karakter
// 4-5 di nomor === "LL"). Divisi ini dikecualikan dari sebagian besar
// validasi rantai tahap (replikasi persis `pos(MidStr(nomor,4,2),'LL')`).
// ─────────────────────────────────────────────────────────
const isLLDivision = (nomor) =>
  String(nomor || "")
    .substring(3, 5)
    .toUpperCase() === "LL";

// ─────────────────────────────────────────────────────────
// GET DETAIL — replikasi loaddataall Delphi.
// Header diambil dari tmemospk kalau nomor berawalan "MAP",
// selain itu dari tspk (⚠️ tsalesorder SENGAJA tidak diikutkan,
// sesuai keputusan sebelumnya — modul ini scope produksi garmen saja).
// ─────────────────────────────────────────────────────────
const getDetail = async (nomor) => {
  const isMap = String(nomor).toUpperCase().startsWith("MAP");

  let headerRows;
  if (isMap) {
    [headerRows] = await db.query(
      `SELECT
         s.mspk_nomor AS nomor, s.mspk_nama AS nama,
         DATE_FORMAT(s.mspk_tanggal, '%Y-%m-%d') AS tanggal,
         DATE_FORMAT(s.mspk_dateline, '%Y-%m-%d') AS dateline,
         s.mspk_jumlah AS jumlah, s.mspk_cab AS cab, s.mspk_workshop AS workshop,
         s.mspk_tipe AS tipe, s.mspk_kain AS kain, s.mspk_finishing AS finishing,
         s.mspk_sablon AS sablon, s.mspk_sublim AS sublim, s.mspk_bordir AS bordir
       FROM tmemospk s WHERE s.mspk_nomor = ?`,
      [nomor],
    );
  } else {
    [headerRows] = await db.query(
      `SELECT
         s.spk_nomor AS nomor, s.spk_nama AS nama,
         DATE_FORMAT(s.spk_tanggal, '%Y-%m-%d') AS tanggal,
         DATE_FORMAT(s.spk_dateline, '%Y-%m-%d') AS dateline,
         s.spk_jumlah AS jumlah, s.spk_cab AS cab, s.spk_workshop AS workshop,
         s.spk_tipe AS tipe, s.spk_kain AS kain, s.spk_finishing AS finishing,
         s.spk_sablon AS sablon, s.spk_sublim AS sublim, s.spk_bordir AS bordir
       FROM tspk s WHERE s.spk_nomor = ?`,
      [nomor],
    );
  }

  if (headerRows.length === 0) {
    throw new Error("Nomor SPK/MAP tersebut tidak ditemukan.");
  }
  const header = headerRows[0];
  header.sablon = header.sablon === "Y";
  header.sublim = header.sublim === "Y";
  header.bordir = header.bordir === "Y";

  // Detail planning — replikasi query loaddataall bagian bawah.
  const [rows] = await db.query(
    `SELECT * FROM tplanningspk WHERE plan_spk = ? ORDER BY plan_tanggal`,
    [nomor],
  );

  const detail = rows.map((r) => ({
    tanggal: r.plan_tanggal
      ? new Date(r.plan_tanggal).toISOString().substring(0, 10)
      : "",
    datang: Number(r.plan_datang) || 0,
    cutting: Number(r.plan_cutting) || 0,
    cetak: Number(r.plan_cetak) || 0,
    sublim: Number(r.plan_sublim) || 0,
    bordir: Number(r.plan_bordir) || 0,
    jahit: Number(r.plan_jahit) || 0,
    finishing: Number(r.plan_finishing) || 0,
    kirim: Number(r.plan_kirim) || 0,
    ketcutting: r.plan_ketcutting || "",
    ketcetak: r.plan_ketcetak || "",
    ketsublim: r.plan_ketsublim || "",
    ketbordir: r.plan_ketbordir || "",
    // ⚠️ FIX bug Delphi: source aslinya salah ambil dari plan_ketbordir.
    // Di sini diambil dari kolom yang benar, plan_ketjahit.
    ketjahit: r.plan_ketjahit || "",
    ketfinishing: r.plan_ketfinishing || "",
    ketkirim: r.plan_ketkirim || "",
    ppic: r.plan_ppic || "",
    dtppic: r.plan_dtppic || "",
    usr: r.plan_usr || "",
    dtusr: r.plan_dtusr || "",
    lama: true, // baris hasil load dari DB — tidak boleh dihapus di frontend
  }));

  return { header, detail };
};

// ─────────────────────────────────────────────────────────
// SAVE DATA — replikasi simpandata + seluruh validasi rantai tahap
// dari *PropertiesEditValueChanged handlers (dipindah ke save-time,
// lihat catatan arsitektur di atas).
// ─────────────────────────────────────────────────────────
const saveData = async (nomor, rows, userKode) => {
  if (!nomor) throw new Error("Nomor SPK tidak valid.");

  // Baris tanpa tanggal diabaikan total (replikasi persis: skip, TIDAK
  // pernah men-delete data lama yang sudah tersimpan di DB).
  const validRows = (rows || []).filter((r) => r && r.tanggal);

  if (validRows.length === 0) {
    throw new Error("Tidak ada data, tidak dapat disimpan.");
  }

  // Validasi duplikasi tanggal dalam 1 nomor SPK (replikasi
  // cltanggalPropertiesEditValueChanged).
  const seenTanggal = new Set();
  for (const r of validRows) {
    if (seenTanggal.has(r.tanggal)) {
      throw new Error(`Tanggal ${r.tanggal} sudah terinput lebih dari sekali.`);
    }
    seenTanggal.add(r.tanggal);
  }

  // Refetch header fresh dari DB (jangan percaya flag sablon/sublim/bordir
  // dari client) untuk validasi rantai tahap Jahit.
  const isMap = String(nomor).toUpperCase().startsWith("MAP");
  const [headerRows] = await db.query(
    isMap
      ? `SELECT mspk_sablon AS sablon, mspk_sublim AS sublim, mspk_bordir AS bordir FROM tmemospk WHERE mspk_nomor = ?`
      : `SELECT spk_sablon AS sablon, spk_sublim AS sublim, spk_bordir AS bordir FROM tspk WHERE spk_nomor = ?`,
    [nomor],
  );
  if (headerRows.length === 0) throw new Error("Data SPK/MAP tidak ditemukan.");
  const pakaiSablon = headerRows[0].sablon === "Y";
  const pakaiSublim = headerRows[0].sublim === "Y";
  const pakaiBordir = headerRows[0].bordir === "Y";

  // Total tiap tahap di SELURUH baris yang dikirim (data lama + baru
  // sekaligus) — setara gabungan isplanning_X() [DB] + getX() [grid]
  // di Delphi.
  const sum = (field) =>
    validRows.reduce((acc, r) => acc + (Number(r[field]) || 0), 0);

  const sumDatang = sum("datang");
  const sumCutting = sum("cutting");
  const sumCetak = sum("cetak");
  const sumSublim = sum("sublim");
  const sumBordir = sum("bordir");
  const sumJahit = sum("jahit");
  const sumFinishing = sum("finishing");
  const sumKirim = sum("kirim");

  const llExempt = isLLDivision(nomor);

  // Rantai validasi persis urutan Delphi:
  if (sumCutting > 0 && !llExempt && sumDatang === 0) {
    throw new Error(
      "SPK tsb belum input planning kedatangan bahan.\nHubungi divisi pembelian.",
    );
  }
  if (sumCetak > 0 && !llExempt && sumCutting === 0) {
    throw new Error(
      "SPK tsb belum input planning cutting.\nHubungi divisi tsb.",
    );
  }
  if (sumSublim > 0 && !llExempt && sumCutting === 0) {
    throw new Error(
      "SPK tsb belum input planning cutting.\nHubungi divisi tsb.",
    );
  }
  if (sumBordir > 0 && !llExempt && sumCutting === 0) {
    throw new Error(
      "SPK tsb belum input planning cutting.\nHubungi divisi tsb.",
    );
  }
  if (sumJahit > 0 && !llExempt) {
    if (pakaiSablon && sumCetak === 0) {
      throw new Error(
        "SPK tsb belum input planning cetak sablon.\nHubungi divisi tsb.",
      );
    }
    if (pakaiSublim && sumSublim === 0) {
      throw new Error(
        "SPK tsb belum input planning cetak sublim.\nHubungi divisi tsb.",
      );
    }
    if (pakaiBordir && sumBordir === 0) {
      throw new Error(
        "SPK tsb belum input planning bordir.\nHubungi divisi tsb.",
      );
    }
  }
  if (sumFinishing > 0 && sumJahit === 0) {
    throw new Error("SPK tsb belum input planning jahit.\nHubungi divisi tsb.");
  }
  if (sumKirim > 0 && sumFinishing === 0) {
    throw new Error(
      "SPK tsb belum input planning finishing.\nHubungi divisi tsb.",
    );
  }

  const now = new Date();
  const nowStr = now
    .toLocaleString("sv-SE", { timeZone: "Asia/Jakarta" })
    .replace(" ", " "); // "YYYY-MM-DD HH:mm:ss"

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    for (const r of validRows) {
      // Replikasi cldatangPropertiesEditValueChanged: ppic/dtppic
      // di-derive server-side dari nilai akhir 'datang', bukan dipercaya
      // dari client.
      const datang = Number(r.datang) || 0;
      const ppic = datang !== 0 ? userKode : "";
      const dtppic = datang !== 0 ? nowStr : "";

      await conn.query(
        `INSERT INTO tplanningspk (
           plan_spk, plan_tanggal, plan_datang, plan_cutting, plan_cetak,
           plan_sublim, plan_bordir, plan_jahit, plan_finishing, plan_kirim,
           plan_ketcutting, plan_ketcetak, plan_ketsublim, plan_ketbordir,
           plan_ketjahit, plan_ketfinishing, plan_ketkirim,
           plan_ppic, plan_dtppic, plan_usr, plan_dtusr
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           plan_datang = VALUES(plan_datang),
           plan_cutting = VALUES(plan_cutting),
           plan_cetak = VALUES(plan_cetak),
           plan_sublim = VALUES(plan_sublim),
           plan_bordir = VALUES(plan_bordir),
           plan_jahit = VALUES(plan_jahit),
           plan_finishing = VALUES(plan_finishing),
           plan_kirim = VALUES(plan_kirim),
           plan_ketcutting = VALUES(plan_ketcutting),
           plan_ketcetak = VALUES(plan_ketcetak),
           plan_ketsublim = VALUES(plan_ketsublim),
           plan_ketbordir = VALUES(plan_ketbordir),
           plan_ketjahit = VALUES(plan_ketjahit),
           plan_ketfinishing = VALUES(plan_ketfinishing),
           plan_ketkirim = VALUES(plan_ketkirim),
           plan_ppic = VALUES(plan_ppic),
           plan_dtppic = VALUES(plan_dtppic),
           plan_usr = VALUES(plan_usr),
           plan_dtusr = VALUES(plan_dtusr)`,
        [
          nomor,
          r.tanggal,
          datang,
          Number(r.cutting) || 0,
          Number(r.cetak) || 0,
          Number(r.sublim) || 0,
          Number(r.bordir) || 0,
          Number(r.jahit) || 0,
          Number(r.finishing) || 0,
          Number(r.kirim) || 0,
          r.ketcutting || "",
          r.ketcetak || "",
          r.ketsublim || "",
          r.ketbordir || "",
          r.ketjahit || "",
          r.ketfinishing || "",
          r.ketkirim || "",
          ppic,
          dtppic,
          userKode,
          nowStr,
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

module.exports = {
  getDetail,
  saveData,
};
