import { describe, expect, it } from "vitest";
import { buildAgentVerificationPrompt, buildMcpClientSnippet, mcpServerName } from "./mcpSetup";

describe("MCP setup helpers", () => {
  it("builds workspace-isolated MCP client snippets and team-scoped verification prompts", () => {
    expect(mcpServerName("onb-eval")).toBe("roster-onb-eval");
    const codex = buildMcpClientSnippet(
      "codex",
      "onb-eval",
      "https://proj.supabase.co/functions/v1/mcp/w/onb-eval/mcp",
      false,
    );
    expect(codex.code).toContain(
      'codex mcp add roster-onb-eval --url "https://proj.supabase.co/functions/v1/mcp/w/onb-eval/mcp"',
    );
    expect(codex.code).toContain("[mcp_servers.roster-onb-eval]");
    expect(codex.authCommand).toBe("codex mcp login roster-onb-eval");

    const previewCodex = buildMcpClientSnippet(
      "codex",
      "onb-eval",
      "http://127.0.0.1:18510/w/onb-eval/mcp",
      true,
    );
    expect(previewCodex.authCommand).toBeUndefined();

    const prompt = buildAgentVerificationPrompt({
      slug: "onb-eval",
      team: { key: "ONB", name: "Onboarding Team" },
    });
    expect(prompt).toContain("`roster-onb-eval`");
    expect(prompt).toContain("`ONB`");
    expect(prompt).toContain('"Onboarding Team"');
    expect(prompt).toContain("`list_teams`");
    expect(prompt).toContain("`list_issues`");
    expect(prompt).toContain("`save_issue`");
    expect(prompt).not.toContain("`create_issue`");
  });
});
