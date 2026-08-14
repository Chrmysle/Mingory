const { callFunction } = require("./cloud");

const createProduct = (data) => callFunction("createProduct", data);
const updateProduct = (data) => callFunction("updateProduct", data);
const getProduct = (data) => callFunction("getProduct", data);
const searchProducts = (data) => callFunction("searchProducts", data);
const getFieldSuggestions = (data) => callFunction("getFieldSuggestions", data);

module.exports = { createProduct, updateProduct, getProduct, searchProducts, getFieldSuggestions };
