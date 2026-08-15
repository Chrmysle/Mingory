const COLORS = ["#4da3ff", "#39c58a", "#f0a84b", "#a78bfa", "#ff7f72", "#626975"];

Component({
  properties: {
    items: { type: Array, value: [], observer(items) { this.updateGradient(items); } },
    centerLabel: { type: String, value: "总销售额" },
    centerValue: { type: String, value: "¥0.00" },
  },
  data: { gradient: "conic-gradient(#2a2f37 0% 100%)", selected: null },
  lifetimes: {
    ready() { this.updateGradient(this.properties.items); },
  },
  methods: {
    updateGradient(source) {
      const items = (Array.isArray(source) ? source : []).filter((item) => item && Number.isFinite(item.value) && item.value > 0);
      const total = items.reduce((sum, item) => sum + item.value, 0);
      this.segments = [];
      if (!total) return this.setData({ gradient: "conic-gradient(#2a2f37 0% 100%)", selected: null });
      let start = 0;
      const stops = items.map((item, index) => {
        const end = start + item.value * 100 / total;
        const color = item.color || COLORS[index % COLORS.length];
        const segment = `${color} ${start.toFixed(4)}% ${end.toFixed(4)}%`;
        this.segments.push({ ...item, start, end });
        start = end;
        return segment;
      });
      this.setData({ gradient: `conic-gradient(from -90deg, ${stops.join(", ")})`, selected: null });
    },
    selectSegment(event) {
      const touch = event.touches && event.touches[0];
      if (!touch || !this.segments || !this.segments.length) return;
      this.createSelectorQuery().select(".donut-ring").boundingClientRect((rect) => {
        if (!rect || !rect.width || !rect.height) return;
        const x = touch.clientX - rect.left - rect.width / 2;
        const y = touch.clientY - rect.top - rect.height / 2;
        const distance = Math.sqrt(x * x + y * y);
        if (distance < rect.width * 0.32 || distance > rect.width / 2) return;
        let progress = (Math.atan2(y, x) + Math.PI / 2) / (Math.PI * 2) * 100;
        if (progress < 0) progress += 100;
        const selected = this.segments.find((item) => progress >= item.start && progress < item.end);
        if (selected) this.setData({ selected: { label: selected.label, display: selected.display, shareDisplay: selected.shareDisplay } });
      }).exec();
    },
  },
});
