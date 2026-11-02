# 后端架构

Roster 是模块化单体。HTTP、MCP、后台任务共用业务模块；各模块的业务用例依赖数据接口，由 PostgreSQL 适配器实现。事务在用例边界开启，跨模块协作使用同一个事务上下文。

## 目录与入口

```text
apps/
  web/                       React/Vite 前端
  server/
    main.ts                  本地 HTTP/MCP/jobs 服务入口
    preview.ts               本机免登录预览入口
packages/
  contracts/                 公开 DTO、输入 schema、身份与错误契约
  backend/src/
    bootstrap.ts             认证、服务、HTTP/MCP 组装
    service.ts               业务模块组装
    application/             服务接口、输入/错误门面、Session/UnitOfWork
    modules/
      access/                Workspace、成员、邀请、Team 权限
      issues/                任务及其内部协作能力
      planning/              Project、Initiative
      labels/                标签、互斥分组与批量变更
      cycles/                周期、补算、结转与快照
      specs/                 文档、不可变修订与版本检查
      activity/              评论、工作记录、接票、链接与依赖关系
      audit/                 审计记录
    integrations/
      github/                同步用例、HTTP 客户端、游标/租约仓库、webhook
      imports/               SQLite/Linear 导入用例与离线存储适配器
    transport/
      http/                  REST 路由及兼容转换
      mcp/                   MCP 工具与协议适配
    platform/                数据库连接、事务组装、JWT、错误与时间工具
supabase/
  functions/                 Edge 部署入口
  migrations/                唯一 SQL 迁移历史
scripts/                     数据迁移、导入、备份、worktree 工具
```

`deno task dev` 和 `deno task preview:api` 保留原命令；实现入口移到 `apps/server`。前端部署与 Supabase Edge 的外部地址不变。

## 模块内的职责

每个业务模块包含 `application` 与 `infrastructure`。有独立纯规则时再使用 `domain`，例如 Cycles 日历计算、Spec 编码、Issue 字段和 PR 状态规则。

| 位置 | 职责 |
| --- | --- |
| `application/service.ts` | 用例、权限与关联校验、事务编排、输出组装 |
| `application/repository.ts` | 存储能力接口，不出现 SQL/Drizzle/pg |
| `domain/` | 不执行 IO 的业务规则 |
| `infrastructure/` | SQL、连接绑定、查询投影、外部系统适配 |
| `index.ts` | 对其他模块公开的业务能力和类型 |
| `postgres.ts` | 仅供基础设施及组装入口使用的 PostgreSQL 适配入口 |

Issues 创建/更新通过专门的 `IssueDependencies`/`IssueSession` 表达用例所需能力；其他模块通过 `Session` 中本模块的 repository 执行存储操作。复杂列表和详情使用查询投影，不强制构造完整领域对象。

公共 `packages/contracts` 不包含后端 Service 接口。后端内部接口在 `application`，数据库查询结果与对外 DTO 分开。部分动态查询投影采用 `Row`，在应用或查询 mapper 中显式转换为 DTO。

## 依赖方向

```text
HTTP / MCP / Jobs
       ↓
业务模块 application → 本模块 repository 接口
       ↓                         ↑ 实现
其他模块 index.ts 能力     infrastructure/PostgreSQL
       ↓                         ↓
共享事务 Session          同一数据库事务连接
```

应用层不导入数据库驱动、SQL builder、基础设施实现或 `postgres.ts`，也不自行执行网络请求。模块间通过 `index.ts` 调用业务能力，不能直接使用其他模块的 repository。基础设施需要共享可见性 SQL、查询投影或构造仓库时，使用显式的 `postgres.ts` 入口。

`architecture_test.ts` 检查所有业务模块和集成的依赖边界、SQL 位置、跨模块 repository 访问及写表归属，并包含违规样例，防止规则失效。

## 事务与跨模块操作

`UnitOfWork.transaction` 在数据库事务内创建 `Session`。其所有 repository 都绑定到同一个 executor，协作函数接收当前 Session，不另开事务。业务失败会回滚该事务内的全部写入。

- Access 管理 Team 编号，通过 `allocateIssueNumber` 供 Issues 创建任务使用；任务与编号、审计原子提交。
- Labels 变更通过 Issues 的 `touchIssue` 更新任务时间。
- Cycles 通过 Issues 的 `rollCycleIssues`、`clearPendingCycleIssues` 结转/解除任务周期；周期快照和任务修改在同一事务。
- Activity 接票通过 Issues 的 `startDelegatedIssue` 更新任务状态和审计。
- GitHub 通过 Access 锁定工作区，通过 Issues 的 `applyPullRequestStatus` 更新任务。该内部能力不暴露到 HTTP/MCP；调用方先验证仓库配置并持有同步租约。
- 审计由业务显式调用 Audit 能力，随业务写入一起提交。

这些能力是事务内的内部接口，不能作为未经权限检查的用户入口。认证和输入门面继续对 HTTP/MCP 共用的 Service 执行校验，成员状态及私有 Team 权限由业务用例检查。

## 表归属与集成

| 模块 | 管理的表 |
| --- | --- |
| Access | users、workspaces、workspace_members、workspace_invites、teams、team_members |
| Issues | issues |
| Planning | projects、project_teams、initiatives、initiative_projects |
| Labels | labels、label_groups、issue_labels |
| Cycles | cycles、team_cycle_settings |
| Specs | specs、spec_revisions |
| Activity | comments、work_logs、issue_delegations、links、relations |
| Audit | audit_events |
| GitHub | pull_requests、github_sync |

查询投影允许受控跨表 JOIN；普通业务写入由表的归属模块负责。

GitHub 同步用例依赖注入的 `GitHubClient` 和 repository。HTTP 认证、超时与请求发送留在 HTTP 适配器；HMAC webhook 只请求后续同步。保留原有租约、游标和外部回写时序，不在结构调整中改变行为。

离线导入是明确的跨模块存储边界：SQLite/Linear 用例负责来源校验、身份/引用映射、历史和业务规则；专用存储适配器负责 SQL、事务、元数据与序列推进。它们不挂载为在线业务接口。SQLite 仍要求空目标库，失败全部回滚；Linear 仍在单一事务中保留原编号与作者语义。

## 数据库约束

数据库继续使用外键、唯一约束、CHECK 和必要的 trigger 做最终一致性保护。现有 8 个 trigger 未改动：标签组填充、标签组固定、任务与项目 Team 兼容、使用中的 Project–Team 保护、父子任务无环、blocks 无环、Spec 修订禁止修改/删除及禁止 truncate。

后端提前校验并返回明确错误；数据库约束保护并发和离线写入。不改变 Workspace 行锁粒度、迁移历史、角色权限或 RLS 策略。

## 验证与扩展

- `deno task check` 检查本地服务、预览、后台任务和 Edge 入口。
- `deno task test` 包含架构检查、无数据库用例测试、协议测试和真实数据库回归；数据库变量见 DEVELOPMENT.md。
- 真实数据库回归覆盖权限、事务回滚、并发编号、trigger、Spec 历史、REST/MCP、GitHub 及两种导入。
- 增加业务时先明确模块和表归属，在用例中定义需要的数据能力，再实现适配器；跨模块操作传递现有 Session。
- 改变 SQL/事务/权限时跑数据库回归；只改纯规则时可先运行对应单元测试。
