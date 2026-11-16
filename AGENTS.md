# Roster 开发约定

不要主动提出后续可选项。

Git、worktree、提交和 PR 操作遵循 `.agents/skills/git-workflow/SKILL.md`。

## 使用 Roster 管理自身开发

- 正式 Workspace：`roster`；Team：`Roster`，key 为 `RST`。
- Codex MCP server：`roster-self`，地址配置在 `.codex/config.toml`。本机全局的 `roster` server 用于 MCP Gateway，不能把本仓库的任务写入那个 Workspace。
- 首次连接用 `codex mcp login roster-self` 完成 OAuth 授权。配置文件中只保存公开地址，不保存 Token、Client Secret 或数据库凭据。
- 通过 MCP 调用 `list_teams`，确认能看到 `RST` 后再读写任务。连接失败时报告实际错误，不能用 Supabase 管理员 SQL 绕过应用权限。
- 有明确任务编号时，先读取最新任务及关联 Spec。没有任务编号时，先查找同一需求，避免重复建票；需要创建时使用 `RST` Team。
- 开始实质开发时记录任务状态与计划。任务正文使用 MCP schema 定义的结构化 `document`，更新前先读取并保留已有内容。
- 在任务中记录相关分支、PR 链接、验证结果和剩余问题。开 PR 后标为 In review；只有实际验收完成后才标为 Done。
- 测试使用独立测试 Workspace、Team 或本地预览数据库。真实开发需求保留在正式 `roster` Workspace，不用演示数据替代 dogfooding。
