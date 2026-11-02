# 后端架构

Roster 使用模块化单体。HTTP、MCP 与后台任务复用后端模块，Supabase Functions 只负责部署适配。数据库迁移继续由 `supabase/migrations` 唯一管理。

## 代码地图

- `packages/contracts`：公开 DTO、输入 schema、身份和错误契约，不包含后端 Service 接口。
- `packages/backend/src/application`：供 HTTP/MCP 调用的 Service 接口和统一认证、输入校验、数据库错误映射门面。
- `service.ts`：模块组装，不包含业务查询和业务方法。
- `modules/access`：Workspace、成员、邀请、Team 和可见性。
- `modules/issues`：任务用例、编号、指派、父子引用，以及 GitHub 驱动的任务状态变更。
- `modules/planning`：Project、Initiative 及关联。
- `modules/labels`：标签、分组、互斥、批量变更和合并。
- `modules/cycles`：周期配置、补算、结转和快照。
- `modules/specs`：Spec、不可变修订及版本冲突。
- `modules/activity`：评论、工作记录、接票登记、链接和依赖关系。
- `modules/audit`：事务内审计持久化。
- `platform`：数据库连接与基础查询、JWT、错误及时间工具。
- `integrations`：GitHub 同步与离线导入；`jobs.ts` 编排系统任务。

## 已建立的边界

模块外只能通过该模块的 `index.ts` 导入能力。HTTP/MCP 不直接访问数据库。公共 DTO 包不依赖后端实现。`architecture_test.ts` 随 `deno task test` 验证这些边界。

Issues 创建/更新采用依赖反转：

```text
service.ts 组装
  application/service.ts → application/ports.ts
                              ↑ 实现
                      infrastructure/postgres.ts
                              ↓
                    同一事务内的模块能力与 SQL
```

`domain` 保留纯规则，`application` 控制执行顺序和事务边界，通过 `IssueDependencies.transaction` 获取绑定到同一事务的 `IssueSession`。事务中完成权限检查、引用校验、编号、写入和审计；任何一步失败都回滚。Application 和 Domain 不导入 PostgreSQL、Drizzle 或 infrastructure。

列表与详情采用独立查询实现，允许针对 DTO 的受控跨表 JOIN，保留当前权限过滤、分页和输出兼容行为。写入记录与查询快照使用不同类型，避免把未经 JOIN 的记录假装成完整查询模型。

GitHub 负责 PR 解析、租约和同步游标，任务状态写入由 Issues 的 `applyPullRequestStatus` 执行。它是仅供内部系统使用的入口，调用方必须持有已配置仓库的租约和 Workspace 锁；不暴露给 HTTP/MCP。状态规则在 Issues Domain 内，状态和审计仍在原同步事务中提交。

## 渐进迁移边界

这次建立模块归属并完整拆分 Issues 创建/更新的数据访问。Access、Planning、Labels、Cycles、Specs、Activity 的服务仍保留现有事务和 SQL，不能将本次调整理解为所有模块已完成依赖反转。

这些模块应逐个按 Issues 模式迁移：先定义用例需要的端口，再移动 SQL 和存储类型，保留数据库回归测试。当前 `index.ts` 暂时公开部分接收 Executor 或返回 SQL 的查询协作函数，它们只供后端适配器使用；后续应逐步替换为业务查询接口，不把这些类型带进纯应用层。

跨模块写入也有明确的过渡项：Cycles 的任务结转、Labels 更新任务时间、Issues 分配 Team 编号，以及离线导入。迁移时应建立归属模块的事务内能力，不能为了隔离而开启嵌套的独立事务。离线全量导入是受控的跨模块写入入口，不应复用为在线业务接口。

暂不改变 Workspace 行锁粒度、不引入事件总线或微服务、不改变 SQL 历史、不新增 RLS。运行入口仍使用现有 `scripts/dev.ts` 与 `supabase/functions`，避免无收益的部署路径迁移。

## 数据库规则

数据库使用外键、唯一性、CHECK 与必要的 trigger 保护不变量。8 个 trigger 保持不变：标签组填充、标签组固定、任务与项目 Team 兼容、使用中的 Project–Team 保护、父子任务无环、blocks 依赖无环，以及 Spec 修订禁止修改/删除和禁止 truncate。

后端提前校验以提供明确错误，数据库做最终约束。审计由业务显式写入。复杂业务流程保留在 TypeScript；新增约束优先使用声明式 SQL。

## 验证

- `deno task check`：所有运行和 Edge 入口类型检查。
- `deno task test`：依赖边界、纯规则、协议测试和数据库回归；数据库变量见 DEVELOPMENT.md。
- 前端构建、测试和 lint：确认 contracts 迁移没有改变前端调用。
- 数据库测试使用独立 `_test` 库和受限应用角色，覆盖权限、事务回滚、并发编号、标签约束、依赖环、Spec 修订、REST/MCP 及 GitHub 同步。
