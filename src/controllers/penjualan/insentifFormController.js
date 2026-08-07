const insentifFormService = require("../../services/penjualan/insentifFormService");

const getCustomerInfo = async (req, res) => {
  try {
    const { kode } = req.params;
    const data = await insentifFormService.getCustomerInfo(kode);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const searchInvoice = async (req, res) => {
  try {
    const { custKode, q } = req.query;
    const data = await insentifFormService.searchInvoiceForCustomer(
      custKode,
      q,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const checkInvoice = async (req, res) => {
  try {
    const { custKode, nomor } = req.query;
    const data = await insentifFormService.checkInvoice(custKode, nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getById = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await insentifFormService.getById(nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const data = await insentifFormService.save(req.body, req.user);
    res
      .status(200)
      .json({ success: true, message: "Berhasil disimpan.", data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await insentifFormService.getPrintData(nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getCustomerInfo,
  searchInvoice,
  checkInvoice,
  getById,
  save,
  getPrintData,
};
