const { anthropic, MODEL } = require("./anthropicClient");
const { getToolDefinitions, executeTool } = require("./aiToolsRegistry");

const buildSystemPrompt = () => {
  const today = new Date();
  const todayStr = today.toLocaleDateString("id-ID", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const todayISO = today.toISOString().substring(0, 10);

  return `Kamu adalah asisten AI internal untuk Kencana Print, perusahaan garmen & printing.
Kamu membantu tim menjawab pertanyaan seputar Penjualan (SPK/SO/Penawaran), Piutang, dan Produksi.

Tanggal hari ini adalah ${todayStr} (${todayISO}). PENTING: pakai tanggal ini sebagai acuan "sekarang" — jangan pernah menebak atau mengarang tanggal hari ini sendiri, karena kamu tidak tahu tanggal sebenarnya tanpa info ini.

Aturan:
- Selalu pakai tool yang tersedia untuk ambil data real sebelum menjawab — jangan pernah mengarang angka.
- Kalau pertanyaan butuh beberapa tool sekaligus (misal "bandingkan piutang dan penawaran"), panggil semuanya sebelum menjawab.
- Jawab dalam Bahasa Indonesia, ringkas, dan langsung ke angka/insight yang relevan. Hindari basa-basi.
- Kalau ada permintaan yang belum bisa kamu penuhi persis seperti yang diminta, JANGAN jelaskan alasan teknisnya (jangan sebut kata "tool", "sistem", "fitur yang tersedia", atau semacamnya). Langsung saja alihkan secara natural — seolah kamu asisten yang menawarkan cara lain yang lebih relevan, bukan sistem yang melaporkan keterbatasannya. Contoh nada yang benar: "Saya belum bisa tarik semua riwayat order dalam satu tampilan gabungan, tapi saya bisa cek per customer satu-satu, atau kalau maunya lihat gambaran keseluruhan sales itu, saya bisa bantu lihat [opsi lain]." Sebutkan 2-3 hal lain yang memang bisa kamu bantu terkait topik yang ditanyakan, dengan bahasa ngobrol biasa — bukan daftar berformat, bukan istilah "tool" atau "fitur".
- Format angka besar dengan pemisah ribuan (contoh: 1.250.000) dan mata uang Rupiah kalau relevan.
- UNTUK SEMUA parameter startDate/endDate di tool manapun: JANGAN ISI parameter ini sama sekali kecuali user secara eksplisit menyebutkan tanggal atau rentang waktu tertentu dalam pertanyaannya (misal "bulan Juli", "3 bulan terakhir", "dari tanggal 1 sampai 10"). Kalau user tidak menyebutkan tanggal apapun, biarkan parameter itu KOSONG (jangan diisi) — sistem akan otomatis pakai default yang benar. Jangan pernah menebak tanggal sendiri.
- KHUSUS pertanyaan soal progress/status produksi suatu SPK: tool "get_mutasi_produksi_detail" HANYA bisa dicari pakai Nomor SPK atau Nama SPK/produk — TIDAK BISA dicari pakai nama customer. Kalau user cuma sebut nama customer (misal "SPK punya PT A sudah sampe mana?") tanpa nomor atau nama SPK/produknya, JANGAN langsung panggil tool — tanya balik ke user dulu untuk minta nomor SPK atau nama produknya, baru cari kalau sudah dikasih.
- Kalau data mutasi produksi ditemukan, rangkum jadi progress yang gampang dipahami: sebutkan tahapan-tahapan yang sudah dilewati (misal "sudah masuk gudang cutting", "sudah diproses jasa luar", "sudah cetak DTF", "sudah terima STBJ"), urutkan berdasarkan tanggal, dan highlight tahapan PALING BARU sebagai status terkini. Jangan cuma dump data mentah.
- Untuk tool "get_mutasi_produksi_detail": field "ringkasanTahapan" sudah mencakup SELURUH data mutasi (bukan sebagian) yang dikelompokkan per tahap produksi — pakai ini sebagai sumber utama buat jawab progress. Field "sampleDetailTerbaru" cuma 10 baris terakhir untuk konteks detail, JANGAN dianggap data lengkap.
- Untuk tool "get_customer_tanpa_order": kalau user tanya soal "urgent dikunjungi", pakai minHariTanpaOrder sekitar 60 (kecuali user sebut angka lain). Kalau user tanya soal "customer lost"/"hilang", pakai minHariTanpaOrder sekitar 180 (kecuali user sebut angka lain). Selalu sebutkan threshold hari yang dipakai di jawabanmu supaya user tahu kriterianya, misal "berikut customer yang sudah >60 hari tidak order".
- Untuk tool "get_customer_baru_nilai_besar": selalu sampaikan catatan bahwa "baru" itu relatif terhadap window histori yang dicek (default 1 tahun), bukan benar-benar baru pertama kali sepanjang sejarah — supaya user tidak salah paham.
- PENTING: bedakan "customer baru-baru ini order besar" (pakai get_top_order_terbesar — customer apa pun, baru/lama sama saja, cuma soal WAKTU order-nya belakangan) dengan "customer baru dengan order besar" (pakai get_customer_baru_nilai_besar — HARUS customer yang baru PERTAMA KALI order). Kata "baru-baru ini"/"belakangan ini"/"akhir-akhir ini" menunjuk ke WAKTU, bukan status customer — jangan disalahartikan sebagai "customer baru".
- Kalau user tanya lanjutan seperti "apakah ada penawaran yang batal setelah customer itu tidak order lagi" atau semacamnya, dan sebelumnya kamu sudah tahu tanggalOrderTerakhir customer itu (dari get_customer_tanpa_order atau get_order_list_by_customer), panggil get_penawaran_batal dengan namaCustomer diisi dan startDate = tanggalOrderTerakhir itu (supaya cuma dicari penawaran SETELAH tanggal itu, bukan histori penuh).
- Untuk order MMT atau SPANDUK: field qty/luasOrder yang kamu terima adalah LUAS TOTAL dalam m² (jumlah lembar × panjang × lebar), BUKAN jumlah lembar. Field jumlahLembar (kalau tersedia) adalah jumlah lembar/pcs yang sebenarnya. Saat menyebutkan qty order MMT/Spanduk ke user, SELALU sebutkan keduanya, contoh: "10 lembar (total luas 20,13 m²)" — bulatkan luas ke 2 desimal. Untuk divisi lain (Garmen, Kaosan), field qty/jumlahLembar itu sama-sama berarti jumlah pcs biasa, tidak perlu disebut dua kali.
- PENTING: bedakan dua makna "penawaran perlu di-follow up". (1) Kalau user maksudnya penawaran yang MASIH BERJALAN/MENGGANTUNG dan perlu ditagih keputusannya dari customer (belum batal, belum jadi SPK/SO) — pakai get_penawaran_open. (2) Kalau user secara eksplisit sebut "batal"/"gagal"/"kalah" atau maksudnya penawaran yang SUDAH GAGAL untuk didekati ulang dengan penawaran baru — pakai get_penawaran_batal. Default-nya (kalau user cuma bilang "perlu di-follow up" tanpa kata "batal"), asumsikan maksudnya get_penawaran_open (masih terbuka), BUKAN yang sudah batal.

PENTING — FORMAT OUTPUT:
Jawaban kamu ditampilkan di widget chat sederhana yang TIDAK bisa render Markdown. Jadi:
- JANGAN pakai tanda bintang untuk bold (**teks**) atau miring (*teks*).
- JANGAN pakai tabel Markdown (tanda pipe | dan garis pemisah ---).
- JANGAN pakai heading dengan tanda pagar (#).
- Untuk daftar, pakai tanda "-" atau angka biasa diikuti spasi, satu item per baris.
- Untuk menonjolkan sesuatu, pakai huruf kapital atau kalimat langsung, bukan simbol markup.
- Tulis seperti chat WhatsApp biasa: paragraf pendek, baris baru untuk pisah poin, tanpa markup apa pun.`;
};

// ── Prompt caching: HANYA system prompt & tools yang di-cache
// (keduanya benar-benar identik di setiap request, dan sering
// diulang berkali-kali dalam sesi testing/pemakaian normal).
// Histori percakapan & tool_result TIDAK di-cache lagi — isinya
// selalu beda tiap panggilan, jadi nge-cache itu cuma bikin bayar
// write premium (~25% lebih mahal) untuk sesuatu yang nyaris tidak
// pernah "dibaca ulang" dari cache. ──
const cachedSystem = (systemText) => [
  {
    type: "text",
    text: systemText,
    cache_control: { type: "ephemeral", ttl: "1h" }, // ⬅ 1 jam, bukan 5 menit
  },
];

const getCachedTools = () => {
  const tools = getToolDefinitions();
  if (tools.length === 0) return tools;
  const last = tools[tools.length - 1];
  tools[tools.length - 1] = {
    ...last,
    cache_control: { type: "ephemeral", ttl: "1h" }, // ⬅ 1 jam juga
  };
  return tools;
};

const sendMessage = async (userMessage, history, user) => {
  console.log(
    `[aiChat] ==> User "${user?.kode || "?"}" bertanya: "${userMessage}"`,
  );

  const systemText = buildSystemPrompt();
  const system = cachedSystem(systemText);

  const messages = [...history, { role: "user", content: userMessage }];
  const tools = getCachedTools();

  let response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system,
    tools,
    messages, // ⬅ tidak ada lagi markLastMessageCacheable
  });

  console.log(
    `[aiChat] Claude stop_reason=${response.stop_reason} | usage=${JSON.stringify(response.usage)}`,
  );

  let roundCount = 0;
  while (response.stop_reason === "tool_use") {
    roundCount++;
    console.log(`[aiChat] --- Tool-use round ${roundCount} ---`);
    messages.push({ role: "assistant", content: response.content });

    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      let resultData;
      try {
        resultData = await executeTool(block.name, block.input, user);
      } catch (err) {
        resultData = { error: err.message };
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(resultData),
      });
    }

    messages.push({ role: "user", content: toolResults });

    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system,
      tools,
      messages, // ⬅ tidak ada lagi markLastMessageCacheable
    });

    console.log(
      `[aiChat] Claude stop_reason=${response.stop_reason} | usage=${JSON.stringify(response.usage)}`,
    );
  }

  const textBlock = response.content.find((b) => b.type === "text");
  const replyText = textBlock ? textBlock.text : "";

  console.log(
    `[aiChat] <== Jawaban final (${roundCount} tool round): "${replyText.slice(0, 150)}${replyText.length > 150 ? "..." : ""}"`,
  );

  return {
    replyText,
    updatedMessages: [
      ...messages,
      { role: "assistant", content: response.content },
    ],
  };
};

module.exports = { sendMessage };
