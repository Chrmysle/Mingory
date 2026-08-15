Component({
  properties: {
    series: { type: Array, value: [], observer() { this.setData({ selected: null }); this.scheduleDraw(); } },
    color: { type: String, value: "#4da3ff", observer() { this.scheduleDraw(); } },
    fillColor: { type: String, value: "rgba(77,163,255,0.12)", observer() { this.scheduleDraw(); } },
    valueType: { type: String, value: "money" },
    emptyText: { type: String, value: "该时间范围暂无数据" },
  },
  data: { ready: false, selected: null },
  lifetimes: {
    ready() {
      this.componentReady = true;
      this.initializeCanvas();
    },
  },
  methods: {
    scheduleDraw() {
      if (!this.componentReady) return;
      clearTimeout(this.drawTimer);
      this.drawTimer = setTimeout(() => this.draw(), 0);
    },
    initializeCanvas() {
      this.createSelectorQuery().select("#chart").fields({ node: true, size: true }).exec((result) => {
        const target = result && result[0];
        if (!target || !target.node || !target.width || !target.height) return;
        this.canvas = target.node;
        this.width = target.width;
        this.height = target.height;
        const pixelRatio = wx.getSystemInfoSync().pixelRatio || 1;
        this.canvas.width = target.width * pixelRatio;
        this.canvas.height = target.height * pixelRatio;
        this.context = this.canvas.getContext("2d");
        this.context.scale(pixelRatio, pixelRatio);
        this.setData({ ready: true });
        this.draw();
      });
    },
    trimNumber(value, decimals) {
      return Number(value).toFixed(decimals).replace(/\.?0+$/, "");
    },
    formatValue(value, compact = false) {
      if (value == null) return "--";
      if (this.properties.valueType === "money") {
        const amount = value / 100;
        if (compact && Math.abs(amount) >= 10000) return `¥${this.trimNumber(amount / 10000, 1)}万`;
        if (compact && Math.abs(amount) >= 1000) return `¥${this.trimNumber(amount / 1000, 1)}千`;
        return `¥${this.trimNumber(amount, 2)}`;
      }
      if (this.properties.valueType === "percent") return `${Number(value).toFixed(1)}%`;
      return `${Math.round(value)}`;
    },
    quantityScale(values) {
      const maximum = Math.max(0, ...values.map((value) => Math.ceil(value)));
      if (maximum === 0) return { min: 0, max: 1, ticks: [1, 0] };
      const rawStep = maximum / 4;
      const magnitude = 10 ** Math.floor(Math.log10(rawStep));
      const normalized = rawStep / magnitude;
      const niceNormalized = normalized <= 1 ? 1 : (normalized <= 2 ? 2 : (normalized <= 5 ? 5 : 10));
      const step = Math.max(1, niceNormalized * magnitude);
      const max = step * Math.ceil(maximum / step);
      const ticks = [];
      for (let value = max; value >= 0; value -= step) ticks.push(value);
      return { min: 0, max, ticks };
    },
    draw() {
      if (!this.context || !this.width || !this.height) return;
      const ctx = this.context;
      const series = (this.properties.series || []).filter((item) => item && Number.isFinite(item.value));
      ctx.clearRect(0, 0, this.width, this.height);
      this.points = [];
      if (!series.length) return;
      const padding = { top: 18, right: 12, bottom: 34, left: 58 };
      const chartWidth = this.width - padding.left - padding.right;
      const chartHeight = this.height - padding.top - padding.bottom;
      const values = series.map((item) => item.value);
      let min;
      let max;
      let ticks;
      if (this.properties.valueType === "quantity") {
        ({ min, max, ticks } = this.quantityScale(values));
      } else {
        min = Math.min(0, ...values);
        max = Math.max(0, ...values);
        if (max === min) max = this.properties.valueType === "money" ? 100 : 1;
        const range = max - min;
        ticks = Array.from({ length: 4 }, (_, index) => max - range * index / 3);
      }
      const range = max - min;

      ctx.font = "10px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 1;
      for (let index = 0; index < ticks.length; index += 1) {
        const ratio = ticks.length === 1 ? 0 : index / (ticks.length - 1);
        const y = padding.top + chartHeight * ratio;
        ctx.strokeStyle = "rgba(127,134,145,0.18)";
        ctx.beginPath(); ctx.moveTo(padding.left, y); ctx.lineTo(this.width - padding.right, y); ctx.stroke();
        ctx.fillStyle = "#7f8691";
        ctx.textAlign = "right";
        ctx.fillText(this.formatValue(ticks[index], true), padding.left - 7, y);
      }

      this.points = series.map((item, index) => ({
        ...item,
        x: padding.left + (series.length === 1 ? chartWidth / 2 : chartWidth * index / (series.length - 1)),
        y: padding.top + (max - item.value) / range * chartHeight,
      }));
      if (this.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(this.points[0].x, padding.top + chartHeight);
        for (const point of this.points) ctx.lineTo(point.x, point.y);
        ctx.lineTo(this.points[this.points.length - 1].x, padding.top + chartHeight);
        ctx.closePath();
        ctx.fillStyle = this.properties.fillColor;
        ctx.fill();
      }
      ctx.strokeStyle = this.properties.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      this.points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      ctx.stroke();
      if (this.points.length === 1) {
        ctx.fillStyle = this.properties.color;
        ctx.beginPath(); ctx.arc(this.points[0].x, this.points[0].y, 3, 0, Math.PI * 2); ctx.fill();
      }

      const labelIndexes = [...new Set([0, Math.floor((series.length - 1) / 2), series.length - 1])];
      ctx.fillStyle = "#7f8691";
      ctx.textBaseline = "alphabetic";
      for (const index of labelIndexes) {
        const point = this.points[index];
        ctx.textAlign = index === 0 ? "left" : (index === series.length - 1 ? "right" : "center");
        ctx.fillText(point.shortLabel || point.label, point.x, this.height - 7);
      }
    },
    selectPoint(event) {
      if (!this.points || !this.points.length) return;
      const touch = event.touches && event.touches[0];
      if (!touch) return;
      const x = Number.isFinite(touch.x) ? touch.x : touch.clientX;
      let nearest = this.points[0];
      for (const point of this.points) if (Math.abs(point.x - x) < Math.abs(nearest.x - x)) nearest = point;
      const tooltipWidth = 148;
      const tooltipLeft = Math.max(4, Math.min(this.width - tooltipWidth - 4, nearest.x - tooltipWidth / 2));
      this.setData({ selected: { label: nearest.label, valueDisplay: this.formatValue(nearest.value), tooltipLeft } });
      this.draw();
      const ctx = this.context;
      ctx.strokeStyle = "rgba(242,244,247,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(nearest.x, 18); ctx.lineTo(nearest.x, this.height - 34); ctx.stroke();
      ctx.fillStyle = this.properties.color;
      ctx.beginPath(); ctx.arc(nearest.x, nearest.y, 4, 0, Math.PI * 2); ctx.fill();
    },
  },
});
