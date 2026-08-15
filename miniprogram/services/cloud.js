function callFunction(name, data = {}) {
  return wx.cloud
    .callFunction({ name, data })
    .then(({ result }) => {
      if (result && result.success) return result.data;

      const error = new Error(
        (result && result.message) || "云服务请求失败，请稍后重试"
      );
      error.code = (result && result.code) || "CLOUD_FUNCTION_ERROR";
      error.data = (result && result.data) || null;
      if (error.code === "UNAUTHORIZED" && typeof getApp === "function") {
        const app = getApp();
        if (app && typeof app.handleUnauthorized === "function") app.handleUnauthorized(error);
      }
      throw error;
    })
    .catch((error) => {
      if (error.code) throw error;

      const friendlyError = new Error("无法连接云服务，请检查云环境和云函数配置");
      friendlyError.code = "CLOUD_CONNECTION_ERROR";
      friendlyError.cause = error;
      throw friendlyError;
    });
}

module.exports = { callFunction };
