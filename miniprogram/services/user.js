const { callFunction } = require("./cloud");

function login() {
  return callFunction("login");
}

module.exports = { login };
