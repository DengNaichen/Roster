import type { Database } from '../../platform/database/client.ts';
import { createUnitOfWork } from '../../platform/database/session.ts';
import { createGitHubSync, type GitHubOptions } from './application/sync.ts';
import { type AppCredentials, createGitHubClient } from './infrastructure/http.ts';
export function createGitHubIntegration(
  db: Database,
  options: GitHubOptions & {
    app: AppCredentials;
    fetch?: typeof fetch;
  },
) {
  if (options.bindings.length && (!options.app.appId || !options.app.privateKey)) {
    throw new Error('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required');
  }
  return createGitHubSync(createUnitOfWork(db), options, createGitHubClient(options));
}
