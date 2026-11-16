# RST-6 — 减少读取的数据库往返

按 RST-2 区域选择、RST-3 概要 DTO 和 RST-5 缓存基线，选择较小的合并方案：

- 只读 Workspace 与活跃成员合为一条查询；找不到 Workspace 仍 404，成员无权限仍 403。写入保留先锁 Workspace、再用新语句读取成员的顺序。
- 项目、按名称/ID 排序的标签、权限过滤后的父任务批量读取；对明确无项目/父任务的行只读取标签。缺少引用字段的部分行走完整查询，不将 undefined 当成 null。
- 评论、链接、执行记录、决策、日志数与 PR 聚合为一条 SQL；关系方向用 UNION 去重后一次补充关联数据，消除逐父任务查询。
- 内部活动补充函数只接收当前请求已授权的任务，移除重复读；审计快照与写事务主体不重写。没有索引、数据库迁移、权限提升或长期权限缓存。

READ COMMITTED 下连续语句可能看到不同快照，因此没有把写锁与成员读取合成一条等待锁的连接查询。[PostgreSQL 17 隔离说明](https://www.postgresql.org/docs/17/transaction-iso.html)。JSON 聚合明确保留顺序与空数组，再由原 DTO 做数值和毫秒时间转换。[聚合说明](https://www.postgresql.org/docs/17/functions-aggregate.html)。

## 真实 HTTP / 数据库测量

同一 worktree 数据库、ego-lite、每路径前后各 20 次，热样本 n=19。普通 fixture 有 50 条长正文任务；富关联 fixture 在同样正文上增加项目、每任务两标签、父子、16 条关系、评论、链接、决策、进度及执行记录。始终读取 PERF-1，只写 PERF-50，后者的审计增长不影响详情样本；富关联元数据有单独 SHA256 校验。

| 场景 | SQL 前→后 | JSON bytes 前＝后 | API P50/P95 ms 前→后 |
| --- | --- | ---: | --- |
| 普通列表 | 5→3 | 17363 | 1.7/2.4 → 2.1/4.5 |
| 普通详情 | 20→9 | 14767 | 3.1/3.7 → 3.0/6.0 |
| 普通写入 | 9→8 | 4997 | 2.1/5.0 → 3.0/7.6 |
| 富关联列表 | 6→3 | 28316 | 2.5/3.5 → 2.9/4.2 |
| 富关联详情 | 46→11 | 188672 | 7.5/11.8 → 6.1/9.0 |
| 富关联写入 | 9→8 | 5212 | 3.0/6.0 → 3.6/5.7 |

HTTP 请求数没有改变；减少的是每个请求内的数据库调用。计数不含事务 BEGIN/COMMIT/ROLLBACK，沿用 RST-1 定义。普通路径均为顺序调用；根据代码推导，富详情旧实现包含约 33 个 await 阶段（含三组父任务并发读），新实现 11 个，不能把旧 46 次全部说成串行。REST 详情比核心 getIssue 多两条当前成员读取，用来保留负责人历史。

**不主张所有浏览器本地延迟均改善。** 普通列表/写入的尾延迟在这批数据中上升，短样本和客户端调度不足以区分噪声与真实差别。初版合并的普通列表 P95 2.4→3.2 ms 后，保留 `rst-6-initial-after.json` 并增加无引用快捷路径；没有删除较慢样本或添加猜测性索引。

为分离浏览器/TCP 调度，另在同一受限 PostgreSQL 连接池交错调用旧/新真实 HTTP 业务处理器，每版本/场景 40 次，先各预热 3 次，交替 A/B 与 B/A，逐响应要求正文完全相等，无 mock 或人为延迟：

| 同进程处理器（不含浏览器/TCP） | P50 ms 前→后 | P95 ms 前→后 |
| --- | --- | --- |
| 普通列表 | 1.49→0.95 | 1.84→1.13 |
| 普通详情 | 2.61→1.61 | 3.40→1.99 |
| 富关联列表 | 1.56→1.49 | 1.99→1.89 |
| 富关联详情 | 6.23→4.18 | 7.06→4.80 |

A/B 的 SQL 计数与独立 HTTP 报告一致。它支持本地服务端处理收益，**不能代替浏览器结果或生产链路验收**。富详情稳定响应哈希 `8b14e359…`、列表 `13e2b60b…` 前后相同。SQL-plan 报告保存真实业务语句的 EXPLAIN；新脚本在只读事务中执行计划。小数据集未显示需要新增索引的证据，不把 50 条 fixture 外推为生产大表结论。

## 验证与复现

```sh
node scripts/performance/report.mjs docs/performance/rst-6-before.json docs/performance/rst-6-after.json
node scripts/performance/report.mjs docs/performance/rst-6-rich-before.json docs/performance/rst-6-rich-after.json
# probe.mjs 的富关联模式：preview:true, fixture:'v2-linked', workspace:'perf-joined-v1'
# 仅第一次准备：先 probe seed:true,count:0，再运行 sql-fixture.ts；比较中不要重新准备。
DATABASE_URL=postgresql://roster_preview_runtime@127.0.0.1:55479/roster_wt_b61c362ccf2e_preview node scripts/toolchain.mjs deno run --allow-env --allow-net --allow-write scripts/performance/sql-plan.ts perf-joined-v1 PLAN.json
DATABASE_URL=postgresql://roster_preview_runtime@127.0.0.1:55479/roster_wt_b61c362ccf2e_preview node scripts/toolchain.mjs deno run --allow-env --allow-net --allow-read --allow-write scripts/performance/read-ab.ts ../optimistic-writes-on-cache AB.json
```

预览端口 5205/18498。基线 45ff843，后测在注明的工作树阶段；最终源码还由交错 A/B 与回归检查验证。历史测量不改写为测量时尚不存在的提交 SHA。

- 真实受限 PG：私有 Team、跨 Workspace、停用成员、筛选/分页、标签分组与父任务可见性、审计均通过。新增锁等待后撤权测试观察到实际锁等待，再提交撤权，后续写入 403 且任务不变。SQL 预算列表3/详情9/写入8进入回归断言。
- 快捷路径/完整路径、部分行、混合引用页和多标签输出做真实数据库对比；JSON 与 driver 时间在 Asia/Shanghai 的微秒输入下都输出相同 UTC 毫秒，bigint 转换保持现有 Number 语义（不主张大整数精确度）。
- 真实本地 MCP get_issue 200：6 子任务、6 blocks、4 blocked_by、6 related、两标签及完整活动正确。ego-lite 正确渲染 22 条关联任务、项目、标签和日志计数。见 `rst-6-mcp.json` / `rst-6-browser.json`。
- format/check/build、138 前端用例、完整后端 34 测试/6 步通过，无数据库测试跳过。Claude Opus 复核无阻塞，见 `rst-6-review.md`。

未验证：托管部署后的 SQL/延迟、生产大数据执行计划和新代码的真实 OAuth 链路。本次真实 MCP 为本地固定身份，不等同 OAuth。详情中的关联任务仍保留完整文档，所以富详情载荷未缩小；本票不再改变 DTO。

## 回退

撤销本 PR 即恢复原查询路径，无迁移或索引回滚。保留 RST-2 区域和 CORS、RST-3 DTO、RST-4/5 缓存代码；后续 RST-7 按依赖逆序回退。生产收益仍须正常部署后验收，本轮不合并、不部署。
