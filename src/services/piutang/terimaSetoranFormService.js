const db = require("../../config/database");

// ── Load form data ────────────────────────────────────────────────────
// Delphi loaddataall:
//   Header: tform_setorkasir_hdr
//   Detail 1: tform_setorkasir_dtl JOIN tcustomer (readonly, tampilan saja)
//   Detail 2: tform_setorkasir_dtl2 (editable — nominalv)
const getForm = async (nomor) => {
  // Header
  const [[hdr]] = await db.query(
    `SELECT
       fsk_nomor        AS Nomor,
       DATE_FORMAT(fsk_tanggal,'%Y-%m-%d')  AS TglSetor,
       DATE_FORMAT(fsk_tanggalv,'%Y-%m-%d') AS TglVerifikasi,
       user_create      AS UserCreate,
       fsk_userv        AS UserVerifikasi,
       LEFT(fsk_nomor,3) AS Cabang
     FROM retail.tform_setorkasir_hdr
     WHERE fsk_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");

  // Detail 1 — readonly, untuk tampilan grid atas
  // Delphi: JOIN tform_setorkasir_dtl + tcustomer
  const [dtl1] = await db.query(
    `SELECT
       d.fskd_jenis    AS Jenis,
       DATE_FORMAT(d.fskd_tgltrf,'%Y-%m-%d') AS TglTransfer,
       d.fskd_kdcus    AS KdCus,
       COALESCE(c.cus_nama,'')   AS NamaCus,
       COALESCE(c.cus_alamat,'') AS Alamat,
       d.fskd_inv      AS Invoice,
       d.fskd_nominal  AS Nominal
     FROM retail.tform_setorkasir_dtl d
     LEFT JOIN retail.tcustomer c ON c.cus_kode = d.fskd_kdcus
     WHERE d.fskd_nomor = ?
     ORDER BY d.fskd_nomor`,
    [nomor],
  );

  // Detail 2 — editable, rekap per jenis
  // Delphi: tform_setorkasir_dtl2, field: jenis, nominal (setor), nominalv (verifikasi)
  const [dtl2] = await db.query(
    `SELECT
       fskd2_jenis    AS Jenis,
       fskd2_nominal  AS NominalSetor,
       fskd2_nominalv AS NominalVerifikasi
     FROM retail.tform_setorkasir_dtl2
     WHERE fskd2_nomor = ?
     ORDER BY fskd2_jenis`,
    [nomor],
  );

  return { hdr, dtl1, dtl2 };
};

// ── Save ──────────────────────────────────────────────────────────────
// Delphi simpandata:
//   1. UPDATE tform_setorkasir_hdr:
//      - fsk_userv = userVerifikasi (kosong jika unverif)
//      - date_createv = NOW()
//      - fsk_tanggalv = tglVerifikasi JIKA diVerifikasi, else NULL
//   2. UPDATE tform_setorkasir_dtl2 per baris:
//      - fskd2_nominalv = nilai input JIKA diVerifikasi, else 0
//
// Validasi (dari btnSimpanClick):
//   - tglVerifikasi < tglSetor → error
const saveForm = async (nomor, payload, userLogin) => {
  // payload: { diVerifikasi: bool, tglVerifikasi: string|null, detail2: [{jenis, nominalv}] }
  const { diVerifikasi, tglVerifikasi, detail2 } = payload;

  // Ambil tglSetor untuk validasi
  const [[hdr]] = await db.query(
    `SELECT fsk_tanggal AS TglSetor FROM retail.tform_setorkasir_hdr WHERE fsk_nomor = ?`,
    [nomor],
  );
  if (!hdr) throw new Error("Data tidak ditemukan.");

  // Validasi: tglVerifikasi tidak boleh < tglSetor (Delphi: dtTglVerifikasi.Date < dtTanggal.Date)
  if (diVerifikasi && tglVerifikasi) {
    const tSetor = new Date(hdr.TglSetor);
    const tVerif = new Date(tglVerifikasi);
    if (tVerif < tSetor) {
      throw new Error("Tgl verifikasi tidak boleh lebih kecil dari Tgl setor.");
    }
  }

  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    // UPDATE header
    // Delphi: fsk_userv = edtVerifikasi.Text (isi user jika verif, kosong jika tidak)
    //         fsk_tanggalv = tanggal jika verif, NULL jika tidak
    //         date_createv = NOW()
    await conn.query(
      `UPDATE retail.tform_setorkasir_hdr SET
         fsk_userv    = ?,
         date_createv = NOW(),
         fsk_tanggalv = ?
       WHERE fsk_nomor = ?`,
      [
        diVerifikasi ? userLogin : "",
        diVerifikasi && tglVerifikasi ? tglVerifikasi : null,
        nomor,
      ],
    );

    // UPDATE detail2 per baris
    // Delphi: fskd2_nominalv = nilai JIKA diVerifikasi, else 0
    for (const d of detail2) {
      await conn.query(
        `UPDATE retail.tform_setorkasir_dtl2 SET
           fskd2_nominalv = ?
         WHERE fskd2_nomor = ? AND fskd2_jenis = ?`,
        [diVerifikasi ? Number(d.nominalv) || 0 : 0, nomor, d.jenis],
      );
    }

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

module.exports = { getForm, saveForm };
