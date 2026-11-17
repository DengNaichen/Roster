# MCP 工作区授权

关联 SPEC-1、RST-16、RST-17。阶段：Ground 已完成；Sketch 已确定；Implement 已完成；Verify：本地数据库/JWT、适配器、前端和质量检查通过，托管 OAuth 尚待验收。

## 使用流程与接口

客户端连接统一 `/mcp`，从资源 metadata 发现 Roster 的 OAuth broker。broker 的 authorize/register/token 接口转交 Supabase 做客户端、回调 URI、PKCE 和 refresh 验证。授权页显示已验证请求的客户端 ID、回调地址和权限上限，由用户选择工作区与权限。身份显示仍由网页登录提供。

`OAuthService.authorize(params)` 捕获 Supabase 重定向中的 authorization_id，保存该请求的 client/redirect URI/权限上限；网页不会直接请求上游 details。`details(ctx, id)` 只读取 broker 请求摘要及当前用户工作区。`approve(ctx, bearer, id, workspace, access)` 检查成员资格、锁定请求，再向 Supabase 获取 code，保存 code 的 SHA-256 与用户所选授权。自动批准和首次批准均经过这条绑定路径。

`token(request)` 在 code exchange 前核对 code hash；Supabase 验证 PKCE 并签发 JWT 后，再验证签名及 subject/client_id/session_id。不可变 grant 以 session_id 为键，保存 workspace/access 后才返回 token。刷新只使用既有 grant，绝不重绑工作区。同一用户/客户端可有多个独立授权。

`context(ctx)` 每次请求读取 grant 并复查当前成员资格。普通 REST 拒绝所有第三方 OAuth token；不允许从缺少 grant 的 OAuth 凭据退回网页登录身份。只读 endpoint 和 grant 取权限交集。

## 取舍与依据

Supabase OAuth Server 暂不支持自定义 scopes。Roster broker 将 read/write 转成自身权限上界，对外只提供 read/write，不宣称提供 OIDC 身份服务；上游固定使用 email 身份 scope，注册和 token 响应对外返回 Roster 权限 scope。刷新不能改变授权权限，改变权限需重新连接。授权记录不使用 user_metadata，也不使用 user+client 的最近选择。只读请求不能在授权页提升权限。

直接用 hook 无法把 authorization_id 传到 token session；只在网页写客户端选择会导致并发串授权。独立实现完整 OAuth server 会重复 Supabase 已有 PKCE/refresh 功能。采用 code exchange 边界连接两者。Herdr server 未运行，跨模型 arena 未执行，依据为已核实源码与用户批准的模型。

资料：
- https://supabase.com/docs/guides/auth/oauth-server/oauth-flows
- https://supabase.com/docs/guides/auth/oauth-server/token-security
- https://linear.app/docs/mcp

## 迁移与故障处理

旧 OAuth 凭据没有 grant，必须重新授权；不得自动补成全账号权限。上游 code 已兑换但本地保存失败时不返回 token，用户需重新连接。原始 code、access token、refresh token 不持久化、不写日志。授权请求的短期摘要保存 code hash；grant 可以独立撤销，成员停用也实时生效。部署需先迁移数据库，再部署后端和授权页；不要求改变 Supabase token hook。
