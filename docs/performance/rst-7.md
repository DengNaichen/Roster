# RST-7 — 让远端任务变更自动显示

基于 RST-6 / PR48 的 `ca99a31`，使用同一内存查询缓存，每个登录会话共用一个轮询器。默认 `VITE_REMOTE_REFRESH_MS=15000`，允许 1000–60000 的整数，0 关闭；无效配置在 build 时失败。只校验已挂载的任务、Spec、关联/计数、可访问 Team 及周期详情；下拉目录和不可变 Spec 历史正文不定时读取。隐藏、离线及等待重新登录时停止调度；恢复可见性、焦点、网络时合并为一次补拉，不为同一查询叠加在途请求。

读取沿用用户与 Workspace key、写入等待屏障和取消信号。网络、408/429、5xx 按 15→30→60 秒退避；403/404 仍按正常周期重查，让恢复的权限自动生效，也不拖慢健康资源。所有 GET 新增 30 秒全请求期限（含会话读取和响应体），原有一次读取重试仍保留；失败时保留可用缓存并提示，不能把失败期间计入 30 秒健康链路目标。

ETag 在正常鉴权、业务 SQL 与序列化之后计算；仅成功 GET 可变为 304。用户权限撤销、任务不存在仍返回正常 403/404。客户端校验器绑定实际 query 和已确认数据对象；乐观改动使旧校验器失效。304 节省响应正文，不减少 SQL、函数调用或鉴权。HTTP cache 为 no-store，不把用户正文放进浏览器持久缓存。

已确认 Workspace 拒绝会清除其旧内容。Team 集合缩小时，清除失去权限的正文及不活跃/无法判定归属的缓存；保留无关已挂载任务和 Spec，移除其不再可见的关联行，再校验当前资源。Spec 通过明确的 team 字段判权，不能从 SPEC-编号推断 Team。任务 404 清除自身和日志子资源，同时清理列表、父子/关系及 Spec 图中的引用；本地引用移除是尽力清理；未结构化历史文字及其他复合数据以随后成功的普通读取为准。无法判定归属的已挂载图、历史列表或设置视图可能在权限丢失时清空一次。

当前 work log API 只追加记录。打开的日志面板在 detail 的 `work_log_count` 变化时校验已加载页，切回面板或恢复焦点也会校验；不每 15 秒重读所有历史页。直接数据库修改日志而保持总数不变不保证即时显示，当前方案不扩展为离线复制或变更日志协议。

## 测量方法与结果

独立本地 PostgreSQL / 受限 `roster_preview_runtime`、真实 REST/MCP、ego-lite。没有 mock 数据服务或生产业务写入。50 条长正文任务与 RST-1 的 v2 fixture 一致；业务字段在每轮后恢复，但真实 MCP 写入会追加审计，详情大小自然增长。因此不把跨轮详情字节增长或计时变化当作优化效果。

- 基线 n=1：MCP 返回 200，页面可见在线，30011 ms 内仍未显示变化、没有新 GET。这是超时下界，不是完成延迟。
- 最终 n=5 以 MCP 成功确认到 DOM MutationObserver 匹配计时。每次紧接上一轮显示后写入，接近最坏轮询相位；不是随机到达分布，P95 在 n=5 时就是最大样本。
- 最终四份主报告和补充内容报告都嵌入同一完整源码范围的 `source.runtimeSha256`，由 `remote-report.mjs` 校验后生成 `rst-7-summary.json`。旧初测/评审前报告保留原数据，不改写为最终源码的验收。

| 场景 | 实测结果 |
| --- | --- |
| MCP→详情 DOM | P50/P95 14949/15049 ms，n=5 |
| 32秒无变更 | 6个304，26 SQL，0正文bytes，同查询最大在途1 |
| 隐藏 / 离线 | 32130ms / 17秒，均0请求 |
| 恢复焦点 / 网络 | 222 / 211 ms |
| 网络失败退避 | 重试后 30003.6 ms 才开始下一轮；重新聚焦后 219ms恢复 |
| Team私有化 / 恢复 | 14593 / 14788 ms |
| 成员停用 / 恢复 | 14886 / 14903 ms |
| 测试任务删除后隐藏 | 14594 ms（单次相位样本，不与旧删除计时比较） |

| 同数据交错 API，n=20/组 | 完整200 P50/P95 ms | 条件304 P50/P95 ms | 正文bytes 200→304 | SQL 每次 |
| --- | --- | --- | --- | --- |
| 列表 | 2/2.8 | 2/2.5 | 17363→0 | 3→3 |
| 详情（包含累积审计） | 6.3/9.9 | 5.9/9.5 | 915826→0 | 9→9 |

最终指纹覆盖web/server/backend/contracts源码、Vite配置、依赖锁和全部性能脚本，排除测试与报告。指纹标识采样启动时磁盘上的文件，不包含忽略的.env.worktree等运行环境，也不是进程加载的远程证明；预览端口和默认15秒配置另由本次运行记录与实测周期确认。后端在最终运行前从本worktree重启，所有最终采样期间冻结这些文件。早期只覆盖部分前端的指纹及其结果保留在 `rst-7-pre-ownership/`，不能与最终指纹混称。

正常详情页每轮 **3 GET / 13 SQL**（Team 2、Triage 2、详情9），约 **12 请求 / 52 SQL 每分钟每个可见标签页**，另有首屏、正常 focus 目录刷新和用户操作。未变化时正文为 0 bytes，HTTP headers、往返、鉴权、SQL 和哈希仍有成本。若每轮都变更，则每分钟约传输 4 份完整详情；本测试审计增长使正文达到数百 KB，最终条件比较的详情为915826 bytes；若每轮都返回同等大小正文，约3.66 MB/分钟，之后仍可能随审计增长。实际 bytes 见原始样本。没有测量托管函数调用费用、并发用户或生产大数据负载，不声称 304 降低服务端负载。多个标签页各有自己的缓存和 timer，没有跨标签页协调或抖动。

`conditional.mjs` 在**完全不变的数据**上交错执行完整 GET 与条件 GET（每资源每种20次），逐次断言 ETag 与完整正文相等，304 为空体；相关 API P50/P95、字节及 SQL 见汇总。请求数均为每次1，SQL不变。轮询不会刷新整个页面，也不会清除输入框草稿。

## 真实验收及边界

- MCP 更新打开的详情（可见在线且没有本地待确认写入）：正常鉴权 transport 返回200，五次均在30秒目标内显示。
- 隐藏页期间由页面自身监听 visibilitychange；ego-lite 的任何 Page 调用都会激活目标，故隐藏期间不查询目标页。恢复焦点会有普通目录校验与100ms后任务校验两批，不是同查询重复请求。
- CDP 真正断网与 URL 阻断：离线暂停、错误提示、30秒失败退避和恢复焦点后的补拉实测。60秒上限由时钟测试验证；没有声称实测等待60秒 timer 自动恢复。
- `access.ts` 经正常服务改为私有 Team、停用成员，再恢复；浏览器自动隐藏和恢复正文。原始 status=0 包含权限清理主动取消的旧读取，不能一概说成业务失败。
- 应用没有 deleteIssue 接口。删除验证使用一次性 `perf-deletion-*` 本地 fixture，经服务确认测试所有者可读后，用**受限预览角色**清理该合成任务及审计，再观察真实 GET404 与页面内容消失。它证明前端处理不存在资源，不代表生产删除 API 已验收；没有管理员 SQL 或真实 Workspace 数据修改。
- 真实 MCP 新增日志：打开的日志面板15123ms内显示，切回评论后未发送的草稿仍在；MCP状态改变使任务进入/离开Triage分别14699/15010ms。见 `rst-7-content.json`。
- 补充复现并修复了旧账号迟到写入错误误清新账号缓存：Provider只接收其登记过的完成事件。先失败、修复后通过的回归纳入queryCache测试，失败记录保留为 `rst-7-owner-regression-before.txt`。
- 用户切换、同用户暂时会话失效、卸载清缓存、同任务写序、过期响应、失败回滚、Spec权限丢失与不相关已挂载任务保护由真实组件/QueryClient 回归测试覆盖。测试身份提供器是替身，**不等同真实 OAuth**。本地预览禁用 Sign out；真实 OAuth 首次登录、刷新/撤销、退出登录与新代码的生产 REST/MCP/CORS 链路未验证。

## 复现

在本分支 worktree 按仓库 setup 启动 preview:api / preview:web（本次5255/18548），按 RST-1 的 probe 在独立 `perf-baseline-v2` 建50条 fixture。只使用当前任务的 ego-lite 空间/页面，把下列12/p1替换为实际句柄；不要复用已关闭空间编号。脚本不保存 Token、业务正文或原始 SQL。

```sh
node scripts/performance/remote-refresh.mjs 12 p1 perf-baseline-v2 docs/performance/rst-7-final-after.json 5
node scripts/performance/remote-lifecycle.mjs 12 p1 docs/performance/rst-7-lifecycle.json
node scripts/performance/remote-access.mjs 12 p1 docs/performance/rst-7-access.json
node scripts/performance/conditional.mjs 12 p1 perf-baseline-v2 docs/performance/rst-7-conditional.json
node scripts/performance/remote-content.mjs 12 p1 docs/performance/rst-7-content.json
node scripts/performance/remote-report.mjs docs/performance
```

运行全部场景期间不编辑前端、不操作别的页面。access 脚本从受托管 `.env.worktree` 读取本地配置，并拒绝远端、非 perf-* 或非受限角色。测量是开发预览，不能将本地毫秒值外推为托管网络延迟。

本地 format/check/build、155前端用例、完整后端35测试/6步骤均通过（无数据库用例跳过）；配置999的build按预期拒绝。补充内容脚本初次采样后仅经deno fmt格式化，随后用最终脚本重跑；首轮结果保留为 `rst-7-content-first.json`，不将计时差异说成性能提升。原有大于500KB的chunk提示仍在。Claude Opus交叉评审及修正记录保留在本目录，最终结论随PR提交。

## 发布与回退

本轮只开PR，未合并或部署。构建时设0并发布对应前端可关闭定时轮询并恢复普通focus/reconnect行为，但仍保留缓存与条件读取。后端先发布可让新前端安全取得ETag；旧后端不广告ETag时，新前端不会发送条件header。

回退后端时先移除 conditionalRead，**保留 If-None-Match 的 CORS allowlist**，让已缓存的新前端可成功读到无ETag的200并丢弃校验器；不要先移除CORS而让旧页面陷入预检失败。完整撤销按RST-7→6→5→4→3→2→1的依赖逆序；没有新增数据库迁移。生产验收未完成，因此状态为 In review。
