const pool = require("../../../../config/database");
const { format } = require("date-fns");

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const normalizeCabang = (cabang) =>
  String(cabang || "P04").trim().toUpperCase().slice(0, 3) || "P04";

const isGudangCode = (value) => /^GP\d{3}$/i.test(String(value || "").trim());

// Bagian asal form adalah "SUB" (Sublim/RTR). Untuk tabel
// tmutasiproduksi, kolom mph_gdgasal harus berisi kode gudang produksi.
const mapGudangAsal = (bagianAsal, cabang) => {
  const value = String(bagianAsal || "").trim().toUpperCase();
  if (isGudangCode(value)) return value;
  if (["SUB", "SUBLIM", "RTR", "GPM"].includes(value)) {
    return cabang === "P01" ? "GP029" : "GP031";
  }
  return cabang === "P01" ? "GP029" : "GP031";
};

// Bagian tujuan form: PTG/JHT/FIN/GGD. Konversi ke kode gudang
// produksi yang dipakai browse/cetak Mutasi Produksi.
const mapGudangTujuan = (bagianTujuan, cabang) => {
  const value = String(bagianTujuan || "").trim().toUpperCase();
  if (isGudangCode(value)) return value;

  const mapP04 = {
    PTG: "GP001", // GD Potong P4
    JHT: "GP003", // GD Jahit P4
    FIN: "GP004", // GD Lipat/Finishing P4
    GGD: "GP013", // GD Koli/Gudang Jadi P4
  };
  const mapP01 = {
    PTG: "GP015", // GD Potong P1
    JHT: "GP018", // GD Jahit P1
    FIN: "GP019", // GD Lipat/Finishing P1
    GGD: "GP020", // GD Koli/Gudang Jadi P1
  };

  return (cabang === "P01" ? mapP01 : mapP04)[value] || value || "";
};

const parseLhkRef = (item) => {
  let lhkNomor = item.lhk_nomor || item.Nomor;
  let lhkNoUrut = item.No_Urut || item.lrd_no_urut;

  if (
    !lhkNomor &&
    item.lhk_detail_id &&
    typeof item.lhk_detail_id === "string" &&
    item.lhk_detail_id.includes("_")
  ) {
    const parts = item.lhk_detail_id.split("_");
    lhkNoUrut = parseInt(parts.pop(), 10);
    lhkNomor = parts.join("_");
  }

  return {
    lhkNomor: lhkNomor || "",
    lhkNoUrut: Number(lhkNoUrut) || 0,
  };
};

exports.getNewNomorMutasi = async () => {
  try {
    const currentYear = format(new Date(), "yyyy");
    const searchPattern = `MP/%/${currentYear}`;

    // Format nomor: MP/<nomor urut>/<tahun>, mis. MP/45367/2025.
    // Nomor urut diambil dari nomor terbesar pada tahun berjalan, baik dari
    // tabel produksi maupun tabel mutasi lama, agar tidak terjadi duplikat.
    const sql = `
      SELECT MAX(CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(nomor, '/', 2), '/', -1) AS UNSIGNED)) AS MaxNomor
      FROM (
        SELECT mph_nomor AS nomor
        FROM tmutasiproduksi_hdr
        WHERE mph_nomor LIKE ?
        UNION ALL
        SELECT mut_nomor AS nomor
        FROM tmutasi_hdr
        WHERE mut_nomor LIKE ?
      ) x;
    `;

    const [results] = await pool.query(sql, [searchPattern, searchPattern]);
    const maxNomor = Number(results[0]?.MaxNomor) || 0;
    const nextNumber = String(maxNomor + 1).padStart(5, "0");

    return `MP/${nextNumber}/${currentYear}`;
  } catch (error) {
    throw new Error("Gagal generate nomor mutasi: " + error.message);
  }
};

const getMutasiTable = async (connection, nomor) => {
  const [produksi] = await connection.query(
    "SELECT mph_nomor FROM tmutasiproduksi_hdr WHERE mph_nomor = ? LIMIT 1",
    [nomor],
  );
  if (produksi.length > 0) return "produksi";

  const [lama] = await connection.query(
    "SELECT mut_nomor FROM tmutasi_hdr WHERE mut_nomor = ? LIMIT 1",
    [nomor],
  );
  if (lama.length > 0) return "lama";

  return null;
};

// Cari baris LHK RTR yang menjadi sumber detail mutasi produksi.
// Dipakai saat edit/hapus untuk mengembalikan stok sublim.
const resolveLhkDetail = async (connection, lhkNomor, row) => {
  // "-" dipakai sebagai fallback saat LHK tidak punya kode bahan.
  // Anggap wildcard agar stok tetap bisa ditemukan dan dikembalikan.
  const bhnKode =
    row.mpd_bhn_kode && row.mpd_bhn_kode !== "-"
      ? row.mpd_bhn_kode
      : "";
  const spk = row.mpd_spk || "";
  const size = row.mpd_size || "";
  // mpd_lhk menyimpan stok asli sebelum dipotong; stok yang tersisa
  // sekarang adalah mpd_lhk - mpd_jumlah.
  const sisaStok = toNumber(row.mpd_lhk) - toNumber(row.mpd_jumlah);

  if (lhkNomor) {
    const [rows] = await connection.query(
      `SELECT lrd_lr_nomor, lrd_no_urut
       FROM tlhk_rtr_dtl
       WHERE lrd_lr_nomor = ?
         AND lrd_spk_nomor = ?
         AND lrd_poid_size = ?
         AND (lrd_bahan = ? OR ? = '' OR COALESCE(lrd_bahan, '') = '')
         AND lrd_jumlah = ?
       ORDER BY lrd_no_urut
       LIMIT 1`,
      [lhkNomor, spk, size, bhnKode, bhnKode, sisaStok],
    );
    if (rows.length > 0) return rows[0];
  }

  const [fallback] = await connection.query(
    `SELECT lrd_lr_nomor, lrd_no_urut
     FROM tlhk_rtr_dtl
     WHERE lrd_spk_nomor = ?
       AND lrd_poid_size = ?
       AND (lrd_bahan = ? OR ? = '' OR COALESCE(lrd_bahan, '') = '')
       AND lrd_jumlah = ?
     ORDER BY lrd_lr_nomor DESC, lrd_no_urut DESC
     LIMIT 1`,
    [spk, size, bhnKode, bhnKode, sisaStok],
  );

  return fallback[0] || null;
};

// Sinkronkan flag lr_mutasi setelah dokumen mutasi dihapus. Flag ini dipakai
// lookup LHK Sublim untuk menampilkan status CLOSE. Jika tidak ada lagi
// dokumen mutasi yang memakai detail LHK tersebut, status dikembalikan OPEN.
const syncLhkMutationFlag = async (connection, lhkNomor) => {
  if (!lhkNomor || !String(lhkNomor).startsWith("MMT-LHK")) return;

  const [produksi] = await connection.query(
    `SELECT COUNT(*) AS n
     FROM tmutasiproduksi_dtl d
     JOIN tmutasiproduksi_hdr h ON h.mph_nomor = d.mpd_mph_nomor
     WHERE h.mph_kelompok = 'SUBLIM'
       AND EXISTS (
         SELECT 1 FROM tlhk_rtr_dtl l
         WHERE l.lrd_lr_nomor = ?
           AND l.lrd_spk_nomor = d.mpd_spk
           AND l.lrd_poid_size = d.mpd_size
           AND (
             l.lrd_bahan = d.mpd_bhn_kode
             OR d.mpd_bhn_kode IN ('', '-')
             OR COALESCE(l.lrd_bahan, '') = ''
           )
       )`,
    [lhkNomor],
  );

  let active = Number(produksi[0]?.n) > 0;

  if (!active) {
    const [lama] = await connection.query(
      `SELECT COUNT(*) AS n
       FROM tmutasi_dtl d
       JOIN tlhk_rtr_dtl l
         ON l.lrd_lr_nomor = ?
        AND l.lrd_no_urut = d.mutd_lhk_detail_id
        AND l.lrd_spk_nomor = d.mutd_spk_nomor
        AND l.lrd_poid_size = d.mutd_poi_size
       WHERE d.mutd_jumlah > 0`,
      [lhkNomor],
    );
    active = Number(lama[0]?.n) > 0;
  }

  await connection.query(
    "UPDATE tlhk_rtr_hdr SET lr_mutasi = ? WHERE lr_nomor = ?",
    [active ? 1 : 0, lhkNomor],
  );
};

exports.saveMutasiInternal = async (data, isUpdate = false, userLogin) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    let { Nomor, Tanggal, GudangAsal, GudangTujuan, Keterangan, Cabang, Details } =
      data;

    const cabang = normalizeCabang(Cabang);
    const serverTime = new Date();
    const activeUser = userLogin || "SYSTEM";

    // 1. Handle Nomor Dokumen
    if (!isUpdate && (!Nomor || Nomor === "MUT-AUTO" || Nomor === "AUTO")) {
      Nomor = await exports.getNewNomorMutasi();
    }

    const table = isUpdate ? await getMutasiTable(connection, Nomor) : "produksi";
    if (isUpdate && !table) {
      throw new Error(`Dokumen mutasi ${Nomor} tidak ditemukan.`);
    }

    // =====================================================================
    // Jalur lama: dokumen yang sudah terlanjur tersimpan di tmutasi_hdr/dtl.
    // Tetap didukung agar edit/hapus dokumen lama tidak kehilangan stok LHK.
    // =====================================================================
    if (isUpdate && table === "lama") {
      const kodeGudangAsal = GudangAsal || "GP001";
      const kodeGudangTujuan = GudangTujuan || "GB001";

      const [oldDetails] = await connection.query(
        `SELECT mutd_lhk_detail_id, mutd_nourut, mutd_jumlah,
                mutd_spk_nomor, mutd_poi_size, mutd_nama_komponen,
                mutd_stok_sublim_lama
         FROM tmutasi_dtl WHERE mutd_mut_nomor = ?`,
        [Nomor],
      );
      const oldAffectedLhk = new Set();
      const oldRefByKey = new Map();
      for (const oldItem of oldDetails) {
        const ref = await resolveLhkDetail(connection, "", {
          mpd_spk: oldItem.mutd_spk_nomor,
          mpd_size: oldItem.mutd_poi_size,
          mpd_bhn_kode: oldItem.mutd_nama_komponen,
          mpd_lhk: oldItem.mutd_stok_sublim_lama,
          mpd_jumlah: oldItem.mutd_jumlah,
        });
        if (ref) {
          oldAffectedLhk.add(ref.lrd_lr_nomor);
          await connection.query(
            "UPDATE tlhk_rtr_dtl SET lrd_jumlah = lrd_jumlah + ? WHERE lrd_lr_nomor = ? AND lrd_no_urut = ?",
            [oldItem.mutd_jumlah, ref.lrd_lr_nomor, ref.lrd_no_urut],
          );
          oldRefByKey.set(
            `${oldItem.mutd_spk_nomor || ""}|${oldItem.mutd_poi_size || ""}|${oldItem.mutd_nama_komponen || ""}`,
            ref,
          );
        }
      }

      await connection.query(
        "DELETE FROM tmutasi_dtl WHERE mutd_mut_nomor = ?",
        [Nomor],
      );

      await connection.query(
        `UPDATE tmutasi_hdr SET
            mut_tanggal=?, mut_gdg_asal=?, mut_gdg_tujuan=?,
            mut_keterangan=?, mut_type=?, user_modified=?, date_modified=?
         WHERE mut_nomor=?`,
        [
          Tanggal,
          kodeGudangAsal,
          kodeGudangTujuan,
          Keterangan,
          data.Type || 1,
          activeUser,
          serverTime,
          Nomor,
        ],
      );

      if (Details && Details.length > 0) {
        const groupedDetailsMap = new Map();
        for (const d of Details) {
          const key = `${d.brg_kode || d.kode_barang || "-"}_${d.lhk_detail_id || d.Nomor || "null"}_${d.No_Urut || 0}`;
          if (groupedDetailsMap.has(key)) {
            groupedDetailsMap.get(key).qty_mutasi += Number(d.qty_mutasi);
          } else {
            groupedDetailsMap.set(key, {
              ...d,
              qty_mutasi: Number(d.qty_mutasi),
            });
          }
        }
        const finalDetails = Array.from(groupedDetailsMap.values());
        const newAffectedLhk = new Set();

        for (let i = 0; i < finalDetails.length; i++) {
          const item = finalDetails[i];
          const currentNoUrut = i + 1;
          const brgKode = item.brg_kode || item.kode_barang || "-";
          let lhkNomor = item.lhk_nomor || item.Nomor;
          let lhkNoUrut = item.No_Urut || item.lrd_no_urut;

          if (
            !lhkNomor &&
            item.lhk_detail_id &&
            typeof item.lhk_detail_id === "string" &&
            item.lhk_detail_id.includes("_")
          ) {
            const parts = item.lhk_detail_id.split("_");
            lhkNoUrut = parseInt(parts.pop(), 10);
            lhkNomor = parts.join("_");
          }

          // Dokumen lama hanya menyimpan nomor urut detail, bukan nomor LHK.
          // Gunakan referensi LHK yang berhasil di-resolve saat restore stok.
          if (!lhkNomor || !String(lhkNomor).startsWith("MMT-LHK")) {
            const oldKey = `${item.Nomor_SPK || item.nomor_spk || ""}|${item.lrd_poid_size || item.poi_size || ""}|${item.lrd_spk_nama || item.nama_komponen || ""}`;
            const oldRef = oldRefByKey.get(oldKey);
            if (oldRef) {
              lhkNomor = oldRef.lrd_lr_nomor;
              lhkNoUrut = oldRef.lrd_no_urut;
            }
          }

          lhkNomor = lhkNomor || "-";
          lhkNoUrut = Number(lhkNoUrut) || 1;
          if (lhkNomor !== "-") newAffectedLhk.add(lhkNomor);

          const [stokCheck] = await connection.query(
            "SELECT lrd_jumlah FROM tlhk_rtr_dtl WHERE lrd_lr_nomor = ? AND lrd_no_urut = ?",
            [lhkNomor, lhkNoUrut],
          );
          const currentStok = stokCheck[0]?.lrd_jumlah || 0;

          await connection.query(
            `INSERT INTO tmutasi_dtl
              (mutd_mut_nomor, mutd_brg_kode, mutd_lhk_detail_id, mutd_spk_nomor, mutd_poi_nomor, mutd_poi_size, mutd_nama_komponen, mutd_jumlah, mutd_stok_sublim_lama, mutd_keterangan, mutd_nourut)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              Nomor,
              brgKode,
              lhkNoUrut,
              item.Nomor_SPK || item.nomor_spk || "-",
              item.No_PO_Internal || item.poi_nomor || "-",
              item.lrd_poid_size || item.poi_size || "",
              item.lrd_spk_nama || item.nama_komponen || "",
              item.qty_mutasi,
              currentStok,
              item.keterangan || "",
              Number(currentNoUrut),
            ],
          );

          await connection.query(
            "UPDATE tlhk_rtr_dtl SET lrd_jumlah = lrd_jumlah - ? WHERE lrd_lr_nomor = ? AND lrd_no_urut = ?",
            [item.qty_mutasi, lhkNomor, lhkNoUrut],
          );
          await connection.query(
            "UPDATE tlhk_rtr_hdr SET lr_mutasi = 1 WHERE lr_nomor = ?",
            [lhkNomor],
          );
        }
      }

      for (const lhkNomor of oldAffectedLhk) {
        await syncLhkMutationFlag(connection, lhkNomor);
      }
      for (const lhkNomor of newAffectedLhk) {
        await syncLhkMutationFlag(connection, lhkNomor);
      }

      await connection.commit();
      return { success: true, nomor: Nomor, table: "tmutasi" };
    }

    // =====================================================================
    // Jalur baru: simpan ke tmutasiproduksi_hdr / tmutasiproduksi_dtl.
    // =====================================================================
    const gudangAsal = mapGudangAsal(GudangAsal, cabang);
    const gudangTujuan = mapGudangTujuan(GudangTujuan, cabang);

    // Gabungkan baris dengan referensi LHK + SPK + size + komponen yang sama.
    const groupedDetailsMap = new Map();
    for (const d of Details || []) {
      const ref = parseLhkRef(d);
      const key = `${ref.lhkNomor}_${ref.lhkNoUrut}_${d.nomor_spk || d.Nomor_SPK || ""}_${d.poi_size || d.Size || ""}_${d.nama_komponen || ""}`;
      if (groupedDetailsMap.has(key)) {
        groupedDetailsMap.get(key).qty_mutasi += toNumber(d.qty_mutasi);
      } else {
        groupedDetailsMap.set(key, {
          ...d,
          qty_mutasi: toNumber(d.qty_mutasi),
          __ref: ref,
        });
      }
    }
    const finalDetails = Array.from(groupedDetailsMap.values()).filter(
      (d) => d.qty_mutasi > 0,
    );

    // Restore stok LHK dari detail lama sebelum replace.
    const oldAffectedLhk = new Set();
    if (isUpdate) {
      const [oldHdr] = await connection.query(
        "SELECT mph_nomor_opr FROM tmutasiproduksi_hdr WHERE mph_nomor = ? LIMIT 1",
        [Nomor],
      );
      const oldLhkNomor = oldHdr[0]?.mph_nomor_opr || "";
      if (oldLhkNomor) oldAffectedLhk.add(oldLhkNomor);
      const [oldDetails] = await connection.query(
        "SELECT * FROM tmutasiproduksi_dtl WHERE mpd_mph_nomor = ?",
        [Nomor],
      );

      for (const oldItem of oldDetails) {
        const ref = await resolveLhkDetail(connection, oldLhkNomor, oldItem);
        if (ref) {
          oldAffectedLhk.add(ref.lrd_lr_nomor);
          await connection.query(
            "UPDATE tlhk_rtr_dtl SET lrd_jumlah = lrd_jumlah + ? WHERE lrd_lr_nomor = ? AND lrd_no_urut = ?",
            [toNumber(oldItem.mpd_jumlah), ref.lrd_lr_nomor, ref.lrd_no_urut],
          );
        }
      }

      await connection.query(
        "DELETE FROM tmutasiproduksi_dtl WHERE mpd_mph_nomor = ?",
        [Nomor],
      );
    }

    // Agregat header
    const totalQty = finalDetails.reduce(
      (sum, d) => sum + toNumber(d.qty_mutasi),
      0,
    );
    const spkSet = new Set(
      finalDetails
        .map((d) => d.nomor_spk || d.Nomor_SPK)
        .filter((v) => v && v !== "-"),
    );
    const lhkSet = new Set(
      finalDetails.map((d) => d.__ref.lhkNomor).filter(Boolean),
    );
    const commonSpk = spkSet.size === 1 ? [...spkSet][0] : "";
    const commonLhk = lhkSet.size === 1 ? [...lhkSet][0] : "";

    if (isUpdate) {
      await connection.query(
        `UPDATE tmutasiproduksi_hdr SET
            mph_tanggal=?, mph_cab=?, mph_gdgasal=?, mph_gdgtujuan=?,
            mph_keterangan=?, mph_spk_nomor=?, mph_jumlah=?,
            mph_kelompok=?, mph_kelompok_tujuan=?, mph_komponen=?,
            mph_asal_kerjaan=?, mph_nomor_opr=?, user_modified=?, date_modified=?
         WHERE mph_nomor=?`,
        [
          Tanggal,
          cabang,
          gudangAsal,
          gudangTujuan,
          Keterangan || "",
          commonSpk,
          totalQty,
          "SUBLIM",
          GudangTujuan || "",
          "",
          cabang,
          commonLhk,
          activeUser,
          serverTime,
          Nomor,
        ],
      );
    } else {
      await connection.query(
        `INSERT INTO tmutasiproduksi_hdr
          (mph_nomor, mph_tanggal, mph_cab, mph_gdgasal, mph_gdgtujuan,
           mph_keterangan, mph_spk_nomor, mph_jumlah, mph_kelompok,
           mph_kelompok_tujuan, mph_komponen, mph_asal_kerjaan,
           mph_nomor_opr, mph_apv, user_create, date_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Y', ?, ?)`,
        [
          Nomor,
          Tanggal,
          cabang,
          gudangAsal,
          gudangTujuan,
          Keterangan || "",
          commonSpk,
          totalQty,
          "SUBLIM",
          GudangTujuan || "",
          "",
          cabang,
          commonLhk,
          activeUser,
          serverTime,
        ],
      );
    }

    // Insert detail + potong stok LHK RTR
    for (const item of finalDetails) {
      const { lhkNomor, lhkNoUrut } = item.__ref;
      let lhkRow = null;

      if (lhkNomor && lhkNoUrut) {
        const [rows] = await connection.query(
          `SELECT lrd_lr_nomor, lrd_no_urut, lrd_jumlah, lrd_bahan,
                  lrd_komponen, lrd_panjang, lrd_lebar, lrd_spk_nomor,
                  lrd_poid_size, lrd_poi_nomor
           FROM tlhk_rtr_dtl
           WHERE lrd_lr_nomor = ? AND lrd_no_urut = ?
           LIMIT 1`,
          [lhkNomor, lhkNoUrut],
        );
        lhkRow = rows[0] || null;
      }

      const qty = toNumber(item.qty_mutasi);
      const bhnKode =
        lhkRow?.lrd_bahan || item.brg_kode || item.kode_barang || "-";
      const nama =
        lhkRow?.lrd_komponen ||
        lhkRow?.lrd_bahan ||
        item.nama_komponen ||
        "-";
      const size =
        lhkRow?.lrd_poid_size || item.poi_size || item.Size || "";
      const spk =
        lhkRow?.lrd_spk_nomor || item.nomor_spk || item.Nomor_SPK || "-";
      const stokLama = toNumber(lhkRow?.lrd_jumlah ?? item.stok_sublim ?? qty);
      const panjang = toNumber(lhkRow?.lrd_panjang ?? item.panjang ?? 0);
      const lebar = toNumber(lhkRow?.lrd_lebar ?? item.lebar ?? 0);

      await connection.query(
        `INSERT INTO tmutasiproduksi_dtl
          (mpd_mph_nomor, mpd_spk, mpd_bhn_kode, mpd_nama, mpd_satuan,
           mpd_size, mpd_lhk, mpd_jumlah, mpd_jumlah_kain, mpd_jumlah_sablon,
           mpd_jumlah_bs, mpd_jumlah_jahit, mpd_gantibs, mpd_panjang,
           mpd_lebar, mpd_gdgp_asal)
         VALUES (?, ?, ?, ?, 'PCS', ?, ?, ?, 0, 0, 0, 0, 0, ?, ?, ?)`,
        [
          Nomor,
          spk,
          bhnKode,
          nama,
          size,
          stokLama,
          qty,
          panjang,
          lebar,
          gudangAsal,
        ],
      );

      if (lhkRow) {
        await connection.query(
          "UPDATE tlhk_rtr_dtl SET lrd_jumlah = lrd_jumlah - ? WHERE lrd_lr_nomor = ? AND lrd_no_urut = ?",
          [qty, lhkNomor, lhkNoUrut],
        );
        await connection.query(
          "UPDATE tlhk_rtr_hdr SET lr_mutasi = 1 WHERE lr_nomor = ?",
          [lhkNomor],
        );
      }
    }

    // Setelah update, LHK lama yang tidak dipakai lagi harus kembali OPEN,
    // sedangkan LHK baru tetap CLOSE.
    for (const lhkNomor of oldAffectedLhk) {
      await syncLhkMutationFlag(connection, lhkNomor);
    }
    for (const lhkNomor of lhkSet) {
      await syncLhkMutationFlag(connection, lhkNomor);
    }

    await connection.commit();
    return { success: true, nomor: Nomor, table: "tmutasiproduksi" };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

exports.getMutasiData = async (startDate, endDate, userLogin) => {
  try {
    // Browse hanya menampilkan dokumen yang dibuat oleh user yang login.
    // Contoh: ARDAN hanya melihat dokumen user_create ARDAN, ESTI hanya ESTI.
    const userFilter = String(userLogin || "").trim().toUpperCase();

    // UNION dengan tmutasi_hdr agar dokumen lama (sebelum perpindahan
    // tabel) tetap muncul di browse. Nomor yang sudah ada di tabel
    // produksi tidak diambil dari tabel lama.
    const sqlMaster = `
      SELECT * FROM (
        SELECT
          h.mph_nomor AS Nomor_Mutasi,
          h.mph_tanggal AS Tanggal,
          h.mph_kelompok AS Bagian_Asal,
          COALESCE(NULLIF(h.mph_kelompok_tujuan, ''), h.mph_gdgtujuan) AS Bagian_Tujuan,
          h.mph_keterangan AS Keterangan,
          1 AS Status,
          COALESCE((
            SELECT SUM(d.mpd_jumlah)
            FROM tmutasiproduksi_dtl d
            WHERE d.mpd_mph_nomor = h.mph_nomor
          ), 0) AS Total_Qty,
          h.date_create AS _sort
        FROM tmutasiproduksi_hdr h
        WHERE (
            h.mph_nomor LIKE 'MMT.MUT.%'
            OR (
              h.mph_kelompok = 'SUBLIM'
              AND h.mph_kelompok_tujuan IN ('PTG', 'JHT', 'FIN', 'GGD')
            )
          )
          AND h.mph_tanggal BETWEEN ? AND ?
          AND UPPER(TRIM(h.user_create)) = ?

        UNION ALL

        SELECT
          h.mut_nomor AS Nomor_Mutasi,
          h.mut_tanggal AS Tanggal,
          h.mut_gdg_asal AS Bagian_Asal,
          h.mut_gdg_tujuan AS Bagian_Tujuan,
          h.mut_keterangan AS Keterangan,
          h.mut_status_realisasi AS Status,
          COALESCE((
            SELECT SUM(d.mutd_jumlah)
            FROM tmutasi_dtl d
            WHERE d.mutd_mut_nomor = h.mut_nomor
          ), 0) AS Total_Qty,
          h.date_create AS _sort
        FROM tmutasi_hdr h
        WHERE h.mut_nomor LIKE 'MMT.MUT.%'
          AND h.mut_tanggal BETWEEN ? AND ?
          AND UPPER(TRIM(h.user_create)) = ?
          AND NOT EXISTS (
            SELECT 1 FROM tmutasiproduksi_hdr p
            WHERE p.mph_nomor = h.mut_nomor
          )
      ) x
      ORDER BY x._sort DESC, x.Tanggal DESC
    `;

    const [masterResults] = await pool.query(sqlMaster, [
      startDate,
      endDate,
      userFilter,
      startDate,
      endDate,
      userFilter,
    ]);
    return masterResults;
  } catch (error) {
    throw new Error("Gagal tarik data master mutasi: " + error.message);
  }
};

exports.getMutasiDetailByNomor = async (nomor) => {
  try {
    const [produksiHdr] = await pool.query(
      "SELECT * FROM tmutasiproduksi_hdr WHERE mph_nomor = ? LIMIT 1",
      [nomor],
    );

    if (produksiHdr.length > 0) {
      const h = produksiHdr[0];
      const sqlDetail = `
        SELECT
          COALESCE((
            SELECT CONCAT(l.lrd_lr_nomor, '_', l.lrd_no_urut)
            FROM tlhk_rtr_dtl l
            WHERE l.lrd_spk_nomor = d.mpd_spk
              AND l.lrd_poid_size = d.mpd_size
              AND (
                l.lrd_bahan = d.mpd_bhn_kode
                OR d.mpd_bhn_kode IN ('', '-')
                OR COALESCE(l.lrd_bahan, '') = ''
              )
              AND l.lrd_jumlah = (d.mpd_lhk - d.mpd_jumlah)
            ORDER BY (l.lrd_lr_nomor = ?) DESC, l.lrd_lr_nomor DESC, l.lrd_no_urut DESC
            LIMIT 1
          ), CONCAT(COALESCE(?, ''), '_', 0)) AS Lhk_Detail_Id,
          d.mpd_mph_nomor AS Nomor_Mutasi,
          d.mpd_spk AS Nomor_SPK,
          s.spk_nama AS Nama_SPK,
          COALESCE(d.mpd_spk, '') AS No_PO_Internal,
          d.mpd_size AS Size,
          d.mpd_nama AS Nama_Komponen,
          d.mpd_jumlah AS Qty_Mutasi,
          d.mpd_lhk AS Stok_Sublim_Lama,
          DATE_FORMAT(?, '%Y-%m-%d') AS Tanggal,
          ? AS Bagian_Asal,
          ? AS Bagian_Tujuan,
          ? AS Keterangan
        FROM tmutasiproduksi_dtl d
        LEFT JOIN tspk s ON s.spk_nomor = d.mpd_spk
        WHERE d.mpd_mph_nomor = ?
        ORDER BY d.mpd_spk, d.mpd_size
      `;

      const [detailResults] = await pool.query(sqlDetail, [
        h.mph_nomor_opr || "",
        h.mph_nomor_opr || "",
        h.mph_tanggal,
        h.mph_kelompok,
        h.mph_kelompok_tujuan || h.mph_gdgtujuan,
        h.mph_keterangan,
        nomor,
      ]);
      return detailResults;
    }

    // Fallback dokumen lama di tmutasi_hdr/dtl.
    const sqlDetail = `
      SELECT
        d.mutd_lhk_detail_id AS Lhk_Detail_Id,
        d.mutd_mut_nomor AS Nomor_Mutasi,
        d.mutd_spk_nomor AS Nomor_SPK,
        d.mutd_poi_nomor AS No_PO_Internal,
        d.mutd_poi_size AS Size,
        d.mutd_nama_komponen AS Nama_Komponen,
        d.mutd_jumlah AS Qty_Mutasi,
        d.mutd_stok_sublim_lama AS Stok_Sublim_Lama,
        s.spk_nama AS Nama_SPK,
        DATE_FORMAT(h.mut_tanggal, '%Y-%m-%d') AS Tanggal,
        h.mut_gdg_asal AS Bagian_Asal,
        h.mut_gdg_tujuan AS Bagian_Tujuan,
        h.mut_keterangan AS Keterangan
      FROM tmutasi_dtl d
      LEFT JOIN tmutasi_hdr h ON h.mut_nomor = d.mutd_mut_nomor
      LEFT JOIN tspk s ON d.mutd_spk_nomor = s.spk_nomor
      WHERE d.mutd_mut_nomor = ?
      ORDER BY d.mutd_nourut ASC
    `;

    const [detailResults] = await pool.query(sqlDetail, [nomor]);
    return detailResults;
  } catch (error) {
    throw new Error("Gagal tarik data detail mutasi: " + error.message);
  }
};

exports.deleteMutasiInternal = async (nomor) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const table = await getMutasiTable(connection, nomor);
    if (!table) {
      throw new Error(`Dokumen mutasi ${nomor} tidak ditemukan.`);
    }

    if (table === "produksi") {
      const [hdr] = await connection.query(
        "SELECT mph_nomor_opr FROM tmutasiproduksi_hdr WHERE mph_nomor = ? LIMIT 1",
        [nomor],
      );
      const lhkNomor = hdr[0]?.mph_nomor_opr || "";
      const [details] = await connection.query(
        "SELECT * FROM tmutasiproduksi_dtl WHERE mpd_mph_nomor = ?",
        [nomor],
      );

      // Kembalikan stok ke LHK RTR sebelum header dihapus.
      for (const item of details) {
        const ref = await resolveLhkDetail(connection, lhkNomor, item);
        if (ref) {
          await connection.query(
            "UPDATE tlhk_rtr_dtl SET lrd_jumlah = lrd_jumlah + ? WHERE lrd_lr_nomor = ? AND lrd_no_urut = ?",
            [toNumber(item.mpd_jumlah), ref.lrd_lr_nomor, ref.lrd_no_urut],
          );
        }
      }

      // Trigger BEFORE DELETE pada header akan menghapus detail.
      await connection.query(
        "DELETE FROM tmutasiproduksi_hdr WHERE mph_nomor = ?",
        [nomor],
      );

      await syncLhkMutationFlag(connection, lhkNomor);

      await connection.commit();
      return { success: true };
    }

    // Dokumen lama
    const [details] = await connection.query(
      `SELECT mutd_lhk_detail_id, mutd_nourut, mutd_jumlah,
              mutd_spk_nomor, mutd_poi_size, mutd_nama_komponen,
              mutd_stok_sublim_lama
       FROM tmutasi_dtl WHERE mutd_mut_nomor = ?`,
      [nomor],
    );

    const affectedLhk = new Set();
    for (const item of details) {
      const ref = await resolveLhkDetail(connection, "", {
        mpd_spk: item.mutd_spk_nomor,
        mpd_size: item.mutd_poi_size,
        mpd_bhn_kode: item.mutd_nama_komponen,
        mpd_lhk: item.mutd_stok_sublim_lama,
        mpd_jumlah: item.mutd_jumlah,
      });
      if (ref) {
        affectedLhk.add(ref.lrd_lr_nomor);
        await connection.query(
          "UPDATE tlhk_rtr_dtl SET lrd_jumlah = lrd_jumlah + ? WHERE lrd_lr_nomor = ? AND lrd_no_urut = ?",
          [item.mutd_jumlah, ref.lrd_lr_nomor, ref.lrd_no_urut],
        );
      }
    }

    await connection.query(
      "DELETE FROM tmasterstok_bahan WHERE mst_noreferensi = ?",
      [nomor],
    );
    await connection.query(
      "DELETE FROM tmasterstok_mmt WHERE mst_noreferensi = ?",
      [nomor],
    );
    await connection.query("DELETE FROM tmutasi_dtl WHERE mutd_mut_nomor = ?", [
      nomor,
    ]);
    await connection.query("DELETE FROM tmutasi_hdr WHERE mut_nomor = ?", [
      nomor,
    ]);

    for (const lhkNomor of affectedLhk) {
      await syncLhkMutationFlag(connection, lhkNomor);
    }

    await connection.commit();
    return { success: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};
