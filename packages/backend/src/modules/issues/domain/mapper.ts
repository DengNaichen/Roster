import type { Issue } from '../../../../../contracts/mod.ts';
import type { Row } from '../../../application/records.ts';
import { iso } from '../../../platform/time.ts';
export function issueDTO(r: Row): Issue {
  return {
    id: String(r.id),
    identifier: String(r.identifier),
    team: String(r.team),
    title: String(r.title),
    document: r.document as Issue['document'],
    status: r.status as Issue['status'],
    type: r.type as Issue['type'],
    priority: Number(r.priority),
    project_id: r.project_id == null ? null : Number(r.project_id),
    project: r.project == null ? null : String(r.project),
    project_emoji: String(r.project_emoji ?? ''),
    cycle_id: r.cycle_id == null ? null : Number(r.cycle_id),
    parent: r.parent == null ? null : String(r.parent),
    labels: (r.labels ?? []) as Issue['labels'],
    assignee: r.user_subject
      ? {
        subject: String(r.user_subject),
        name: String(r.user_name),
        email: String(r.user_email),
      }
      : null,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}
