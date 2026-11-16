# RST-4 — 跨页面共享查询缓存

TanStack Query 5.107.1 的内存 QueryClient 放在 AuthBoundary 内、导航重挂载边界外。用户、Workspace、资源和规范化筛选参数共同组成 key；30 秒 freshness、5 分钟非活跃回收。列表、详情、通用资源和分页工作日志读取统一使用 Query，删除旧读取队列。详情链接在 150 ms 指针停留或键盘 focus 时预取。后台刷新保留内容，失败/离线提示可见；403/404 清除被拒绝资源，Workspace 403 清除同范围内容并保留错误状态。临时登录失效保留草稿；真正卸载或更换用户清空旧 client。

写入队列共享到用户/Workspace/实体，保留取消未发送写入与过期回调保护。写入前取消旧读，写入结束后恢复活跃的过期读，避免永久 loading。已发写入在导航后继续等待结果；精确资源的未确认缓存会重置，确认结果再使当前视图校验。HTTP 写入有 30 秒超时且不自动重试；超时可能是确认丢失，不能假定服务端没有提交。当前阶段仍按 Workspace 标记过期，RST-5 负责定向更新与统一乐观层。

## 相同场景测量

同一个本地预览数据库、50 条 fixture、同一个 ego-lite 页面、相同 PERF-50 详情数据，前后各 20 次往返。原始文件 `rst-4-ui-before.json` / `rst-4-ui-after.json`；热样本分别去除第一对，n=19。

| 指标 | 前 | 后 |
| --- | ---: | ---: |
| 列表→详情 DOM P50/P95 ms | 57.2 / 126.4 | 12.1 / 15.7 |
| 详情→列表 DOM P50/P95 ms | 79.9 / 87.3 | 36.1 / 51.3 |
| 列表→详情请求 P50 | 11 | 0 |
| 详情→列表请求 P50 | 9 | 0 |
| 20 对往返记录请求总数 | 406 | 5 |

**测量边界：**这是 Vite 开发预览，包含 StrictMode 双 effect 的请求，不能将 406→5 直接当作生产请求节省。匹配条件是详情标题/列表行出现，不是所有属性选择器完成加载；请求窗口从 arm 到可见，包含输入前 hover 请求。前测两帧回调大量受约 1 秒调度影响，后测恢复正常，因此不报告 `ms` 为 paint 收益，也不将全部 DOM 差异归因于缓存。确定性证据是热访问复用内容、不发业务请求，去重也有真实 QueryClient 用例验证。

API probe 绕过网页 Query，每端 60 次成功请求。前/后列表 P50/P95 为 3.5/351.8 → 1.9/5.6 ms，详情 5.3/1199.3 → 3.1/3.8 ms，写入 4.5/50.4 → 2.1/3.3 ms。前测有明显浏览器调度噪声；后端没有修改，**这些延迟变化不作为本 PR 的 API 优化证据**。SQL 次数维持 5/20/9；字节维持 17363/14767/4997。API 原始报告保存全部样本，没有删除慢样本。

首个 after 测量完成后，补充了独立审阅发现的写入/取消边界修复。最终代码另跑 `rst-4-ui-regression.json`；此时 API probe 已增加 PERF-50 审计记录，因此该文件只作为最终回归，不与冻结的前测混作同数据对比。所有 revision 是报告中注明的工作树阶段，不伪装为测量时已存在的提交 SHA。

## 验证与复现

```sh
node scripts/performance/ui-report.mjs docs/performance/rst-4-ui-before.json docs/performance/rst-4-ui-after.json
node scripts/performance/report.mjs docs/performance/rst-4-api-before.json docs/performance/rst-4-api-after.json
node scripts/performance/roundtrip.mjs SPACE p1 perf-baseline-v2 OUTPUT.json 20 PERF-50
```

当前预览前端/API 为 5275/18568；API probe 用法见 README.md。浏览器仅操作独立测试 Workspace。

- ego-lite 真实网络离线：CDP 禁网后点击已访问详情，仍显示正确标题和离线提示，恢复网络后保留内容，见 `rst-4-offline.json`。
- 现有写入/筛选竞态、快速勾选、草稿恢复与权限用例保持通过；新增共享在途去重/热 remount、后台旧响应、权限清理、用户与 Workspace 隔离、离线重连、StrictMode、取消初始读取恢复、跨视图实体排序和未确认编辑卸载用例。
- 本地完整数据库测试 34 个/6 步通过，没有跳过；check/build 通过。119 个前端用例通过。
- Claude Opus 独立审阅指出取消后读取未恢复与无限写入等待，均已修复并补回归；最终复核无阻塞，见 rst-4-review.md。

未验证：新缓存代码尚未部署，真实 OAuth 重新登录/退出、跨用户浏览器链路和托管 MCP 到新网页没有完成验收。权限变化的前端状态用例与真实 PostgreSQL 权限测试分别通过，不能合称真实 OAuth 端到端通过。离线时无法获知服务端刚发生的权限撤销；已知拒绝会清除缓存，未知撤销在重新联网校验后处理。

## 风险与回退

撤销本 PR 恢复各页面独立读取，无数据库迁移或持久缓存。RQ 增加客户端依赖，已有 bundle 超 500 kB 的提示仍存在。此 PR 不提供离线写入队列。RST-5 会处理跨列表/详情乐观一致性、定向失效和写入主体绑定；RST-7 添加轻量远端校验。后续依赖 PR 需要一同回退或先移除对 Query 的调用。
