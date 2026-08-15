const { submitAccessRequest } = require("../../services/access");

Component({
  properties: {
    status: { type:String, value:"checking" },
    message: { type:String, value:"" },
  },
  data: {
    requestedName:"",
    requestState:"idle",
    requestMessage:"",
  },
  methods: {
    retry() { this.triggerEvent("retry"); },
    onNameInput(event) { this.setData({ requestedName:event.detail.value, requestState:"idle", requestMessage:"" }); },
    async submitRequest() {
      if (this.data.requestState === "submitting") return;
      const name = String(this.data.requestedName || "").trim();
      if (!name) { this.setData({ requestState:"error", requestMessage:"请先输入你的姓名" }); return; }
      this.setData({ requestState:"submitting", requestMessage:"" });
      try {
        const result = await submitAccessRequest(name);
        this.setData({ requestState:"submitted", requestMessage:result.status === "authorized" ? "当前账户已经获得权限，请重新检查" : "申请已提交，请等待店内成员批准" });
      } catch (error) {
        this.setData({ requestState:"error", requestMessage:error.message || "申请提交失败，请稍后重试" });
      }
    },
  },
});
