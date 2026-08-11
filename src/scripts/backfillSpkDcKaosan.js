// ============================================================
// ONE-OFF BACKFILL — isi tspk_dc untuk SPK PPIC divisi 3 yang
// terlanjur tersimpan SEBELUM fix bug dtlKaosan (source undefined /
// tidak di-destructure dari payload). SPK-SPK ini kaosan-nya kosong
// di tspk_dc padahal seharusnya ter-copy dari SO sumber saat create.
//
// Cara pakai:
//   DRY_RUN=true node scripts/backfillSpkDcKaosan.js   # cek dulu, TIDAK nulis apa-apa
//   node scripts/backfillSpkDcKaosan.js                # jalankan beneran
// ============================================================
const db = require("../config/database");
const {
  getSoHeaderUnified,
  getSoKaosanReference,
  saveSpkKaosan,
  isDivisiTiga,
} = require("../services/ppic/spkFormService");

const DRY_RUN = process.env.DRY_RUN === "true";

const run = async () => {
  // Kandidat: SPK PPIC (spk_is_so=0) divisi 3, punya spk_so_ref,
  // dan BELUM ada baris apapun di tspk_dc untuk nomor itu.
  const [candidates] = await db.query(
    `SELECT s.spk_nomor, s.spk_so_ref, s.spk_divisi
     FROM tspk s
     WHERE s.spk_is_so = 0
       AND LEFT(s.spk_divisi, 1) = '3'
       AND s.spk_so_ref IS NOT NULL AND s.spk_so_ref <> ''
       AND NOT EXISTS (
         SELECT 1 FROM tspk_dc d WHERE d.spkd_nomor = s.spk_nomor
       )`,
  );

  console.log(
    `Ditemukan ${candidates.length} SPK PPIC divisi 3 tanpa data kaosan.`,
  );
  if (DRY_RUN)
    console.log("=== MODE DRY RUN — tidak ada perubahan ditulis ke DB ===\n");

  let filled = 0;
  let emptySource = 0;
  let errored = 0;

  for (const row of candidates) {
    try {
      const { header: soHeader, source: soSource } = await getSoHeaderUnified(
        row.spk_so_ref,
      );
      if (!soHeader) {
        console.log(
          `  [SKIP] ${row.spk_nomor} — SO sumber ${row.spk_so_ref} tidak ditemukan.`,
        );
        continue;
      }

      const kaosanSource = await getSoKaosanReference(row.spk_so_ref, soSource);
      if (!kaosanSource || kaosanSource.length === 0) {
        emptySource++;
        console.log(
          `  [KOSONG] ${row.spk_nomor} — SO ${row.spk_so_ref} (source: ${soSource}) juga tidak punya data kaosan.`,
        );
        continue;
      }

      console.log(
        `  [ISI] ${row.spk_nomor} <- SO ${row.spk_so_ref} (source: ${soSource}), ${kaosanSource.length} baris`,
      );

      if (!DRY_RUN) {
        const conn = await db.getConnection();
        try {
          await conn.beginTransaction();
          await saveSpkKaosan(conn, row.spk_nomor, kaosanSource);
          await conn.commit();
        } catch (e) {
          await conn.rollback();
          throw e;
        } finally {
          conn.release();
        }
      }
      filled++;
    } catch (e) {
      errored++;
      console.error(`  [ERROR] ${row.spk_nomor}: ${e.message}`);
    }
  }

  console.log("\n=== RINGKASAN ===");
  console.log(`Total kandidat : ${candidates.length}`);
  console.log(
    `Berhasil diisi : ${filled}${DRY_RUN ? " (simulasi, belum ditulis)" : ""}`,
  );
  console.log(`SO sumber kosong juga : ${emptySource}`);
  console.log(`Error : ${errored}`);

  process.exit(0);
};

run().catch((e) => {
  console.error("Backfill gagal total:", e);
  process.exit(1);
});
