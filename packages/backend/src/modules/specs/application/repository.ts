import type { Row } from '../../../application/records.ts';
export interface SpecsRepository {
  findSpec(input: { workspaceId: unknown; number: number; subject: string }): Promise<Row>;
  currentRevision(input: { specId: unknown; current_revision: unknown }): Promise<Row>;
  listSpecs(
    input: { workspaceId: unknown; subject: string; hasTeam: boolean; teamId: unknown },
  ): Promise<Row[]>;
  nextNumber(input: { workspaceId: unknown }): Promise<Row>;
  insertSpec(
    input: { workspaceId: unknown; teamId: unknown; number: number; now: Date },
  ): Promise<Row>;
  insertFirstRevision(
    input: { specId: unknown; content: string; message: string; subject: string; now: Date },
  ): Promise<void>;
  revisionHistory(input: { specId: unknown }): Promise<Row[]>;
  advanceRevision(
    input: { next: number; now: Date; specId: unknown; base_revision: number },
  ): Promise<Row[]>;
  insertRevision(
    input: {
      specId: unknown;
      next: number;
      content: string;
      message: string;
      subject: string;
      now: Date;
    },
  ): Promise<void>;
  listRevisions(input: { specId: unknown }): Promise<Row[]>;
  findRevision(input: { specId: unknown; number: number }): Promise<Row>;
}
