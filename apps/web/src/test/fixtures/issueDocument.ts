import type { IssueDocument } from "../../../../../packages/contracts/issue-document";

export const sampleDocument: IssueDocument = {
  lead: "让用户在 Spec 的任务列表中直接识别依赖和阻塞关系。",
  sections: [
    {
      title: "交付目标",
      blocks: [{ type: "paragraph", text: "选中依赖提示即可看到直接前置与后续任务。" }],
    },
    {
      title: "工作范围",
      blocks: [
        {
          type: "compare",
          left: { title: "本次包含", items: ["行内展示依赖图标。", "点击后展开直接关系。"] },
          right: { title: "本次不包含", items: ["独立的 DAG 视图。"] },
        },
      ],
    },
    {
      title: "展示与交互",
      blocks: [
        {
          type: "table",
          columns: ["任务情况", "列表中的提示"],
          rows: [
            ["存在未完成的前置任务", "红色“被阻塞”图标"],
            ["没有依赖关系", "不显示额外标记"],
          ],
        },
      ],
    },
    {
      title: "实施约束",
      blocks: [
        {
          type: "list",
          ordered: true,
          items: [
            {
              title: "复用共享查询。",
              text: "通过 `GET /specs/:identifier/dependencies` 获取关系。",
            },
          ],
        },
        { type: "note", title: "需要注意的边界", text: "隐藏任务不能通过数量泄露。" },
      ],
    },
  ],
  criteria: [
    { id: "AC-1", title: "可以识别阻塞。", detail: "列表出现红色图标。", done: true },
    { id: "AC-2", title: "列表行为不受影响。", detail: "", done: false },
  ],
};
