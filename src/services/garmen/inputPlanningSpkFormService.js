const db = require("../../config/database");

const isLLDivision = (nomor) =>
  String(nomor || "")
    .substring(3, 5)
    .toUpperCase() === "LL";

// ⚠️ Resolve tipe sumber header: MAP -> tmemospk, format "SO-..." ->
// tsalesorder, selain itu -> tspk (SPK PPIC / SO legacy pre-migrasi).
// Ditambahkan setelah ditemukan bahwa mkb_spk_nomor sekarang bisa
// berisi nomor SO langsung — modul Planning per SPK perlu bisa
// menerima nomor itu, bukan cuma SPK PPIC/MAP seperti sebelumnya.
const resolveHeaderSource = (nomor) => {
  const n = String(nomor || "").toUpperCase();
  if (n.startsWith("MAP")) return "map";
  if (n.startsWith("SO-")) return "so";
  return "spk";
};

const getDetail = async (nomor) => {
  const source = resolveHeaderSource(nomor);

  let headerRows;
  if (source === "map") {
    [headerRows] = await db.query(
      `SELECT
        s.spk_nomor AS nomor, s.spk_nama AS nama,
        DATE_FORMAT(s.spk_tanggal, '%Y-%m-%d') AS tanggal,
        DATE_FORMAT(s.spk_dateline, '%Y-%m-%d') AS dateline,
        s.spk_jumlah AS jumlah, s.spk_cab AS cab, s.spk_workshop AS workshop,
        s.spk_tipe AS tipe, s.spk_kain AS kain, s.spk_finishing AS finishing,
        s.spk_sablon AS sablon, s.spk_sublim AS sublim, s.spk_bordir AS bordir,
        s.spk_so_ref AS soRef
      FROM tspk s WHERE s.spk_nomor = ?`,
      [nomor],
    );
  } else if (source === "so") {
    [headerRows] = await db.query(
      `SELECT
         s.so_nomor AS nomor, s.so_nama AS nama,
         DATE_FORMAT(s.so_tanggal, '%Y-%m-%d') AS tanggal,
         DATE_FORMAT(s.so_dateline, '%Y-%m-%d') AS dateline,
         s.so_jumlah AS jumlah, s.so_cab AS cab, s.so_workshop AS workshop,
         s.so_tipe AS tipe, s.so_kain AS kain, s.so_finishing AS finishing,
         s.so_sablon AS sablon, s.so_sublim AS sublim, s.so_bordir AS bordir
       FROM tsalesorder s WHERE s.so_nomor = ?`,
      [nomor],
    );
  } else {
    // ⬅ FIX: SPK PPIC — tambahkan spk_so_ref ke SELECT, supaya bisa
    // dipakai cari planning yang tersimpan atas nama SO sumbernya
    [headerRows] = await db.query(
      `SELECT
         s.spk_nomor AS nomor, s.spk_nama AS nama,
         DATE_FORMAT(s.spk_tanggal, '%Y-%m-%d') AS tanggal,
         DATE_FORMAT(s.spk_dateline, '%Y-%m-%d') AS dateline,
         s.spk_jumlah AS jumlah, s.spk_cab AS cab, s.spk_workshop AS workshop,
         s.spk_tipe AS tipe, s.spk_kain AS kain, s.spk_finishing AS finishing,
         s.spk_sablon AS sablon, s.spk_sublim AS sublim, s.spk_bordir AS bordir,
         s.spk_so_ref AS soRef
       FROM tspk s WHERE s.spk_nomor = ?`,
      [nomor],
    );
  }

  if (headerRows.length === 0) {
    throw new Error("Nomor SPK/SO/MAP tersebut tidak ditemukan.");
  }
  const header = headerRows[0];
  header.sablon = header.sablon === "Y";
  header.sublim = header.sublim === "Y";
  header.bordir = header.bordir === "Y";

  // planKeys sudah otomatis include header.soRef kalau ada —
  // logic ini TIDAK berubah, cuma sekarang soRef ikut ke-select
  // untuk source "map" MAUPUN "spk" (sebelumnya cuma "map")
  const planKeys = [nomor];
  if (header.soRef) planKeys.push(header.soRef);

  const [rows] = await db.query(
    `SELECT * FROM tplanningspk WHERE plan_spk IN (?) ORDER BY plan_tanggal`,
    [planKeys],
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
    ketjahit: r.plan_ketjahit || "",
    ketfinishing: r.plan_ketfinishing || "",
    ketkirim: r.plan_ketkirim || "",
    ppic: r.plan_ppic || "",
    dtppic: r.plan_dtppic || "",
    usr: r.plan_usr || "",
    dtusr: r.plan_dtusr || "",
    lama: true,
  }));

  return { header, detail };
};

const saveData = async (nomor, rows, userKode) => {
  if (!nomor) throw new Error("Nomor SPK tidak valid.");

  const validRows = (rows || []).filter((r) => r && r.tanggal);
  if (validRows.length === 0) {
    throw new Error("Tidak ada data, tidak dapat disimpan.");
  }

  const seenTanggal = new Set();
  for (const r of validRows) {
    if (seenTanggal.has(r.tanggal)) {
      throw new Error(`Tanggal ${r.tanggal} sudah terinput lebih dari sekali.`);
    }
    seenTanggal.add(r.tanggal);
  }

  // ⚠️ Refetch header fresh — tiga sumber (MAP/SO/SPK), sama pola
  // resolveHeaderSource seperti getDetail di atas. Untuk SPK PPIC,
  // sekalian ambil spk_so_ref supaya planning bisa disimpan konsisten
  // ke nomor SO sumbernya (sama key yang dipakai MKB).
  const source = resolveHeaderSource(nomor);
  let headerRows;
  let effectiveNomor = nomor;

  if (source === "map") {
    [headerRows] = await db.query(
      `SELECT mspk_sablon AS sablon, mspk_sublim AS sublim, mspk_bordir AS bordir FROM tmemospk WHERE mspk_nomor = ?`,
      [nomor],
    );
  } else if (source === "so") {
    [headerRows] = await db.query(
      `SELECT so_sablon AS sablon, so_sublim AS sublim, so_bordir AS bordir FROM tsalesorder WHERE so_nomor = ?`,
      [nomor],
    );
  } else {
    [headerRows] = await db.query(
      `SELECT spk_sablon AS sablon, spk_sublim AS sublim, spk_bordir AS bordir, spk_so_ref AS soRef FROM tspk WHERE spk_nomor = ?`,
      [nomor],
    );
    if (headerRows.length > 0 && headerRows[0].soRef) {
      effectiveNomor = headerRows[0].soRef;
    }
  }
  if (headerRows.length === 0)
    throw new Error("Data SPK/SO/MAP tidak ditemukan.");
  const pakaiSablon = headerRows[0].sablon === "Y";
  const pakaiSublim = headerRows[0].sublim === "Y";
  const pakaiBordir = headerRows[0].bordir === "Y";

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
    .replace(" ", " ");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const r of validRows) {
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
          effectiveNomor, // ⬅ FIX: pakai SO ref kalau ada, bukan `nomor` mentah
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

module.exports = { getDetail, saveData };
