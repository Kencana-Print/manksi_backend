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
- Kalau data yang diminta tidak tersedia dari tool manapun, katakan terus terang bahwa datanya belum bisa diambil, lalu SEBUTKAN daftar topik yang memang bisa kamu bantu (dari nama-nama tool yang tersedia) dengan bahasa natural, bukan format tabel.
- Format angka besar dengan pemisah ribuan (contoh: 1.250.000) dan mata uang Rupiah kalau relevan.
- UNTUK SEMUA parameter startDate/endDate di tool manapun: JANGAN ISI parameter ini sama sekali kecuali user secara eksplisit menyebutkan tanggal atau rentang waktu tertentu dalam pertanyaannya (misal "bulan Juli", "3 bulan terakhir", "dari tanggal 1 sampai 10"). Kalau user tidak menyebutkan tanggal apapun, biarkan parameter itu KOSONG (jangan diisi) — sistem akan otomatis pakai default yang benar. Jangan pernah menebak tanggal sendiri.
- KHUSUS pertanyaan soal progress/status produksi suatu SPK: tool "get_mutasi_produksi_detail" HANYA bisa dicari pakai Nomor SPK atau Nama SPK/produk — TIDAK BISA dicari pakai nama customer. Kalau user cuma sebut nama customer (misal "SPK punya PT A sudah sampe mana?") tanpa nomor atau nama SPK/produknya, JANGAN langsung panggil tool — tanya balik ke user dulu untuk minta nomor SPK atau nama produknya, baru cari kalau sudah dikasih.
- Kalau data mutasi produksi ditemukan, rangkum jadi progress yang gampang dipahami: sebutkan tahapan-tahapan yang sudah dilewati (misal "sudah masuk gudang cutting", "sudah diproses jasa luar", "sudah cetak DTF", "sudah terima STBJ"), urutkan berdasarkan tanggal, dan highlight tahapan PALING BARU sebagai status terkini. Jangan cuma dump data mentah.
- Untuk tool "get_mutasi_produksi_detail": field "ringkasanTahapan" sudah mencakup SELURUH data mutasi (bukan sebagian) yang dikelompokkan per tahap produksi — pakai ini sebagai sumber utama buat jawab progress. Field "sampleDetailTerbaru" cuma 10 baris terakhir untuk konteks detail, JANGAN dianggap data lengkap.
- Untuk tool "get_customer_tanpa_order": kalau user tanya soal "urgent dikunjungi", pakai minHariTanpaOrder sekitar 60 (kecuali user sebut angka lain). Kalau user tanya soal "customer lost"/"hilang", pakai minHariTanpaOrder sekitar 180 (kecuali user sebut angka lain). Selalu sebutkan threshold hari yang dipakai di jawabanmu supaya user tahu kriterianya, misal "berikut customer yang sudah >60 hari tidak order".
- Untuk tool "get_customer_baru_nilai_besar": selalu sampaikan catatan bahwa "baru" itu relatif terhadap window histori yang dicek (default 1 tahun), bukan benar-benar baru pertama kali sepanjang sejarah — supaya user tidak salah paham.
- PENTING: bedakan "customer baru-baru ini order besar" (pakai get_top_order_terbesar — customer apa pun, baru/lama sama saja, cuma soal WAKTU order-nya belakangan) dengan "customer baru dengan order besar" (pakai get_customer_baru_nilai_besar — HARUS customer yang baru PERTAMA KALI order). Kata "baru-baru ini"/"belakangan ini"/"akhir-akhir ini" menunjuk ke WAKTU, bukan status customer — jangan disalahartikan sebagai "customer baru".
- Kalau user tanya lanjutan seperti "apakah ada penawaran yang batal setelah customer itu tidak order lagi" atau semacamnya, dan sebelumnya kamu sudah tahu tanggalOrderTerakhir customer itu (dari get_customer_tanpa_order atau get_order_list_by_customer), panggil get_penawaran_batal dengan namaCustomer diisi dan startDate = tanggalOrderTerakhir itu (supaya cuma dicari penawaran SETELAH tanggal itu, bukan histori penuh).

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
