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
  context:
    "一份 Spec 往往拆成多张 Issue，同一张 Issue 也可能支撑多份 Spec。成员从网页维护关联，Agent 从 MCP 操作。两者可能并发请求，也可能对记录有不同的访问权限。",
  goals: "支持从任一端查询和维护关联。重复建立同一关联时，两端都只显示一次。",
  nonGoals: "本次只管理关联关系。Spec 的修订和 Issue 的状态各自独立。",
  decisions: [
    {
      ...blankDecision,
      title: "单独保存关联关系",
      reason:
        "每条记录保存一对 Spec ID 和 Issue ID。若只在 Issue 上放一个 Spec ID，第二份规格就需要覆盖原值或复制任务。独立关联表支持多对多，解除关联只删除这一对记录。",
    },
    {
      ...blankDecision,
      title: "由数据库保证关联唯一",
      reason:
        "网页和 Agent 可能同时查到“尚未关联”。对两个 ID 建立联合唯一约束，将重复写入视为成功，调用方就可以安全重试。",
      sequence: `sequenceDiagram
    participant Web as 网页
    participant Store as 关联服务与数据库
    participant Agent
    Web->>Store: 关联 SPEC-1 与 RO-56
    Agent->>Store: 关联同一对记录
    Store-->>Web: 创建成功，已关联
    Store-->>Agent: 记录已存在，已关联`,
    },
    {
      ...blankDecision,
      title: "对关联两端分别检查权限",
      reason:
        "公开 Spec 可以关联私有团队的 Issue。网页和 MCP 共用权限判断，读取时只返回双方都可见的记录，写入前校验两端的操作权限。",
    },
  ],
  risks:
    "关联计数可能泄露私有任务。列表和数量使用相同的可见性条件，因此不同成员看到的数量可能不同。\n\n双向查询多一次联表。按 Spec 和按 Issue 分别检查查询计划，为反向查找补上合适的索引。",
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
