import { z } from 'zod';
export const searchSchema = z.strictObject({
  query: z.string().trim().min(1).max(200),
  type: z.enum(['all', 'issue', 'spec', 'project']).default('all'),
  limit: z.number().int().min(1).max(50).default(10),
  cursor: z.string().min(1).max(2048).optional(),
});
export type SearchInput = z.input<typeof searchSchema>;
export type SearchHit = {
  type: 'issue' | 'spec' | 'project';
  id: string;
  reference: string;
  title: string;
  excerpt: string;
  updated_at: string | null;
};
export type SearchPage = { results: SearchHit[]; next_cursor: string | null };
