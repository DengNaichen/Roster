---
name: git-workflow
description: "管理 Roster 的分支、worktree 及其本地预览隔离、提交、GitHub PR、合并和合并后清理。开始任何代码修改、创建或删除分支/worktree、提交、开 PR、合并或整理分支时使用。"
---

# Git Workflow

本 skill 拥有 Roster 的 Git 操作流程。远端只有 GitHub `DengNaichen/Roster`（`origin`），用 `gh` 操作，首次使用前检查 `gh auth status`。本仓库没有 CI/CD，验证在本地执行。

## 开始前检查

修改前先核对：当前分支、`git worktree list --porcelain`、未提交改动、未推送提交（`git log @{u}..` 或与 `origin/<branch>` 比较），并 fetch `origin/main`。

- 目标 worktree dirty、分叉或基线不明时，先弄清归属；不静默 stash、覆盖或混入他人工作。
- 已处于本任务的 worktree、用户指定了其他基线或网络不可用时，说明适用的例外。

## 分支

- `main` 是唯一长期分支，只通过 PR 修改；不直接在 `main` 上提交，也不把未提交改动留在主 checkout。
- 一个分支只交付一件事。命名为 `<短英文名>`：全小写、连字符分隔，描述内容而不是阶段（`settings-labels-tab`，而不是 `bootstrap`、`wip`、`fix`）。
- 有实现依赖时用堆叠分支 `<短名>-on-<基分支短名>`，以前置分支为基线；前置分支合并后接回 `main`。
- 分支合并后即删除，**不复用**。合并后的新工作从最新 `main` 另开分支。分支名不能作为“已合并”或“可丢弃”的证据，以提交是否为 `main` 的祖先为准。

## Worktree

### 位置与归属

- 主 checkout（`git worktree list --porcelain` 第一项，即 `~/Developer/Roster`）停在 `main`，只用于默认预览、同步和清理，不在其中写代码。
- 手工创建的 worktree 统一放在 `<主 checkout 父目录>/roster-worktrees/<branch-slug>`，分支中的 `/` 替换为 `-`。不使用 `/tmp`、`/private/tmp` 或仓库内目录。
- 宿主自行管理的 worktree（Claude Code 的 `.claude/worktrees/`、Codex App 的 `~/.codex/worktrees/`）由宿主负责位置和生命周期，不受位置约束，但同样要运行 setup 和清理。
- 一个分支最多一个可写 worktree；并行路线先拆分支或使用堆叠分支。

### 创建

```sh
scripts/new-worktree <branch> [--base <ref>] [--no-setup]
```

- 默认基线 `origin/main`；脚本只 fetch 所选基线分支，fetch 失败或远端分支已删除时停止，**不使用过期的本地缓存**。
- 新分支以 `--no-track` 创建，不会把 `origin/main` 继承为 upstream；首次推送时用 `git push -u origin <branch>` 设置自己的 upstream。
- 已有分支直接检出，此时不要传 `--base`。
- Git 创建失败不自动删除分支；检查 `git worktree list`、分支 tip 与目标路径后再重试。
- 创建后自动在新 worktree 根运行 `deno task worktree:setup`；setup 失败时保留 worktree，修复原因后在其根目录重跑。宿主管理或用 `git worktree add` 手工创建的 worktree 必须显式运行同一 setup，不另写初始化步骤。

### 运行时隔离

实现位于 [`scripts/worktree-runtime.ts`](../../../scripts/worktree-runtime.ts)，是 worktree 身份、端口、预览库和清理的唯一实现。

- **主 checkout 保持文档默认值**：前端 5178、后端 18471、数据库 `roster_preview`，setup 只安装依赖。
- **次级 worktree** 从其 canonical 路径派生稳定身份 `<12 位 hex>`，并独占：
  - 端口槽位 1–99：前端 `5178+slot`、后端 `18471+slot`。首次选择时避开其他已登记 worktree 的槽位，重复 setup 保留原槽位。
  - 预览库 `roster_wt_<id>_preview`，位于本机预览 Postgres（默认 `127.0.0.1:55439`，可用 `ROSTER_PREVIEW_ADMIN_URL` 覆盖），setup 建库、授予 `roster_preview_runtime` 连接权并执行全部 migrations。
- 配置写入 Git 忽略的 `.env.worktree`（带固定 marker、权限 0600）。发现非托管同名文件，或 marker 身份与当前路径不符（目录被移动或复制）时拒绝执行，不覆盖。
- 不复制任何 secret。隔离只覆盖免登录预览链路；真实 Supabase 登录、OAuth 回调仍按 [开发说明](../../../docs/DEVELOPMENT.md) 在主 checkout 单独配置。
- 启动预览用 `deno task preview:api` 和 `deno task preview:web`，它们读取本 worktree 的配置。端口被仓库外进程占用时直接失败，不在运行中换端口。
- 依赖安装按 `pnpm-lock.yaml` 等文件的摘要判断；`--if-needed` 在摘要未变时跳过安装。

### 清理

- 分支合并、放弃或转正后清理对应 worktree：先在**目标 worktree 内**运行 `deno task worktree:clean`（要求工作区干净；删除本 worktree 的预览库和 `.env.worktree`），成功后从主 checkout 执行 `git worktree remove <路径>`。
- 宿主已先删除目录时，从主 checkout 运行 `deno task worktree:gc` 预览孤儿库，确认后加 `--apply` 删除。GC 只处理名称符合 `roster_wt_<12 位 hex>_preview` 且不属于任何已登记 worktree 的库；其他 `*_preview` 库只报告不处理。
- Claude Code 通过 [`.claude/settings.json`](../../../.claude/settings.json) 自动接入：`SessionStart` 运行幂等的 `worktree:setup --if-needed`，`WorktreeRemove` 运行精确清理（只删除该路径对应的库；路径已不存在或为主 checkout 时跳过）。不配置 `WorktreeCreate`，保留 Claude 默认的 Git 创建逻辑。其他宿主没有删除事件，删除前显式运行 `worktree:clean`，或事后用 GC 收敛。
- 不使用 `git worktree remove --force`，不强制移除 dirty worktree，不静默丢弃未提交或未推送内容。
- 停止进程只停自己启动的那个（按 PID），不用 `pkill -f` 之类的模式匹配，避免误杀主 checkout 或其他 worktree 的预览。

## 提交

- 提交信息为英文祈使句，首行不超过 72 字符，描述行为而不是过程（`Move settings into the workspace menu`）。
- 逐文件 stage；不用 `git add -A` / `git add .`，不混入无关改动。逻辑上独立的改动拆成独立提交。
- 工作告一段落即推送，不留只在本地的提交。

## Pull Request

- 独立 PR 的 base 为 `main`；堆叠 PR 的 base 为前置分支，前置分支合并后改回 `main`，并读回 PR 确认 diff 没有带入无关提交。
- 用 `git push -u origin <branch>` 显式推送后再创建 PR。标题和正文用中文；正文写入临时文件或 heredoc，保留真实换行：

```sh
gh pr create --repo DengNaichen/Roster --base main --head <branch> \
  --title '<标题>' --body-file <正文文件>
```

- 正文包含：**内容**（实际交付了什么）、**验证**（跑了哪些命令、结果）、**风险与回退**（如有）。不复制完整日志。
- 验证按改动范围选择，PR 中如实记录；跳过的项目要写明，未提供数据库时被跳过的测试不能写成集成测试通过：

```sh
corepack pnpm build
corepack pnpm test:web
corepack pnpm --filter @roster/web lint
deno task check
deno task test
```

- **“开 PR”与“合并”是两次授权**：只要求开 PR 时，创建并交付审核后停止，不自动合并或启用 auto-merge。
- 用户授权合并后，用普通 merge commit 合并（不 squash / rebase），并绑定已审查的 head：

```sh
gh pr merge <number> --repo DengNaichen/Roster --merge --match-head-commit <已审查的 SHA>
```

- 合并冲突在工作分支上 rebase 或 merge `origin/main` 解决，解决后重新验证再推送；冲突的取舍（保留哪边的设计）在 PR 正文说明。

## 合并后清理

1. 核对工作分支的精确 head 已是 `origin/main` 的祖先：`git merge-base --is-ancestor <head> origin/main`，并确认没有待保留的提交或文件。
2. 按上面的流程清理 worktree：`deno task worktree:clean`，再 `git worktree remove`。
3. 删除本地分支 `git branch -d <branch>`（不用 `-D`）。删除远端分支时绑定已核对的 tip，避免删掉被并发推进的分支：

```sh
git push origin --force-with-lease=<branch>:<已核对 SHA> --delete <branch>
```

4. `git fetch --prune origin`，并把主 checkout 的 `main` fast-forward 到 `origin/main`（只在主 checkout 干净时）。
