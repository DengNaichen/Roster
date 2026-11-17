import { z } from 'zod';

const positiveId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const repoName = z.string().regex(/^[\w.-]+\/[\w.-]+$/).refine(
  (name) => name.split('/').every((part) => part !== '.' && part !== '..'),
);
const bindingSchema = z.object({
  workspace: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  repo: repoName,
  installationId: positiveId,
  repositoryId: positiveId,
  completion: z.enum(['manual', 'closing_reference']).default('manual'),
}).strict();
export type GitHubBinding = z.infer<typeof bindingSchema>;
export const pullSchema = z.object({
  number: positiveId.max(2_147_483_647),
  title: z.string(),
  body: z.string().nullable().default(null),
  state: z.enum(['open', 'closed']),
  draft: z.boolean(),
  merged_at: z.iso.datetime({ offset: true }).nullable(),
  updated_at: z.iso.datetime({ offset: true }),
  head: z.object({ ref: z.string() }),
  base: z.object({ repo: z.object({ id: positiveId }) }),
});
export type Pull = z.infer<typeof pullSchema>;
export type PullState = 'open' | 'draft' | 'merged' | 'closed';
export const deliverySchema = z.object({
  deliveryId: z.uuid(),
  bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
  installationId: positiveId,
  repositoryId: positiveId,
  number: positiveId.max(2_147_483_647),
  action: z.enum([
    'opened',
    'edited',
    'closed',
    'reopened',
    'synchronize',
    'ready_for_review',
    'converted_to_draft',
  ]),
});
export type Delivery = z.infer<typeof deliverySchema>;
export const scanSchema = z.object({
  page: positiveId,
  since: z.string().nullable(),
  startedAt: z.string(),
  initial: z.boolean(),
});
export type Scan = z.infer<typeof scanSchema>;
export function parseBindings(value = ''): GitHubBinding[] {
  const bindings = z.array(bindingSchema).parse(JSON.parse(value || '[]'));
  const repositories = new Set<number>();
  const names = new Set<string>();
  for (const b of bindings) {
    if (repositories.has(b.repositoryId) || names.has(b.repo.toLowerCase())) {
      throw new Error('Each GitHub repository can bind to only one workspace');
    }
    repositories.add(b.repositoryId);
    names.add(b.repo.toLowerCase());
  }
  return bindings;
}
/** Queued work cannot inherit a replacement binding's authority or completion policy. */
export function bindingKey(b: GitHubBinding): string {
  return JSON.stringify([
    b.workspace,
    b.repo.toLowerCase(),
    b.installationId,
    b.repositoryId,
    b.completion,
  ]);
}
export function identifiers(text: string, keys: string[]): string[] {
  if (!keys.length) return [];
  const normalized = new Map(keys.map((k) => [k.toUpperCase(), k]));
  const escaped = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return [
    ...new Set([...text.matchAll(new RegExp(`\\b(${escaped.join('|')})-(\\d+)`, 'gi'))]
      .map((m) => `${normalized.get(m[1].toUpperCase())}-${m[2]}`)),
  ];
}
export function closingReferences(text: string, keys: string[]): Set<string> {
  const found = new Set<string>();
  for (
    const match of text.matchAll(
      /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+([a-z][a-z0-9]*-\d+)\b/gi,
    )
  ) {
    for (const id of identifiers(match[1], keys)) found.add(id);
  }
  return found;
}
export function pullState(p: Pull): PullState {
  return p.merged_at ? 'merged' : p.state === 'closed' ? 'closed' : p.draft ? 'draft' : 'open';
}
