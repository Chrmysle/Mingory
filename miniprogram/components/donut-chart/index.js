const COLORS = ["#4da3ff", "#39c58a", "#f0a84b", "#a78bfa", "#ff7f72", "#626975"];

Component({
  properties: {
    items: { type: Array, value: [], observer() { this.setData({ selected: null }); this.scheduleDraw(); } },
    centerLabel: { type: String, value: "总销售额" },
    centerValue: { type: String, value: "¥0.00" },
  },
  data: { selected: null },
  lifetimes: {
    ready() { this.componentReady = true; this.initializeCanvas(); },
  },
  methods: {
    scheduleDraw() { if (this.componentReady) { clearTimeout(this.drawTimer); this.drawTimer = setTimeout(() => this.draw(), 0); } },
    initializeCanvas() {
      this.createSelectorQuery().select("#donut").fields({ node: true, size: true }).exec((result) => {
        const target = result && result[0];
        if (!target || !target.node) return;
        this.canvas = target.node;
        this.width = target.width;
        this.height = target.height;
        const pixelRatio = wx.getSystemInfoSync().pixelRatio || 1;
        this.canvas.width = target.width * pixelRatio;
        this.canvas.height = target.height * pixelRatio;
        this.context = this.canvas.getContext("2d");
        this.context.scale(pixelRatio, pixelRatio);
        this.draw();
      });
    },
    draw() {
      if (!this.context) return;
      const ctx = this.context;
      const items = (this.properties.items || []).filter((item) => item.value > 0);
      const total = items.reduce((sum, item) => sum + item.value, 0);
      ctx.clearRect(0, 0, this.width, this.height);
      this.segments = [];
      const centerX = this.width / 2;
      const centerY = this.height / 2;
      const radius = Math.min(this.width, this.height) * 0.43;
      ctx.lineWidth = Math.max(16, radius * 0.28);
      if (!total) {
        ctx.strokeStyle = "#2a2f37";
        ctx.beginPath(); ctx.arc(centerX, centerY, radius, 0, Math.PI * 2); ctx.stroke();
        return;
      }
      let start = -Math.PI / 2;
      items.forEach((item, index) => {
        const end = start + Math.PI * 2 * item.value / total;
        ctx.strokeStyle = item.color || COLORS[index % COLORS.length];
        ctx.beginPath(); ctx.arc(centerX, centerY, radius, start, end); ctx.stroke();
        this.segments.push({ ...item, start, end, color: ctx.strokeStyle });
        start = end;
      });
    },
    selectSegment(event) {
      if (!this.segments || !this.segments.length) return;
      const touch = event.touches && event.touches[0];
      if (!touch) return;
      const x = (Number.isFinite(touch.x) ? touch.x : touch.clientX) - this.width / 2;
      const y = (Number.isFinite(touch.y) ? touch.y : touch.clientY) - this.height / 2;
      let angle = Math.atan2(y, x);
      if (angle < -Math.PI / 2) angle += Math.PI * 2;
      const segment = this.segments.find((item) => angle >= item.start && angle < item.end);
      if (segment) this.setData({ selected: { label: segment.label, display: segment.display, shareDisplay: segment.shareDisplay } });
    },
  },
});
