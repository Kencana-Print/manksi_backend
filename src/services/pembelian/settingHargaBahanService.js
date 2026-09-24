const db = require("../../config/database");

// ========================================================
// 1. GARMEN KAIN (tmintaharga_kain)
// Kolom: mhk_kode, mhk_ktg, mhk_jeniskain, mhk_lengan, mhk_komponen, mhk_babaran, mhk_warna, mhk_harga, mhk_harga_partaibesar, mhk_allow
// Catatan: qty >1000 (partai besar) pakai mhk_harga_partaibesar, fallback ke mhk_harga jika NULL/0
// ========================================================
const getKainGarmen = async () => {
    let rows;
    try {
        const [r] = await db.query(
            "SELECT * FROM tmintaharga_kain ORDER BY mhk_ktg ASC, mhk_jeniskain ASC, mhk_warna ASC",
        );
        rows = r;
    } catch (err) {
        // Fallback jika kolom mhk_harga_partaibesar / mhk_allow_partaibesar belum ada (belum migrasi)
        if (err.code === "ER_BAD_FIELD_ERROR" && (String(err.sqlMessage).includes("mhk_harga_partaibesar") || String(err.sqlMessage).includes("mhk_allow_partaibesar"))) {
            const [r2] = await db.query(
                "SELECT *, NULL AS mhk_harga_partaibesar, NULL AS mhk_allow_partaibesar FROM tmintaharga_kain ORDER BY mhk_ktg ASC, mhk_jeniskain ASC, mhk_warna ASC",
            );
            rows = r2;
        } else throw err;
    }

    // Rumus Excel referensi: (Harga Kain Warna TUA / 1.11) / Babaran Lengan
    // Juga untuk partai besar (>1000) pakai mhk_harga_partaibesar
    const kh0002InfoMap = new Map();
    const kh0002InfoMapBesar = new Map();
    rows.forEach((r) => {
        const kode = (r.mhk_kode || "").trim().toUpperCase();
        if (kode !== "KH-0002") return;
        const jk = (r.mhk_jeniskain || "").trim();
        if (!kh0002InfoMap.has(jk)) {
            kh0002InfoMap.set(jk, { babaranLengan: 0, hargaTua: 0, fallbackHarga: 0 });
            kh0002InfoMapBesar.set(jk, { babaranLengan: 0, hargaTua: 0, fallbackHarga: 0 });
        }
        const info = kh0002InfoMap.get(jk);
        const infoB = kh0002InfoMapBesar.get(jk);
        const komp = (r.mhk_komponen || "").trim().toUpperCase();
        const warna = (r.mhk_warna || "").trim().toUpperCase();
        const babaran = Number(r.mhk_babaran) || 0;
        const harga = Number(r.mhk_harga) || 0;
        const hargaBesar = Number(r.mhk_harga_partaibesar) || harga || 0;

        if (komp === "LENGAN" && babaran > 0) {
            info.babaranLengan = babaran;
            infoB.babaranLengan = babaran;
            if (!info.fallbackHarga) info.fallbackHarga = harga;
            if (!infoB.fallbackHarga) infoB.fallbackHarga = hargaBesar;
        }
        if (warna === "TUA" && harga > 0) {
            info.hargaTua = harga;
        }
        if (warna === "TUA" && hargaBesar > 0) {
            infoB.hargaTua = hargaBesar;
        }
    });

    const lenganPriceMap = new Map();
    const lenganPriceMapBesar = new Map();
    kh0002InfoMap.forEach((info, jk) => {
        const hrg = info.hargaTua || info.fallbackHarga || 0;
        if (info.babaranLengan > 0 && hrg > 0) {
            const dppTua = hrg / 1.11;
            lenganPriceMap.set(jk, Math.round(dppTua / info.babaranLengan));
        }
    });
    kh0002InfoMapBesar.forEach((info, jk) => {
        const hrg = info.hargaTua || info.fallbackHarga || 0;
        if (info.babaranLengan > 0 && hrg > 0) {
            const dppTua = hrg / 1.11;
            lenganPriceMapBesar.set(jk, Math.round(dppTua / info.babaranLengan));
        }
    });

    // Himpun master babaran body per model dan per jenis kain
    const babaranBodyMap = new Map();
    rows.forEach((r) => {
        const kode = (r.mhk_kode || "").trim().toUpperCase();
        const jk = (r.mhk_jeniskain || "").trim();
        const key = `${kode}_${jk}`;
        const komp = (r.mhk_komponen || "").trim().toUpperCase();
        const val = Number(r.mhk_babaran) || 0;
        if (!babaranBodyMap.has(key)) babaranBodyMap.set(key, 0);
        if (komp === "BODY" && val > 0) {
            babaranBodyMap.set(key, val);
        } else if (val > 0 && babaranBodyMap.get(key) === 0) {
            babaranBodyMap.set(key, val);
        }
    });

    // Ambil master biaya jahit konveksi langsung dari database tmintaharga_biaya
    // Partai besar (>1000) pakai kolom per model jika ada, fallback ke mhb_biaya
    let biayaJahitRows;
    try {
        const [rows] = await db.query(
            "SELECT mhb_ket, mhb_biaya, mhb_biaya_partaibesar_kh0001, mhb_biaya_partaibesar_kh0002 FROM tmintaharga_biaya WHERE mhb_jenis = 'JAHIT'",
        );
        biayaJahitRows = rows;
    } catch (err) {
        if (err.code === "ER_BAD_FIELD_ERROR" && String(err.sqlMessage).includes("mhb_biaya_partaibesar")) {
            const [rows] = await db.query("SELECT mhb_ket, mhb_biaya, NULL AS mhb_biaya_partaibesar_kh0001, NULL AS mhb_biaya_partaibesar_kh0002 FROM tmintaharga_biaya WHERE mhb_jenis = 'JAHIT'");
            biayaJahitRows = rows;
        } else throw err;
    }
    const biayaJahitMap = new Map();
    const biayaJahitBesarMapKh0001 = new Map();
    const biayaJahitBesarMapKh0002 = new Map();
    let defaultBiayaJahit = 5000;
    let defaultBiayaKh0001 = null;
    let defaultBiayaKh0002 = null;
    biayaJahitRows.forEach((b) => {
        const ket = (b.mhb_ket || "").trim().toUpperCase();
        const cost = Number(b.mhb_biaya) || 0;
        const raw1 = b.mhb_biaya_partaibesar_kh0001;
        const raw2 = b.mhb_biaya_partaibesar_kh0002;
        const costBesar1 = raw1 !== null && raw1 !== undefined && Number(raw1) !== 0 ? Number(raw1) : null;
        const costBesar2 = raw2 !== null && raw2 !== undefined && Number(raw2) !== 0 ? Number(raw2) : null;
        if (ket === "-" || ket === "") {
            defaultBiayaJahit = cost;
            if (costBesar1 !== null) defaultBiayaKh0001 = costBesar1;
            if (costBesar2 !== null) defaultBiayaKh0002 = costBesar2;
        } else {
            biayaJahitMap.set(ket, cost);
            if (costBesar1 !== null) {
                // Jika sudah ada dan yang baru 0, jangan overwrite yang sudah benar (1650)
                if (!biayaJahitBesarMapKh0001.has(ket) || biayaJahitBesarMapKh0001.get(ket) === 0) {
                    biayaJahitBesarMapKh0001.set(ket, costBesar1);
                }
            }
            if (costBesar2 !== null) {
                if (!biayaJahitBesarMapKh0002.has(ket) || biayaJahitBesarMapKh0002.get(ket) === 0) {
                    biayaJahitBesarMapKh0002.set(ket, costBesar2);
                }
            }
        }
    });

    return rows.map((r) => {
        const kode = (r.mhk_kode || "").trim().toUpperCase();
        const jk = (r.mhk_jeniskain || "").trim();
        const ktg = (r.mhk_ktg || "").trim().toUpperCase();
        const key = `${kode}_${jk}`;
        const bBody = babaranBodyMap.get(key) || 0;
        const bLengan =
            kode === "KH-0002"
                ? kh0002InfoMap.get(jk)?.babaranLengan || 0
                : 0;
        const bLenganBesar =
            kode === "KH-0002"
                ? kh0002InfoMapBesar.get(jk)?.babaranLengan || bLengan
                : 0;

        const hargaBahan = Number(r.mhk_harga) || 0;
        const hargaBahanBesarRaw = r.mhk_harga_partaibesar;
        const hargaBahanBesar =
            hargaBahanBesarRaw !== null && hargaBahanBesarRaw !== undefined && Number(hargaBahanBesarRaw) !== 0
                ? Number(hargaBahanBesarRaw)
                : hargaBahan;
        const hargaBody = bBody > 0 ? Math.round(hargaBahan / bBody / 1.11) : 0;
        const hargaRib = Math.round((hargaBahan / 1.11 + 1500) / 70);
        const hargaLengan =
            kode === "KH-0002" ? (lenganPriceMap.get(jk) || 0) : 0;

        const hargaBodyBesar = bBody > 0 ? Math.round(hargaBahanBesar / bBody / 1.11) : 0;
        const hargaRibBesar = Math.round((hargaBahanBesar / 1.11 + 1500) / 70);
        const hargaLenganBesar =
            kode === "KH-0002" ? (lenganPriceMapBesar.get(jk) || hargaLengan) : 0;

        const totalHargaBahan = hargaBody + hargaLengan + hargaRib;
        const allowancePersen = Number(r.mhk_allow) || 0;
        const allowancePersenBesarRaw = r.mhk_allow_partaibesar;
        const allowancePersenBesar =
            allowancePersenBesarRaw !== null && allowancePersenBesarRaw !== undefined && String(allowancePersenBesarRaw) !== ""
                ? Number(allowancePersenBesarRaw)
                : allowancePersen;
        const allowanceRp = Math.round(totalHargaBahan * (allowancePersen / 100));
        const totalBahan = totalHargaBahan + allowanceRp;

        const totalHargaBahanBesar = hargaBodyBesar + hargaLenganBesar + hargaRibBesar;
        const allowanceRpBesar = Math.round(totalHargaBahanBesar * (allowancePersenBesar / 100));
        const totalBahanBesar = totalHargaBahanBesar + allowanceRpBesar;

        const biayaKonveksi = biayaJahitMap.has(ktg)
            ? biayaJahitMap.get(ktg)
            : defaultBiayaJahit;
        const isKh0001 = kode === "KH-0001";
        const biayaKonveksiBesar = (() => {
            const mapBesar = isKh0001 ? biayaJahitBesarMapKh0001 : biayaJahitBesarMapKh0002;
            const defBesar = isKh0001 ? defaultBiayaKh0001 : defaultBiayaKh0002;
            if (mapBesar.has(ktg)) return mapBesar.get(ktg);
            if (defBesar !== null && defBesar !== undefined) return defBesar;
            return biayaKonveksi;
        })();
        const hpp = totalBahan + biayaKonveksi;
        const hppBesar = totalBahanBesar + biayaKonveksiBesar;

        return {
            ...r,
            mhk_harga_partaibesar: hargaBahanBesarRaw !== undefined ? hargaBahanBesarRaw : null,
            babaranBody: bBody,
            babaran_body: bBody,
            babaranLengan: bLengan,
            babaran_lengan: bLengan,
            babaranRib: 70,
            babaran_rib: 70,
            mhk_harga_rib: hargaRib,
            hargaRib,
            mhk_harga_lengan: hargaLengan,
            hargaLengan,
            mhk_harga_body: hargaBody,
            hargaBody,
            mhk_total_harga_bahan: totalHargaBahan,
            totalHargaBahan,
            mhk_allowance_rp: allowanceRp,
            allowanceRp,
            mhk_total_bahan: totalBahan,
            totalBahan,
            mhk_biaya_konveksi: biayaKonveksi,
            biayaKonveksi,
            mhk_biaya_konveksi_partaibesar: biayaKonveksiBesar,
            biayaKonveksiBesar,
            biayaKonveksiPartaiBesar: biayaKonveksiBesar,
            mhk_hpp: hpp,
            hpp,
            // Partai besar (>1000) - qty >=1000 pakai ini
            mhk_harga_body_partaibesar: hargaBodyBesar,
            hargaBody_partaibesar: hargaBodyBesar,
            mhk_harga_rib_partaibesar: hargaRibBesar,
            hargaRib_partaibesar: hargaRibBesar,
            mhk_harga_lengan_partaibesar: hargaLenganBesar,
            hargaLengan_partaibesar: hargaLenganBesar,
            mhk_total_harga_bahan_partaibesar: totalHargaBahanBesar,
            totalHargaBahan_partaibesar: totalHargaBahanBesar,
            mhk_allowance_rp_partaibesar: allowanceRpBesar,
            allowanceRp_partaibesar: allowanceRpBesar,
            mhk_total_bahan_partaibesar: totalBahanBesar,
            totalBahan_partaibesar: totalBahanBesar,
            mhk_hpp_partaibesar: hppBesar,
            hpp_partaibesar: hppBesar,
            hppPartaiBesar: hppBesar,
        };
    });
};

const createKainGarmen = async (data) => {
    const {
        mhk_kode = "",
        mhk_ktg = "",
        mhk_jeniskain = "",
        mhk_lengan = "",
        mhk_komponen = "",
        mhk_babaran = 0,
        mhk_warna = "",
        mhk_harga = 0,
        mhk_harga_partaibesar = null,
        mhk_allow = 0,
        mhk_allow_partaibesar = null,
    } = data;

    // Coba insert dengan kolom partai besar, fallback jika kolom belum ada
    const hargaPartai = mhk_harga_partaibesar !== null && mhk_harga_partaibesar !== undefined && mhk_harga_partaibesar !== "" ? Number(mhk_harga_partaibesar) : null;
    const allowPartai = mhk_allow_partaibesar !== null && mhk_allow_partaibesar !== undefined && String(mhk_allow_partaibesar) !== "" ? Number(mhk_allow_partaibesar) : null;
    try {
        await db.query(
            `INSERT INTO tmintaharga_kain (
      mhk_kode, mhk_ktg, mhk_jeniskain, mhk_lengan, mhk_komponen,
      mhk_babaran, mhk_warna, mhk_harga, mhk_harga_partaibesar, mhk_allow, mhk_allow_partaibesar
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                mhk_kode,
                mhk_ktg,
                mhk_jeniskain,
                mhk_lengan,
                mhk_komponen,
                Number(mhk_babaran) || 0,
                mhk_warna,
                Number(mhk_harga) || 0,
                hargaPartai,
                Number(mhk_allow) || 0,
                allowPartai,
            ],
        );
    } catch (err) {
        if (err.code === "ER_BAD_FIELD_ERROR" && (String(err.sqlMessage).includes("mhk_harga_partaibesar") || String(err.sqlMessage).includes("mhk_allow_partaibesar"))) {
            // Fallback bertahap: coba dengan hanya harga partai besar
            try {
                await db.query(
                    `INSERT INTO tmintaharga_kain (
      mhk_kode, mhk_ktg, mhk_jeniskain, mhk_lengan, mhk_komponen,
      mhk_babaran, mhk_warna, mhk_harga, mhk_harga_partaibesar, mhk_allow
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        mhk_kode, mhk_ktg, mhk_jeniskain, mhk_lengan, mhk_komponen,
                        Number(mhk_babaran) || 0, mhk_warna, Number(mhk_harga) || 0, hargaPartai, Number(mhk_allow) || 0,
                    ],
                );
            } catch (e2) {
                await db.query(
                    `INSERT INTO tmintaharga_kain (
      mhk_kode, mhk_ktg, mhk_jeniskain, mhk_lengan, mhk_komponen,
      mhk_babaran, mhk_warna, mhk_harga, mhk_allow
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        mhk_kode, mhk_ktg, mhk_jeniskain, mhk_lengan, mhk_komponen,
                        Number(mhk_babaran) || 0, mhk_warna, Number(mhk_harga) || 0, Number(mhk_allow) || 0,
                    ],
                );
            }
        } else throw err;
    }
    return { success: true };
};

const updateKainGarmen = async (idOrKey, data) => {
    const {
        mhk_kode = "",
        mhk_ktg = "",
        mhk_jeniskain = "",
        mhk_lengan = "",
        mhk_komponen = "",
        mhk_babaran = 0,
        mhk_warna = "",
        mhk_harga = 0,
        mhk_harga_partaibesar = null,
        mhk_allow = 0,
        mhk_allow_partaibesar = null,
        old_kode,
        old_jeniskain,
        old_warna,
    } = data;

    const targetKode = (old_kode || mhk_kode || "").trim();
    const targetJenisKain = (old_jeniskain || mhk_jeniskain || "").trim();
    const targetWarna = (old_warna || mhk_warna || "").trim();
    const hargaPartai = mhk_harga_partaibesar !== null && mhk_harga_partaibesar !== undefined && mhk_harga_partaibesar !== "" ? Number(mhk_harga_partaibesar) : null;
    const allowPartai = mhk_allow_partaibesar !== null && mhk_allow_partaibesar !== undefined && String(mhk_allow_partaibesar) !== "" ? Number(mhk_allow_partaibesar) : null;

    const tryUpdate = async (mode) => {
        let cols, vals;
        if (mode === "both") {
            cols = `mhk_kode = ?, mhk_ktg = ?, mhk_jeniskain = ?, mhk_lengan = ?, mhk_komponen = ?, mhk_babaran = ?, mhk_warna = ?, mhk_harga = ?, mhk_harga_partaibesar = ?, mhk_allow = ?, mhk_allow_partaibesar = ?`;
            vals = [mhk_kode, mhk_ktg, mhk_jeniskain, mhk_lengan, mhk_komponen, Number(mhk_babaran) || 0, mhk_warna, Number(mhk_harga) || 0, hargaPartai, Number(mhk_allow) || 0, allowPartai];
        } else if (mode === "harga") {
            cols = `mhk_kode = ?, mhk_ktg = ?, mhk_jeniskain = ?, mhk_lengan = ?, mhk_komponen = ?, mhk_babaran = ?, mhk_warna = ?, mhk_harga = ?, mhk_harga_partaibesar = ?, mhk_allow = ?`;
            vals = [mhk_kode, mhk_ktg, mhk_jeniskain, mhk_lengan, mhk_komponen, Number(mhk_babaran) || 0, mhk_warna, Number(mhk_harga) || 0, hargaPartai, Number(mhk_allow) || 0];
        } else {
            cols = `mhk_kode = ?, mhk_ktg = ?, mhk_jeniskain = ?, mhk_lengan = ?, mhk_komponen = ?, mhk_babaran = ?, mhk_warna = ?, mhk_harga = ?, mhk_allow = ?`;
            vals = [mhk_kode, mhk_ktg, mhk_jeniskain, mhk_lengan, mhk_komponen, Number(mhk_babaran) || 0, mhk_warna, Number(mhk_harga) || 0, Number(mhk_allow) || 0];
        }
        if (targetKode) {
            const sql = `UPDATE tmintaharga_kain SET ${cols} WHERE mhk_kode = ? AND TRIM(mhk_jeniskain) = ? AND TRIM(mhk_warna) = ?`;
            return db.query(sql, [...vals, targetKode, targetJenisKain, targetWarna]);
        } else {
            const sql = `UPDATE tmintaharga_kain SET ${cols} WHERE TRIM(mhk_jeniskain) = ? AND TRIM(mhk_warna) = ?`;
            return db.query(sql, [...vals, targetJenisKain, targetWarna]);
        }
    };

    let res;
    try {
        const [result] = await tryUpdate("both");
        res = result;
    } catch (err) {
        if (err.code === "ER_BAD_FIELD_ERROR" && String(err.sqlMessage).includes("mhk_allow_partaibesar")) {
            try {
                const [result] = await tryUpdate("harga");
                res = result;
            } catch (e2) {
                const [result] = await tryUpdate("none");
                res = result;
            }
        } else if (err.code === "ER_BAD_FIELD_ERROR" && String(err.sqlMessage).includes("mhk_harga_partaibesar")) {
            const [result] = await tryUpdate("none");
            res = result;
        } else throw err;
    }

    return { success: true, affectedRows: res?.affectedRows || 0 };
};

const deleteKainGarmen = async (data) => {
    const { mhk_kode, mhk_jeniskain, mhk_warna } = data;
    const targetKode = (mhk_kode || "").trim();
    const targetJenisKain = (mhk_jeniskain || "").trim();
    const targetWarna = (mhk_warna || "").trim();

    let res;
    if (targetKode) {
        const [result] = await db.query(
            `DELETE FROM tmintaharga_kain 
       WHERE mhk_kode = ? AND TRIM(mhk_jeniskain) = ? AND TRIM(mhk_warna) = ?`,
            [targetKode, targetJenisKain, targetWarna],
        );
        res = result;
    } else {
        const [result] = await db.query(
            `DELETE FROM tmintaharga_kain 
       WHERE TRIM(mhk_jeniskain) = ? AND TRIM(mhk_warna) = ?`,
            [targetJenisKain, targetWarna],
        );
        res = result;
    }
    return { success: true, affectedRows: res?.affectedRows || 0 };
};

const getBiayaJahitGarmen = async () => {
    const [rows] = await db.query(
        "SELECT mhb_jenis, mhb_ket, mhb_biaya FROM tmintaharga_biaya WHERE mhb_jenis = 'JAHIT'",
    );
    return rows;
};

// ========================================================
// 2. GARMEN TAMBAHAN / CUSTOM (tmintaharga_tambahan)
// Kolom: mht_ket, mht_lacost, mht_cotton, mht_pe, mht_pe_partaibesar
// ========================================================
const getTambahanGarmen = async () => {
    const [rows] = await db.query(
        "SELECT * FROM tmintaharga_tambahan ORDER BY mht_ket ASC",
    );
    return rows;
};

const createTambahanGarmen = async (data) => {
    const {
        mht_ket,
        mht_lacost = 0,
        mht_cotton = 0,
        mht_pe = 0,
        mht_pe_partaibesar = 0,
    } = data;
    await db.query(
        `INSERT INTO tmintaharga_tambahan (mht_ket, mht_lacost, mht_cotton, mht_pe, mht_pe_partaibesar)
     VALUES (?, ?, ?, ?, ?)`,
        [
            mht_ket,
            Number(mht_lacost) || 0,
            Number(mht_cotton) || 0,
            Number(mht_pe) || 0,
            Number(mht_pe_partaibesar) || 0,
        ],
    );
    return { success: true };
};

const updateTambahanGarmen = async (oldKet, data) => {
    const {
        mht_ket,
        mht_lacost = 0,
        mht_cotton = 0,
        mht_pe = 0,
        mht_pe_partaibesar = 0,
    } = data;
    await db.query(
        `UPDATE tmintaharga_tambahan SET
      mht_ket = ?,
      mht_lacost = ?,
      mht_cotton = ?,
      mht_pe = ?,
      mht_pe_partaibesar = ?
     WHERE mht_ket = ?`,
        [
            mht_ket,
            Number(mht_lacost) || 0,
            Number(mht_cotton) || 0,
            Number(mht_pe) || 0,
            Number(mht_pe_partaibesar) || 0,
            oldKet,
        ],
    );
    return { success: true };
};

const deleteTambahanGarmen = async (mht_ket) => {
    await db.query("DELETE FROM tmintaharga_tambahan WHERE mht_ket = ?", [
        mht_ket,
    ]);
    return { success: true };
};

// ========================================================
// 3. SPANDUK (tmintaharga_spanduk)
// Kolom: mhsp_id, mhsp_metode, mhsp_lebar, mhsp_jenis_kain, mhsp_qmin, mhsp_qmax, mhsp_harga, mhsp_user_create, mhsp_date_create
// ========================================================
const getSpanduk = async () => {
    const [rows] = await db.query(`
    SELECT 
      mhsp_id AS id,
      mhsp_metode AS metode,
      mhsp_lebar AS lebar,
      mhsp_jenis_kain AS jenis_kain,
      mhsp_qmin AS qmin,
      mhsp_qmax AS qmax,
      mhsp_harga AS harga,
      mhsp_user_create AS user_create,
      mhsp_date_create AS date_create
    FROM tmintaharga_spanduk 
    ORDER BY mhsp_metode ASC, mhsp_lebar ASC, mhsp_jenis_kain ASC, mhsp_qmin ASC
  `);
    return rows;
};

const createSpanduk = async (data, user) => {
    const {
        metode = "MANUAL",
        lebar = 90,
        jenis_kain = "POLYESTER 50/36",
        qmin = 0,
        qmax = 999999,
        harga = 0,
    } = data;

    const [res] = await db.query(
        `INSERT INTO tmintaharga_spanduk (
      mhsp_metode, mhsp_lebar, mhsp_jenis_kain, mhsp_qmin, mhsp_qmax, mhsp_harga, mhsp_user_create, mhsp_date_create
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
            metode,
            Number(lebar) || 90,
            jenis_kain,
            Number(qmin) || 0,
            Number(qmax) || 999999,
            Number(harga) || 0,
            user?.nama || "ADMIN",
        ],
    );
    return { id: res.insertId };
};

const updateSpanduk = async (id, data) => {
    const { metode, lebar, jenis_kain, qmin, qmax, harga } = data;
    await db.query(
        `UPDATE tmintaharga_spanduk SET
      mhsp_metode = ?,
      mhsp_lebar = ?,
      mhsp_jenis_kain = ?,
      mhsp_qmin = ?,
      mhsp_qmax = ?,
      mhsp_harga = ?
     WHERE mhsp_id = ?`,
        [
            metode,
            Number(lebar) || 90,
            jenis_kain,
            Number(qmin) || 0,
            Number(qmax) || 999999,
            Number(harga) || 0,
            id,
        ],
    );
    return { success: true };
};

const deleteSpanduk = async (id) => {
    await db.query("DELETE FROM tmintaharga_spanduk WHERE mhsp_id = ?", [id]);
    return { success: true };
};

// ========================================================
// 4. MMT BAHAN (tmintaharga_mmt)
// Kolom: mhm_id, mhm_kategori, mhm_bahan_kode, mhm_nama_bahan, mhm_qmin, mhm_qmax, mhm_harga, mhm_is_netto, mhm_resolusi_tipe
// ========================================================
const getMmt = async () => {
    const [rows] = await db.query(`
    SELECT 
      mhm_id AS id,
      mhm_kategori AS kategori,
      mhm_bahan_kode AS bahan_kode,
      mhm_nama_bahan AS nama_bahan,
      mhm_qmin AS qmin,
      mhm_qmax AS qmax,
      mhm_harga AS harga,
      mhm_is_netto AS is_netto,
      mhm_resolusi_tipe AS resolusi_tipe,
      mhm_user_create AS user_create,
      mhm_date_create AS date_create
    FROM tmintaharga_mmt 
    ORDER BY mhm_kategori ASC, mhm_bahan_kode ASC, mhm_qmin ASC
  `);
    return rows;
};

const createMmt = async (data, user) => {
    const {
        kategori = "VYNIL",
        bahan_kode = "260",
        nama_bahan = "",
        qmin = 0,
        qmax = 999999,
        harga = 0,
        is_netto = 0,
        resolusi_tipe = "",
    } = data;

    const [res] = await db.query(
        `INSERT INTO tmintaharga_mmt (
      mhm_kategori, mhm_bahan_kode, mhm_nama_bahan, mhm_qmin, mhm_qmax, mhm_harga, mhm_is_netto, mhm_resolusi_tipe, mhm_user_create, mhm_date_create
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
            kategori,
            bahan_kode,
            nama_bahan,
            Number(qmin) || 0,
            Number(qmax) || 999999,
            Number(harga) || 0,
            is_netto ? 1 : 0,
            resolusi_tipe || "",
            user?.nama || "ADMIN",
        ],
    );
    return { id: res.insertId };
};

const updateMmt = async (id, data) => {
    const {
        kategori,
        bahan_kode,
        nama_bahan,
        qmin,
        qmax,
        harga,
        is_netto,
        resolusi_tipe,
    } = data;

    await db.query(
        `UPDATE tmintaharga_mmt SET
      mhm_kategori = ?,
      mhm_bahan_kode = ?,
      mhm_nama_bahan = ?,
      mhm_qmin = ?,
      mhm_qmax = ?,
      mhm_harga = ?,
      mhm_is_netto = ?,
      mhm_resolusi_tipe = ?
     WHERE mhm_id = ?`,
        [
            kategori,
            bahan_kode,
            nama_bahan,
            Number(qmin) || 0,
            Number(qmax) || 999999,
            Number(harga) || 0,
            is_netto ? 1 : 0,
            resolusi_tipe || "",
            id,
        ],
    );
    return { success: true };
};

const deleteMmt = async (id) => {
    await db.query("DELETE FROM tmintaharga_mmt WHERE mhm_id = ?", [id]);
    return { success: true };
};

// ========================================================
// 5. MMT TAMBAHAN / TOPPING (tmintaharga_mmt_tambahan)
// Kolom: mhmt_id, mhmt_kode, mhmt_nama, mhmt_kategori, mhmt_ukuran, mhmt_material, mhmt_harga, mhmt_aktif
// ========================================================
const getMmtTambahan = async () => {
    const [rows] = await db.query(`
    SELECT 
      mhmt_id AS id,
      mhmt_kode AS kode,
      mhmt_nama AS nama,
      mhmt_kategori AS kategori,
      mhmt_ukuran AS ukuran,
      mhmt_material AS material,
      mhmt_harga AS harga,
      mhmt_aktif AS aktif,
      mhmt_user_create AS user_create,
      mhmt_date_create AS date_create
    FROM tmintaharga_mmt_tambahan 
    ORDER BY mhmt_kategori ASC, mhmt_nama ASC
  `);
    return rows;
};

const createMmtTambahan = async (data, user) => {
    const {
        kode,
        nama,
        kategori = "STANDING_BANNER",
        ukuran = "",
        material = "-",
        harga = 0,
        aktif = 1,
    } = data;

    const [res] = await db.query(
        `INSERT INTO tmintaharga_mmt_tambahan (
      mhmt_kode, mhmt_nama, mhmt_kategori, mhmt_ukuran, mhmt_material, mhmt_harga, mhmt_aktif, mhmt_user_create, mhmt_date_create
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
            kode,
            nama,
            kategori,
            ukuran,
            material,
            Number(harga) || 0,
            aktif ? 1 : 0,
            user?.nama || "ADMIN",
        ],
    );
    return { id: res.insertId };
};

const updateMmtTambahan = async (id, data) => {
    const { kode, nama, kategori, ukuran, material, harga, aktif } = data;
    await db.query(
        `UPDATE tmintaharga_mmt_tambahan SET
      mhmt_kode = ?,
      mhmt_nama = ?,
      mhmt_kategori = ?,
      mhmt_ukuran = ?,
      mhmt_material = ?,
      mhmt_harga = ?,
      mhmt_aktif = ?
     WHERE mhmt_id = ?`,
        [
            kode,
            nama,
            kategori,
            ukuran,
            material,
            Number(harga) || 0,
            aktif ? 1 : 0,
            id,
        ],
    );
    return { success: true };
};

const deleteMmtTambahan = async (id) => {
    await db.query("DELETE FROM tmintaharga_mmt_tambahan WHERE mhmt_id = ?", [
        id,
    ]);
    return { success: true };
};

// ========================================================
// 5. GARMEN MARGIN TIER (tmintaharga_margin)
// ========================================================
const getMarginGarmen = async (model, ktg = null) => {
    try {
        let query = "SELECT * FROM tmintaharga_margin";
        const params = [];
        const conds = [];
        if (model) { conds.push("model = ?"); params.push(model); }
        if (ktg) { conds.push("ktg = ?"); params.push(ktg); }
        if (conds.length) query += " WHERE " + conds.join(" AND ");
        query += " ORDER BY model ASC, ktg ASC, qmin ASC";
        const [rows] = await db.query(query, params);
        if (ktg && rows.length === 0) {
            const [fallback] = await db.query("SELECT * FROM tmintaharga_margin WHERE model = ? AND (ktg IS NULL OR ktg = ?) ORDER BY qmin ASC", [model, ktg]);
            if (fallback.length) return fallback;
            const [fallback2] = await db.query("SELECT * FROM tmintaharga_margin WHERE model = ? ORDER BY qmin ASC", [model]);
            return fallback2;
        }
        return rows;
    } catch (err) {
        if (err.code === "ER_BAD_FIELD_ERROR" && String(err.sqlMessage).includes("ktg")) {
            let query = "SELECT * FROM tmintaharga_margin";
            const params = [];
            if (model) { query += " WHERE model = ?"; params.push(model); }
            query += " ORDER BY model ASC, qmin ASC";
            const [rows] = await db.query(query, params);
            return rows;
        }
        throw err;
    }
};

const updateMarginGarmen = async (data) => {
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
        const { model, ktg, qmin, margin } = item;
        if (model && qmin !== undefined) {
            try {
                if (ktg) {
                    const [res] = await db.query(
                        "UPDATE tmintaharga_margin SET margin = ? WHERE model = ? AND ktg = ? AND qmin = ?",
                        [Number(margin) || 0, model, ktg, Number(qmin)],
                    );
                    if (res.affectedRows === 0) {
                        await db.query(
                            "INSERT INTO tmintaharga_margin (model, ktg, qmin, qmax, margin, persen) VALUES (?, ?, ?, ?, ?, 'Y')",
                            [model, ktg, Number(qmin), 999999999, Number(margin) || 0],
                        );
                    }
                } else {
                    await db.query(
                        "UPDATE tmintaharga_margin SET margin = ? WHERE model = ? AND qmin = ?",
                        [Number(margin) || 0, model, Number(qmin)],
                    );
                }
            } catch (err) {
                if (err.code === "ER_BAD_FIELD_ERROR" && String(err.sqlMessage).includes("ktg")) {
                    await db.query(
                        "UPDATE tmintaharga_margin SET margin = ? WHERE model = ? AND qmin = ?",
                        [Number(margin) || 0, model, Number(qmin)],
                    );
                } else throw err;
            }
        }
    }
    return { success: true };
};

module.exports = {
    getKainGarmen,
    getBiayaJahitGarmen,
    createKainGarmen,
    updateKainGarmen,
    deleteKainGarmen,
    getTambahanGarmen,
    createTambahanGarmen,
    updateTambahanGarmen,
    deleteTambahanGarmen,
    getSpanduk,
    createSpanduk,
    updateSpanduk,
    deleteSpanduk,
    getMmt,
    createMmt,
    updateMmt,
    deleteMmt,
    getMmtTambahan,
    createMmtTambahan,
    updateMmtTambahan,
    deleteMmtTambahan,
    getMarginGarmen,
    updateMarginGarmen,
};
