import { defaultTeamKey } from "../../../packages/contracts/workspace.ts";
import { describe, expect, it } from "vitest";
import { defaultIssueStatus, deriveTeamKey, deriveWorkspaceSlug } from "./onboarding";

describe("onboarding helpers", () => {
  it("derives valid workspace slugs from human names", () => {
    expect(deriveWorkspaceSlug("Acme Engineering")).toBe("acme-engineering");
    expect(deriveWorkspaceSlug("  42 Studio Labs! ")).toBe("studio-labs");
    expect(deriveWorkspaceSlug("A")).toBe("");
    expect(deriveWorkspaceSlug("纯中文名称")).toBe("");
  });

  it("derives valid uppercase team keys from single or multi-word names", () => {
    expect(deriveTeamKey("Platform")).toBe("PLA");
    expect(deriveTeamKey("Onboarding Team")).toBe("OT");
    expect(deriveTeamKey("MCP Gateway")).toBe("MCP");
    expect(deriveTeamKey("Core Web Infra")).toBe("CWI");
    expect(deriveTeamKey("AI")).toBe("AI");
    expect(deriveTeamKey("研发")).toBe("");
  });

  it("picks an issue creation default status that remains visible in the active view", () => {
    expect(defaultIssueStatus(true, "all", "active")).toBe("triage");
    expect(defaultIssueStatus(false, "all", "active")).toBe("todo");
    expect(defaultIssueStatus(false, "all", "all")).toBe("todo");
    expect(defaultIssueStatus(false, "all", "backlog")).toBe("backlog");
    expect(defaultIssueStatus(false, "agent_ready", "all")).toBe("agent_ready");
  });
});

it("provides a valid default team key for multilingual and numeric workspace names", () => {
  expect(defaultTeamKey("研发", "studio")).toBe("STU");
  expect(defaultTeamKey("123", "123")).toBe("TEAM");
  expect(defaultTeamKey("Studio Sandbox", "different")).toBe("SS");
});
