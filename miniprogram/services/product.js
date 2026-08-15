const { callFunction } = require("./cloud");

const createProduct = (data) => callFunction("createProduct", data);
const updateProduct = (data) => callFunction("updateProduct", data);
const archiveProduct = (data) => callFunction("archiveProduct", data);
const manageArchivedProducts = (data) => callFunction("manageArchivedProducts", data);
const getProduct = (data) => callFunction("getProduct", data);
const searchProducts = (data) => callFunction("searchProducts", data);
const getFieldSuggestions = (data) => callFunction("getFieldSuggestions", data);

module.exports = { createProduct, updateProduct, archiveProduct, manageArchivedProducts, getProduct, searchProducts, getFieldSuggestions };
