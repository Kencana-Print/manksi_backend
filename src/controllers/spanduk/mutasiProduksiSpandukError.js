const kirimError = (res, e) => {
  if (e.notFound) {
    return res.status(404).json({ success: false, message: e.message });
  }
  if (e.forbidden) {
    return res.status(403).json({ success: false, message: e.message });
  }
  // Error database: jangan bocorkan detail SQL ke klien
  if (e.sqlMessage || e.errno) {
    console.error("[mutasi-produksi-spanduk]", e);
    return res
      .status(500)
      .json({ success: false, message: "Terjadi kesalahan pada server" });
  }
  return res.status(400).json({ success: false, message: e.message });
};

module.exports = { kirimError };
