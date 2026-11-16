# RST-1 — 真实业务基线与回归门槛

本 PR 建立测量入口，不包含生产优化或部署。使用独立合成测试 Workspace，经正常用户权限调用真实业务 REST/MCP；本地预览的数据与正式 `roster` 开发任务分开。

环境、身份、版本、网络与样本约束见 [environment.md](environment.md)，操作入口见 [README.md](README.md)。API 原始样本为 `rst-1-hosted.json` 与 `rst-1-local.json`。每种 API 20 个样本，首个单列、热样本 19 个，P95 为 nearest-rank；这个样本量的尾部估计较粗，不把单批次差异解释为稳定 SLA。


| 托管 API（热样本 n=19） | P50 ms | P95 ms | JSON bytes |
| --- | ---: | ---: | ---: |
| 列表 | 2866.3 | 7204.2 | 499805 |
| 详情 | 4839.6 | 9136.9 | 14767 |
| 写入 | 3166.7 | 5412.6 | 4997 |

## 已验证的现状

- 真登录 REST 的列表、详情、写入都返回成功业务结果；无登录 401 不计入结果。有一批复测遇到 401，整批作废。应用正常恢复会话后重跑，脚本逐请求使用当前同用户会话，不自动重试写入。
- 相同的 50 条长正文 fixture：列表 JSON 为 **499805 bytes**，`items` 与 `issues` 完全相同。单份数组 249883 bytes，其中正文共 231950 bytes。这是未压缩 JSON 体积，非线上压缩传输字节。[复现](../../scripts/performance/payload.mjs)：`node scripts/performance/payload.mjs http://127.0.0.1:18553 perf-baseline-v2 docs/performance/rst-1-payload.json`。
- 独立本地 PostgreSQL 17：列表/详情/写入分别执行 **5 / 20 / 9** 次应用 SQL。含失败语句，不含 BEGIN/COMMIT/ROLLBACK；事务内连接获取与提交耗时不计入 SQL milliseconds。托管端未部署诊断，因此这些 SQL 数字不冒充托管实测。
- 浏览器 schema-2 本地往返记录：首次详情 356.9 ms / 11 个启动的 GET，返回列表 78.2 ms / 9 GET，重复详情 48.4 ms / 11 GET。Vite 开发模式含 StrictMode，不直接与生产页面请求数比较。请求记录含开始/完成偏移、可见时仍在途数量。旧版 UI 观测仅为探索值，不证明缓存或乐观更新已经达标。
- 本地真实 MCP 更新 `perf-baseline-v2/PERF-50` 的状态，返回 200；之后 REST 对同一任务读回确认 `todo`。已打开的页面在 **30006 ms** 观察窗口仍未显示它；这是下界，不是更新成功的耗时。见 `rst-1-mcp-local.json`。本地固定预览身份不等于托管 OAuth 全链路。
- 托管真实登录 JWT 调用 MCP 的 update_issue 也返回 200（5321.8 ms），可见且在线的页面在确认后 30021 ms 内未显示变化；见 `rst-1-mcp-hosted.json`。后续组合 REST 核验超出浏览器执行限时，未保留返回验证，明确不据此宣称该额外核验通过。
- 两个实际成功业务响应的 CDP 元数据显示 `ap-northeast-1`。fetch 因 CORS 无法读取区域头，样本保留 null；不把这两次观察泛化到全部请求。实际区域取舍在 RST-2 对比后决定。

## 后续验收预算

这些是基于秒级托管读取、重复 GET 和 30 秒远端不刷新的测量设定的**目标**，不是本 PR 已实现的结果。

| 路径 | 回归目标与测法 |
| --- | --- |
| 首屏 | 同网络/数据/构建下，优化后比基线减少至少 30%；暂定 3 秒，若实测不支持则记录网络/区域约束并调整 |
| 热列表/详情往返 | 已缓存内容事件到 DOM 匹配 P95 ≤ 200 ms，且不等待业务 GET 完成；新数据后台校验不清空内容 |
| 状态/优先级反馈 | 事件到 DOM 匹配 P95 ≤ 100 ms，发生在写入确认之前；失败可恢复、同任务顺序不被旧结果覆盖 |
| 远端写入可见 | 可见且在线页面，从 MCP 成功确认到 DOM 匹配 ≤ 30 秒；无并发刷新堆积，隐藏页停止轮询，失败退避 |
| API/数据库 | 同 fixture、身份、区域比较 P50/P95、大小、SQL 数量与 driver 耗时；区域比较明确唯一改变的区域策略 |

字段、用户/Workspace、私有 Team、成员停用、过滤/分页、旧响应与失败恢复是功能门槛；不能用速度收益抵消权限回归。仅内存共享缓存和轻量刷新，不做完整离线同步。

## 复现与限制

`node scripts/performance/report.mjs docs/performance/rst-1-local.json` 打印指标；传入 before/after 两份报告进行比较，区域实验显式加 `--allow-region-change`。不要混合本地和托管结果。不同环境的用户显示名、审计时间文本会使详情体积略有不同（当前 4 bytes）；跨环境绝对体积不作优化前后对比。

后端诊断开关默认关闭，仅本地预览启用。成功非流式请求输出汇总 header；错误/SSE 不输出，避免泄露权限侧信道或发布未完成的流式 SQL 计数。真实 OAuth 首次授权、刷新/撤销、Edge 冷启动与区域故障、生产诊断部署均未作为完整链路验收；未获得指标一律 null。现有真实登录 REST 与 roster-self 已授权 MCP 调用成功，只证明此次访问成功。

## 验证与回退

- `node scripts/toolchain.mjs format:write`、`check`、`build` 通过；构建仍有既有 bundle >500 kB 提示。
- 前端测试：16 文件、99 测试通过。
- 独立本地 PostgreSQL 17 的完整后端 suite：34 项测试、6 个步骤通过，无数据库跳过。
- `ego-lite` 实际页面、真实 REST 和本地 MCP 证据在相邻 JSON；合成 fixture 外未做业务数据写入。
- 回退：撤销本 PR；或保持 `ROSTER_PERFORMANCE` 关闭。无 schema 迁移、付费资源或生产配置变更。

交叉审查：Claude Opus 只读审查了测量实现与证据。已修复 SSE 过早计数、错误响应诊断、请求归属、fixture 校验和元数据遗漏。仍需注意小样本 P95、开发模式 UI 与托管诊断不可见等上列限制。

## 可重复页面往返批次

以下为同一开发构建中 20 轮的输入事件到 DOM 匹配耗时，原始值含请求开始/完成偏移和 paint 时间：`rst-1-roundtrip-local.json`。

| 路径 | n | P50 ms | P95 ms | 每轮启动的请求 |
| --- | ---: | ---: | ---: | ---: |
| list-to-detail | 20 | 50.5 | 65.4 | 11 |
| detail-to-list | 20 | 72.1 | 83.9 | 9 |

复现：`node scripts/performance/roundtrip.mjs SPACE_ID PAGE_LABEL perf-baseline-v2 docs/performance/roundtrip.json 20`。同一 TaskSpace 的页面测量必须串行，测量期间保持被测页可见。
