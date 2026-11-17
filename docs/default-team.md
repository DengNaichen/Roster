# 创建工作区与默认团队

关联 RST-20。createWorkspace 接受可选 team_key，在一个事务中创建工作区、管理员成员资格、同名公开 Team 和创建者的 Team owner 成员资格；创建响应增加必填 default_team_key。Team key 省略时使用共享 deriveTeamKey 规则，非拉丁名称回退到 slug，再回退 TEAM。

网页新建表单同时确认工作区名、slug 与可编辑的 Team key，失败时保留输入；成功后直接导航默认 Team 的任务列表。重命名流程不创建团队，不修改既有工作区。旧调用方省略 team_key 仍可创建，只是新工作区会自动附带团队；显式创建同 key 的第二个团队会像往常一样冲突。

验证：隔离数据库覆盖默认团队与 owner、数据库插入失败整体回滚、重复 slug 不产生第二个团队、既有无团队工作区不会被回填、REST/MCP 创建后立即创建任务。前端覆盖取消、失败重试、自定义 key 与首条 Todo 任务。ego-browser 在独立 preview 实际创建 Default Team Verification，修改 key 为 VFY，自动进入 Team issues 并成功创建 VFY-1，Todo 列表可见。
