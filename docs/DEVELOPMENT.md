# 开发与手动部署

## 数据访问

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
```

常规 `deno task test` 未设置该变量时会跳过数据库测试。传输层测试使用本地生成的签名 JWT 和 service stub；只有数据库测试执行真实 SQL。两者都不能替代真实 OAuth 回调与托管网关验证。

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

前端会在基址后添加 `/api`。本地例子为 `http://127.0.0.1:8787`，托管例子为 `https://PROJECT.supabase.co/functions/v1/api`。三个 VITE 变量是构建时配置，修改后需要重建。

## Supabase 手动部署

1. 创建独立 Supabase 项目，启用 ES256 或 RS256 JWT 签名；应用不接受旧 HS256 签名。
2. `supabase link --project-ref PROJECT_REF` 绑定**新项目**。核对项目后，用 `supabase db push` 应用 migrations。
3. 配置专用数据库 login 和后端 secrets。`SUPABASE_URL` 在托管函数环境由平台提供；其余应用变量通过 secrets 设置。不要上传前端配置为数据库凭据。
4. `supabase functions deploy api` 和 `supabase functions deploy mcp`。`verify_jwt=false` 允许 discovery 和 OPTIONS 到达函数；业务请求由函数内部 JWT 验证保护。
5. 在 Auth 中配置网页 Site URL、登录邮件回调允许列表。登录链接会回到发起登录的页面，因此需明确允许部署域下的 `/auth/callback`、`/join` 和 `/oauth/consent` 等实际路径，不能允许任意外部域。
6. 启用 Supabase OAuth Server，授权页面设置为前端 `/oauth/consent`。根据目标 MCP 客户端配置预注册客户端或动态注册。

每个 Edge 函数的 `deno.json` 独立维护运行依赖。共享代码通过相对 import 打包；部署前还需在真实 Supabase CLI 下验证函数打包，不以仓库根 `deno check` 替代。

## Vercel 手动部署

在仓库根通过 Vercel CLI 手动创建/关联项目并部署，不连接 GitHub 自动部署。根 `vercel.json` 已配置安装命令、构建命令、`apps/web/dist` 输出目录和 SPA rewrite。项目根保持仓库根，确保共享 contracts 在构建上下文可见。

用户目前不需要 CI/CD：不配置 GitHub Actions，也不启用基于 push 的自动发布。执行发布时应使用显式的手动部署入口。

## MCP

本地：`http://127.0.0.1:8787/w/WORKSPACE/mcp`。

托管：`https://PROJECT.supabase.co/functions/v1/mcp/w/WORKSPACE/mcp`。

未认证请求返回 401，`WWW-Authenticate` 指向同基址下的资源 metadata。OAuth 授权服务器是 Supabase Auth，授权 UI 是 Roster 前端；客户端不能使用 Supabase service-role key 代表用户。

当前验证了 JWT 签名、issuer、audience、过期时间和用户角色，以及 discovery、结构化工具输出。Supabase 默认 audience 是 `authenticated`，不是某一个 MCP URL；因此当前不提供资源专属 Token 隔离保证。真实 OAuth 登录、刷新、撤销和客户端兼容性尚须托管端到端验证。

## 已保留的权限语义

- 每次调用都检查工作区成员 active 状态；Admin 不自动获得私有 Team 内容权限。
- 邀请只授 Member；重置使旧链接失效，已停用成员不能靠邀请恢复。
- 最后活动 Admin / Owner 的修改与检查在事务内完成。
- 工作区写操作锁定 Workspace 行，先保证并发权限和编号正确；后续按实际争用数据收窄锁粒度。
- 任务编号、任务行和审计事件原子提交。失败不消耗任务编号。
