# RST-3 — 列表概要与单一分页数组

列表 SQL 改为显式选择概要字段，不将 document/document_text 作为查询结果返回；全文搜索仍在数据库内匹配 document_text。游标边界和 parent 筛选的任务查询也使用概要投影。单独的 IssueSummary DTO 与完整 Issue 共享基础字段，完整正文只在详情/写入响应出现。项目、标签、父任务、负责人和排序时间保持不变。

统一 Issue 分页为 `issues + next_cursor`，删除重复 `items`。现有网页使用 issues，因此后端先发布时列表仍能工作；服务层、MCP list_issues/list_spec_issues 和所有仓库调用方/测试一起迁移。MCP 自动客户端应按新 outputSchema 读取 issues，旧 items 字段不再保留。get_issue 仍返回完整文档与活动。

## 同数据实测

同一个 worktree 的 PostgreSQL 17 数据库、同一个 perf-baseline-v2 fixture、ego-lite 浏览器、无额外限速，前后均 20 次每路径请求，热样本 n=19。仅重启本任务 API 加载代码，没有重建 fixture。原始数据为 rst-3-before.json/rst-3-after.json，基线包含 RST-2 代码；本地 loopback 不涉及区域路由，不将本地延迟冒充生产收益。

| 列表指标 | 前 | 后 |
| --- | ---: | ---: |
| JSON bytes | 499805 | 17363 |
| API P50 ms | 4.3 | 2.5 |
| API P95 ms | 11.0 | 3.9 |
| SQL 次数 | 5 | 5 |
| SQL/driver P95 ms | 6.04 | 1.46 |
| JSON parse P95 ms | 0.8 | 0.1 |

载荷减少 **96.5%**。语句数不变；延迟样本小且本地尾部有噪声，主要确定性收益是移除正文与重复数组。详情仍为 14767 bytes、写入仍为 4997 bytes。SQL 时间含 driver/网络等待，非数据库 CPU 时间；JSON 解析接近浏览器计时精度，不把 0 ms 解释为零成本。

## 验证与复现

```sh
node scripts/performance/report.mjs docs/performance/rst-3-before.json docs/performance/rst-3-after.json
node scripts/performance/payload.mjs http://127.0.0.1:18522 perf-baseline-v2 docs/performance/rst-3-payload.json
```

API 测量运行入口见 README.md 的 probe.mjs。当前 web/API 端口为 5229/18522；fixture 哈希在两个 API 报告中相同。详情正文与列表没有被改写为 mock。

- ego-lite：50 条列表打开完整详情；提交唯一标题搜索得到 1 条、正文关键词搜索得到 50 条。见 rst-3-browser.json。
- 实际本地 MCP：列表仅 issues/next_cursor，10 条游标分页无重叠，正文搜索仍返回 50 条，get_issue 有完整 document。见 rst-3-mcp.json。
- PostgreSQL 集成测试：REST/MCP 概要字段缺省、详情文档完整、跨 Workspace/私有 Team/停用成员、标签/项目/负责人筛选、优先级和时间排序、分页、Spec 关联超过 50 条、导入/周期等现有行为。
- format:write、check、build、105 前端测试、完整 PostgreSQL 后端 34 测试/6 步通过，无数据库测试跳过。

没有生产部署，因此新 DTO 的托管 OAuth/MCP/网页全链路未验收；真实服务验证在隔离本地数据库进行。RST-1/2 的真实托管结果作为场景依据，不替代本次部署后验收。

## 回退与取舍

撤销本 PR 会恢复列表完整 document 和重复 items，现有网页仍使用 issues。MCP 自动客户端需要与输出 schema 同步；在发布前盘点使用 items 的外部自动脚本。没有迁移、权限缓存或数据库角色变更。

保留详情里的子任务/关系和活动原有结构；本次范围是任务集合与分页查询，不扩展成所有对象关系的协议重写。共享查询缓存、乐观写入和 SQL 往返合并分别由 RST-4/5/6 交付。
