# OAuth 授权请求 ID 的托管回归

PR #53 部署后的真实授权请求返回 server_error。直接读取上游 authorize 的 302 Location 确认：Supabase 的 authorization_id 是 32 位不透明字母数字字符串，不是内部行 UUID。原实现把 broker 请求主键和网页 API 校验都定义为 UUID，数据库首先拒绝插入。原测试使用 randomUUID 伪造上游 ID，未覆盖这个协议边界。

修复将请求主键迁移成 text，已有 UUID 形状的请求按原文保留；入口与上游响应共用有界 URL-safe 字符串 schema。client_id/session_id 仍按各自已核实的 UUID 协议处理，授权能力和 grant 绑定不变。

回归先使用实际格式的非 UUID ID 重现 invalid input syntax for type uuid，再验证 authorize 存储、网页 GET/POST consent、code exchange 和 refresh 全链路。另验证迁移保留旧 UUID 形状的请求，不修改原始已应用 migration。

开发时 roster-self 因旧凭据缺少 grant 返回 403，无法读写正式任务；修复记录暂保存在此文档和 PR，连接恢复后通过 MCP 回写，不使用管理员 SQL 绕过应用权限。生产修复仍需真实 OAuth 重连确认，不把本地模拟上游的测试当作托管验收。
