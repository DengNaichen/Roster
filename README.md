# Roster

面向人和 Agent 的任务工作区。React 页面与 MCP 共用 TypeScript 业务层，Supabase 提供 Postgres、Auth 和 Edge Functions，Vercel 托管前端。

当前是独立重写的首个可运行切片，旧 InfTask 保持独立运行。这里不连接旧库，也不自动迁移正式数据。

## 当前范围

- Workspace 创建与切换、Admin/Member、停用与恢复、可重置的邀请链接。
- Team、公开/私有可见性、成员与 Owner 管理。
- 任务创建、列表、详情、更新与审计记录；事务分配编号。
- REST、MCP、Supabase JWT 校验、网页登录与 OAuth 授权界面。

Projects、Initiatives、Labels、Cycles、评论、Agent 工作记录/接票、GitHub 同步和旧数据导入尚未迁移。本仓库没有 CI/CD；验证和部署手动执行。

## 目录

| 路径 | 职责 |
| --- | --- |
| `apps/web` | React/Vite 前端 |
| `packages/contracts` | 公共 DTO 和严格输入 schema |
| `packages/backend/src` | 业务、权限、数据库、HTTP/MCP |
| `supabase/functions` | Edge 部署入口 |
| `supabase/migrations` | 唯一 SQL 迁移历史 |
| `scripts` | 本地开发入口 |

## 本地开发

前置：Node 22、Corepack、Deno 2、Supabase CLI 与 Docker。前端依赖由 pnpm 管理，后端 npm 依赖由 Deno 解析；两份锁文件均需保留。

```sh
corepack pnpm install
supabase start
supabase db reset
```

`db reset` 仅用于本地隔离 Supabase，不能对正式环境执行。通过 Supabase 输出获得本地 Auth URL 和 publishable/anon key。为后端配置独立数据库 login，将 `roster_app` 授予该 login；角色初始化见 [开发说明](docs/DEVELOPMENT.md)。

复制根 `.env.example` 为 `.env`，复制 `apps/web/.env.example` 为 `apps/web/.env`，填入本地配置。然后分别运行：

```sh
deno task dev
corepack pnpm dev
```

默认前端地址 `http://localhost:5173`，后端 `http://127.0.0.1:8787`。如果端口已占用，换端口并同步 API、Origin、Auth callback 和 MCP 地址。

## 验证

```sh
corepack pnpm build
corepack pnpm test:web
deno task check
deno task test
```

数据库集成测试需要显式提供隔离测试数据库地址，详见 [开发说明](docs/DEVELOPMENT.md)。未提供数据库时跳过的测试不表示集成测试通过。真实 Supabase 登录、OAuth 客户端授权、Edge 网关和 Vercel 部署需单独验收。

## 身份与权限

浏览器和 MCP 的身份均来自固定 Supabase 项目签发的用户 JWT。邀请、工作区角色和私有 Team 权限由业务层每次检查。业务表位于未通过 Data API 暴露的 `roster` schema，浏览器角色没有表访问权限。数据库连接不自动继承用户 JWT，也不依赖 RLS 替代业务鉴权。

MCP 使用 Supabase 默认 `authenticated` audience，提供受保护资源发现。**目前没有实现资源专属 JWT audience 绑定，也未验证完整远端 OAuth 流程；不能将此首版当作已经通过 MCP OAuth 合规验证的生产部署。**

## 手动部署

部署步骤、环境变量和未验证边界见 [开发说明](docs/DEVELOPMENT.md)。不得把 `DATABASE_URL` 或 service-role key 写入任何 `VITE_*` 变量。
