const root = new URL('./', import.meta.url);
const composition = new Set([
  'service.ts',
  'bootstrap.ts',
  'jobs.ts',
  'integrations/github/factory.ts',
]);
const tableOwners: Record<string, string> = {
  users: 'access',
  workspaces: 'access',
  workspace_members: 'access',
  workspace_invites: 'access',
  teams: 'access',
  team_members: 'access',
  issues: 'issues',
  projects: 'planning',
  project_teams: 'planning',
  initiatives: 'planning',
  initiative_projects: 'planning',
  labels: 'labels',
  label_groups: 'labels',
  issue_labels: 'labels',
  cycles: 'cycles',
  team_cycle_settings: 'cycles',
  specs: 'specs',
  spec_issues: 'specs',
  spec_revisions: 'specs',
  comments: 'activity',
  work_logs: 'activity',
  issue_delegations: 'activity',
  links: 'activity',
  relations: 'activity',
  audit_events: 'audit',
  pull_requests: 'github',
  github_sync: 'github',
};
function violations(path: string, source: string): string[] {
  const errors: string[] = [];
  const owner = /^(?:modules|integrations)\/([^/]+)\//.exec(path)?.[1];
  const pure = path.includes('/application/') || path.includes('/domain/') ||
    path.startsWith('application/');
  const adapter = path.includes('/infrastructure/') || path.startsWith('platform/database/') ||
    path.endsWith('/postgres.ts') || composition.has(path);
  for (const match of source.matchAll(/(?:from\s*|import\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)) {
    const specifier = match[1];
    const target = specifier.startsWith('.')
      ? new URL(specifier, new URL(path, root)).pathname.slice(root.pathname.length)
      : specifier;
    if (
      pure && /drizzle|npm:pg|\/infrastructure\/|platform\/database\/|\/postgres\.ts$/.test(target)
    ) errors.push(`${path}: application/domain imports storage: ${specifier}`);
    if (path.endsWith('/index.ts') && /\/infrastructure\/|\/postgres\.ts$/.test(target)) {
      errors.push(`${path}: business entrypoint exports adapter internals`);
    }
    const module = /^(?:modules|integrations)\/([^/]+)\/(.+)/.exec(target);
    if (
      module && module[1] !== owner && module[2] !== 'index.ts' &&
      !(adapter && module[2] === 'postgres.ts')
    ) errors.push(`${path}: imports another module's internals: ${specifier}`);
    if (path.startsWith('transport/') && /platform\/database|\/postgres\.ts$/.test(target)) {
      errors.push(`${path}: transport imports persistence`);
    }
  }
  if (!adapter && /sql`|\.query\(\s*['"`](?:select|insert|update|delete)/i.test(source)) {
    errors.push(`${path}: SQL outside a storage adapter`);
  }
  if (pure && /\bfetch\s*\(/.test(source)) {
    errors.push(`${path}: network IO in a use case; inject a client`);
  }
  if (pure && owner) {
    for (
      const match of source.matchAll(
        /\b(?:db|data|tx)\.(access|issues|planning|labels|cycles|specs|activity|audit|github)\./g,
      )
    ) {
      if (match[1] !== owner) {
        errors.push(
          `${path}: uses another module's repository directly; call its public capability`,
        );
      }
    }
  }
  // Offline import adapters intentionally restore a complete snapshot in one transaction.
  if (owner && owner !== 'imports') {
    for (
      const match of source.matchAll(/(?:insert\s+into|update|delete\s+from)\s+roster\.([a-z_]+)/gi)
    ) {
      if (tableOwners[match[1]] !== owner) {
        errors.push(`${path}: ${owner} writes ${match[1]}, owned by ${tableOwners[match[1]]}`);
      }
    }
  }
  return errors;
}
async function* sources(dir: URL): AsyncGenerator<URL> {
  for await (const entry of Deno.readDir(dir)) {
    const file = new URL(entry.name + (entry.isDirectory ? '/' : ''), dir);
    if (entry.isDirectory) yield* sources(file);
    else if (
      entry.name.endsWith('.ts') && !entry.name.endsWith('_test.ts') &&
      entry.name !== 'test_support.ts'
    ) yield file;
  }
}
Deno.test('All backend use cases, adapters and table writers respect module boundaries', async () => {
  const errors: string[] = [];
  for await (const file of sources(root)) {
    errors.push(
      ...violations(file.pathname.slice(root.pathname.length), await Deno.readTextFile(file)),
    );
  }
  for await (const file of sources(new URL('../../contracts/', root))) {
    if (/backend\/|export interface \w*Service\b/.test(await Deno.readTextFile(file))) {
      errors.push(`${file.pathname}: public DTO contracts contain backend interfaces`);
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
});
Deno.test('Architecture checks reject storage imports, hidden adapter exports and cross-module writes', () => {
  const cases = [
    ['modules/specs/application/service.ts', "import { sql } from 'npm:drizzle-orm@0.45.4';"],
    [
      'modules/specs/application/service.ts',
      "import { createAccessRepository } from '../../access/postgres.ts';",
    ],
    ['modules/specs/index.ts', "export { load } from './infrastructure/repository.ts';"],
    [
      'modules/labels/infrastructure/repository.ts',
      'sql`update roster.issues set updated_at=now()`',
    ],
    ['modules/cycles/application/service.ts', 'await fetch(url)'],
  ];
  for (const [path, source] of cases) {
    if (!violations(path, source).length) throw new Error(`Boundary check missed ${source}`);
  }
  if (
    violations(
      'modules/labels/infrastructure/repository.ts',
      'sql`insert into roster.labels(name) values(${name})`',
    ).length
  ) throw new Error('Own table writes must remain allowed');
});
