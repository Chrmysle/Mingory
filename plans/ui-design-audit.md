# 微信小程序 UI / UX 审计与实施基线

本审计以现有业务逻辑为边界，依据 `emil-design-eng`、`apple-design`、`review-animations`、`improve-animations`、`find-animation-opportunities` 与 `animation-vocabulary` 的原则，将网页端设计语言转换为微信小程序原生 WXML / WXSS 实现。所有高频销售、扫码、库存操作优先响应速度和可预测性，不引入第三方 UI 或动效库。

## 问题与实施计划

| 优先级 | 页面 / 文件 | 当前问题 | 实施修复 | 原因 | 对应原则 |
| --- | --- | --- | --- | --- | --- |
| P0 | `miniprogram/app.wxss` | 仅有最小 reset；颜色、间距、圆角、控件状态在各页重复且不一致 | 建立全局颜色、排版、间距、圆角、按钮、输入框、状态和动效 token；统一 88–96rpx 触控高度 | 先形成稳定设计语言，降低页面漂移和维护成本 | Apple：一致性、层级；Emil：tokens、cohesion |
| P0 | 首页 `pages/index` | “身份验证成功”占据主视觉；全部入口纵向堆叠，扫码销售不够突出；经营数据嵌套卡片较多 | 登录成功后弱化技术状态，突出今日经营与两项高频扫码；次级功能使用清晰双列入口 | 父母应一眼看到今天经营情况并快速完成销售 | Apple：响应、熟悉、清晰层级；Emil：频率决定设计权重 |
| P0 | 销售 `pages/sale` | 关键数量、金额和库存虽完整，但确认区层次松散；成功反馈缺少明确完成标记 | 强化商品/库存上下文、数量步进与成交总额；确认按钮保持大热区；成功态使用简短明确反馈 | 销售是最高频和最高风险操作，应减少误触和二次确认成本 | Apple：即时反馈、可预测性；Emil：高频操作不延迟 |
| P0 | 新增/编辑 `pages/product-create`、`product-edit` | 每个字段都单独成为卡片，页面碎片化；必填标识、规格区与快捷操作层级不够统一 | 将公共信息、规格、补充信息按 section 分组；统一字段标签、帮助文字、输入高度和底部主操作 | 长表单需要分组和节奏，而不是卡片套卡片 | Apple：grouping、wayfinding；Emil：simplicity not minimalism |
| P0 | 全局错误/加载/空态 | 文案位置、颜色和留白各页不同，部分错误缺少可扫描结构 | 用统一状态容器和语义色；保留现有业务文案，不把空数据当异常 | 用户能迅速判断“等待、没有数据、操作失败” | Apple：feedback；Emil：state indication |
| P1 | 商品列表 `pages/product-list` | 商品名、规格、价格、库存权重接近；无条目间明确扫描节奏 | 价格和库存形成右侧关键数据，规格/位置降级；列表保持单层 surface + 分隔 | 列表阅读应从名称快速落到价格和库存 | Apple：hierarchy；Emil：清晰度优先 |
| P1 | 搜索 `pages/product-search` | 扫码与搜索抢占同级整行空间；搜索结果信息横向拥挤 | 搜索框作为主任务，扫码为紧邻快捷操作；结果匹配原因明确但视觉克制 | 搜索页面应围绕一次输入和结果判断 | Apple：focus；Emil：频繁交互少动画 |
| P1 | 商品详情 `pages/product-detail` | Variant 内建议价和四个操作按钮密集；商品公共信息优先级偏高 | 商品名/售价/库存优先；规格操作分主次；成本及 20/25/30% 建议价保持清晰；扫码命中规格轻量高亮 | 详情页要支持“看、卖、入库、调整”决策 | Apple：progressive disclosure；Emil：visual hierarchy |
| P1 | 入库/调整 `pages/stock-in`、`stock-adjust` | 表单视觉接近但各自重复；调整方式色彩语义过重 | 统一 operation 页面骨架；突出“当前 → 操作后”；减少操作类型切换的装饰 | 库存操作必须让变化结果在提交前可见 | Apple：error prevention；Emil：state indication |
| P1 | 销售记录/详情 `pages/sales`、`sale-detail` | 五个筛选按钮过窄；卡片信息密度和详情区块节奏不统一 | 筛选改为可扫描 segmented row；销售额与毛利润形成层级；详情使用分组行 | 父母能按日期快速查账，并清楚区分销售额和毛利润 | Apple：legibility、predictability |
| P1 | 经营统计 `pages/business-statistics` | 指标被拆成多个同等卡片，主次虽有但视觉语言与首页不同 | 与首页共用经营指标语言；营业额为主，成本/利润/数量/笔数为次 | 同一指标跨页面应有一致心智模型 | Apple：consistency；Emil：cohesion |
| P2 | 库存流水 `pages/inventory-logs` | 每条流水都使用独立卡片，长列表视觉噪声偏大 | 改为单层列表与分隔线，强化变化量和前后库存 | 查账场景需要高密度但可扫读 | Apple：information density；Emil：avoid unnecessary containers |
| P2 | `components/suggestion-input` | 建议标签可用但输入/标签风格孤立，标签最多 12 个偏多 | 统一输入控件与标签 token；默认少量展示，点击热区不少于 60rpx | 建议是辅助而不是抢占表单 | Apple：restraint；Emil：frequency and purpose |
| P2 | 页面 WXSS | 大量单行压缩 CSS、重复硬编码颜色与圆角 | 格式化并引用全局 token，页面只保留布局差异 | 提升长期一致性和可维护性 | Emil：shared motion/design tokens |
| P2 | 成功态 `sale/stock-in/stock-adjust` | 状态切换完全瞬时，偶发完成动作反馈略生硬 | 仅对成功面板增加 180ms ease-out 的 opacity + 轻微 translate；支持 reduced motion | 这是偶发、明确的提交完成反馈，动效有合理目的 | Review：occasional feedback；transform/opacity only |
| P3 | 图片选择与预览 | 只有基础选择/重传，没有裁剪或删除操作 | 本轮仅统一视觉，不扩展图片业务能力 | 不因 UI 改造扩大产品范围 | Scope restraint |
| P3 | 自定义日期选择 | 原生 picker 功能正确但视觉表达有限 | 本轮保留原生控件，只统一容器与按钮 | 原生交互更熟悉、可靠 | Apple：platform conventions |

## 动效机会与明确拒绝项

采用的动效词汇：`press feedback`、`enter`、`state transition`。

| 决定 | 位置 | 方案 | 理由 |
| --- | --- | --- | --- |
| 采用 | 所有主要按钮与可点击列表项 | 触下 `scale(0.98)`，120ms，强 ease-out；禁用态不缩放 | 即时触控确认，不延迟业务动作 |
| 采用 | 销售、入库、调整成功态 | 180ms opacity + `translateY(8rpx)` enter；减少动态时只保留淡入 | 偶发提交反馈，避免内容瞬移 |
| 采用 | 扫码命中的规格 | 静态语义高亮，不循环、不闪烁 | 状态指示比装饰动画更有效 |
| 拒绝 | 首页、列表逐项入场 | 无 stagger / 无逐项动画 | 首页和列表每日高频访问，动画会拖慢扫读 |
| 拒绝 | 扫码、搜索、销售跳转 | 不增加转场等待 | 高频路径必须立即响应 |
| 拒绝 | 数量加减、筛选切换 | 不做弹跳或滑块动画，仅保留按压反馈与即时状态更新 | 一天可能操作几十次，动效收益低于延迟感 |
| 拒绝 | 装饰性渐变、漂浮背景、玻璃模糊 | 不实现 | 与家庭日杂店克制、可靠的产品气质不符 |

## 动效参数

- `--motion-fast: 120ms`
- `--motion-enter: 180ms`
- `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`
- `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`
- 仅允许 `transform` 与 `opacity` 参与动效；禁止 `transition: all` 和 `ease-in`。
- 微信小程序 WXSS 支持情况允许时使用 `@media (prefers-reduced-motion: reduce)`，去除位移动效、保留必要的透明度反馈。

## 实施边界

- 不修改云函数接口、数据库模型、商品/销售/库存/统计业务规则。
- 不引入 npm UI 框架、动画库、渐变、玻璃拟态或复杂自绘图标。
- 不新增 Phase 6 之后的业务能力。
- 页面结构调整只服务于信息层级、触控热区和状态表达；JS 仅在确有必要时补充纯展示状态。

## 最终动效复审

| Before | After | Why |
| --- | --- | --- |
| 可点击控件没有统一触下反馈 | 按钮与主要列表项使用 120ms、`scale(0.98)`、强 ease-out 的 press feedback | 即时确认触控已被接收，不阻塞点击事件 |
| 销售、入库、调整成功后内容直接瞬时替换 | 仅成功面板使用 180ms opacity + `translateY(8rpx)` enter | 偶发提交反馈适合轻量动效，帮助识别状态完成 |
| 连续录入保存后以 200ms 滚动到顶部 | 改为 0ms 立即定位 | 连续录入属于高频效率路径，不应等待装饰动画 |
| 没有减少动态处理 | `prefers-reduced-motion` 下取消位移与缩放，仅保留 120ms 淡入/透明度反馈 | 保持可理解反馈，同时尊重减少动态偏好 |
| 建议值最多同时出现 12 个 | 默认收敛到 8 个，仍可输入关键词查找其他历史值 | 快捷建议辅助输入，不抢占长表单视觉焦点 |

审查结论：**Approve**。现有动效均有状态反馈目的，UI 动效不超过 180ms，只使用 transform / opacity；未发现 `transition: all`、`ease-in`、`scale(0)`、布局属性动画或高频路径入场动画。
