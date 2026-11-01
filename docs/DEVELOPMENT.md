# 开发与手动部署

## 本机免登录预览

独立入口 `scripts/preview.ts` 固定使用本地开发者身份，首次启动创建示例 Workspace、两个 Team 和七条任务。它只接受 loopback 上、名称以 `_preview` 结尾的数据库，HTTP 只监听 `127.0.0.1:18471`，允许前端 Origin `127.0.0.1:5178` / `localhost:5178`。该入口不被 Edge Functions 引用。

先在隔离的本地 Postgres 创建 `roster_preview` 库、应用 migrations，并为本地 login 授予 `roster_app`。当前开发机已经在端口 55439 完成这一初始化。分别运行：

```sh
DATABASE_URL=postgresql://roster_preview_runtime@127.0.0.1:55439/roster_preview deno run --allow-env --allow-net scripts/preview.ts
VITE_LOCAL_PREVIEW=true corepack pnpm --filter @roster/web dev --port 5178 --strictPort
```

主 checkout 也可用 `deno task preview:api` 和 `deno task preview:web` 以上述默认值启动。次级 worktree 用 `scripts/new-worktree <branch>` 创建，或在其根目录运行 `deno task worktree:setup`：它分配稳定的独立端口和 `roster_wt_<id>_preview` 库并执行 migrations，之后同样用这两个 task 启动。分支与 worktree 的完整规则（位置、清理、GC）见 [git-workflow skill](../.agents/skills/git-workflow/SKILL.md)。

访问 `http://127.0.0.1:5178/roster`。修改保存在该本地数据库，重启不覆盖已有工作区。预览只有一个固定用户，不能用于验证多用户登录或 OAuth；生产构建即使设置 `VITE_LOCAL_PREVIEW=true` 也不会启用免登录。

## 数据访问

### 原前端兼容

前端保留 InfTask 的 History 路由、`useResource` 和 `useRequestScope`，迁移不以更换路由/请求库为前提。`src/integration` 处理 Supabase 会话和本地预览，`shared.api` 保持原调用签名。

`GET /api/w/:workspace/capabilities` 在页面挂载前声明已实现能力，当前全部启用；获取失败会阻断并提供重试。原组件读取的项目、标签、周期、评论、工作记录、关系和 PR 均来自真实存储；独立 Specs 的文档与修订同样来自真实服务。

`packages/backend/src/transport/compat.ts` 负责 REST 兼容：列表提供原 `{issues}`，详情/状态更新按原形状返回，处理原表单的清空字段，并保留真实负责人筛选和历史。MCP 保留旧工具名称/输入语义；`list_issues` 的零 limit 使用默认值，负 limit 返回全部，支持优先级和更新时间排序。

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

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm test:web
deno task check
deno task test
```

真实数据库测试要求一个**可创建测试角色、名称以 `_test` 结尾的隔离数据库**。测试会应用 schema、创建受限测试 login，并清理本次随机工作区；不要填写开发者已有数据库或生产地址。

```sh
ROSTER_TEST_DATABASE_URL=postgresql://USER@127.0.0.1:PORT/roster_test deno test --allow-env --allow-net --allow-read packages/backend/src/service_test.ts
ROSTER_TEST_DATABASE_URL=postgresql://USER@127.0.0.1:PORT/roster_spec_test deno test --allow-env --allow-net --allow-read packages/backend/src/modules/spec_test.ts
```

全套真实数据库测试还读取 `ROSTER_ACTIVITY_TEST_DATABASE_URL`（数据库名必须为 `roster_activity_test`）、`ROSTER_INTEGRATIONS_TEST_DATABASE_URL` 和 `ROSTER_IMPORT_TEST_DATABASE_URL`；后两者使用隔离 `_test` 库，导入测试要求没有工作区。每个测试创建自己的数据并清理。`deno task test` 未设置相应变量时会跳过该数据库测试。传输单元测试使用签名 JWT 与 stub；活动与独立 Spec 测试另通过真实数据库跨 REST/MCP 写读；Spec 套件覆盖全部 6 个 REST 路由、6 个 MCP 工具、版本冲突和历史只读。

## 配置

| 环境 | 变量 | 含义 |
| --- | --- | --- |
| 后端 | `DATABASE_URL` | 专用数据库 login 的连接串 |
| 后端 | `SUPABASE_URL` | 固定 Auth 项目 URL |
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

在仓库根通过 Vercel CLI 手动创建/关联项目并部署，不连接 GitHub 自动部署。根 `vercel.json` 已配置安装命令、构建命令、`apps/web/dist` 输出目录和 SPA rewrite。项目根保持仓库根，确保共享 contracts 在构建上下文可见。

用户目前不需要 CI/CD：不配置 GitHub Actions，也不启用基于 push 的自动发布。执行发布时应使用显式的手动部署入口。

## MCP

本地：`http://127.0.0.1:18471/w/WORKSPACE/mcp`。

托管：`https://PROJECT.supabase.co/functions/v1/mcp/w/WORKSPACE/mcp`。

未认证请求返回 401，`WWW-Authenticate` 指向同基址下的资源 metadata。OAuth 授权服务器是 Supabase Auth，授权 UI 是 Roster 前端；客户端不能使用 Supabase service-role key 代表用户。

当前验证了 JWT 签名、issuer、audience、过期时间和用户角色，以及 discovery、结构化工具输出。Supabase 默认 audience 是 `authenticated`，不是某一个 MCP URL；因此当前不提供资源专属 Token 隔离保证。真实 OAuth 登录、刷新、撤销和客户端兼容性尚须托管端到端验证。

## 已保留的权限语义

- 每次调用都检查工作区成员 active 状态；Admin 不自动获得私有 Team 内容权限。
- 邀请只授 Member；重置使旧链接失效，已停用成员不能靠邀请恢复。
- 最后活动 Workspace Admin 的修改与检查在事务内完成。Team 可以没有 Owner；管理员保留设置管理权，但访问私有内容仍需显式加入。
- 工作区写操作锁定 Workspace 行，先保证并发权限和编号正确；后续按实际争用数据收窄锁粒度。
- 任务编号、任务行和审计事件原子提交。失败不消耗任务编号。

## 后台任务与 GitHub

`jobs` Edge Function 的 POST 用独立 `JOBS_TOKEN`（`Authorization: Bearer ...`）认证，先补算周期，再同步配置的 GitHub 仓库。`github-webhook` 仅验证 GitHub HMAC、限制 1 MiB 请求体，并将已配置 repository 的同步请求持久化；payload 不能直接改变任务。用 `supabase functions deploy jobs` 和 `supabase functions deploy github-webhook` 手动部署。

配置 `GITHUB_BINDINGS` 为 JSON，例如 `[{"workspace":"default","repo":"owner/repository"}]`，并提供仅能访问所需仓库的 `GITHUB_TOKEN`。`GITHUB_WEBHOOK_SECRET` 与 GitHub webhook 配置一致，URL 为 `https://PROJECT.supabase.co/functions/v1/github-webhook`。默认 `GITHUB_LINKBACK=false`；设为 true 会向 GitHub 回写任务内容，私有 Team 只回写编号。

在 Supabase Cron 中每分钟 POST `https://PROJECT.supabase.co/functions/v1/jobs`，从 Vault 取 `JOBS_TOKEN` 作为 Bearer header。URL 与 secret 必须按部署环境配置，不在迁移 SQL 中硬编码。本地普通开发入口等价路径是 `/jobs/run` 与 `/webhooks/github`。免登录 preview 不开放这些系统入口，只用本机定时器推进周期。

GitHub 同步通过数据库租约防止并行 worker 重复执行；只有完整读取成功才推进游标。回写包含稳定标记，重试先核对远端评论。请求有超时，失败返回可重试结果；重复 webhook 会合并，定时拉取补漏。周期按团队事务处理，单次最多补算 5000 期，超限整体回滚并报告错误。

## 本地追加迁移

使用管理员连接运行 `DATABASE_URL=... deno run --allow-env --allow-net --allow-read scripts/migrate.ts`。此脚本只接受 loopback 数据库并保存迁移校验和，拒绝修改已经应用的迁移。仅当数据库原来手动应用了首个迁移时，首次加 `--baseline-initial`；它不会跳过后续迁移。托管环境仍统一使用 Supabase CLI。
