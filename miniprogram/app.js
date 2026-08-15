const { CLOUD_ENV_ID } = require("./envList");
const userService = require("./services/user");

App({
  globalData: {
    envId: CLOUD_ENV_ID,
    currentUser: null,
    authStatus: "checking",
    authMessage: "正在验证访问权限…",
  },

  onLaunch() {
    this.cloudInitialized = false;
    this.userReady = this.ensureAuthorized({ force: true });
    this.userReady.catch(() => {});
  },

  initializeCloud() {
    if (this.cloudInitialized) return;
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
    this.cloudInitialized = true;
  },

  setAuthState(status, { user = null, message = "" } = {}) {
    this.globalData.authStatus = status;
    this.globalData.authMessage = message;
    this.globalData.currentUser = status === "authorized" ? user : null;

    if (status === "authorized" && typeof wx.showTabBar === "function") wx.showTabBar({ animation: false, fail() {} });
    else if (status !== "authorized" && typeof wx.hideTabBar === "function") wx.hideTabBar({ animation: false, fail() {} });

    if (typeof getCurrentPages === "function") {
      for (const page of getCurrentPages()) {
        if (page && typeof page.applyAuthorizationState === "function") {
          page.applyAuthorizationState({ status, user:this.globalData.currentUser, message });
        }
      }
    }
  },

  async ensureAuthorized({ force = false } = {}) {
    if (!force && this.globalData.authStatus === "authorized" && this.globalData.currentUser) {
      return this.globalData.currentUser;
    }
    if (!force && this.authRequest) return this.authRequest;
    if (!force && this.globalData.authStatus === "unauthorized") {
      const error = new Error("当前账户未获得访问权限");
      error.code = "UNAUTHORIZED";
      throw error;
    }
    if (!force && this.globalData.authStatus === "error") {
      const error = new Error(this.globalData.authMessage || "权限验证失败，请稍后重试");
      error.code = "AUTH_CHECK_ERROR";
      throw error;
    }

    this.setAuthState("checking", { message:"正在验证访问权限…" });
    this.authRequest = (async () => {
      try {
        this.initializeCloud();
        const user = await userService.login();
        this.setAuthState("authorized", { user });
        return user;
      } catch (error) {
        if (error.code === "UNAUTHORIZED") {
          this.handleUnauthorized(error);
        } else {
          this.setAuthState("error", { message:error.message || "权限验证失败，请稍后重试" });
        }
        throw error;
      } finally {
        this.authRequest = null;
      }
    })();
    this.userReady = this.authRequest;
    return this.authRequest;
  },

  handleUnauthorized() {
    try { wx.removeStorageSync("MINGORY_SALE_CART_V1"); } catch (_) {}
    this.setAuthState("unauthorized", {
      message:"此小程序仅供店内授权人员使用。",
    });
  },
});
