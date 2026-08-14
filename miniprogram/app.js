const { CLOUD_ENV_ID } = require("./envList");
const userService = require("./services/user");

App({
  globalData: {
    envId: CLOUD_ENV_ID,
    currentUser: null,
  },

  onLaunch() {
    this.userReady = this.initialize();
  },

  async initialize() {
    if (!wx.cloud) {
      const error = new Error("当前微信基础库不支持云开发，请升级微信后重试");
      error.code = "CLOUD_NOT_SUPPORTED";
      throw error;
    }

    if (!CLOUD_ENV_ID) {
      const error = new Error("请先在 miniprogram/envList.js 中填写云环境 ID");
      error.code = "CLOUD_ENV_NOT_CONFIGURED";
      throw error;
    }

    wx.cloud.init({
      env: CLOUD_ENV_ID,
      traceUser: true,
    });

    const user = await userService.login();
    this.globalData.currentUser = user;
    return user;
  },
});
