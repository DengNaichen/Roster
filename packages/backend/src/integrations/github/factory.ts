import type { Database } from '../../platform/database/client.ts';
import { createUnitOfWork } from '../../platform/database/session.ts';
import { createGitHubSync, type GitHubOptions } from './application/sync.ts';
import { createGitHubClient } from './infrastructure/http.ts';
export function createGitHubIntegration(
  db: Database,
  options: GitHubOptions & { token: string; fetch?: typeof fetch },
) {
  if (options.bindings.length && !options.token) throw new Error('GITHUB_TOKEN is required');
  return createGitHubSync(createUnitOfWork(db), options, createGitHubClient(options));
}
