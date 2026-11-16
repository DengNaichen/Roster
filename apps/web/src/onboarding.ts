import type { IssueScope, Status } from "./shared";

/**
 * Derive a valid URL slug (`[a-z][a-z0-9-]{1,31}`) from a workspace display name.
 * Returns "" when the name has fewer than two usable ASCII characters so the
 * user can type an explicit slug instead of receiving invalid filler.
 */
export function deriveWorkspaceSlug(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+/g, "-")
    .slice(0, 32)
    .replace(/-+$/, "");
  return /^[a-z][a-z0-9-]{1,31}$/.test(cleaned) ? cleaned : "";
}

/**
 * Derive a valid team key (`[A-Z][A-Z0-9]{1,5}`) from a team display name.
 * Multi-word names use initials (or keep a short leading acronym); single words
 * use the first 2–4 characters.
 */
export function deriveTeamKey(name: string): string {
  const words = name
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return "";
  let candidate: string;
  if (words.length === 1) {
    candidate = words[0]
      .toUpperCase()
      .replace(/^[^A-Z]+/, "")
      .slice(0, 3);
  } else {
    const first = words[0];
    if (/^[A-Z][A-Z0-9]{1,3}$/.test(first)) {
      candidate = first;
    } else {
      candidate = words
        .map((word) => word[0].toUpperCase())
        .join("")
        .replace(/^[^A-Z]+/, "")
        .slice(0, 4);
      if (candidate.length < 2) {
        candidate = words
          .join("")
          .toUpperCase()
          .replace(/^[^A-Z]+/, "")
          .slice(0, 3);
      }
    }
  }
  return /^[A-Z][A-Z0-9]{1,5}$/.test(candidate) ? candidate : "";
}

/**
 * Choose a default status for a new issue that matches the list the user is
 * currently viewing, so newly created issues do not disappear into Triage when
 * created from Active, Backlog, All issues, Projects, or Cycles.
 */
export function defaultIssueStatus(
  triage: boolean,
  filter: Status | "all",
  scope: IssueScope,
): Status {
  if (triage) return "triage";
  if (filter !== "all") return filter;
  if (scope === "backlog") return "backlog";
  return "todo";
}

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
      `1. Call \`list_teams\` to verify you are connected to workspace \`${slug}\` and list the accessible teams.`,
      `2. Stop and report the exact error if authentication fails or no teams are returned.`,
    ].join("\n");
  }
  return [
    `Use the \`${server}\` MCP server (workspace \`${slug}\`).`,
    `1. Call \`list_teams\` and confirm team \`${team.key}\` (${JSON.stringify(team.name)}) is accessible. If \`${team.key}\` is missing, stop and report which workspace or error you received.`,
    `2. Call \`list_issues\` with \`team: ${JSON.stringify(team.key)}\` to inspect current issues.`,
    `3. If an issue already exists, call \`get_issue\` on the latest \`${team.key}-*\` issue and summarize it; otherwise call \`create_issue\` in team \`${team.key}\` with \`status: "todo"\` and \`title: "Verify MCP connection from coding agent"\`, then report the created identifier.`,
  ].join("\n");
}
