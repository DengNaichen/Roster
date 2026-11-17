# 开发与手动部署

## 本机免登录预览

独立入口 `apps/server/preview.ts` 固定使用本地开发者身份，首次启动创建示例 Workspace、两个 Team 和七条任务。它只接受 loopback 上、名称以 `_preview` 结尾的数据库，HTTP 只监听 `127.0.0.1:18471`，允许前端 Origin `127.0.0.1:5178` / `localhost:5178`。该入口不被 Edge Functions 引用。

先在隔离的本地 Postgres 创建 `roster_preview` 库、应用 migrations，并为本地 login 授予 `roster_app`。当前开发机已经在端口 55439 完成这一初始化。分别运行：

```sh
DATABASE_URL=postgresql://roster_preview_runtime@127.0.0.1:55439/roster_preview node scripts/toolchain.mjs deno run --allow-env --allow-net apps/server/preview.ts
VITE_LOCAL_PREVIEW=true node scripts/toolchain.mjs --filter @roster/web dev --port 5178 --strictPort
```

主 checkout 也可用 `node scripts/toolchain.mjs deno task preview:api` 和 `node scripts/toolchain.mjs deno task preview:web` 以上述默认值启动。次级 worktree 用 `scripts/new-worktree <branch>` 创建，或在其根目录运行 `node scripts/toolchain.mjs deno task worktree:setup`：它分配稳定的独立端口和 `roster_wt_<id>_preview` 库并执行 migrations，之后同样用这两个 task 启动。分支与 worktree 的完整规则（位置、清理、GC）见 [git-workflow skill](../.agents/skills/git-workflow/SKILL.md)。

访问 `http://127.0.0.1:5178/roster`。修改保存在该本地数据库，重启不覆盖已有工作区。预览只有一个固定用户，不能用于验证多用户登录或 OAuth；生产构建即使设置 `VITE_LOCAL_PREVIEW=true` 也不会启用免登录。

## Issue 正文

Issue 正文是结构化 JSON `document`，契约见 `packages/contracts/issue-document.ts`：导语 `lead`、带标题的 `sections`（段落、列表、对比、表格、提示、代码块）和验收条件 `criteria`（稳定 ID `AC-n`）。所有文本字段按纯文本显示，不解释 Markdown 或 HTML。REST 与 MCP 在边界用同一个 zod schema 校验，错误信息带字段路径，例如 `document.criteria.1.id: Duplicate criterion ID AC-1`。

`save_issue` 的 `document` 整体替换正文；不传则保持不变。勾选单条验收条件使用 `PATCH /api/w/:workspace/issues/:identifier/criteria/:criterion`（正文 `{"done": true}`）或 MCP `check_issue_criterion`（参数 `identifier`、`criterion`、`done`）。服务端在锁住任务行的事务内只改这一条，审计事件 `issue.criterion_updated` 只记录 `{criterion, done}` 的前后值；状态未变时不写入。未知 ID 返回 `not_found`，权限与修改任务相同。

搜索匹配标题和 `document_text`，即 `issueDocumentText` 生成的纯文本，不匹配 JSON 键名。迁移 `20261105000200_issue_documents.sql` 把旧 `description` 转为一个名为 Description 的段落（超过 5000 字符截断），空正文转为空文档，然后删除该列。Linear 与 SQLite 导入用同一规则转换。

## Spec Design

Design 页签读取 `GET /api/w/:workspace/specs/:identifier/design`。共享文档使用 Spec 的工作区与团队权限。尚无共享版本时，浏览器可以只读展示此前保存在本机的草稿。

Agent 通过工作区 MCP 调用 `get_spec_design`（参数为 `identifier`），返回的 `design` 为空表示尚未创建。使用 `set_spec_design` 提交完整正文。首次写入传 `base_revision: 0`，后续传读取到的 Design 版本号；遇到冲突时重新读取并整合修改。`spec_revision` 指向这份设计所依据的 Spec 修订。只有 Design 的版本号会随写入递增。

本机免登录预览支持在 API 端口的 `/w/roster/mcp` 接入本地 MCP 客户端，使用预览固定身份，拒绝带浏览器 Origin 或 Fetch Metadata 的请求。部署环境沿用现有 MCP 授权流程。

## Spec 依赖图

`GET /api/w/:workspace/specs/:identifier/dependencies` 与 MCP `get_spec_dependencies`（参数 `identifier`）返回相同的 `nodes`、`edges`。节点以 Issue UUID 标识，包含票号、标题、状态、负责人和 `external` 标记。边从前置任务的 `from` 指向后续任务的 `to`。

读取结果包含直接关联任务与它们的递归前置任务。`external` 表示该节点未直接关联当前 Spec。Spec 和每个节点都按调用者权限检查，隐藏节点以及经过隐藏节点的路径被省略。图展示的是可见关系，无法据此断言任务已经满足所有执行条件。

前端在 Spec 的 Issue 列表中显示直接依赖和阻塞提示，点击可查看前置、Spec 内后续任务并打开真实 Issue 详情。不提供 DAG 图形视图；依赖查询 REST 和 MCP 接口继续保留。

## 数据访问

### 原前端兼容

前端保留 InfTask 的 History 路由、`useResource` 和 `useRequestScope`，迁移不以更换路由/请求库为前提。`src/integration` 处理 Supabase 会话和本地预览，`shared.api` 保持原调用签名。

`GET /api/w/:workspace/capabilities` 在页面挂载前声明已实现能力，当前全部启用；获取失败会阻断并提供重试。原组件读取的项目、标签、周期、评论、工作记录、关系和 PR 均来自真实存储；独立 Specs 的文档与修订同样来自真实服务。

`packages/backend/src/transport/http/compat.ts` 负责 REST 兼容：列表统一返回 `{issues, next_cursor}`（MCP 同形），每项为不含 document 的概要；详情/状态更新返回完整正文与原有形状，处理原表单的清空字段，并保留真实负责人筛选和历史。MCP 保留旧工具名称/输入语义；`list_issues` 的零 limit 使用默认值，负 limit 返回全部，支持优先级和更新时间排序。

`roster` schema 不加入 Supabase Data API 的暴露名单。迁移撤销 `public`、`anon`、`authenticated` 的访问，并创建 `roster_app` NOLOGIN 权限角色。业务权限由 Service 每次读取成员关系后执行；数据库客户端并不自动传递用户 JWT。应用连接不能使用 `postgres` 超级用户。

在独立本地数据库或新 Supabase 项目内，以有建角色权限的管理员执行以下 SQL。密码替换成独立生成的值，不能提交到仓库：

```sql
create role roster_runtime login password 'REPLACE_WITH_A_STRONG_PASSWORD'
  nosuperuser nobypassrls;
grant roster_app to roster_runtime;
grant connect on database postgres to roster_runtime;
```

迁移应使用管理员连接；应用 `DATABASE_URL` 使用 `roster_runtime`。托管环境使用项目 Connection 面板提供的 transaction pooler 地址，用户名遵循该面板中自定义角色的格式。不要禁用 TLS 证书验证。数据库连接池大小需根据项目连接预算配置；当前单实例最多五条连接。

## 本地验证

### Codex 质量 Hook 的隔离约束

实现入口为 [`.codex/hooks.json`](../.codex/hooks.json) 和 [质量检查脚本](../.codex/hooks/quality-core.mjs)。以下约束适用于当前实现及后续修改。

- **状态归属**：以 worktree 的 canonical 路径、宿主提供的 `session_id` 和 `turn_id` 共同标识一次检查。路径别名必须先解析为真实路径；标识编码或哈希后再用于文件名，不直接拼接外部输入。不得使用全局“当前会话”、共享的单一状态文件或“最近一次运行”来推断归属。
- **结果归属**：Hook 只通过本次进程的 stdout 返回宿主协议规定的结果，诊断日志与协议输出分离。不得调用会话消息接口、向其他会话注入修复任务，或读取其他会话的状态作为本次检查结果。
- **基线与续轮**：记录本回合开始时的 HEAD，检查该基线之后的提交与当前暂存、未暂存、未跟踪改动的并集，包含重命名和删除。自动修复续轮必须显式关联原始检查，保留原基线与重试计数；不能因产生新的 turn 而重置基线或重试上限。无法验证关联时，退回无状态只读检查并说明覆盖限制，不猜测归属。
- **并发与清理**：状态写入使用原子替换；同一检查的并发更新需要互斥或等效保护。锁、缓存、重试计数和清理均限定在对应 worktree、会话及检查内。过期进程不能覆盖新检查结果或删除其他会话的状态。
- **缺失标识**：缺少或无法验证会话、回合标识时，不读写持久会话状态，也不触发依赖归属的自动修复续轮；只执行无状态只读检查，并明确报告无法保证增量覆盖。缺少工具、超时和状态损坏不能当作检查通过。
- **共享工作区边界**：不同会话在同一 worktree 中仍会看到同一份文件，状态隔离不能识别修改者。并行写代码必须使用独立 worktree；发现共享 worktree 的并行写入时，报告冲突并停止自动修复，不能把其他会话的修改当作自己的修复目标。不得宣称仅凭 Git 状态就能可靠检测所有并发写入。
- **只读与防循环**：`Stop` Hook 只检查，不格式化或修复文件；由接收诊断的 Codex 会话执行修复。每次原始检查最多触发一轮自动修复续轮，再次失败明确报告未解决项，不跨会话转交，也不无限继续。

实现时必须通过契约测试验证：不同 worktree、同 worktree 不同会话、同会话不同回合、并发状态更新、续轮基线保留、缺失标识、超时与状态损坏、过期状态清理，以及“本回合已提交且工作区干净”仍被检查。宿主实际触发和结果归属还需用两个独立会话做冒烟验证，不能用脚本单测代替。

### 质量工具与 Hook 接入

- 前端：ESLint 的 JS/TypeScript 推荐规则及 React Hooks 规则；Biome 只负责格式化，不重复 lint。暂不接入尚未声明支持当前 ESLint 10 的 jsx-a11y 插件。
- 后端、contracts、服务器入口、脚本和 Hook：`deno lint` 与 `deno fmt`。`require-await` 因异步端口的同步 stub 实现而排除；`no-import-prefix` 因已有 npm/jsr 显式版本导入而排除。其余推荐规则启用。URL 校验有一处明确注明原因的控制字符正则例外。
- formatter 各管自己的目录，不修改 SQL migrations、lockfile 或生成的 emoji 数据。`format:write` 是显式写操作，Hook 不调用它。

```sh
node scripts/toolchain.mjs format:write  # 主动格式化；完成修改后、提交前执行
node scripts/toolchain.mjs check         # 格式、lint、前后端类型、架构边界、Hook 契约测试
```

也可单独运行 `lint`、`format:check`、`typecheck`、`test:architecture`、`test:hooks`。`check` 不需要数据库，不启动预览或运行构建；完整应用测试仍按下方命令执行。

新机器只需 Node 22+（含 npm）。先运行 `node scripts/toolchain.mjs setup`：使用根 `package.json` 固定的 pnpm 10.20.0 和 `pnpm-lock.yaml` 安装依赖到本 worktree 的 `node_modules`，包括 Deno 2.9.6、Biome 和 ESLint；首次引导使用 npm 的缓存，不全局安装。Deno 的安装脚本在 `pnpm-workspace.yaml` 中明确允许。两个锁文件都应提交；不提交工具二进制或 `node_modules`。

Hook 通过当前 Node 进程直接调用仓库的 `scripts/toolchain.mjs`，该入口优先使用本 worktree 的工具并验证 pnpm/Deno 版本；缺失或不匹配时明确报错，不退回全局工具、不自动安装。`scripts/run-agent-hook` 只帮助 GUI 宿主寻找基础 Node；不读取 shell profile。`setup` 是显式安装步骤，`check` 与 Stop 不安装工具。创建 worktree 的脚本也调用同一入口完成依赖引导，预览与清理使用仓库内 Deno。

在 Codex 中打开**实际任务 worktree** 后，通过 `/hooks` 审阅并信任仓库 Hook，再开启一个新回合验证触发。项目 `.codex/` 层也必须被信任。新增或修改 Hook 需要重新审阅；仓库不会修改用户的全局信任记录。宿主行为以 [官方 Hooks 文档](https://learn.chatgpt.com/docs/hooks) 为准。

Hook 只检查事件 `cwd` 对应的 Git worktree，不追踪 shell 命令曾经切换到的其他目录。从主 checkout 创建 worktree 后，应在 Codex 中打开该 worktree；否则不能依赖主 checkout 的 Hook 覆盖另一个 worktree 的修改，必须在目标目录手动执行 `node scripts/toolchain.mjs check`。

`UserPromptSubmit` 记录起始 HEAD；`Stop` 发现代码或工具配置变动时执行完整 `check`，避免漏掉 contracts 的跨端依赖。纯文档或无改动时跳过。检查进程最多运行 100 秒，诊断限制为 6000 字符；宿主 Stop 超时设为 120 秒。失败最多触发一轮修复，随后仍失败会报告未解决项。续轮仅用同一会话中完全匹配的 Hook 返回 reason 关联原始检查；宿主未保留此关联时不会从其他记录猜测基线。

状态位于 `git rev-parse --absolute-git-dir` 下的 `roster-quality/`，不进入版本控制。短时目录锁保护状态事务，原子替换防止部分写入。`Interrupt` 关闭当前回合，`SessionEnd` 关闭本会话记录；其他会话的活跃记录不会按时间自动过期。共享 worktree 的重叠会话会相互标记冲突并禁止自动修复；检查前后文件内容变化也会禁止自动修复，但两者不能识别所有外部写入。

若宿主异常退出遗留活跃状态或目录锁，先确保该 worktree 没有运行中的会话或检查进程，再人工核对并移除对应状态或锁；不得清空其他仍活跃会话的记录。状态损坏、缺少标识或基线时执行完整只读检查并报告限制，不请求自动修复。脚本测试不等于宿主验收：首次启用仍需两个独立 Codex 会话验证各自的结果归属。

### 手动验证命令

```sh
node scripts/toolchain.mjs setup
node scripts/toolchain.mjs build
node scripts/toolchain.mjs test:web
node scripts/toolchain.mjs deno task check
node scripts/toolchain.mjs deno task test
```

真实数据库测试要求一个**可创建测试角色、名称以 `_test` 结尾的隔离数据库**。测试会应用 schema、创建受限测试 login，并清理本次随机工作区；不要填写开发者已有数据库或生产地址。

```sh
ROSTER_TEST_DATABASE_URL=postgresql://USER@127.0.0.1:PORT/roster_test deno test --allow-env --allow-net --allow-read packages/backend/src/service_test.ts
ROSTER_TEST_DATABASE_URL=postgresql://USER@127.0.0.1:PORT/roster_spec_test deno test --allow-env --allow-net --allow-read packages/backend/src/modules/spec_test.ts
```

全套真实数据库测试还读取 `ROSTER_ACTIVITY_TEST_DATABASE_URL`（数据库名必须为 `roster_activity_test`）、`ROSTER_INTEGRATIONS_TEST_DATABASE_URL` 和 `ROSTER_IMPORT_TEST_DATABASE_URL`；后两者使用隔离 `_test` 库，导入测试要求没有工作区。每个测试创建自己的数据并清理。`node scripts/toolchain.mjs deno task test` 未设置相应变量时会跳过该数据库测试。传输单元测试使用签名 JWT 与 stub；活动与独立 Spec 测试另通过真实数据库跨 REST/MCP 写读；Spec 套件覆盖全部 6 个 REST 路由、6 个 MCP 工具、版本冲突和历史只读。

## 配置

| 环境 | 变量 | 含义 |
| --- | --- | --- |
| 后端 | `DATABASE_URL` | 专用数据库 login 的连接串 |
| 后端 | `SUPABASE_URL` | 固定 Auth 项目 URL |
| 后端 | `SUPABASE_PUBLISHABLE_KEY` 或 `SUPABASE_ANON_KEY` | OAuth 用户授权接口所需的项目公钥；托管函数自动提供 anon key，不能使用 service role key |
| 后端 | `AUTH_AUDIENCE` | 验证的 audience，默认 `authenticated` |
| 后端 | `ALLOWED_ORIGINS` | 逗号分隔的前端精确 Origin |
| 后端 | `MCP_PUBLIC_URL` | MCP 函数公开基址，不含 `/w/<slug>/mcp` |
| 前端 | `VITE_SUPABASE_URL` | 同一个 Auth 项目 URL |
| 前端 | `VITE_SUPABASE_ANON_KEY` | publishable 或 anon key，可在浏览器公开 |
| 前端 | `VITE_API_BASE_URL` | 本地后端或托管 api 函数基址，不含 `/api` |

前端会在基址后添加 `/api`。本地例子为 `http://127.0.0.1:18471`，托管例子为 `https://PROJECT.supabase.co/functions/v1/api`。三个 VITE 变量是构建时配置，修改后需要重建。

## Supabase 手动部署

1. 创建独立 Supabase 项目，启用 ES256 或 RS256 JWT 签名；应用不接受旧 HS256 签名。
2. `supabase link --project-ref PROJECT_REF` 绑定**新项目**。核对项目后，用 `supabase db push` 应用 migrations。
3. 配置专用数据库 login 和后端 secrets。`SUPABASE_URL` 在托管函数环境由平台提供；其余应用变量通过 secrets 设置。不要上传前端配置为数据库凭据。
4. `supabase functions deploy api` 和 `supabase functions deploy mcp`。`verify_jwt=false` 允许 discovery 和 OPTIONS 到达函数；业务请求由函数内部 JWT 验证保护。
5. 在 Auth 中配置网页 Site URL、登录邮件回调允许列表。登录链接会回到发起登录的页面，因此需明确允许部署域下的 `/auth/callback`、`/auth/join`、`/join` 和 `/oauth/consent` 等实际路径，不能允许任意外部域。
6. 启用 Supabase OAuth Server，授权页面设置为前端 `/oauth/consent`。根据目标 MCP 客户端配置预注册客户端或动态注册。

每个 Edge 函数的 `deno.json` 独立维护运行依赖。共享代码通过相对 import 打包；部署前还需在真实 Supabase CLI 下验证函数打包，不以仓库根 `deno check` 替代。

## Vercel 手动部署

日常发布由 GitHub Actions 执行。需要手动恢复时，在仓库根通过 Vercel CLI 关联项目并部署。根 `vercel.json` 已配置安装命令、构建命令、`apps/web/dist` 输出目录和 SPA rewrite。项目根保持仓库根，确保共享 contracts 在构建上下文可见。

### GitHub Actions 自动部署

[delivery.yml](../.github/workflows/delivery.yml) 在 PR、`main` push 和手动运行时执行格式、lint、类型、架构、前端测试/构建，以及临时 Postgres 17 上的全部迁移和后端集成测试。PR 不读取生产凭据，不部署。手动运行非 `main` 分支也只验证。

`main` 验证通过后进入 `production` environment：检查凭据 → 拉取 Vercel production 配置并构建 → Supabase 数据库迁移 → `api`、`mcp` 函数 → 发布 Vercel prebuilt 产物。整个 main 流程串行，正在运行的发布不会被新提交取消；GitHub 可将尚未开始的排队运行替换为更新提交。Vercel 不要再单独开启 Git 自动部署，否则它会绕过这里的测试与后端顺序。

迁移先以 `supabase db push --remote="$SUPABASE_PROJECT_REF" --include-all --dry-run --yes` 输出计划，再以相同参数去掉 `--dry-run` 执行。`--include-all` 补执行历史表中缺失的版本，包含并行 PR 后合入但时间戳较早的迁移，已应用版本仍跳过；不重命名、修改已提交迁移或伪造 applied 记录来绕过。参考 [CLI db push](https://supabase.com/docs/reference/cli/supabase-db-push)。CI 的 `scripts/test-migration-upgrade.ts` 使用固定 CLI 与独立本地数据库，覆盖固定的 OAuth 已上线/GitHub inbox 后补场景，并从 PR base（main push 使用 before SHA）应用既有迁移后再补入本次迁移；拒绝修改或删除既有迁移，对比列、约束、索引、表授权、函数与触发器，验证重试和全新库一致性。手工运行需提供本地管理连接 ROSTER_MIGRATION_TEST_ADMIN_URL，可提供完整提交 SHA 的 ROSTER_MIGRATION_BASE_REF。

PR #52 的失败发生在补执行 `20261117042051_github_webhook_inbox.sql` 前，旧命令因时间戳早于生产现有版本而退出。dry-run 只是审计输出，并非人工确认门禁，后续步骤会自动执行。合并本修复前，运维须确认旧 GitHub Cron/worker 未启用或已停止，并用生产只读 dry-run 核对计划仅包含预期缺失版本，再通过修正后的 main 工作流部署；不直接重跑仍含旧命令的历史失败 job。已核对 #59 的调用链：`requested_at` 的写入仅由 jobs 内的 sync/notify 使用，API/MCP 不调用；该破坏性字段删除仅在旧 jobs/webhook 已停用的前提下可应用。迁移删除了旧 worker 使用的 `requested_at`，新 GitHub worker 启用仍遵循下文专门流程。生产迁移失败不能通过只发布前端绕过。

正式版本的规划、验收和 GitHub Release 操作见 [release skill](../.agents/skills/release/SKILL.md)；本节的日常生产部署不自动创建 Release。

首次启用，在仓库 Settings → Secrets and variables → Actions（或 `production` environment）添加：

| 类型 | 名称 | 值 |
| --- | --- | --- |
| Secret | `SUPABASE_ACCESS_TOKEN` | 有目标项目权限的 Supabase access token |
| Secret | `SUPABASE_DB_PASSWORD` | 目标 Supabase 数据库密码，供 CLI 迁移使用 |
| Secret | `VERCEL_TOKEN` | 有目标团队和项目部署权限的 Vercel token |
| Variable | `SUPABASE_PROJECT_REF` | 东京项目 `jmmwgdyfcmonzqkurcly` |
| Variable | `VERCEL_ORG_ID` | 当前团队 `team_cU33prMrSFgbhI1qNpC2fmnw` |
| Variable | `VERCEL_PROJECT_ID` | 当前项目 `prj_GETdvx0784lNbGkn0MnLa6DOTMjy` |

这些 ID 来自已核对的项目配置，切换目标时需重新核对。东京切换使用 `production` environment 的 Supabase 覆盖值，仓库级巴黎配置保留用于回退；不要混用两层中的项目地址和密码。迁移步骤及回退边界见 [东京切换记录](migrations/tokyo-cutover.md)。缺少任一配置时发布在云端写入前失败。配置凭据后可在 Actions → CI and production deployment → Run workflow 选择 `main` 首次发布；也可等待下一次合并。建议把 `Check and test` 设为 main 分支保护的必需检查。

Vercel 项目根保持仓库根，Production 中需已有 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`、`VITE_API_BASE_URL`。工作流校验前端指向本次部署的 Supabase 项目，再开始构建。Supabase 的运行时 secrets（例如专用 `DATABASE_URL`、`ALLOWED_ORIGINS`、`MCP_PUBLIC_URL`）和 Auth provider/回调配置仍在 Supabase 管理，不从仓库覆盖。**自动发布代码不会自动开通 Google/GitHub 登录。**

`jobs`、`github-webhook` 尚需单独配置 GitHub 凭据、HMAC、后台 token 和 Cron，暂不纳入自动发布；按下文后台任务流程单独启用。Supabase CLI 固定为 3.0.0，Vercel CLI 固定为 65.12.1；升级时一起核对参数和部署结果。

发布不是跨服务事务：迁移成功后若函数或 Vercel 发布失败，已执行的迁移不会撤销。迁移必须兼容旧前端/函数，破坏性变更拆分发布。修复原因后重新运行失败的 job，或重新运行 main 工作流；已应用迁移由 Supabase 迁移记录跳过。前端紧急恢复可使用 Vercel 的历史部署回滚，后端可从已验证版本手动重新部署函数；数据库用新迁移向前修复，不自动执行 down/reset，恢复备份需单独评估。

## MCP

真实登录本地服务：`http://127.0.0.1:18471/mcp`。免登录 preview 仍为 `/w/WORKSPACE/mcp`，不得用于验证真实 OAuth。

托管统一入口：`https://PROJECT.supabase.co/functions/v1/mcp/mcp`；只读目录为 `/mcp/readonly`。Workspace 由授权记录确定。旧 `/w/WORKSPACE/mcp` 仅在 URL 与既有授权一致时可用，旧凭据需要重新授权。

资源 metadata 指向 Roster OAuth broker。`OAUTH_PUBLIC_URL` 默认为授权页所在 origin，`OAUTH_CONSENT_URL` 默认为第一个 `ALLOWED_ORIGINS` 加 `/oauth/consent`。多域部署需明确设置二者，并与 Supabase 的 Site URL/授权页一致。根目录 vercel.json 将公开 AS discovery 与 authorize/token/register 路由代理到当前托管 MCP Function；更换 Supabase 项目时同步更新这些公开目标。真实本地 OAuth 使用后端 origin 设置 `OAUTH_PUBLIC_URL`，无需前端代理。

未认证请求返回 401，`WWW-Authenticate` 指向同基址下的资源 metadata。OAuth broker 由 Roster 提供，Supabase Auth 负责身份签发、PKCE 与刷新，授权 UI 是 Roster 前端；客户端不能使用 Supabase service-role key 代表用户。

当前验证了 JWT 签名、issuer、audience、过期时间和用户角色，以及 discovery、结构化工具输出。Supabase 默认 audience 是 `authenticated`，不是某一个 MCP URL；Roster 不把 audience 当作工作区边界：第三方 OAuth token 必须有通过 code exchange 精确绑定的 session grant；普通 REST 拒绝第三方 OAuth token。只读授权的写工具不注册，手工调用也无法执行。read/write scope 由 broker 映射成应用权限，上游只使用标准 OIDC scope。详细边界见 [授权设计](auth/mcp-authorization.md)。真实托管 OAuth 登录、刷新和各客户端兼容性仍须部署后端到端验收；本地签名 JWT、数据库和模拟上游的测试不等同于托管验收。

## 已保留的权限语义

- 每次调用都检查工作区成员 active 状态；Admin 不自动获得私有 Team 内容权限。
- 邀请只授 Member；重置使旧链接失效，已停用成员不能靠邀请恢复。
- 最后活动 Workspace Admin 的修改与检查在事务内完成。Team 可以没有 Owner；管理员保留设置管理权，但访问私有内容仍需显式加入。
- 工作区写操作锁定 Workspace 行，先保证并发权限和编号正确；后续按实际争用数据收窄锁粒度。
- 任务编号、任务行和审计事件原子提交。失败不消耗任务编号。

## 后台任务与 GitHub

GitHub 集成使用 GitHub App。当前由服务端运维配置绑定，设置页尚不支持自助安装。GitHub 登录与仓库授权独立。自动发布仍只部署 api/mcp；生产启用需要另外完成以下配置和真实 App 验收。

1. 创建 GitHub App，仓库权限只选 Metadata read 和 Pull requests read，订阅 Pull request 事件。安装时只选择要同步的仓库。不需要 OAuth 回调或 Setup URL：Roster 不接受 installation_id 回调作为 Workspace 授权。
2. 在服务端 Secrets 配置 GITHUB_APP_ID、GITHUB_APP_PRIVATE_KEY（GitHub 下载的 PEM，支持 PKCS#1/PKCS#8）、GITHUB_WEBHOOK_SECRET、独立随机 JOBS_TOKEN。已有 DATABASE_URL 继续使用仅获 roster_app 权限的运行时账户。私钥和 token 不进入前端、Git 或日志。
3. 配置 GITHUB_BINDINGS JSON。例如：

   ```json
   [{"workspace":"roster","repo":"owner/repository","installationId":123,"repositoryId":456,"completion":"manual"}]
   ```

   Workspace 是 slug；installationId 和 repositoryId 是正整数，分别取自 App 安装信息和 GitHub 仓库 API。绑定是运维对 Workspace 的授权决定；后台还会用限定到 repositoryId 的 installation token 验证仓库 ID 和名称。每个仓库只允许绑定一个 Workspace，重名或重复 ID 启动即报错。仓库改名需更新绑定；不匹配时停止处理，不按同名仓库猜测权限。
4. 先应用迁移，再部署 jobs、github-webhook 两个 Edge Function（仓库 supabase/config.toml 已关闭平台 JWT 校验，入口分别使用 JOBS_TOKEN 和 GitHub HMAC）。App webhook URL 为 https://PROJECT.supabase.co/functions/v1/github-webhook，Content type 为 application/json，Secret 与 GITHUB_WEBHOOK_SECRET 一致，开启 SSL 验证。
5. 在 Supabase Cron 中每分钟 POST https://PROJECT.supabase.co/functions/v1/jobs，从 Vault 读取 JOBS_TOKEN 并设置 Authorization: Bearer 请求头。Cron 消费持久化事件；正常空闲时不查询 GitHub。每轮最多处理每仓库 20 个不同 PR 的事件组、一个新的对账页，重复上一页以覆盖分页移动。并发执行由仓库租约隔离。事件处理通常等待下一个分钟调度，积压或退避会延长延迟。

Webhook 限制 1 MiB，校验原始字节的 HMAC SHA-256、事件 action、installation/repository ID 和 X-GitHub-Delivery UUID。只保存 PR 编号、路由和投递元数据，不保存 payload 或 PR 正文；额外保存已验签原始字节的 SHA-256 摘要，防止重放时替换未签名的 delivery header；成功持久化后返回 202。同一 PR 已排队事件按处理开始前的数据库时间合并，读取期间新到的事件保留到下一轮。重复 delivery 或相同正文摘要是 no-op，DB 失败返回 503，未绑定仓库/无关事件返回 204。worker 在数据库事务外重新读取该 PR 的当前事实，防止乱序 payload 回退状态。PR 展示合同不变；标题、分支名中的任务编号及正文中的显式 Fixes/Closes/Resolves 编号可建立关联，编辑后删除的关联会移除。

首次绑定会分页导入全部历史 PR，仅建立关联，绝不修改任务状态；页进度持久化，跨 jobs 续跑。初始导入期间的实时事件保持 pending，导入完成后再消费；已导入的相同事实也能在第一次实时消费时推进一次状态。完成导入后每 6 小时增量对账，以扫描开始时间为游标并向前重叠 5 分钟；只有完整扫描成功才推进完成游标。扫描中变化在下一次对账再次读取。失败保留当前页，15 分钟后重试。

completion 默认 manual：实时 PR 事实变化可将待处理/进行中任务推进 In review，合并仍等待人工验收。显式选择 closing_reference 时，只有连接后发生的合并、存在 Fixes/Closes/Resolves KEY-n 完成声明、且任务所有已知关联 PR 中没有 open/draft，才可自动 Done。普通 closed 不完成任务；done/canceled 永不回退；重复未变化的事实不覆盖人工状态修改。已知关联无法证明所有必需 PR 或验收已完成，需要人工验收的团队保持 manual。

失败事件按 30 秒起、指数退避至 1 小时重试，尊重 GitHub Retry-After / rate-limit reset，限制绑定整体请求直至解禁，最多 8 次（含领取后崩溃，同组投递合并计次）；之后记录 dead，并安排一次提前对账。新 worker 可接手过期租约，旧 worker 无法再提交或释放新租约。cycle 计算失败不阻止 GitHub worker，jobs 的响应会分别报告结果；重试或 dead 会返回 503。事件元数据作为去重凭据保留，不存凭据或正文。

运维排查读取 jobs 的 github 结果、github_deliveries 的 attempts/available_at/outcome/last_error，以及 github_sync 的 scan/reconcile_after/last_error。错误码不含远端响应或 token。GitHub 不自动重投失败 webhook：服务恢复后在 GitHub Deliveries 手动重投；重复已完成/已 dead 的投递不会复活。dead 事件修复原因后由受信运维明确重置 attempts=0、completed_at/outcome/last_error=null、available_at=now()；不要删除 delivery 记录规避去重。也可等待低频对账恢复 PR 的当前状态。

旧 PAT/评论回写配置须在启用前移除 GITHUB_TOKEN；GITHUB_LINKBACK=true 会启动报错，集成不再向 GitHub 复制任何任务内容。停止旧 jobs 并行运行后再应用本迁移、部署新代码和修改绑定；新旧 worker 不能混跑。已有绑定的 installation、仓库或 completion 策略不一致时，worker 报错并跳过，不覆盖存储身份。更换配置须停旧 Cron/worker，由受信运维明确将对应 github_sync 行的 binding_key、lease_token、lease_until 设为 null，再部署新配置；首次采用新身份会重置导入进度和 connected_at，旧绑定事件被忽略。更名应先移除旧名称对应的绑定状态后启用新名称。移除配置后该绑定不再消费；历史 PR 展示数据保留。回退先停 Cron 和新 webhook，再回退代码与数据库备份，不能只运行旧代码读取已移除 requested_at 的 schema。

本地普通入口是 /jobs/run 与 /webhooks/github。免登录 preview 不开放系统入口。验证用独立测试 Workspace/仓库绑定：签名事件入库、worker 更新 PR 与 In review、重复投递无重复审计、合并后 manual 保持等待验收。单元和数据库测试使用模拟 GitHub 响应，不替代真实 App、远端 Cron、撤销安装和生产部署验收。

协议依据：[GitHub webhook 最佳实践](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)、[失败投递处理](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries)、[GitHub App installation token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)、[支持的 REST API 版本](https://docs.github.com/en/rest/about-the-rest-api/api-versions)。HTTP 适配器固定使用 2026-03-10。

## 本地追加迁移

使用管理员连接运行 `DATABASE_URL=... node scripts/toolchain.mjs deno run --allow-env --allow-net --allow-read scripts/migrate.ts`。此脚本只接受 loopback 数据库并保存迁移校验和，拒绝修改已经应用的迁移。仅当数据库原来手动应用了首个迁移时，首次加 `--baseline-initial`；它不会跳过后续迁移。托管环境仍统一使用 Supabase CLI。

### Spec 修订状态

新修订使用 `draft`、`review`、`active`，界面对应 Draft、In review、Active。编辑生效版时默认起草新修订；只有显式选择 Active 才替换现行版本。目录与详情 API 的 `revision` 是可编辑的最新修订，`active_revision` 是当前生效修订的编号与标题（尚无生效版时为 null）。详情默认展示生效正文，评审仍可查看最新修订。Issue 完成数独立计算。

历史 `approved` 按 Active 读取，旧客户端提交该别名也会写为 `active`；历史 `superseded` 仅可读取，且不会使更早的生效版重新生效。无需改写历史行或执行数据库迁移。

### Spec–Issue 关联回归

在独立 `_test` 数据库上运行：

```sh
ROSTER_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/roster_spec_links_test node scripts/toolchain.mjs deno test --allow-env --allow-net --allow-read packages/backend/src/modules/spec_links_test.ts packages/backend/src/modules/spec_test.ts packages/backend/src/transport/transport_test.ts
```

覆盖双端与跨 Team 权限、跨 Workspace 外键、成员停用、并发重复关联、批量回滚、解除关联的幂等性、状态与修订独立、超过 50 条数据的完整查询和分页，以及 REST/MCP 交叉读写。部署前须应用 `20261103000100_spec_issues.sql`；前端需要同版本后端。


### MCP 统一任务写入

`save_issue` 是任务创建和编辑的统一 MCP 入口。不传 `identifier` 时创建，必填 `team` 与 `title`；传入 `identifier` 时更新，禁止传 `team`。省略字段保留原值，`assignee: null` 清空负责人。

`add_labels` / `remove_labels` 接受精确标签名称或数字 ID；`blocks` / `blocked_by` / `related_to` 增加关系，`remove_blocks` / `remove_blocked_by` / `remove_related_to` 删除关系。`links` 追加 `{title, url}`，已有相同标题和 URL 的链接不重复添加。标签和关系的增删不能包含同一个目标；标签分组互斥、私有任务可见性和依赖无环校验照常生效。

基础字段、标签、关系与链接在一个数据库事务中提交，任一操作失败时全部回滚。重试同一更新不会重复增加关系、标签或相同链接；创建请求没有客户端幂等键，网络结果不明时先查找任务，避免重复创建。

原先多任务标签修改改为逐任务调用 `save_issue`，每个任务单独保证原子性。

旧 MCP `create_issue`、`update_issue`、`change_issue_labels`、`add_relation`、`remove_relation`、`add_link` 已移除，客户端需要刷新工具清单。网页所用 REST 资源接口仍独立提供。

```json
{"team":"Roster","title":"修复 OAuth 回调","assignee":"me","add_labels":["auth"],"blocks":["RST-17"],"links":[{"title":"PR","url":"https://github.com/DengNaichen/Roster/pull/58"}]}
```
