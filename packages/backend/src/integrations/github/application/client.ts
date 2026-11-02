export interface GitHubClient {
  request(path: string, body?: unknown): Promise<unknown>;
}
