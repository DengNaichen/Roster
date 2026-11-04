import { planSections, type PlanNotes } from "./planSections";
export type Scenario = { given: string; when: string; then: string };
type LegacyContent = {
  notes?: string;
  approach: string;
  sequence: string;
  state: string;
  scenarios: Scenario[];
};
export type Decision = { title: string; reason: string; sequence: string; state: string };
export type DesignContent = {
  context: string;
  goals: string;
  nonGoals: string;
  risks: string;
  decisions: Decision[];
  notes?: string;
};
export type Design = { content: DesignContent; revision: number };
export const blankDecision: Decision = { title: "", reason: "", sequence: "", state: "" };
export const emptyDesign: DesignContent = {
  context: "",
  goals: "",
  nonGoals: "",
  risks: "",
  decisions: [blankDecision],
};
const blankScenario = { given: "", when: "", then: "" };
export const exampleDesign: DesignContent = {
  context: `联调前，负责人从 SPEC-1 查看还差哪些工作；接手 RO-56 的 Agent 则从任务回查验收条件。两条路径指向同一段关系。假如成员只在描述里粘贴票号，另一端无法可靠地知道自己被引用，统计进度时还要逐条核对。

工作区里同时存在公开和私有团队。一个成员可以读到规格，却看不到参与实现的全部任务。因此，页面上的“已关联”始终有一个前提：当前读者有权看到关系的两端。`,
  goals:
    "从 Spec 和 Issue 任一端都能建立、查看和解除关联。网页与 MCP 对同一请求给出一致的结果，客户端在超时后可以安全重试。",
  nonGoals:
    "关联只表达一项工作支撑哪份规格。采纳 Spec 修订、关闭 Issue 和调整任务负责人仍由各自的操作完成。",
  decisions: [
    {
      ...blankDecision,
      title: "用一条关系记录支撑双向查询",
      reason: `用 Spec 和 Issue 的稳定 ID 保存关联，票号和标题只负责显示。一张任务可以支撑两份规格；任务改名时，两份规格都应立即显示新标题。

在 Issue 上增加一个 Spec ID 虽然容易查询，但第二份规格会覆盖第一份。分别在两端维护列表则需要协调两次写入。独立关联表只保存一次关系，两个详情页从同一条记录读取。`,
    },
    {
      ...blankDecision,
      title: "重复关联返回同一个结果",
      reason: `成员在网页点下“关联”的同时，Agent 也可能提交同一对 ID。两个请求即使都先查询，也可能都读到空结果。把唯一约束放在数据库，由写入操作处理冲突。

如果第一次写入成功，但响应在网络中丢失，重试仍返回“已关联”。接手者可以继续下一项工作，列表中也只出现一条 RO-56。`,
      sequence: `sequenceDiagram
    participant Web as 网页
    participant API as 关联服务
    participant DB as 数据库
    Web->>API: 关联 SPEC-1 与 RO-56
    API->>DB: 校验两端权限并写入
    DB-->>API: 已创建
    API--xWeb: 响应丢失
    Web->>API: 重试相同请求
    API->>DB: 校验权限并尝试写入
    DB-->>API: 同一对记录已存在
    API-->>Web: 已关联`,
    },
    {
      ...blankDecision,
      title: "列表与计数使用同一套可见性条件",
      reason: `先按当前身份筛出两端都可读的关联，再分页、统计总数和已完成数。否则，即使隐藏了私有 Issue 的标题，成员仍可能从“共 4 条”与眼前三行的差额得知还有一条私有任务。

写入时重新校验工作区和权限。成员在打开选择器之后可能被移出团队，提交时不能继续沿用打开页面那一刻的权限结果。`,
    },
    {
      ...blankDecision,
      title: "将关联状态与两端的生命周期分开",
      reason: `解除关联只删除关系记录。SPEC-1 从待评审变为已采纳，或者 RO-56 从进行中变为已完成，都保留原有关联。这样在任务结束后仍可以回查它依据的规格。

例如，RO-56 同时支撑两份规格时，从 SPEC-1 移除它，只影响 SPEC-1 的关联列表和进度。另一份规格仍应能打开 RO-56，任务本身也保留原状态。`,
      state: `stateDiagram-v2
    state "未关联" as Unlinked
    state "已关联" as Linked
    [*] --> Unlinked
    Unlinked --> Linked: 建立关联
    Linked --> Linked: 重试关联或更新任务状态
    Linked --> Unlinked: 解除这对关联`,
    },
    {
      ...blankDecision,
      title: "按任务身份汇总进度，按当前状态判断完成",
      reason: `规格页上的进度回答“当前可见的关联任务里，多少已经完成”。同一任务重新打开时，分子随之减少；解除关联时，再从分母中移除。没有可见任务时显示空状态，避免把零项工作解释成全部完成。

验收时先关联两张可见任务，只完成其中一张，应得到 1/2。重新打开它，应变为 0/2。随后解除另一张任务的关联，结果应为 0/1。从 Issue 详情反查也应得到相同的关联关系。`,
    },
  ],
  risks: `成员看到的进度可能不同。拥有私有团队权限的人可能看到 2/3，其他人只看到 1/2。评审时应使用拥有不同权限的账号分别核对列表、计数和空状态。

双向读取需要不同的索引顺序。按规格查询常用于进度统计，按任务查询用于追溯依据。两条路径都要用真实列表规模检查，尤其要关注一份规格关联数十张任务时的分页和计数。

客户端在等待响应期间可能错过其他成员的修改。保存后重新读取关联集合和进度；如果刷新失败，保留重试入口，让用户可以确认最终结果。`,
};
// Import the original four-section template. Preserve arbitrary Markdown verbatim
// in Approach when it doesn't match, so a failed conversion never loses text.
function fromMarkdown(body: string): LegacyContent {
  const match =
    /^## Approach\s*\n([\s\S]*?)\n## Sequence\s*\n```mermaid\n([\s\S]*?)\n```\s*\n## State transitions\s*\n```mermaid\n([\s\S]*?)\n```\s*\n## Verification\s*\n([\s\S]*)$/.exec(
      body,
    );
  if (!match) return { approach: body, sequence: "", state: "", scenarios: [] };
  return {
    approach: match[1].trim(),
    sequence: match[2],
    state: match[3],
    scenarios: [{ ...blankScenario, then: match[4].trim() }],
  };
}
export function readDesign(key: string): Design | null {
  const value = JSON.parse(localStorage.getItem(key) ?? "null");
  if (value === null) return null;
  if (!Number.isInteger(value.revision)) throw new Error("Invalid design revision");
  if (typeof value.body === "string") value.content = fromMarkdown(value.body);
  const c = value.content;
  if (Array.isArray(c?.decisions)) {
    if (
      [c.context, c.goals, c.nonGoals, c.risks, c.notes ?? ""].some((v) => typeof v !== "string") ||
      !c.decisions.every(
        (d: Decision) =>
          d && [d.title, d.reason, d.sequence, d.state].every((v) => typeof v === "string"),
      )
    )
      throw new Error("Invalid design");
    return value;
  }
  if (
    !c ||
    [c.approach, c.sequence, c.state].some((v) => typeof v !== "string") ||
    (c.plan !== undefined &&
      (!c.plan ||
        typeof c.plan !== "object" ||
        Array.isArray(c.plan) ||
        planSections.some((section) =>
          section.fields.some(
            ([key]) => c.plan[key] !== undefined && typeof c.plan[key] !== "string",
          ),
        ))) ||
    !Array.isArray(c.scenarios) ||
    !c.scenarios.every(
      (s: Scenario) => s && [s.given, s.when, s.then].every((v) => typeof v === "string"),
    )
  )
    throw new Error("Invalid design content");
  if (c.notes !== undefined && typeof c.notes !== "string") throw new Error("Invalid design notes");
  {
    const notes = [c.notes];
    const plan: PlanNotes = c.plan ?? {};
    for (const section of planSections)
      for (const [key, label] of section.fields) {
        if (plan[key]) notes.push(label + "\n" + plan[key]);
      }
    for (const scenario of c.scenarios as Scenario[]) {
      notes.push(
        [
          ["Given", scenario.given],
          ["When", scenario.when],
          ["Then", scenario.then],
        ]
          .filter(([, v]) => v)
          .map(([k, v]) => k + " " + v)
          .join("\n"),
      );
    }
    return {
      revision: value.revision,
      content: {
        ...emptyDesign,
        decisions: (c.approach.split(/\r?\n/).filter((line: string) => line.trim()).length
          ? c.approach.split(/\r?\n/).filter((line: string) => line.trim())
          : [""]
        ).map((title: string, index: number) => ({
          ...blankDecision,
          title,
          sequence: index === 0 ? c.sequence : "",
          state: index === 0 ? c.state : "",
        })),
        notes: notes.filter(Boolean).join("\n\n"),
      },
    };
  }
}
