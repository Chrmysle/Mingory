const { getFieldSuggestions } = require("../../services/product");

Component({
  properties: {
    label: String,
    field: String,
    value: String,
    placeholder: String,
    maxlength: { type: Number, value: 100 },
    presets: { type: Array, value: [] },
  },
  data: { suggestions: [], loading: false },
  lifetimes: {
    attached() { this.loadSuggestions(""); },
    detached() { if (this.timer) clearTimeout(this.timer); },
  },
  methods: {
    onInput(e) {
      const value = e.detail.value;
      this.triggerEvent("change", { value });
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.loadSuggestions(value), 250);
    },
    select(e) {
      const value = e.currentTarget.dataset.value;
      this.triggerEvent("change", { value });
      this.loadSuggestions(value);
    },
    async loadSuggestions(keyword) {
      if (!this.properties.field) return;
      const requestId = (this.requestId || 0) + 1;
      this.requestId = requestId;
      this.setData({ loading: true });
      try {
        const remote = await getFieldSuggestions({ field: this.properties.field, keyword, limit: 6 });
        if (requestId !== this.requestId) return;
        const normalizedKeyword = String(keyword || "").trim().toLocaleLowerCase();
        const combined = (remote || []).concat(this.properties.presets).filter((value, index, values) => {
          const text = String(value || "").trim();
          if (!text || (normalizedKeyword && !text.toLocaleLowerCase().includes(normalizedKeyword))) return false;
          return values.findIndex((item) => String(item).trim().toLocaleLowerCase() === text.toLocaleLowerCase()) === index;
        }).slice(0, 8);
        this.setData({ suggestions: combined });
      } catch (_) {
        if (requestId !== this.requestId) return;
        // 建议加载失败不应阻止用户自由输入。
        this.setData({ suggestions: this.properties.presets.slice(0, 8) });
      } finally {
        this.setData({ loading: false });
      }
    },
  },
});
