export type McpClientKind = "codex" | "claude" | "json";

export function mcpServerName(slug: string): string {
  const safe = slug
    .replace(/[^a-z0-9-]/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return safe ? `roster-${safe}` : "roster";
}

export function buildMcpClientSnippet(
  client: McpClientKind,
  slug: string,
  url: string,
  preview: boolean,
): { code: string; authCommand?: string; hint: string } {
  const server = mcpServerName(slug);
  if (client === "codex") {
    return {
      code: [
        `codex mcp add ${server} --url ${JSON.stringify(url)}`,
        "",
        `# Or in a trusted repository's .codex/config.toml:`,
        `[mcp_servers.${server}]`,
        `url = ${JSON.stringify(url)}`,
      ].join("\n"),
      authCommand: preview ? undefined : `codex mcp login ${server}`,
      hint: preview
        ? "Run codex mcp add (works in any repo) or add to a trusted repository's .codex/config.toml. Local preview authenticates on loopback without OAuth."
        : "Run codex mcp add (or save in a trusted repository's .codex/config.toml), then run the login command once to authorize in your browser. Never commit tokens or secrets.",
    };
  }
  if (client === "claude") {
    return {
      code: `claude mcp add --transport http ${server} ${url}`,
      authCommand: preview ? undefined : "/mcp",
      hint: preview
        ? "Run inside your target repository. Local preview connects directly on loopback without OAuth."
        : "Run inside your target repository, then type /mcp in Claude Code to complete browser OAuth.",
    };
  }
  return {
    code: JSON.stringify(
      {
        mcpServers: {
          [server]: {
            url,
          },
        },
      },
      null,
      2,
    ),
    hint: preview
      ? "Add to your client's MCP configuration file (.mcp.json or ~/.cursor/mcp.json)."
      : "Add to your client's MCP configuration file (.mcp.json or ~/.cursor/mcp.json). Your client will open Roster's OAuth consent screen on first connection.",
  };
}

export function buildAgentVerificationPrompt({
  slug,
  team,
}: {
  slug: string;
  team?: { key: string; name: string } | null;
}): string {
  const server = mcpServerName(slug);
  if (!team) {
    return [
      `Use the \`${server}\` MCP server (workspace \`${slug}\`).`,
      `1. Call \`whoami\` and confirm the authorized workspace is \`${slug}\`; reconnect if it differs.`,
      `2. Stop and report the exact error if authentication fails or no teams are returned.`,
    ].join("\n");
  }
  return [
    `Use the \`${server}\` MCP server (workspace \`${slug}\`).`,
    `1. Call \`whoami\` and confirm workspace \`${slug}\`, then \`list_teams\` to confirm team \`${team.key}\` (${JSON.stringify(team.name)}) is accessible. Stop if the workspace or team differs.`,
    `2. Call \`list_issues\` with \`team: ${JSON.stringify(team.key)}\` to inspect current issues.`,
    `3. If an issue already exists, call \`get_issue\` on the latest \`${team.key}-*\` issue and summarize it; otherwise call \`save_issue\` in team \`${team.key}\` with \`status: "todo"\` and \`title: "Verify MCP connection from coding agent"\`, then report the created identifier.`,
  ].join("\n");
}
