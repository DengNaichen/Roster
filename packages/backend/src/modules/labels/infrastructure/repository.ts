import { sql } from 'npm:drizzle-orm@0.45.4';
import { type Executor, one, rows } from '../../../platform/database/query.ts';
import { visible } from '../../access/postgres.ts';
import type { LabelsRepository } from '../application/repository.ts';

export function createLabelsRepository(db: Executor): LabelsRepository {
  return {
    async findLabel({ workspaceId, id }) {
      return rows(
        db,
        sql`select * from roster.labels where workspace_id=${workspaceId} and id=${id}`,
      );
    },
    async listLabels({ workspaceId, include_archived }) {
      return rows(
        db,
        sql`select * from roster.labels where workspace_id=${workspaceId} and (${include_archived} or not archived) order by name_key,id`,
      );
    },
    async listGroups({ workspaceId }) {
      return rows(
        db,
        sql`select id,name from roster.label_groups where workspace_id=${workspaceId} order by name_key,id`,
      );
    },
    async insertGroup({ workspaceId, name, toLowerCase }) {
      return one(
        db,
        sql`insert into roster.label_groups(workspace_id,name,name_key) values(${workspaceId},${name},${toLowerCase}) returning id,name`,
      );
    },
    async renameGroup({ name, toLowerCase, workspaceId, id }) {
      return one(
        db,
        sql`update roster.label_groups set name=${name},name_key=${toLowerCase} where workspace_id=${workspaceId} and id=${id} returning id,name`,
      );
    },
    async findGroup({ workspaceId, group_id }) {
      return rows(
        db,
        sql`select 1 from roster.label_groups where workspace_id=${workspaceId} and id=${group_id}`,
      );
    },
    async insertLabel({ workspaceId, name, toLowerCase, color, description, group_id }) {
      return one(
        db,
        sql`insert into roster.labels(workspace_id,name,name_key,color,description,group_id) values(${workspaceId},${name},${toLowerCase},${color},${description},${group_id}) returning *`,
      );
    },
    async updateLabel({ name, toLowerCase, color, description, archived, workspaceId, id }) {
      return one(
        db,
        sql`update roster.labels set name=${name},name_key=${toLowerCase},color=${color},description=${description},archived=${archived} where workspace_id=${workspaceId} and id=${id} returning *`,
      );
    },
    async removeIssueLabel({ issueId, id }) {
      return rows(
        db,
        sql`delete from roster.issue_labels where issue_id=${issueId} and label_id=${id} returning label_id`,
      );
    },
    async findIssueLabel({ issueId, id }) {
      return rows(
        db,
        sql`select 1 from roster.issue_labels where issue_id=${issueId} and label_id=${id}`,
      );
    },
    async clearExclusiveLabel({ issueId, group_id }) {
      await db.execute(
        sql`delete from roster.issue_labels il using roster.labels l where il.label_id=l.id and il.issue_id=${issueId} and l.group_id=${group_id}`,
      );
    },
    async addIssueLabel({ workspaceId, issueId, id }) {
      await db.execute(
        sql`insert into roster.issue_labels(workspace_id,issue_id,label_id) values(${workspaceId},${issueId},${id})`,
      );
    },
    async hasHiddenIssues({ id, subject }) {
      return rows(
        db,
        sql`select 1 from roster.issue_labels il join roster.issues i on i.id=il.issue_id join roster.teams t on t.id=i.team_id where il.label_id=${id} and not ${
          visible(subject)
        } limit 1`,
      );
    },
    async labelIssueIds({ id }) {
      return rows(db, sql`select issue_id from roster.issue_labels where label_id=${id}`);
    },
    async clearLabel({ id }) {
      await db.execute(sql`delete from roster.issue_labels where label_id=${id}`);
    },
    async transferLabel({ workspaceId, issueId, id }) {
      await db.execute(
        sql`insert into roster.issue_labels(workspace_id,issue_id,label_id) values(${workspaceId},${issueId},${id}) on conflict do nothing`,
      );
    },
    async deleteLabel({ workspaceId, id }) {
      await db.execute(
        sql`delete from roster.labels where workspace_id=${workspaceId} and id=${id}`,
      );
    },
  };
}
