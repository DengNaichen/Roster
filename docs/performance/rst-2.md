# RST-2 — 执行区域对比与配置

基于 RST-1 / PR #43，同一已登录用户、同一独立 Workspace `perf-baseline-20261116`、同一 50 条 fixture、同一 Node fetch 客户端交错调用自动选区与数据库同区。每轮交替先后顺序；没有部署或更改生产设置。Supabase 项目元数据确认数据库为 eu-west-3、PostgreSQL 17.11，原始必要字段见 rst-2-project-region.json。

选择 eu-west-3：两种真实业务传输的 P50/P95 都改善，当前样本未见错误率上升。网页仅对已测量项目 qietzaqhmforixtpicjd 默认同区，其他部署保持自动选区，`VITE_API_REGION=any` 或空值恢复自动选区；仓库 roster-self 客户端增加静态 `x-region` header，OAuth URL/身份不变。

| 传输 / 路径 | 每策略热 n | 自动 P50 / P95 ms | 同区 P50 / P95 ms | P95 变化 |
| --- | ---: | ---: | ---: | ---: |
| REST 列表 | 19 | 2562.8 / 5976.3 | 689.2 / 1178.4 | -80.3% |
| REST 详情 | 19 | 4629.1 / 8085.6 | 481.3 / 1035.0 | -87.2% |
| REST 写入 | 19 | 2858.0 / 3520.5 | 436.7 / 2401.7 | -31.8% |
| MCP 列表 | 9 | 3414.5 / 5433.1 | 1834.3 / 2834.7 | -47.8% |
| MCP 详情 | 9 | 4351.5 / 5250.4 | 642.3 / 1369.1 | -73.9% |
| MCP 写入 | 9 | 3080.1 / 4430.8 | 629.0 / 1070.8 | -75.8% |

REST 每策略 60 个业务样本（各路径 1 首次观测 +19 热样本），MCP 每策略 30 个（各路径 1+9）。共 180 个业务请求全部成功，两策略错误率均为 0/90。每个响应的 `x-sb-edge-region` 均保存：自动为 ap-northeast-1，同区为 eu-west-3。MCP 返回体真实 SSE，耗时计算到完整 body；写入还核对返回任务和优先级。首个观测不能证明冷启动，P95 尾部样本较少。

同一策略间每条路径的载荷大小相同；REST 列表 499805 bytes、详情 14767、写入 4997。MCP 对应 504269、29846、10221 bytes。没有减少请求数、SQL 数量或修改连接池（仍最多 5）；本项优化的是网络位置。生产 SQL/服务端分段耗时仍不可见，不能用 RST-1 本地 5/20/9 冒充这里的实测。

## 发现与限制

- 带 `forceFunctionRegion` 查询参数的实际列表请求在 eu-west-3 返回 400：网关保留了参数，当前 REST 严格校验拒绝它。因此不采用这个方案，也不将 400 当作性能提升。
- 一次初步 Node 探测遇到 503，当时未保存发生策略，不能归因到某一区域；该次中断未纳入正式交错批次。随后脚本逐条持久化成功与失败，正式批次保留所有样本，不重试写入。样本内零错误不证明区域高可用。
- 区域对比用 ego-lite 取当前已登录浏览器的同用户 bearer，仅在 Node 内存中持有并发送给相同 Supabase 项目，输出不含凭据。Node 客户端避开了当前已部署浏览器 CORS 不支持 x-region 的限制；它不等于新前端已部署验证。浏览器 CORS 在独立本地真实服务上验收，另有 REST/MCP CORS 与鉴权契约测试。
- OAuth 首次授权/撤销/刷新、受控冷 isolate 和区域故障注入未验证。正常现有 JWT 在两区域的 REST/MCP 业务调用成功。`codex mcp get roster-self --json` 读回了仓库新 header，URL 保持不变；当前会话工具未重新授权。

## 复现与回退

在既有 ego-lite TaskSpace 的生产 Roster 页面登录后，执行：

```sh
node scripts/performance/regions.mjs SPACE PAGE perf-baseline-20261116 docs/performance/rest-regions.json
node scripts/performance/mcp-regions.mjs SPACE PAGE perf-baseline-20261116 docs/performance/mcp-regions.json
```

两条命令顺序运行，避免相互制造负载。环境沿用 RST-1 的 M4 Pro、未加显式限速的本机网络。区域文档：[Supabase Regional Invocations](https://supabase.com/docs/guides/functions/regional-invocation)；客户端静态 header 配置：[Codex MCP](https://developers.openai.com/codex/mcp#streamable-http-servers)。

部署需先发布支持 x-region 的后端 CORS，再发布前端；现有 delivery 工作流就是这个顺序。用户尚未授权生产部署，本轮不执行。数据库不迁移、不创建资源。其他部署若数据库不在巴黎，应设置 VITE_API_REGION 为其已测量区域或 any。

固定区域失去平台自动跨区重路由：区域异常时将 VITE_API_REGION 设为 any/空值并重建前端，同时移除 MCP 客户端 x-region header 后重连。URL/OAuth 资源地址保持不变。应用对读写都不自动跨区重试；已提交但应答丢失的写入先正常读回确认，再由用户重试。不要整体撤销 CORS 兼容：已打开的新版页面仍会带 x-region。若回滚后端构建，应保留 API/MCP allowHeaders 和 exposeHeaders 增量；先通过 VITE_API_REGION=any 重建/回滚前端，客户端刷新后再做其余回退。

## 验证

format:write、check、build；前端 105 测试；独占 PostgreSQL 17 上后端 34 测试/6 步、无跳过。浏览器真实 CORS 结果见 rst-2-browser-cors.json；自动与同区原始样本见两个 regions.json。没有将单测 stub 的状态码或未登录请求计入业务性能统计。

Node 与浏览器客户端的绝对耗时不可直接比较，本报告只比较同一 Node 客户端内的两种区域策略，不与 RST-1 浏览器数字计算优化百分比。现有 Authorization/JSON 请求已需要预检；x-region 增加兼容要求但不额外增加一种预检往返。首次授权部署后的浏览器验收应检查实际登录页面的 2xx 和可读的 x-sb-edge-region=eu-west-3；本轮未执行该生产步骤。

配置验证补充：`VITE_API_REGION=not-a-region node scripts/toolchain.mjs build` 按预期在构建配置阶段失败（Invalid VITE_API_REGION），未生成可部署的错误配置；正常构建已通过。默认区域仅绑定已测量的 Roster 项目 URL，其他 Supabase 项目默认自动选区。
