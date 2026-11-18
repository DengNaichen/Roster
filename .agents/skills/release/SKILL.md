---
name: release
description: "准备、检查和发布 Roster 的版本与 GitHub Release；用于确定版本号、整理发布说明、核对部署状态或执行正式发布。日常分支、PR 和代码部署仍遵循 git-workflow。"
---

# Roster Release

Roster 采用“合并 `main` 持续部署 + 里程碑式 Release”模式：日常 PR 合并到 `main` 后由 GitHub Actions 自动部署生产，积累到阶段性改动后通过 GitHub tag 和 Release 固化对外版本快照，不要求每个 PR 都发版本。不批量修改私有 package 的 version。

## 版本

- 首版从 `v0.1.0` 开始。每次准备版本前先读取远端 tags 与 Releases，按上个正式版本以来的实际改动确定版本号，避免重复或倒退。
- Patch（`v0.1.1`）：问题修复、小幅体验改进，不要求用户或客户端调整。
- Minor（`v0.2.0`）：完整新能力，或接口、配置、数据库有需要关注的变化。`0.x` 阶段的不兼容变化也升 minor，并在发布说明中写明迁移方式。
- `v1.0.0`：核心流程与对外接口具备稳定承诺后发布，不预设日期。此后不兼容变更升 major，兼容新能力升 minor，兼容修复升 patch。
- 预发布验证使用 `v0.2.0-rc.1` 等格式，标为 GitHub prerelease，不设为 latest。候选版须在 `main` 历史上且 CI 通过，可先于生产核对发布，但不能替代正式版流程。

## 发布依据

先按 [git-workflow](../git-workflow/SKILL.md) 核对仓库状态，记录本次版本、完整目标 SHA、上个正式版本及关联 PR，并确认以下各项：

1. **工作流通过**：目标完整 SHA 在 `main` 历史上，该 SHA 对应的 `CI and production deployment` 工作流中 `Check and test` 与 `Deploy production`（数据库迁移、API/MCP、前端部署）全部成功；不能用另一个提交的绿灯代替。
2. **部署记录与连通核对**：核对 GitHub `production` deployment 最新成功记录指向目标 SHA，并做一次生产连通性只读核对（确认前端生产域名与 API/MCP 端点正常响应，如请求 `/mcp` 发现端点或页面可访问）。未验证或未启用的能力写入“已知限制”。
3. **兼容性与独立组件说明**：数据库、MCP 工具、配置或登录流程有变更时，核对升级顺序与客户端兼容说明（如 MCP 客户端需刷新 schema）。`jobs` 和 `github-webhook` 当前不随日常 `main` 工作流自动部署，涉及变更时单独核对并注明。

以上任一工作流或连通核对未通过时，只准备发布说明草稿并列明阻塞项，不创建 tag 或发布 Release。草稿保存在仓库外临时文件或 Roster 任务中，不在主 checkout 留未提交文件。只读核对与本地草稿准备可直接执行；创建 tag 或 GitHub Release（含 draft/prerelease）须由用户授权，授权且条件满足后直接执行，不重复询问。

## 发布说明

用中文按用户可感知的变化组织，不直接堆砌提交或 PR 标题。只保留有内容的栏目：

- 新增
- 改进与修复
- 升级注意：不兼容变更、迁移、配置或客户端刷新提示
- 已知限制：尚未启用、独立部署或待验证的边界

附完整目标 SHA、上个版本参考、生产工作流链接与关联 PR，便于追溯。

## 创建与核对

Release 不触发另一套生产部署；不为打版本重跑部署或修改 production 配置。

1. 确认远端 tag 与 Release 名称未被占用。
2. 创建指向已核对目标 SHA 的 annotated tag 并显式推送该 tag（不依赖默认分支此刻的 HEAD）。
3. 使用 `gh release create <tag> --verify-tag --title <版本标题> --notes-file <说明文件>` 创建 Release：正式版标为 latest，候选版使用 `--prerelease --latest=false`。
4. 若发生网络中断，先读回远端 tag 的解引用 SHA 和 Release 状态再续跑；已有 tag 仅在指向预期 SHA 时才继续创建缺失的 Release，名字已被不同提交占用时停止并报告，不覆盖。
5. 发布后读回 tag、Release、`prerelease`/`latest` 与目标 SHA 确认一致。已发布的 tag 永不移动或覆盖，后续问题通过新版本修复。
