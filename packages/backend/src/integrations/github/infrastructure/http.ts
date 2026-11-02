import type { GitHubClient } from '../application/client.ts';
export function createGitHubClient(options: { token: string; fetch?: typeof fetch }): GitHubClient {
  // Only GitHub API paths composed from configured owner/repo and numeric IDs are used.
  async function request(path: string, body?: unknown): Promise<unknown> {
    const response = await (options.fetch ?? fetch)(`https://api.github.com${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${options.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`GitHub request failed (${response.status})`);
    return await response.json();
  }
  return { request };
}
