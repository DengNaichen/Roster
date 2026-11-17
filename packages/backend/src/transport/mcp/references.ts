import {
  AppError,
  type Identity,
  type RequestContext,
  type Team,
} from '../../../../contracts/mod.ts';
import type { Service } from '../../application/mod.ts';
export type ReferenceCandidate = { id: string; name: string; key?: string; email?: string };
export class AmbiguousReference extends AppError {
  constructor(kind: string, reference: string, public candidates: ReferenceCandidate[]) {
    super(
      'invalid_input',
      `Multiple ${kind} match ${
        JSON.stringify(reference)
      }. Use a candidate's ID, team key or email.`,
    );
  }
}
const canonical = (value: string) => value.trim().toLowerCase();
export function resolveTeam(reference: string, teams: Team[]): string {
  const q = canonical(reference);
  if (!q) throw new AppError('invalid_input', 'Team reference cannot be empty');
  const byKey = teams.find((t) => canonical(t.key) === q || t.id === reference);
  if (byKey) return byKey.key;
  const matches = teams.filter((t) => canonical(t.name) === q);
  if (matches.length === 1) return matches[0].key;
  if (matches.length > 1) {
    throw new AmbiguousReference(
      'teams',
      reference,
      matches.map((t) => ({ id: t.id, key: t.key, name: t.name })),
    );
  }
  throw new AppError('not_found', `No accessible team matches ${JSON.stringify(reference)}`);
}
export function resolveUser(reference: string, people: Identity[]): string {
  const q = canonical(reference);
  if (!q) throw new AppError('invalid_input', 'User reference cannot be empty');
  const exact = people.filter((p) =>
    p.subject === reference || canonical(p.email) === q || canonical(p.name) === q
  );
  const matches = exact.length ? exact : people.filter((p) => canonical(p.name).includes(q));
  if (matches.length === 1) return matches[0].subject;
  if (matches.length > 1) {
    throw new AmbiguousReference(
      'users',
      reference,
      matches.map((p) => ({ id: p.subject, name: p.name, email: p.email })),
    );
  }
  throw new AppError('not_found', `No visible user matches ${JSON.stringify(reference)}`);
}
const teamKeys = new Set(['update_team', 'list_team_members', 'change_team_member', 'join_team']);
/** Normalize validated MCP references once; business services still enforce all access rules. */
export async function resolveMcpReferences<T extends Record<string, unknown>>(
  service: Service,
  ctx: RequestContext,
  workspace: string,
  name: string,
  input: T,
): Promise<T> {
  const result = { ...input };
  let teams: Promise<Team[]> | undefined;
  const team = async (reference: string) =>
    resolveTeam(
      reference,
      await (teams ??= teamKeys.has(name)
        ? service.teamDirectory(ctx, workspace)
        : service.listTeams(ctx, workspace)),
    );
  if (typeof input.team === 'string') Object.assign(result, { team: await team(input.team) });
  if (Array.isArray(input.teams)) {
    Object.assign(result, { teams: await Promise.all(input.teams.map(team)) });
  }
  if (teamKeys.has(name) && typeof input.key === 'string') {
    Object.assign(result, { key: await team(input.key) });
  }
  if (
    name === 'save_issue' && (Array.isArray(input.add_labels) || Array.isArray(input.remove_labels))
  ) {
    const labels = await service.listLabels(ctx, workspace, { include_archived: true });
    for (const field of ['add_labels', 'remove_labels'] as const) {
      if (!Array.isArray(input[field])) continue;
      const resolved = input[field].map((ref: string | number) => {
        if (typeof ref === 'number') return ref;
        const matches = labels.filter((label) => canonical(label.name) === canonical(ref));
        if (!matches.length) {
          throw new AppError('not_found', `No label matches ${JSON.stringify(ref)}`);
        }
        if (matches.length > 1) {
          throw new AmbiguousReference(
            'labels',
            ref,
            matches.map((l) => ({ id: String(l.id), name: l.name })),
          );
        }
        return matches[0].id;
      });
      Object.assign(result, { [field]: resolved });
    }
  }
  for (const field of ['assignee', 'subject'] as const) {
    const reference = input[field];
    if (typeof reference !== 'string') continue;
    if (field === 'assignee' && reference === '') {
      Object.assign(result, { [field]: null });
      continue;
    }
    if (canonical(reference) === 'me') {
      Object.assign(result, { [field]: ctx.identity.subject });
      continue;
    }
    // Stable subjects already have the service's exact validation and require no directory lookup.
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reference)) continue;
    const people = (await service.listMembers(ctx, workspace)).filter((p) =>
      field === 'subject' || p.status === 'active'
    );
    Object.assign(result, { [field]: resolveUser(reference, people) });
  }
  return result;
}
