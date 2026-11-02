# 功能与数据迁移

## 功能对照

| 原 InfTask | Roster 实现 | 主要验证 |
| --- | --- | --- |
| 工作区、邀请、成员、Team、私有权限 | `modules/access` | 活动成员、最后 Admin、公开/私有 Team、幂等退出、事务 |
| Projects / Initiatives / Labels | `modules/planning` / `modules/labels` | 隐藏关联保留、归档、日期、互斥组、批量回滚、合并隐私 |
| 独立 Specs / 不可变修订 | `modules/specs` / `contracts/spec.ts` | 可信作者、私有 Team、稳定 ID 不复用、并发冲突、历史只读、6 REST + 6 MCP 真实联通 |
| Cycles | `modules/cycles` | DST、缺期结转、历史快照、停用重启、跨 Team 拒绝 |
| 评论、工作记录、接票、关系、链接 | `modules/activity` | 可信作者、分页、幂等登记、DAG、私有数据过滤 |
| GitHub 同步 / webhook | `integrations/github` / `jobs.ts` | 游标、租约、状态推进、私有内容不外发、签名 |
| Linear 导入 | `integrations/imports/application/linear.ts` | 号码保留、未知类型回滚、作者与项目保留 |
| SQLite 全量迁移 | `integrations/imports/application/sqlite.ts` | 身份/引用映射、空目标限制、失败全部回滚 |
| 本地备份 | `scripts/backup-postgres.py` | 原子 archive、恢复后任务数量验证 |
| 原生产 MCP 45 个工具 | `transport/mcp/server.ts` | 工具清单、严格输入、结构化输出、真实 REST/MCP 联通 |

前端来自原 `web/src`，保留原页面与样式结构，并包含后续项目样式调整。独立 Spec 的 `spec.css` 与 AL-80 原型逐字节一致。Workspace/Team/Issue 内部 ID 改为 UUID，任务编号保持 `<TEAM>-<number>`；Project/Initiative/Label/Group/Cycle 继续使用数字 ID，兼容原页面 URL。

## 独立 Spec 与接口

Spec 是按工作区编号的 `SPEC-n` 文档，属于一个 Team，按同一公开/私有 Team 边界读取。它不是 Issue 的 `type=spec`：后者仍是任务分类，两种记录分别保存、编号和授权。网页布局与样式来源于 InfTask AL-80 原型工作树，Roster 的 `SpecsPage`、`SpecPage`、`SpecEditor`、`SpecHistory` 接入真实服务；当前交付只覆盖独立文档及其修订。

`content` 是结构化 JSON 对象，含标题、状态、优先级用户故事及 Given/When/Then 场景、边界情况、功能需求、实体、成功标准和澄清记录。`US-n`、`FR-n`、`SC-n` 是稳定 ID，被历史修订移除后不能重新分配。每次保存提供 `base_revision`；旧版本写入返回 `409 conflict`，不会覆盖当前文档或旧修订。作者来自认证身份，不能从请求正文指定。

| REST（前缀 `/api/w/:workspace`） | 行为 |
| --- | --- |
| `GET /specs?team=KEY` | `{specs}` 摘要 |
| `POST /specs` | `{team, content, message?}` 创建 revision 1 |
| `GET /specs/:identifier` | 当前内容与修订信息 |
| `PUT /specs/:identifier` | `{base_revision, content, message?}`；正文禁止 `identifier` |
| `GET /specs/:identifier/revisions` | `{revisions}`，最新在前 |
| `GET /specs/:identifier/revisions/:number` | 只读历史内容 |

原生产 MCP 的完整 45 工具清单由 `transport/transport_test.ts` 固定并与真实 SDK 注册结果核对；Specs 使用具体结构化输出 schema，允许输出追加字段。

| 领域 | 工具 |
| --- | --- |
| 任务（4） | `list_issues`, `get_issue`, `create_issue`, `update_issue` |
| 活动与关系（8） | `add_comment`, `add_work_log`, `list_work_logs`, `get_work_log`, `delegate_issue`, `add_relation`, `remove_relation`, `add_link` |
| Team（8） | `list_teams`, `create_team`, `update_team`, `list_team_directory`, `join_team`, `list_team_members`, `change_team_member`, `list_assignees` |
| Project / Initiative（8） | `list_projects`, `get_project`, `create_project`, `update_project`, `list_initiatives`, `get_initiative`, `create_initiative`, `update_initiative` |
| 标签（7） | `list_labels`, `list_label_groups`, `save_label_group`, `create_label`, `update_label`, `change_issue_labels`, `merge_labels` |
| 周期（4） | `list_cycles`, `configure_cycles`, `get_cycle`, `update_cycle` |
| Spec（6） | `list_specs`, `get_spec`, `create_spec`, `update_spec`, `list_spec_revisions`, `get_spec_revision` |

## SQLite 数据迁入

工具不会自动读取旧正式库。先获得一个明确的数据源或备份文件，导出工具以 SQLite `mode=ro` 和读取事务获取一致快照：

```sh
python3 scripts/export-sqlite.py /path/to/inftask.db /path/to/snapshot.json
```

输出文件必须不存在，避免覆盖。快照包含业务数据、成员、邀请摘要、项目/标签/周期、独立 Spec 及其全部修订、任务与活动历史、PR 和同步游标；不含 UC session 文件、OAuth Token 或服务配置。快照与身份映射文件应放在仓库外。

为每个旧 UC subject 显式指定新 Supabase user UUID，不能按同名或邮箱自动合并：

```json
{
  "subjects": { "old-uc-subject": "11111111-1111-4111-8111-111111111111" },
  "owner": {
    "subject": "11111111-1111-4111-8111-111111111111",
    "name": "Your name",
    "email": "you@example.com"
  }
}
```

`owner` 仅用于源工作区没有活动管理员时的显式初始化。不同旧用户不能映射到同一个新用户。目标必须已经应用全部 SQL migrations，且没有任何 Workspace；导入不会覆盖已有工作区。

```sh
DATABASE_URL=postgresql://... deno run --allow-env --allow-net --allow-read scripts/import-sqlite.ts /path/to/snapshot.json /path/to/identities.json
```

导入在一个事务中映射 UUID、保留任务编号和日期、数字目录 ID、成员与私有性、项目/周期/标签、父子关系、评论作者、工作记录、接票记录、链接和 PR。旧状态事件及负责人历史转为审计记录；无法确认作者的历史记录保持 System/null 语义。返回计数与旧→新 UUID 映射，可保存为核对报告。未知身份、无效引用/链接、循环关系、编号冲突或约束错误使整个导入回滚。

独立 Spec 保留原数字实体 ID、修订 ID、工作区内 `SPEC-n` 编号和完整历史内容、消息、作者与时间。修订的 `author_subject` 使用同一显式身份映射，原本为 null 的历史作者继续为 null；数字序列在导入后推进，后续保存只追加修订。导入验证结构化 JSON、256 KiB 内容上限、从 1 到 `current_revision` 的连续修订，以及 `US-n` / `FR-n` / `SC-n` 删除后不可复用；无效历史同样使全部领域回滚。Spec 功能出现前的旧快照缺少这两张表时按无 Spec 数据兼容，不伪造修订。

核对报告中的 `specs` 与 `spec_revisions` 数量，并使用 Spec 列表、当前详情和修订列表/详情确认最新修订、早期内容、作者/null 和日期一致；验证导入后新建的 `SPEC-n` 接续原编号、已有 Spec 保存追加修订而不修改旧快照。

完成后核对各域数量、关键任务与权限，再切换客户端地址。当前开发中只验证了隔离 fixture 的迁移，未执行任何旧正式数据导入。

## Linear 导入

保留原 `scripts/linear/export.py` 的只读导出方式。导出后先创建目标 Workspace/Team，将 Team 的 `start_number` 设为高于源最大编号，再运行：

```sh
DATABASE_URL=postgresql://... deno run --allow-env --allow-net --allow-read scripts/import-linear.ts WORKSPACE TEAM /path/to/export
```

导入保持原状态/类型映射、项目说明和归档、父子关系、blocks/related、评论与作者及非 GitHub 附件。未知状态、类型标签、关系、评论作者或无效链接会使整批回滚；GitHub 附件由同步模块重新读取。数据库连接必须有该次离线导入所需权限，命令不通过网页或 MCP 暴露。

## Postgres 备份与恢复

使用与服务器版本兼容的 `pg_dump` / `pg_restore`。备份连接应使用直连或 session pooler，不能使用 transaction pooler执行长时间dump。

```sh
DATABASE_URL=postgresql://... python3 scripts/backup-postgres.py /path/to/backups
```

脚本以 UTC 日期命名 archive，权限为 0600，写入临时文件后原子替换；已存在的当日备份不覆盖，保留最新 14 份（`--keep` 可调整）。凭据通过环境传给 pg_dump，不放进命令参数。

恢复到一份新的空数据库，验证后再使用：

```sh
pg_restore --no-owner --no-acl -h HOST -p PORT -d EMPTY_DATABASE /path/to/daily-YYYY-MM-DD.dump
```

业务 runtime role 的 grants 不包含在该 no-acl archive 中，恢复后应重新授予部署所需权限。不要把恢复命令指向正在使用的正式库。本地预览升级前已备份，并在独立恢复库中验证保留了原来的 8 条任务。

## 外部集成验收范围

所有业务域已实现并通过本地测试；外部 GitHub 使用注入的模拟 HTTP 响应验证，未向真实仓库发送评论。真实 GitHub token、webhook、Supabase OAuth、托管 Edge 网关及 Cron 配置仍需部署环境验收。没有 CI/CD 或自动上线流程。
