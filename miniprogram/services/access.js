const { callFunction } = require("./cloud");

function submitAccessRequest(name) {
  return callFunction("manageAccess", { action:"submit", name });
}

function getAccessManagement() {
  return callFunction("manageAccess", { action:"list" });
}

function approveAccessRequest(requestId, name) {
  return callFunction("manageAccess", { action:"approve", requestId, name });
}

function rejectAccessRequest(requestId) {
  return callFunction("manageAccess", { action:"reject", requestId });
}

module.exports = { submitAccessRequest, getAccessManagement, approveAccessRequest, rejectAccessRequest };
