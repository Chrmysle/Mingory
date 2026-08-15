const accessService = require("../../services/access");
const { formatDateTime } = require("../../utils/date");
const { withAuth } = require("../../utils/auth-page");

Page(withAuth({
  data: { pending:[], members:[], loading:false, error:"" },
  onLoad() { this.reload(); },
  onShow() { if (this.hasShown) this.reload(); this.hasShown = true; },
  onPullDownRefresh() { this.reload().finally(() => wx.stopPullDownRefresh()); },
  async reload() {
    if (this.data.loading) return;
    this.setData({ loading:true, error:"" });
    try {
      const result = await accessService.getAccessManagement();
      this.setData({
        pending:(result.pending || []).map((item) => ({ ...item, approvedName:item.requestedName, createdAtDisplay:formatDateTime(item.createdAt) })),
        members:(result.members || []).map((item) => ({ ...item, initial:String(item.name || "成").slice(0, 1) })),
      });
    } catch (error) { this.setData({ error:error.message || "成员信息加载失败" }); }
    finally { this.setData({ loading:false }); }
  },
  updateName(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ [`pending[${index}].approvedName`]:event.detail.value });
  },
  approve(event) {
    const index = Number(event.currentTarget.dataset.index);
    const item = this.data.pending[index];
    const name = String(item.approvedName || "").trim();
    if (!name) { wx.showToast({ title:"请填写成员姓名", icon:"none" }); return; }
    wx.showModal({
      title:"批准访问申请",
      content:`确认将“${name}”加入成员白名单吗？`,
      success:async ({ confirm }) => {
        if (!confirm) return;
        try {
          wx.showLoading({ title:"正在批准", mask:true });
          await accessService.approveAccessRequest(item.requestId, name);
          wx.showToast({ title:"已加入成员", icon:"success" });
          await this.reload();
        } catch (error) { wx.showToast({ title:error.message || "批准失败", icon:"none" }); }
        finally { wx.hideLoading(); }
      },
    });
  },
  reject(event) {
    const item = this.data.pending[Number(event.currentTarget.dataset.index)];
    wx.showModal({
      title:"拒绝访问申请",
      content:`确定拒绝“${item.requestedName}”的申请吗？`,
      confirmColor:"#C64040",
      success:async ({ confirm }) => {
        if (!confirm) return;
        try {
          wx.showLoading({ title:"正在处理", mask:true });
          await accessService.rejectAccessRequest(item.requestId);
          await this.reload();
        } catch (error) { wx.showToast({ title:error.message || "操作失败", icon:"none" }); }
        finally { wx.hideLoading(); }
      },
    });
  },
}));
