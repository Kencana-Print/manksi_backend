const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");
const { cekNomorSpk } = require("./poBahanFormService");

// Rekap Belanja = PO Lain-lain (po_jenis 4, prefix PL). Satu form memuat banyak
// supplier; saat simpan dipecah menjadi satu PO per supplier. Penanda kelompok:
// tpo_hdr.po_grup = nomor PL pertama di kelompok ('' = PL lama).
const JENIS_LAIN = 4;
const KUNCI_NOMOR_PL = "manksi_penomoran_po_PL";

const str = (v) => String(v ?? "").trim();

const periksaAkses = (user) => {
  const ok =
    Number(user?.flags?.lihatSup) === 1 && Number(user?.flags?.lihatBeli) === 1;
  if (!ok)
    throw new Error(
      "Rekap Belanja hanya untuk user yang boleh melihat Supplier dan Harga Beli.",
    );
};

const SQL_BARIS = `
  SELECT d.pod_po_nomor AS nomor, d.pod_nourut AS nourut, d.pod_bhn_kode AS kode,
         IFNULL(b.bhn_name, '') AS nama, d.pod_namaext AS namaext,
         d.pod_bhn_satuan AS satuan,
         IF(IFNULL(d.pod_gramasia_awal, '') <> '', d.pod_gramasia_awal, IFNULL(g.bg_nama, '')) AS gramasiAwal,
         IF(IFNULL(d.pod_gramasia, '') <> '', d.pod_gramasia, IFNULL(g.bg_nama, '')) AS gramasi,
         IF(IFNULL(d.pod_setting, '') <> '', d.pod_setting, IFNULL(s.bs_nama, '')) AS setting,
         IFNULL(j.bj_nama, '') AS jenis,
         d.pod_jumlah AS jumlah, d.pod_hargabeli AS harga, d.pod_disc AS diskon,
         d.pod_ppn AS ppn, d.pod_spk_nomor AS spk, d.pod_mkb_nomor AS mkb,
         d.pod_mppb_nomor AS mppb,
         DATE_FORMAT(mp.mpb_tanggal, '%Y-%m-%d') AS tglMppb,
         IFNULL(mp.mpb_jmlorder, 0) AS jmlMppb,
         IFNULL(d.pod_sup_kode, '') AS supKode, IFNULL(sp.sup_nama, '') AS supNama
    FROM tpo_dtl d
    LEFT JOIN tbahan b ON b.bhn_kode = d.pod_bhn_kode
    LEFT JOIN tbahan_jenis j ON j.bj_kode = LEFT(d.pod_bhn_kode, 2)
    LEFT JOIN tbahan_gramasi g ON g.bg_kode = MID(d.pod_bhn_kode, 6, 2)
                              AND LEFT(d.pod_bhn_kode, 2) <> 'SB'
    LEFT JOIN tbahan_setting s ON s.bs_kode = RIGHT(d.pod_bhn_kode, 2)
                              AND LEFT(d.pod_bhn_kode, 2) <> 'SB'
    LEFT JOIN tsupplier sp ON sp.sup_kode = d.pod_sup_kode
    LEFT JOIN tmpb mp ON mp.mpb_nomor = d.pod_mppb_nomor AND d.pod_mppb_nomor <> ''
   WHERE d.pod_po_nomor IN (?)
   ORDER BY d.pod_po_nomor, d.pod_nourut`;

// Muat satu kelompok (semua PO yang satu po_grup; PL lama = satu PO sendiri).
// kunci = true → baris header dikunci (FOR UPDATE) di dalam transaksi simpan.
const muatGrup = async (runner, nomor, kunci) => {
  const akhir = kunci ? " FOR UPDATE" : "";
  const [awal] = await runner.query(
    `SELECT po_grup FROM tpo_hdr WHERE po_nomor = ? AND po_jenis = ?`,
    [nomor, JENIS_LAIN],
  );
  if (awal.length === 0) throw new Error("Data Rekap Belanja tidak ditemukan.");
  const grupKey = str(awal[0].po_grup);

  const [hdr] = await runner.query(
    `SELECT po_nomor, DATE_FORMAT(po_tanggal, '%Y-%m-%d') AS tgl,
            po_keterangan, po_note, po_mbb_nomor, po_close
       FROM tpo_hdr
      WHERE po_jenis = ? AND ${grupKey ? "po_grup = ?" : "po_nomor = ?"}
      ORDER BY po_nomor${akhir}`,
    [JENIS_LAIN, grupKey || nomor],
  );
  const daftar = hdr.map((h) => h.po_nomor);
  const [rows] = await runner.query(SQL_BARIS, [daftar]);
  const [delivery] = await runner.query(
    `SELECT a.pod2_nomor AS nomor, DATE_FORMAT(a.pod2_tanggal, '%Y-%m-%d') AS tanggal,
            a.pod2_jumlah AS jumlah, a.pod2_bhn_kode AS kode,
            IFNULL(b.bhn_name, '') AS nama, IFNULL(a.pod2_sup_kode, '') AS supKode,
            IFNULL(sp.sup_nama, '') AS supNama
       FROM tpo_dtl2 a
       LEFT JOIN tbahan b ON b.bhn_kode = a.pod2_bhn_kode
       LEFT JOIN tsupplier sp ON sp.sup_kode = a.pod2_sup_kode
      WHERE a.pod2_nomor IN (?)
      ORDER BY a.pod2_tanggal`,
    [daftar],
  );

  const pos = hdr.map((h) => {
    const baris = rows.filter((r) => r.nomor === h.po_nomor);
    const sup = [...new Set(baris.map((r) => r.supKode).filter(Boolean))];
    const supKode = sup.length === 1 ? sup[0] : "";
    return {
      nomor: h.po_nomor,
      tgl: h.tgl,
      ket: h.po_keterangan || "",
      note: h.po_note || "",
      mbb: str(h.po_mbb_nomor),
      close: Number(h.po_close),
      rows: baris,
      supKode,
      supNama: baris.find((r) => r.supKode === supKode)?.supNama || "",
      multiSup: sup.length > 1,
      maxNourut: baris.reduce((m, r) => Math.max(m, Number(r.nourut)), 0),
    };
  });

  return { grupKey, pos, delivery };
};

// Alasan sebuah PO tidak boleh diubah ('' = boleh). Dihitung di server.
const infoKunci = async (runner, po, zdtClose) => {
  let alasan = "";
  let pinAcc = null;

  if (po.close === 1) alasan = "Sudah CLOSE.";
  else if (po.close === 2) alasan = "Sudah ONPROSES.";

  if (!alasan) {
    const [bpb] = await runner.query(
      `SELECT bpb_nomor FROM tbpb_hdr WHERE bpb_po_nomor = ? LIMIT 1`,
      [po.nomor],
    );
    if (bpb.length > 0) alasan = `Sudah ada BPB ${bpb[0].bpb_nomor}.`;
  }
  if (!alasan) {
    const [vou] = await runner.query(
      `SELECT voud_vou_nomor FROM tvoucher_dtl
        WHERE voud_nota = ? AND voud_type IN ('POB', 'POL') LIMIT 1`,
      [po.nomor],
    );
    if (vou.length > 0)
      alasan = `Sudah dibayar di Voucher ${vou[0].voud_vou_nomor}.`;
  }
  if (!alasan) {
    const [mkb] = await runner.query(
      `SELECT mkbd2_mkb_nomor FROM tmkb_dtl2 WHERE mkbd2_po_nomor = ? LIMIT 1`,
      [po.nomor],
    );
    if (mkb.length > 0) alasan = `Sudah link di MKB ${mkb[0].mkbd2_mkb_nomor}.`;
  }
  if (!alasan) {
    const [pjt] = await runner.query(
      `SELECT ptd_nomor FROM finance.tpengajuan_transfer_dtl
        WHERE ptd_trs = ? AND ptd_batal = '' LIMIT 1`,
      [po.nomor],
    );
    if (pjt.length > 0)
      alasan = `Sudah diajukan di Pengajuan Transfer ${pjt[0].ptd_nomor}.`;
  }
  if (!alasan) {
    const [pum] = await runner.query(
      `SELECT ph.pum_nomor
         FROM tpengajuan_uang_muka_dtl pd
         JOIN tpengajuan_uang_muka_hdr ph ON ph.pum_nomor = pd.pumd_pum_nomor
        WHERE pd.pumd_sumber = 'PO_LAIN_LAIN' AND pd.pumd_nomor_sumber = ?
          AND (ph.pum_status = 'DIAJUKAN'
               OR (ph.pum_status = 'REALISASI' AND pd.pumd_status_acc = 'ACC'))
        LIMIT 1`,
      [po.nomor],
    );
    if (pum.length > 0)
      alasan = `Sudah diajukan di Uang Muka ${pum[0].pum_nomor}.`;
  }
  if (!alasan && po.multiSup)
    alasan = "PO lama berisi lebih dari satu supplier, tidak bisa diubah.";
  if (!alasan && zdtClose && new Date(po.tgl) < zdtClose) {
    const [pin] = await runner.query(
      `SELECT pin_urut, pin_acc, pin_dipakai FROM tspk_pin5
        WHERE pin_trs = 'PO BAHAN' AND pin_nomor = ?
        ORDER BY pin_urut DESC LIMIT 1`,
      [po.nomor],
    );
    if (pin.length > 0 && pin[0].pin_acc === "Y" && pin[0].pin_dipakai === "")
      pinAcc = pin[0].pin_urut;
    else
      alasan =
        "Periode sudah tutup buku. Ajukan perubahan data (PIN) terlebih dahulu.";
  }

  const [qc] = await runner.query(
    `SELECT qc_nomor FROM tqc_bahan_hdr WHERE qc_po_nomor = ? LIMIT 1`,
    [po.nomor],
  );
  return { alasan, pinAcc, adaQc: qc.length > 0 };
};

// ── Muat kelompok untuk form ──────────────────────────────────────────
const getGrup = async (nomor, user) => {
  periksaAkses(user);
  const g = await muatGrup(db, nomor, false);
  const zdtClose = await tutupBukuService.getTanggalTutupBuku();

  const pos = [];
  const items = [];
  for (const po of g.pos) {
    const k = await infoKunci(db, po, zdtClose);
    pos.push({
      nomor: po.nomor,
      tanggal: po.tgl,
      supKode: po.supKode,
      supNama: po.supNama,
      terkunci: !!k.alasan,
      alasanKunci: k.alasan,
      adaQc: k.adaQc,
    });
    for (const r of po.rows) {
      if (!r.kode) continue;
      items.push({
        ...r,
        nourut: Number(r.nourut),
        jumlah: Number(r.jumlah) || 0,
        harga: Number(r.harga) || 0,
        diskon: Number(r.diskon) || 0,
        ppn: Number(r.ppn) || 0,
        jmlMppb: Number(r.jmlMppb) || 0,
        terkunci: !!k.alasan,
        kunciStruktur: k.adaQc,
      });
    }
  }

  const utama = g.pos.find((_, i) => !pos[i].terkunci) || g.pos[0];
  return {
    grup: g.grupKey || g.pos[0].nomor,
    header: {
      po_tanggal: utama.tgl,
      po_keterangan: utama.ket,
      po_note: utama.note,
      po_mbb_nomor: utama.mbb,
    },
    pos,
    items,
    delivery: g.delivery.map((d) => ({ ...d, jumlah: Number(d.jumlah) || 0 })),
  };
};

// ── Simpan kelompok ───────────────────────────────────────────────────
// payload: {
//   isEdit, nomor (salah satu PO di kelompok, saat edit),
//   header: { po_tanggal, po_keterangan, po_note, po_mbb_nomor },
//   items: [{ nomor?, nourut?, kode, namaext, satuan, gramasi, gramasiAwal, setting,
//             jumlah, harga, diskon, ppn, spk, mkb, mppb, supKode }],
//   delivery: [{ tanggal, jumlah, kode, supKode }]
// }
// Baris lama membawa (nomor, nourut) asalnya; baris baru tidak.
const saveGrup = async (payload, user) => {
  periksaAkses(user);
  const userKode = user?.kode || "ADMIN";
  const isEdit = !!payload?.isEdit;
  const header = payload?.header || {};

  const tanggal = str(header.po_tanggal).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal))
    throw new Error("Tanggal tidak valid.");

  // 1. Validasi bentuk data (tanpa DB)
  const baris = (payload.items || []).filter((i) => str(i.kode) !== "");
  if (baris.length === 0) throw new Error("Minimal satu bahan harus diisi.");

  const kunciKirim = new Set();
  baris.forEach((it, idx) => {
    const no = `Baris ${idx + 1}`;
    const kode = str(it.kode);
    const sup = str(it.supKode);
    const spk = str(it.spk);
    if (!sup)
      throw new Error(`${no}: Supplier untuk bahan ${kode} wajib diisi.`);
    if (!spk)
      throw new Error(`${no}: Nomor SPK/MAP untuk bahan ${kode} wajib diisi.`);
    if (!(Number(it.jumlah) > 0))
      throw new Error(`${no}: Jumlah untuk bahan ${kode} harus lebih dari 0.`);
    if (!(Number(it.harga) > 0))
      throw new Error(`${no}: Harga Beli untuk bahan ${kode} wajib diisi.`);
    const disc = Number(it.diskon) || 0;
    if (disc < 0 || disc > 100)
      throw new Error(
        `${no}: Disc untuk bahan ${kode} harus antara 0 dan 100.`,
      );
    const ppn = Number(it.ppn) || 0;
    if (ppn < 0 || ppn > 100)
      throw new Error(`${no}: PPN untuk bahan ${kode} harus antara 0 dan 100.`);
    const kunci = `${kode.toUpperCase()}|${sup}|${spk.toUpperCase()}`;
    if (kunciKirim.has(kunci))
      throw new Error(
        `${no}: Bahan ${kode} dengan supplier ${sup} dan SPK/MAP ${spk} dobel.`,
      );
    kunciKirim.add(kunci);
  });

  const deliv = payload.delivery || [];
  deliv.forEach((d, idx) => {
    const no = `Delivery baris ${idx + 1}`;
    if (!str(d.tanggal)) throw new Error(`${no}: Tanggal harus diisi.`);
    if (!(Number(d.jumlah) > 0)) throw new Error(`${no}: Jumlah harus diisi.`);
    if (!str(d.kode)) throw new Error(`${no}: Bahan harus diisi.`);
    if (!str(d.supKode)) throw new Error(`${no}: Supplier wajib diisi.`);
  });

  const conn = await db.getConnection();
  let kunciPegang = false;

  // Nomor PL berikutnya. Dibaca lewat koneksi transaksi yang sama (header yang
  // baru di-insert terlihat) dan dilindungi GET_LOCK, dilepas setelah commit.
  const nomorPlBerikut = async () => {
    if (!kunciPegang) {
      const [r] = await conn.query(`SELECT GET_LOCK(?, 10) AS ok`, [
        KUNCI_NOMOR_PL,
      ]);
      if (Number(r[0].ok) !== 1)
        throw new Error("Penomoran PO sedang dipakai user lain, coba lagi.");
      kunciPegang = true;
    }
    const tahun = tanggal.slice(0, 4);
    const [rows] = await conn.query(
      `SELECT IFNULL(MAX(CAST(SUBSTR(po_nomor, 4, 5) AS UNSIGNED)), 0) AS max_val
         FROM tpo_hdr
        WHERE LEFT(po_nomor, 2) = 'PL' AND RIGHT(po_nomor, 4) = ?`,
      [tahun],
    );
    const next = parseInt(rows[0].max_val, 10) + 1;
    return `PL/${String(next).padStart(5, "0")}/${tahun}`;
  };

  try {
    await conn.beginTransaction();

    // 2. Muat kelompok lama + status kunci tiap PO
    const g = isEdit
      ? await muatGrup(conn, str(payload.nomor), true)
      : { grupKey: "", pos: [], delivery: [] };
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();

    for (const po of g.pos) {
      const k = await infoKunci(conn, po, zdtClose);
      po.alasan = k.alasan;
      po.pinAcc = k.pinAcc;
      po.adaQc = k.adaQc;
      po.terkunci = !!k.alasan;
      po.rencanaUpdate = [];
      po.rencanaMasuk = [];
      po.hapus = [];
    }

    // 3. Data master: bahan, supplier, SPK/MAP
    const kodeList = [...new Set(baris.map((i) => str(i.kode)))];
    const [bhnRows] = await conn.query(
      `SELECT bhn_kode, bhn_name, bhn_satuan FROM tbahan WHERE bhn_kode IN (?)`,
      [kodeList],
    );
    const bhnMap = new Map(
      bhnRows.map((r) => [String(r.bhn_kode).toUpperCase(), r]),
    );
    const bhnHilang = kodeList.filter((k) => !bhnMap.has(k.toUpperCase()));
    if (bhnHilang.length)
      throw new Error(`Bahan tidak ditemukan: ${bhnHilang.join(", ")}`);

    const supList = [...new Set(baris.map((i) => str(i.supKode)))];
    const [supRows] = await conn.query(
      `SELECT sup_kode FROM tsupplier WHERE sup_kode IN (?)`,
      [supList],
    );
    const supAda = new Set(supRows.map((r) => r.sup_kode));
    const supHilang = supList.filter((k) => !supAda.has(k));
    if (supHilang.length)
      throw new Error(`Supplier tidak ditemukan: ${supHilang.join(", ")}`);

    const spkList = [...new Set(baris.map((i) => str(i.spk)))];
    const spkAda = await cekNomorSpk(conn, spkList);
    const spkHilang = spkList.filter((s) => !spkAda.has(s.toUpperCase()));
    if (spkHilang.length)
      throw new Error(`Nomor SPK/MAP tidak ditemukan: ${spkHilang.join(", ")}`);

    // 4. Permintaan Pembelian Bahan (MBB): satu per kelompok, tidak boleh diganti saat edit
    const mbbHeader = str(header.po_mbb_nomor);
    const mbbLama = g.pos.length > 0 ? g.pos[0].mbb : "";
    if (isEdit && mbbHeader !== mbbLama)
      throw new Error(
        "Permintaan Pembelian Bahan tidak boleh diubah saat edit.",
      );
    if (mbbHeader) {
      const [mbb] = await conn.query(
        `SELECT mbb_status FROM tmintabelibahan_hdr WHERE mbb_nomor = ?`,
        [mbbHeader],
      );
      if (mbb.length === 0)
        throw new Error(`Permintaan ${mbbHeader} tidak ditemukan.`);
      if (mbb[0].mbb_status && mbbHeader !== mbbLama)
        throw new Error(`Permintaan ${mbbHeader} sudah ${mbb[0].mbb_status}.`);

      const [adaBahan] = await conn.query(
        `SELECT mbbd_bhn_kode FROM tmintabelibahan_dtl
          WHERE mbbd_nomor = ? AND mbbd_bhn_kode IN (?)`,
        [mbbHeader, kodeList],
      );
      const adaSet = new Set(
        adaBahan.map((r) => String(r.mbbd_bhn_kode).toUpperCase()),
      );
      const luar = kodeList.find((k) => !adaSet.has(k.toUpperCase()));
      if (luar)
        throw new Error(`Bahan ${luar} tidak ada di permintaan ${mbbHeader}.`);
    }

    // 5. Rencana: petakan tiap baris kiriman ke PO tujuannya
    const posByNomor = new Map(g.pos.map((p) => [p.nomor, p]));
    const posBySup = new Map();
    const barisAda = new Map(); // "nomor|nourut" -> baris di DB
    for (const po of g.pos) {
      if (po.supKode && !posBySup.has(po.supKode)) posBySup.set(po.supKode, po);
      for (const r of po.rows)
        barisAda.set(`${po.nomor}|${Number(r.nourut)}`, r);
    }

    const dipakai = new Set();
    const rencana = []; // { it, ex, po, no }
    baris.forEach((it, idx) => {
      const no = `Baris ${idx + 1}`;
      const nomorAsal = str(it.nomor);
      const nourutAsal = Number(it.nourut) || 0;
      if (nomorAsal && nourutAsal) {
        const k = `${nomorAsal}|${nourutAsal}`;
        const ex = barisAda.get(k);
        if (!ex)
          throw new Error(
            `${no}: baris asal ${nomorAsal} urutan ${nourutAsal} tidak ada di kelompok ini.`,
          );
        if (dipakai.has(k)) throw new Error(`${no}: baris asal dikirim dobel.`);
        dipakai.add(k);
        const po = posByNomor.get(nomorAsal);
        if (po.terkunci) return; // PO terkunci dibiarkan apa adanya
        rencana.push({ it, ex, po, no });
      } else {
        rencana.push({ it, ex: null, po: null, no });
      }
    });

    // PL lama yang barisnya belum bersupplier: supplier yang diisi menjadi supplier PO-nya
    for (const r of rencana) {
      if (r.po && !r.po.supKode && !r.po.multiSup) {
        r.po.supKode = str(r.it.supKode);
        if (!posBySup.has(r.po.supKode)) posBySup.set(r.po.supKode, r.po);
      }
    }

    const poBaruBySup = new Map();
    const targetPo = (sup, no) => {
      const ada = posBySup.get(sup);
      if (ada) {
        if (ada.terkunci)
          throw new Error(
            `${no}: supplier ${sup} sudah punya PO ${ada.nomor} yang terkunci (${ada.alasan})`,
          );
        return ada;
      }
      if (!poBaruBySup.has(sup))
        poBaruBySup.set(sup, {
          baru: true,
          nomor: "",
          supKode: sup,
          tgl: tanggal,
          maxNourut: 0,
          rows: [],
          terkunci: false,
          adaQc: false,
          rencanaUpdate: [],
          rencanaMasuk: [],
          hapus: [],
        });
      return poBaruBySup.get(sup);
    };

    for (const r of rencana) {
      const sup = str(r.it.supKode);
      if (r.ex) {
        const kodeSama =
          str(r.it.kode).toUpperCase() === str(r.ex.kode).toUpperCase();
        if (r.po.adaQc && r.ex.supKode && (!kodeSama || sup !== r.ex.supKode))
          throw new Error(
            `${r.no}: PO ${r.po.nomor} sudah QC, bahan dan supplier barisnya tidak boleh diubah.`,
          );
        if (sup === r.po.supKode) {
          r.po.rencanaUpdate.push(r);
        } else {
          r.po.hapus.push(r.ex); // supplier berubah → pindah ke PO supplier tujuan
          targetPo(sup, r.no).rencanaMasuk.push(r);
        }
      } else {
        targetPo(sup, r.no).rencanaMasuk.push(r);
      }
    }

    // Baris lama yang tidak dikirim lagi = dihapus
    for (const po of g.pos) {
      if (po.terkunci) continue;
      for (const r of po.rows) {
        if (!r.kode) continue;
        if (dipakai.has(`${po.nomor}|${Number(r.nourut)}`)) continue;
        if (po.adaQc)
          throw new Error(
            `PO ${po.nomor} sudah QC, baris bahan ${r.kode} tidak boleh dihapus.`,
          );
        po.hapus.push(r);
      }
    }

    const semuaPo = [...g.pos, ...poBaruBySup.values()];
    const bentuk = (o) => ({
      kode: str(o.kode),
      supKode: str(o.supKode),
      spk: str(o.spk),
      mppb: str(o.mppb),
    });
    const barisAkhir = (po) =>
      po.terkunci
        ? po.rows.filter((r) => r.kode).map(bentuk)
        : [...po.rencanaUpdate, ...po.rencanaMasuk].map((x) => bentuk(x.it));
    const finalRows = semuaPo.flatMap(barisAkhir);

    // 6. Cek lintas PO: baris dobel dan MPPB
    const kunciAkhir = new Set();
    for (const r of finalRows) {
      const k = `${r.kode.toUpperCase()}|${r.supKode}|${r.spk.toUpperCase()}`;
      if (kunciAkhir.has(k))
        throw new Error(
          `Bahan ${r.kode} dengan supplier ${r.supKode} dan SPK/MAP ${r.spk} dobel (termasuk PO yang terkunci).`,
        );
      kunciAkhir.add(k);
    }

    const mppbSup = new Map();
    for (const r of finalRows) {
      const m = r.mppb.toUpperCase();
      if (!m) continue;
      if (!mppbSup.has(m)) mppbSup.set(m, new Set());
      mppbSup.get(m).add(r.supKode);
    }
    for (const [m, s] of mppbSup)
      if (s.size > 1)
        throw new Error(
          `MPPB ${m} dipakai untuk lebih dari satu supplier (${[...s].join(", ")}).`,
        );

    const mppbLama = new Set(
      g.pos
        .flatMap((p) => p.rows.map((r) => str(r.mppb).toUpperCase()))
        .filter(Boolean),
    );
    const mppbBaru = [...mppbSup.keys()].filter((m) => !mppbLama.has(m));
    if (mppbBaru.length > 0) {
      const nomorGrup = g.pos.map((p) => p.nomor);
      const [cek] = await conn.query(
        `SELECT m.mpb_nomor, m.mpb_approve,
                (SELECT d.pod_po_nomor FROM tpo_dtl d
                  WHERE d.pod_mppb_nomor = m.mpb_nomor AND d.pod_po_nomor NOT IN (?)
                  LIMIT 1) AS po
           FROM tmpb m WHERE m.mpb_nomor IN (?)`,
        [nomorGrup.length ? nomorGrup : [""], mppbBaru],
      );
      const peta = new Map(
        cek.map((r) => [String(r.mpb_nomor).toUpperCase(), r]),
      );
      for (const m of mppbBaru) {
        const r = peta.get(m);
        if (!r) throw new Error(`MPPB ${m} tidak ada.`);
        if (r.mpb_approve === "N")
          throw new Error(`MPPB ${m} belum di-approve oleh PPIC.`);
        if (r.po) throw new Error(`MPPB ${m} sudah di-input di PO ${r.po}.`);
      }
    }

    // Delivery Commitment: pasangan (bahan, supplier) harus ada di baris PO
    const pasangan = new Set(
      finalRows.map((r) => `${r.kode.toUpperCase()}|${r.supKode}`),
    );
    deliv.forEach((d, idx) => {
      if (!pasangan.has(`${str(d.kode).toUpperCase()}|${str(d.supKode)}`))
        throw new Error(
          `Delivery baris ${idx + 1}: Bahan ${d.kode} tidak dipesan ke supplier ${d.supKode} di Rekap ini.`,
        );
    });

    // 7. Tanggal: tidak boleh membuat/memindah ke periode yang sudah tutup buku
    if (zdtClose && new Date(tanggal) < zdtClose) {
      if (poBaruBySup.size > 0)
        throw new Error(
          "Anda tidak boleh input/edit di tanggal periode yang sudah diclose.",
        );
      for (const po of g.pos)
        if (!po.terkunci && po.tgl !== tanggal)
          throw new Error(
            "Tanggal tidak boleh dipindah ke periode yang sudah diclose.",
          );
    }

    // 8. Eksekusi
    let grup = g.grupKey || (g.pos.length > 0 ? g.pos[0].nomor : "");

    const normalisasi = (it) => {
      const bhn = bhnMap.get(str(it.kode).toUpperCase());
      return {
        kode: bhn.bhn_kode,
        namaext: str(it.namaext) || bhn.bhn_name,
        satuan: str(it.satuan) || str(bhn.bhn_satuan),
        gramasia: it.gramasi || "",
        gramasiAwal: it.gramasiAwal || "",
        setting: it.setting || "",
        jumlah: Number(it.jumlah),
        diskon: Number(it.diskon) || 0,
        harga: Number(it.harga),
        spk: str(it.spk),
        mkb: it.mkb || "",
        supKode: str(it.supKode),
        ppn: Number(it.ppn) || 0,
        mppb: str(it.mppb),
      };
    };

    // 8a. Buat header PO baru (nomor berurutan di dalam transaksi)
    for (const po of poBaruBySup.values()) {
      po.nomor = await nomorPlBerikut();
      if (!grup) grup = po.nomor;
      const mppbPertama =
        po.rencanaMasuk.map((x) => str(x.it.mppb)).find(Boolean) || "";
      await conn.query(
        `INSERT INTO tpo_hdr (
           po_nomor, po_greige, po_tanggal, po_jenis, po_keterangan, po_sup_kode,
           po_mppb_nomor, po_mbb_nomor, po_status_ppn, po_ppn,
           date_create, user_create, po_note, po_grup
         ) VALUES (?, '', ?, ?, ?, NULL, ?, ?, 0, 0, NOW(), ?, ?, ?)`,
        [
          po.nomor,
          tanggal,
          JENIS_LAIN,
          str(header.po_keterangan),
          mppbPertama,
          mbbHeader,
          userKode,
          str(header.po_note),
          grup,
        ],
      );
    }

    // 8b. Detail: hapus → update di tempat → sisip
    const sisipBaris = async (po, it) => {
      const n = normalisasi(it);
      po.maxNourut += 1;
      await conn.query(
        `INSERT INTO tpo_dtl (
           pod_po_nomor, pod_nourut, pod_bhn_kode, pod_namaext, pod_bhn_satuan,
           pod_gramasia, pod_gramasia_awal, pod_setting, pod_roll, pod_jumlah,
           pod_disc, pod_hargabeli, pod_spk_nomor, pod_mkb_nomor, pod_sup_kode,
           pod_ppn, pod_mppb_nomor
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          po.nomor,
          po.maxNourut,
          n.kode,
          n.namaext,
          n.satuan,
          n.gramasia,
          n.gramasiAwal,
          n.setting,
          n.jumlah,
          n.diskon,
          n.harga,
          n.spk,
          n.mkb,
          n.supKode,
          n.ppn,
          n.mppb,
        ],
      );
    };

    for (const po of semuaPo) {
      if (po.terkunci) continue;

      for (const r of po.hapus)
        await conn.query(
          `DELETE FROM tpo_dtl WHERE pod_po_nomor = ? AND pod_nourut = ?`,
          [po.nomor, Number(r.nourut)],
        );

      for (const { it, ex } of po.rencanaUpdate) {
        const n = normalisasi(it);
        await conn.query(
          `UPDATE tpo_dtl SET
             pod_bhn_kode = ?, pod_namaext = ?, pod_bhn_satuan = ?, pod_gramasia = ?,
             pod_gramasia_awal = ?, pod_setting = ?, pod_jumlah = ?, pod_disc = ?,
             pod_hargabeli = ?, pod_spk_nomor = ?, pod_mkb_nomor = ?, pod_sup_kode = ?,
             pod_ppn = ?, pod_mppb_nomor = ?
           WHERE pod_po_nomor = ? AND pod_nourut = ?`,
          [
            n.kode,
            n.namaext,
            n.satuan,
            n.gramasia,
            n.gramasiAwal,
            n.setting,
            n.jumlah,
            n.diskon,
            n.harga,
            n.spk,
            n.mkb,
            n.supKode,
            n.ppn,
            n.mppb,
            po.nomor,
            Number(ex.nourut),
          ],
        );
      }

      for (const { it } of po.rencanaMasuk) await sisipBaris(po, it);
    }

    // 8c. PO yang kosong dihapus; PO lain: perbarui header dan delivery
    for (const po of semuaPo) {
      if (po.terkunci) continue;
      const jumlahAkhir = po.rencanaUpdate.length + po.rencanaMasuk.length;

      if (jumlahAkhir === 0) {
        await conn.query(`DELETE FROM tpo_dtl2 WHERE pod2_nomor = ?`, [
          po.nomor,
        ]);
        await conn.query(`DELETE FROM tpo_dtl WHERE pod_po_nomor = ?`, [
          po.nomor,
        ]);
        await conn.query(`DELETE FROM tpo_hdr WHERE po_nomor = ?`, [po.nomor]);
        continue;
      }

      if (!po.baru) {
        const mppbPertama =
          [...po.rencanaUpdate, ...po.rencanaMasuk]
            .map((x) => str(x.it.mppb))
            .find(Boolean) || "";
        await conn.query(
          `UPDATE tpo_hdr SET po_tanggal = ?, po_keterangan = ?, po_note = ?,
                  po_mppb_nomor = ?, po_grup = ?, date_modified = NOW(), user_modified = ?
            WHERE po_nomor = ?`,
          [
            tanggal,
            str(header.po_keterangan),
            str(header.po_note),
            mppbPertama,
            grup,
            userKode,
            po.nomor,
          ],
        );
        await conn.query(`DELETE FROM tpo_dtl2 WHERE pod2_nomor = ?`, [
          po.nomor,
        ]);
      }

      for (const d of deliv) {
        if (str(d.supKode) !== po.supKode) continue;
        await conn.query(
          `INSERT INTO tpo_dtl2 (pod2_nomor, pod2_tanggal, pod2_jumlah, pod2_bhn_kode, pod2_sup_kode)
           VALUES (?, ?, ?, ?, ?)`,
          [po.nomor, d.tanggal, Number(d.jumlah) || 0, str(d.kode), po.supKode],
        );
      }
    }

    // 8d. PIN edit (tutup buku) yang dipakai
    for (const po of g.pos) {
      if (po.terkunci || po.pinAcc === null) continue;
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai = 'Y'
          WHERE pin_trs = 'PO BAHAN' AND pin_nomor = ? AND pin_urut = ?`,
        [po.nomor, po.pinAcc],
      );
    }

    await conn.commit();

    const nomorList = semuaPo
      .filter(
        (po) =>
          po.terkunci || po.rencanaUpdate.length + po.rencanaMasuk.length > 0,
      )
      .map((po) => ({ nomor: po.nomor, supKode: po.supKode }));
    return { nomor: grup, grup, nomorList };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    if (kunciPegang) {
      try {
        await conn.query(`SELECT RELEASE_LOCK(?)`, [KUNCI_NOMOR_PL]);
      } catch (e) {
        console.error("Gagal melepas kunci penomoran PL:", e.message);
      }
    }
    conn.release();
  }
};

module.exports = { getGrup, saveGrup };
