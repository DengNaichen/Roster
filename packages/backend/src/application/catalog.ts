import type { z } from 'zod';
import type {
  changeIssueLabelsSchema,
  CreateInitiativeInput,
  CreateLabelInput,
  CreateProjectInput,
  getInitiativeSchema,
  getProjectSchema,
  Initiative,
  Label,
  LabelGroup,
  listInitiativesSchema,
  listLabelsSchema,
  listProjectsSchema,
  mergeLabelsSchema,
  Project,
  saveLabelGroupSchema,
  UpdateInitiativeInput,
  UpdateLabelInput,
  UpdateProjectInput,
} from '../../../contracts/catalog.ts';
import type { RequestContext } from '../../../contracts/mod.ts';
export interface CatalogService {
  listProjects(
    ctx: RequestContext,
    slug: string,
    input?: z.infer<typeof listProjectsSchema>,
  ): Promise<Project[]>;
  getProject(
    ctx: RequestContext,
    slug: string,
    input: z.infer<typeof getProjectSchema>,
  ): Promise<Project>;
  createProject(ctx: RequestContext, slug: string, input: CreateProjectInput): Promise<Project>;
  updateProject(ctx: RequestContext, slug: string, input: UpdateProjectInput): Promise<Project>;
  listInitiatives(
    ctx: RequestContext,
    slug: string,
    input?: z.infer<typeof listInitiativesSchema>,
  ): Promise<Initiative[]>;
  getInitiative(
    ctx: RequestContext,
    slug: string,
    input: z.infer<typeof getInitiativeSchema>,
  ): Promise<Initiative>;
  createInitiative(
    ctx: RequestContext,
    slug: string,
    input: CreateInitiativeInput,
  ): Promise<Initiative>;
  updateInitiative(
    ctx: RequestContext,
    slug: string,
    input: UpdateInitiativeInput,
  ): Promise<Initiative>;
  listLabels(
    ctx: RequestContext,
    slug: string,
    input?: z.infer<typeof listLabelsSchema>,
  ): Promise<Label[]>;
  listLabelGroups(
    ctx: RequestContext,
    slug: string,
    input?: Record<string, never>,
  ): Promise<LabelGroup[]>;
  saveLabelGroup(
    ctx: RequestContext,
    slug: string,
    input: z.infer<typeof saveLabelGroupSchema>,
  ): Promise<LabelGroup>;
  createLabel(ctx: RequestContext, slug: string, input: CreateLabelInput): Promise<Label>;
  updateLabel(ctx: RequestContext, slug: string, input: UpdateLabelInput): Promise<Label>;
  changeIssueLabels(
    ctx: RequestContext,
    slug: string,
    input: z.infer<typeof changeIssueLabelsSchema>,
  ): Promise<void>;
  mergeLabels(
    ctx: RequestContext,
    slug: string,
    input: z.infer<typeof mergeLabelsSchema>,
  ): Promise<void>;
}
