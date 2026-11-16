# RST-5 — 乐观属性写入与定向缓存更新

状态与优先级由同一个按用户、Workspace、任务隔离的 mutation 流程处理。待确认补丁立即覆盖列表/详情，成功用返回属性合并，失败只回滚该操作涉及的字段，再叠加后续补丁；每个任务与旧编辑器/评论/标签写入共用队列。拒绝的前驱不会阻塞后续写入，已发送操作在导航后仍确认或回滚，未发送操作随发起页面销毁取消。界面显示 Saving，仍允许连续编辑。

属性写入只更新相关任务、集合、Triage/周期计数；Spec 进度经服务端定向校验。分页、排序边界、不能判断的筛选保留重新读取。合并不刷新旧集合的 freshness，也不清掉其他写入或被取消 focus 读取留下的失效标记。详情仅合并属性与更新时间，保留未确认的正文/勾选。每次写入绑定原用户，身份变化或 30 秒确认超时不重试，不提供离线写队列。

## 实测

相同本地 Workspace `perf-baseline-v2`、50 条 fixture、PERF-50 详情控件、ego-lite 同浏览器，Chrome 模拟 300 ms 网络延迟。每个字段前后各 20 次交替操作，逐次正常 API readback 确认保存；测量外恢复原属性。热样本 n=19，nearest-rank P95。写入必然增加审计记录，但本次属性响应不含审计，fixture 正文与属性起点一致；读取 API 基线固定 PERF-1，避免审计增长改变详情样本。

| 详情属性指标 | 优先级：前 → 后 | 状态：前 → 后 |
| --- | --- | --- |
| DOM 反馈 P50/P95 ms | 326.1/328.1 → 4.0/4.6 | 322.5/332.4 → 3.8/4.3 |
| PATCH 响应 P50/P95 ms | 321.9/323.8 → 314.4/316.2 | 318.7/328.0 → 312.7/316.7 |
| 每操作请求 P50/P95 | 7/7 → 1/1 | 7/7 → 1/1 |
| 每操作 SQL 总数 P50/P95 | 34/34 → 9/9 | 34/34 → 9/9 |
| 每操作 JSON bytes P50 | 6238 → 4997 | 6238 → 4997 |

前后 4 个文件共 80 次成功属性操作。请求从各 140→20：去除每次成功后的 6 个重读，SQL 总数下降来自减少请求，**单次 PATCH 仍为 9 条 SQL**。3–5 ms 是乐观反馈，不是保存成功；确认仍需约一个网络往返，几毫秒差异不作为 API 加速证据。此数字只覆盖详情状态/优先级成功路径，不覆盖评论、勾选、日志等仍需校验相关列表的写入，不推断托管延迟。

普通 API probe（无额外网络延迟），各 60 次：列表 P50/P95 1.9/3.4 → 1.9/2.9 ms，详情 3.8/4.5 → 3.3/3.9，写入 2.2/3.0 → 2.3/4.7。每请求 SQL 5/20/9、字节 17363/14767/4997 不变；后端未改，不主张服务器延迟改善。

前后原始文件为 `rst-5-{priority,status}-{before,after}.json`。after 记录运行时与脚本 SHA256，可通过 `source.mjs` 复算；它们对应 rebase 前同一工作树（后来提交为 87e5e77），不伪称测量时已有最终 SHA。按用户要求对齐最新 main 后，另保存 `rst-5-{priority,status}-rebased.json`：每字段 10 次，仍分别仅 10 个 PATCH，来源为 abd8df8。历史对比和新基线回归分开保留。

## 真实验证与边界

- ego-lite：发起属性写入后立即切换搜索条件，只显示新筛选的 PERF-49；切回 PERF-50 及打开详情保留确认的 High。移入/移出 Triage 时行和侧栏计数一致。最后恢复 Todo/Medium。见 `rst-5-browser.json`。
- 真实浏览器请求阻断：PATCH 报网络失败，界面回到最近确认的 Medium、清除 pending 并显示错误；正常 API readback 确认没有写入，解除阻断后经 UI 保存与恢复均成功。见 `rst-5-network-failure.json`。这是浏览器网络失败，不是伪造 HTTP 500。
- 独立 `perf-access` Workspace：用受限 `roster_preview_runtime` 角色，通过正常应用 service 邀请成员、由第二个有权限的测试管理员停用/恢复浏览器成员；没有管理员 SQL。实际网页 PATCH 返回 403，已缓存私有标题消失；恢复成员并重载后正确显示原值。见 `rst-5-permission.json`、`access.ts`。初次尝试由 focus 校验先发现拒绝，未发出 PATCH；随后在刚加载的详情上重新验证并记录了真实 PATCH 403。
- 138 前端用例、34 PostgreSQL 后端测试/6 步、format/check/build 均在 rebase 后通过。覆盖跨 Workspace 同编号确认隔离、过期响应、取消/连续失败、计数、权限、会话源切换和超时不迟发。
- Claude Opus 独立复核无代码阻塞，见 `rst-5-review.md`；其中测量表是较早 after 批次且使用全 20 个样本，本文采用最终冻结批次的 19 个热样本。

未验证：真实 OAuth 登出/重新登录、跨用户浏览器链路和生产部署。身份/过期会话用例使用模拟身份源，不能代替真实 OAuth。周期和 Spec 计数有回归/数据库验证，未在本次详情性能 probe 中测量。属性写入不立即重拉活动历史，focus 与 RST-7 负责后续校验。

## 复现与回退

```sh
node scripts/performance/write-report.mjs docs/performance/rst-5-priority-before.json docs/performance/rst-5-priority-after.json
node scripts/performance/write-report.mjs docs/performance/rst-5-status-before.json docs/performance/rst-5-status-after.json
node scripts/performance/report.mjs docs/performance/rst-5-api-before.json docs/performance/rst-5-api-after.json
node scripts/performance/writes.mjs SPACE p1 perf-baseline-v2 http://127.0.0.1:18502 OUTPUT.json priority 20
node scripts/performance/source.mjs
# 仅允许独立 worktree 预览数据库和受限运行角色；setup/suspend/restore/private/public 均走应用权限：
DATABASE_URL=postgresql://roster_preview_runtime@127.0.0.1:55479/roster_wt_f8193aef8d69_preview node scripts/toolchain.mjs deno run --allow-env --allow-net scripts/performance/access.ts setup perf-access
```

预览端口 5209/18502。撤销本票恢复 RST-4 的写后校验与局部反馈；没有数据库迁移或持久同步状态。保留后续依赖票的逆序回退要求。rebase 冲突保留了 main 的 Onboarding/Triage 引导、首条任务默认 todo 与新 App 测试 wrapper；没有回退 #40–#42 的功能。
