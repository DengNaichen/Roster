import type { GitHubBinding, Pull } from './model.ts';
export class GitHubError extends Error {
  constructor(readonly code: string, readonly retryAt: number | null = null) {
    super(code);
  }
}
export interface GitHubClient {
  verify(binding: GitHubBinding): Promise<void>;
  pull(binding: GitHubBinding, number: number): Promise<Pull>;
  pulls(binding: GitHubBinding, page: number): Promise<Pull[]>;
}
