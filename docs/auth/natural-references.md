# MCP 自然引用

关联 RST-18。引用解析集中在 transport/mcp/references.ts，输出仍是现有业务服务使用的 key/subject；权限规则由原有服务再次执行。

- Team：key 或 ID 优先，其次精确名称（不区分大小写）。普通业务工具只查可访问团队；团队管理使用既有目录能力，后续操作仍检查管理权限。
- 用户：ID 直接传递，me 使用当前身份；其余先匹配完整姓名或邮箱，再匹配姓名片段。多个匹配返回 invalid_input 与 candidates，不自动选择。指派只匹配 active 成员；成员管理可解析已停用成员。
- 字段省略保持不变；assignee:null 清除指派。历史空字符串指派仍等同 null，其余空引用无效。
- list_team_directory 是唯一目录入口，删除 team_directory 别名。create/update 工具仍分开，Spec、验收标准和工作日志操作保留。

服务端 instructions 与字段 schema 描述这些约定。引用失败不会执行写入；候选只来自当前可见目录，不能通过候选泄露私有团队。
