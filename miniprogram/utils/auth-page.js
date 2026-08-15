function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function withAuth(definition) {
  const originalData = clone(definition.data);
  const originalLoad = definition.onLoad;
  const originalShow = definition.onShow;
  const originalPullDownRefresh = definition.onPullDownRefresh;

  return {
    ...definition,
    data: {
      ...originalData,
      authStatus:"checking",
      authMessage:"正在验证访问权限…",
      authUser:null,
    },

    applyAuthorizationState({ status, user, message }) {
      const authData = { authStatus:status, authMessage:message || "", authUser:user || null };
      if (status === "authorized") this.setData(authData);
      else {
        this.authPageLoaded = false;
        this.setData({ ...clone(originalData), ...authData });
      }
    },

    async authorizePage(force = false) {
      const app = getApp();
      this.applyAuthorizationState({
        status:app.globalData.authStatus || "checking",
        user:app.globalData.currentUser,
        message:app.globalData.authMessage,
      });
      try {
        const user = await app.ensureAuthorized({ force });
        this.applyAuthorizationState({ status:"authorized", user, message:"" });
        if (typeof wx !== "undefined" && typeof wx.showTabBar === "function") wx.showTabBar({ animation:false, fail() {} });
        return true;
      } catch (_) {
        this.applyAuthorizationState({
          status:app.globalData.authStatus || "error",
          user:null,
          message:app.globalData.authMessage || "权限验证失败，请稍后重试",
        });
        if (typeof wx !== "undefined" && typeof wx.hideTabBar === "function") wx.hideTabBar({ animation:false, fail() {} });
        return false;
      }
    },

    onLoad(options = {}) {
      this.authPageOptions = options;
      this.authPageLoaded = false;
      this.authLoadTask = this.authorizePage(false).then((authorized) => {
        if (!authorized) return false;
        if (typeof originalLoad === "function") originalLoad.call(this, options);
        this.authPageLoaded = true;
        return true;
      });
    },

    async onShow() {
      if (this.authLoadTask) await this.authLoadTask;
      const authorized = await this.authorizePage(false);
      if (!authorized) return;
      if (!this.authPageLoaded) {
        if (typeof originalLoad === "function") originalLoad.call(this, this.authPageOptions || {});
        this.authPageLoaded = true;
      }
      if (typeof originalShow === "function") originalShow.call(this);
    },

    async onPullDownRefresh() {
      const authorized = await this.authorizePage(false);
      if (authorized && typeof originalPullDownRefresh === "function") return originalPullDownRefresh.call(this);
      wx.stopPullDownRefresh();
    },

    async retryAuthorization() {
      const authorized = await this.authorizePage(true);
      if (!authorized) return;
      if (!this.authPageLoaded) {
        if (typeof originalLoad === "function") originalLoad.call(this, this.authPageOptions || {});
        this.authPageLoaded = true;
      }
      if (typeof originalShow === "function") originalShow.call(this);
    },
  };
}

module.exports = { withAuth };
