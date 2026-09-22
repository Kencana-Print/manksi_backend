const db = require("../config/database");
const {
  pushMapToKomitmenKirim,
} = require("../services/ppic/penjadwalanPpicFormService");

const KOMITMEN_KIRIM_CABANG = ["P01", "P02", "P04", "P05"];

const run = async () => {
  const [rows] = await db.query(
    `SELECT m.mspk_nomor FROM tmemospk m
     WHERE m.mspk_cmo <> '' AND m.mspk_tgl_cmo IS NOT NULL AND m.mspk_aktif = 'Y'
       AND m.mspk_cab IN (?)
       AND m.mspk_tanggal >= '2026-09-01' AND m.mspk_tanggal < '2026-10-01'
       AND IFNULL(m.mspk_jumlah_kirim, 0) = 0
       AND (
         m.mspk_cab IN ('P02','P05')
         OR (
           m.mspk_cab IN ('P01','P04')
           AND NOT EXISTS (
             SELECT 1 FROM tkesesuaianmap k
             WHERE k.mspk_nomor = m.mspk_nomor AND k.kode_sesuai = 1
           )
         )
       )
     ORDER BY m.mspk_tgl_cmo ASC`,
    [KOMITMEN_KIRIM_CABANG],
  );

  console.log(
    `Ditemukan ${rows.length} MAP kandidat backfill (September 2026, belum kirim${", P01/P04 juga belum BAST"}).`,
  );

  let sukses = 0;
  let dilewati = 0;

  for (const row of rows) {
    const [[before]] = await db.query(
      `SELECT pjwd_id FROM tpenjadwalan_ppic_dtl WHERE pjwd_map_nomor = ? AND pjwd_tipe = 'MAP' LIMIT 1`,
      [row.mspk_nomor],
    );
    if (before) {
      dilewati++;
      continue;
    }

    await pushMapToKomitmenKirim(row.mspk_nomor, "BACKFILL");

    const [[after]] = await db.query(
      `SELECT pjwd_id FROM tpenjadwalan_ppic_dtl WHERE pjwd_map_nomor = ? AND pjwd_tipe = 'MAP' LIMIT 1`,
      [row.mspk_nomor],
    );
    if (after) {
      sukses++;
      console.log(`✓ ${row.mspk_nomor} berhasil masuk Komitmen Kirim.`);
    } else {
      console.warn(`✗ ${row.mspk_nomor} GAGAL — cek log error di atas.`);
    }
  }

  console.log(
    `\nSelesai. Sukses: ${sukses}, Sudah ada sebelumnya: ${dilewati}, Total kandidat: ${rows.length}`,
  );
  process.exit(0);
};

run().catch((e) => {
  console.error("Backfill gagal total:", e);
  process.exit(1);
});
