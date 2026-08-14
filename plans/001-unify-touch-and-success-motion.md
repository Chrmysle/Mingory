# 001 — 统一触控反馈与成功状态动效

- **Status**: DONE
- **Commit**: 当前目录不是 Git 仓库
- **Severity**: MEDIUM
- **Category**: Purpose & frequency / Cohesion & tokens
- **Estimated scope**: 4 files，轻量样式与 class 接入

## Problem

改造前全项目没有共享触控反馈或状态动效。按钮点击缺少即时触下响应，而销售、入库、库存调整在提交成功后内容瞬间替换，状态变化略显生硬。高频扫码、列表浏览和数量调整又不适合加入进入或弹跳动画。

## Target

在 `miniprogram/app.wxss` 使用统一参数：按钮触下只执行 `transform: scale(0.98)`，时长 `120ms`，曲线 `cubic-bezier(0.23, 1, 0.32, 1)`；销售、入库、库存调整的偶发成功面板执行 `180ms` 的 `opacity` + `translateY(8rpx)` 进入。所有动画低于 300ms，只改变 transform / opacity，并用 `prefers-reduced-motion` 去除位移。

## Repo conventions to follow

- 全局视觉与动效 token 位于 `miniprogram/app.wxss`。
- `success-enter` 只挂在提交成功后才渲染的面板，不用于列表、扫码、搜索、筛选或数量步进。
- 页面业务 JS 和云函数不参与动效实现。

## Steps

1. 在 `miniprogram/app.wxss:45` 统一按钮尺寸、字重和 `120ms` 按压反馈。
2. 在 `miniprogram/app.wxss:167` 定义 `success-enter`，仅使用 opacity 和 transform。
3. 在 `miniprogram/pages/sale/index.wxml:4`、`stock-in/index.wxml:4`、`stock-adjust/index.wxml:4` 接入偶发成功状态。
4. 在 `miniprogram/app.wxss:182` 添加减少动态媒体查询，取消位移但保留淡入反馈。

## Boundaries

- 不修改云函数、service、销售事务、库存事务或数据库字段。
- 不为扫码、搜索、列表、筛选、数量加减增加入场或转场动画。
- 不增加第三方动效依赖，不使用 `transition: all`、`ease-in` 或 `scale(0)`。

## Verification

- **Mechanical**: 扫描 WXSS，确认不存在 `transition: all`、`ease-in`、`scale(0)` 和布局属性动画；执行 Phase 4–6 测试。
- **Feel check**: 真机点击主要按钮，触下反馈应立即出现且不延迟事件；完成销售、入库和调整后，成功面板应快速淡入并轻微上移；连续扫码、数量加减和切换筛选时不应出现等待动画。
- **Done when**: 动效参数统一、仅服务触控和偶发成功反馈，且业务回归测试全部通过。
